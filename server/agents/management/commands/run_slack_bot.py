"""
Flaude Slack Bot — Django management command.

Usage:
    python manage.py run_slack_bot

Requires:
    - SLACK_BOT_TOKEN env var
    - SLACK_APP_TOKEN env var (for Socket Mode)

Features:
    1. /ask <member> <message> — Execute agent or team
    2. /agents — List active agents
    3. /client <info> — Auto-parse and register client
    4. /link <token> — Link Slack account to Flaude
    5. Team execution — Sequential/parallel orchestration
    6. Channel-based routing
"""

import asyncio
import os
import logging

from django.core.management.base import BaseCommand
from asgiref.sync import sync_to_async

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

from agents.models import Agent, AgentTeam, Client, UserPlatformLink

logger = logging.getLogger("flaude.slack")


# ── DB helpers ───────────────────────────────────────────────


@sync_to_async
def find_agent_for_channel(channel_id: str) -> Agent | None:
    for agent in Agent.objects.filter(status="active"):
        if str(channel_id) in [str(c) for c in (agent.channels or [])]:
            return agent
    return None


@sync_to_async
def find_agent_by_name(name: str) -> Agent | None:
    try:
        return Agent.objects.get(status="active", name__iexact=name)
    except Agent.DoesNotExist:
        return None


@sync_to_async
def get_active_agents():
    return list(Agent.objects.filter(status="active"))


@sync_to_async
def find_team_by_name(name: str) -> AgentTeam | None:
    try:
        return AgentTeam.objects.get(name__iexact=name)
    except AgentTeam.DoesNotExist:
        return None


@sync_to_async
def get_team_agents(team: AgentTeam) -> list[Agent]:
    sorted_members = sorted(team.members, key=lambda m: m.get("order", 0))
    agents = []
    for m in sorted_members:
        try:
            agents.append(Agent.objects.get(id=m["agent_id"], status="active"))
        except Agent.DoesNotExist:
            continue
    return agents


@sync_to_async
def resolve_slack_user(slack_user_id: str) -> int | None:
    try:
        link = UserPlatformLink.objects.get(
            platform="slack", platform_user_id=str(slack_user_id)
        )
        return link.user_id
    except UserPlatformLink.DoesNotExist:
        return None


async def parse_client_text(raw_text: str) -> dict:
    """Parse client info using claude CLI (haiku model)."""
    import json as json_mod
    from agents.api import _fallback_parse

    prompt = (
        f"Parse the following client info into JSON. "
        f"Extract: company, contact_name, email, phone, department, notes. "
        f"Return ONLY valid JSON, no markdown.\n\nInput: {raw_text}"
    )
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt, "--model", "haiku",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode == 0 and stdout:
            text = stdout.decode().strip()
            if text.startswith("```"):
                text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = "\n".join(text.split("\n")[:-1])
            return json_mod.loads(text.strip())
    except Exception as e:
        logger.warning("Claude CLI parsing failed, using fallback: %s", e)

    return _fallback_parse(raw_text)


@sync_to_async
def save_client_to_db(parsed: dict, workspace_id: int | None) -> None:
    if not workspace_id:
        return
    from django.contrib.auth.models import User
    admin = User.objects.first()
    if admin:
        Client.objects.create(
            workspace_id=workspace_id,
            created_by=admin,
            company=parsed.get("company", ""),
            contact_name=parsed.get("contact_name", ""),
            email=parsed.get("email", ""),
            phone=parsed.get("phone", ""),
            department=parsed.get("department", ""),
            notes=parsed.get("notes", ""),
        )


# ── Claude subprocess runner ─────────────────────────────────

# Track which thread belongs to which agent: { thread_ts: agent_name }
_thread_agents: dict[str, str] = {}


def _thread_to_uuid(thread_ts: str) -> str:
    """Convert Slack thread_ts to a deterministic UUID."""
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"slack-thread:{thread_ts}"))


async def run_claude(agent: Agent, prompt: str, session_id: str | None = None, resume: bool = False) -> str:
    cmd = [
        "claude", "-p", prompt,
        "--model", "opus",
        "--system-prompt", agent.instructions,
        "--permission-mode", "bypassPermissions",
    ]

    if agent.tools:
        cmd += ["--allowedTools", ",".join(agent.tools)]
    if agent.not_allowed:
        cmd += ["--disallowedTools", ",".join(agent.not_allowed)]

    if session_id:
        if resume:
            cmd += ["--resume", session_id]
        else:
            cmd += ["--session-id", session_id]

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        err = stderr.decode().strip()
        return f"Error: {err[:500]}"

    return stdout.decode().strip()


# ── Team Orchestrator ────────────────────────────────────────


async def run_team(team: AgentTeam, agents: list[Agent], prompt: str) -> list[dict]:
    results = []

    if team.execution_mode == "parallel":
        tasks = [run_claude(agent, prompt) for agent in agents]
        outputs = await asyncio.gather(*tasks, return_exceptions=True)
        for agent, output in zip(agents, outputs):
            if isinstance(output, Exception):
                results.append({"agent_name": agent.name, "result": f"Error: {output}"})
            else:
                results.append({"agent_name": agent.name, "result": output})
    else:
        accumulated_context = ""
        for i, agent in enumerate(agents):
            if i == 0:
                full_prompt = prompt
            else:
                full_prompt = (
                    f"이전 에이전트({agents[i-1].name})의 결과:\n"
                    f"---\n{accumulated_context}\n---\n\n"
                    f"사용자 요청: {prompt}"
                )
            result = await run_claude(agent, full_prompt)
            results.append({"agent_name": agent.name, "result": result})
            accumulated_context = result

    return results


# ── Block Kit helpers ────────────────────────────────────────


def format_agent_response(agent_name: str, role: str, text: str) -> list[dict]:
    header = f"[{agent_name} · {role}]"
    blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*{header}*"}},
    ]
    for chunk in _split_text(text, limit=3000):
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": chunk}})
    return blocks


def _split_text(text: str, limit: int = 3000) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break
        idx = text.rfind("\n", 0, limit)
        if idx == -1:
            idx = limit
        chunks.append(text[:idx])
        text = text[idx:].lstrip("\n")
    return chunks


# ── Build the Slack Bolt async app ───────────────────────────


def create_slack_app(token: str) -> AsyncApp:
    app = AsyncApp(token=token)

    # ── /ask <member> <message> ──────────────────────────
    @app.command("/ask")
    async def handle_ask(ack, command, client):
        await ack()

        raw_text = (command.get("text") or "").strip()
        if not raw_text:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="Usage: `/ask <member> <message>`\nExample: `/ask 수현 삼성SDS 조사해줘`",
            )
            return

        parts = raw_text.split(None, 1)
        member_name = parts[0]
        message = parts[1] if len(parts) > 1 else ""

        if not message:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="메시지를 입력해주세요. Example: `/ask 수현 삼성SDS 조사해줘`",
            )
            return

        # Check if it's a team
        team = await find_team_by_name(member_name)
        if team:
            agents = await get_team_agents(team)
            if not agents:
                await client.chat_postEphemeral(
                    channel=command["channel_id"],
                    user=command["user_id"],
                    text=f"Team '{member_name}' has no active agents.",
                )
                return

            initial = await client.chat_postMessage(
                channel=command["channel_id"],
                text=f"*{team.name}* 팀이 작업을 시작합니다...",
            )

            results = await run_team(team, agents, message)
            for r in results:
                agent_obj = await find_agent_by_name(r["agent_name"])
                role = agent_obj.role if agent_obj else ""
                blocks = format_agent_response(r["agent_name"], role, r["result"])
                await client.chat_postMessage(
                    channel=command["channel_id"],
                    thread_ts=initial["ts"],
                    blocks=blocks,
                    text=f"[{r['agent_name']}]\n{r['result']}",
                )
            return

        # Single agent
        agent = await find_agent_by_name(member_name)
        if not agent:
            agents = await get_active_agents()
            names = ", ".join(a.name for a in agents)
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text=f"`{member_name}` not found. Available: {names or 'none'}",
            )
            return

        # 1. 먼저 초기 메시지 → thread_ts 확보
        initial = await client.chat_postMessage(
            channel=command["channel_id"],
            text=f"*{agent.name}*에게 전달했습니다...",
        )
        thread_ts = initial["ts"]

        # thread_ts → agent 매핑 저장 (후속 질문용)
        _thread_agents[thread_ts] = agent.name

        # 2. thread_ts를 session_id로 사용해서 실행
        flaude_user_id = await resolve_slack_user(command["user_id"])
        result = None
        if flaude_user_id:
            from agents.dispatch import dispatch_task
            result = await dispatch_task(str(flaude_user_id), agent.name, message)

        if not result:
            result = await run_claude(agent, message, session_id=_thread_to_uuid(thread_ts))

        # 3. 결과를 스레드에 올림
        blocks = format_agent_response(agent.name, agent.role, result)
        await client.chat_postMessage(
            channel=command["channel_id"],
            thread_ts=thread_ts,
            blocks=blocks,
            text=f"[{agent.name} · {agent.role}]\n{result}",
        )

    # ── /agents ──────────────────────────────────────────
    @app.command("/agents")
    async def handle_agents(ack, command, client):
        await ack()
        agents = await get_active_agents()
        if not agents:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="No active agents.",
            )
            return
        lines = []
        for a in agents:
            ch_list = ", ".join(f"<#{c}>" for c in (a.channels or []))
            line = f"*{a.name}* — {a.role}"
            if ch_list:
                line += f" ({ch_list})"
            lines.append(line)
        await client.chat_postEphemeral(
            channel=command["channel_id"],
            user=command["user_id"],
            text="\n".join(lines),
        )

    # ── /client ──────────────────────────────────────────
    @app.command("/client")
    async def handle_client(ack, command, client):
        await ack()

        raw_text = (command.get("text") or "").strip()
        if not raw_text:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="Usage: `/client 삼성SDS 김부장 kim@samsung.com 010-1234-5678`",
            )
            return

        from agents.models import Workspace
        ws = await sync_to_async(Workspace.objects.first)()
        ws_id = ws.id if ws else None

        parsed = await parse_client_text(raw_text)
        await save_client_to_db(parsed, ws_id)

        name = parsed.get("contact_name", "")
        company = parsed.get("company", "")
        display = f"{company} {name}".strip() or raw_text

        import json
        formatted = json.dumps({k: v for k, v in parsed.items() if v}, ensure_ascii=False, indent=2)

        await client.chat_postMessage(
            channel=command["channel_id"],
            text=f"*{display}* 등록했습니다.\n```{formatted}```",
        )

    # ── /link ────────────────────────────────────────────
    @app.command("/link")
    async def handle_link(ack, command, client):
        await ack()

        token = (command.get("text") or "").strip()
        if not token:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="Usage: `/link <flaude_token>`\nFlaude 앱의 Settings에서 토큰을 복사하세요.",
            )
            return

        from agents.models import AuthToken
        try:
            auth = await sync_to_async(
                lambda: AuthToken.objects.select_related("user").get(token=token)
            )()
            await sync_to_async(UserPlatformLink.objects.update_or_create)(
                platform="slack",
                platform_user_id=command["user_id"],
                defaults={
                    "user": auth.user,
                    "platform_team_id": command.get("team_id", ""),
                },
            )
            user_name = auth.user.first_name or auth.user.email
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text=f"연결 완료! Slack 계정이 *{user_name}*에 연결되었습니다.\n"
                     f"이제 `/ask` 명령 시 당신의 맥에서 에이전트가 실행됩니다.",
            )
        except AuthToken.DoesNotExist:
            await client.chat_postEphemeral(
                channel=command["channel_id"],
                user=command["user_id"],
                text="유효하지 않은 토큰입니다. Flaude 앱 Settings에서 정확한 토큰을 복사해주세요.",
            )

    # ── Channel-based routing + thread resume ──────────────
    @app.event("message")
    async def handle_message(event, client):
        if event.get("bot_id") or event.get("subtype"):
            return

        user_text = event.get("text", "").strip()
        if not user_text:
            return

        channel_id = event.get("channel", "")
        thread_ts = event.get("thread_ts")  # None if top-level message

        # Thread follow-up: resume session if we know this thread
        if thread_ts and thread_ts in _thread_agents:
            agent_name = _thread_agents[thread_ts]
            agent = await find_agent_by_name(agent_name)
            if agent:
                result = await run_claude(agent, user_text, session_id=_thread_to_uuid(thread_ts), resume=True)
                blocks = format_agent_response(agent.name, agent.role, result)
                await client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=thread_ts,
                    blocks=blocks,
                    text=f"[{agent.name} · {agent.role}]\n{result}",
                )
                return

        # Channel-based routing (top-level messages only)
        agent = await find_agent_for_channel(channel_id)
        if not agent:
            return

        result = await run_claude(agent, user_text)
        blocks = format_agent_response(agent.name, agent.role, result)
        reply_ts = thread_ts or event.get("ts")

        await client.chat_postMessage(
            channel=channel_id,
            thread_ts=reply_ts,
            blocks=blocks,
            text=f"[{agent.name} · {agent.role}]\n{result}",
        )

    return app


# ── Django management command ────────────────────────────────


class Command(BaseCommand):
    help = "Run the Flaude Slack bot"

    def add_arguments(self, parser):
        parser.add_argument(
            "--token", type=str,
            default=os.environ.get("SLACK_BOT_TOKEN", ""),
            help="Slack bot token (or set SLACK_BOT_TOKEN env var)",
        )
        parser.add_argument(
            "--app-token", type=str,
            default=os.environ.get("SLACK_APP_TOKEN", ""),
            help="Slack app-level token for Socket Mode (or set SLACK_APP_TOKEN env var)",
        )

    def handle(self, *args, **options):
        token = options["token"]
        app_token = options["app_token"]

        if not token:
            self.stderr.write("Error: No Slack bot token. Set SLACK_BOT_TOKEN env var or pass --token.")
            return
        if not app_token:
            self.stderr.write("Error: No Slack app token. Set SLACK_APP_TOKEN env var or pass --app-token.")
            return

        logging.basicConfig(level=logging.INFO)
        self.stdout.write("Starting Flaude Slack bot...")

        slack_app = create_slack_app(token)

        async def _run():
            handler = AsyncSocketModeHandler(slack_app, app_token)
            await handler.start_async()

        asyncio.run(_run())
