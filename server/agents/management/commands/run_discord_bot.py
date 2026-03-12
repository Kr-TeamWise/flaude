"""
Flaude Discord Bot — Django management command.

Usage:
    python manage.py run_discord_bot

Requires:
    - DISCORD_TOKEN env var or .env file

Features:
    1. /ask <member> <message> — Execute agent (local or dispatch to user's Mac)
    2. /agents — List active agents
    3. /client <info> — Auto-parse and register client
    4. @Flaude <message> — Mention-based invocation
    5. Team execution — Sequential/parallel agent orchestration
    6. Platform linking — Maps Discord user to Flaude user for dispatch
"""

import asyncio
import os
import logging

import discord
from discord import app_commands
from django.core.management.base import BaseCommand
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentTeam, Client, UserPlatformLink

logger = logging.getLogger("flaude.discord")


# ── DB helpers ───────────────────────────────────────────────


@sync_to_async
def find_agent_by_name(name: str) -> Agent | None:
    try:
        return Agent.objects.get(status="active", name__iexact=name)
    except Agent.DoesNotExist:
        return None


@sync_to_async
def find_agent_for_channel(channel_id: str) -> Agent | None:
    for agent in Agent.objects.filter(status="active"):
        if str(channel_id) in [str(c) for c in (agent.channels or [])]:
            return agent
    return None


@sync_to_async
def get_active_agents():
    return list(Agent.objects.filter(status="active"))


@sync_to_async
def get_active_agent_count():
    return Agent.objects.filter(status="active").count()


@sync_to_async
def get_first_active_agent():
    return Agent.objects.filter(status="active").first()


@sync_to_async
def find_team_by_name(name: str) -> AgentTeam | None:
    try:
        return AgentTeam.objects.get(name__iexact=name)
    except AgentTeam.DoesNotExist:
        return None


@sync_to_async
def get_team_agents(team: AgentTeam) -> list[Agent]:
    """Load team's agents in order."""
    sorted_members = sorted(team.members, key=lambda m: m.get("order", 0))
    agents = []
    for m in sorted_members:
        try:
            agents.append(Agent.objects.get(id=m["agent_id"], status="active"))
        except Agent.DoesNotExist:
            continue
    return agents


@sync_to_async
def resolve_discord_user(discord_user_id: str) -> int | None:
    """Look up Flaude user_id from Discord user ID."""
    try:
        link = UserPlatformLink.objects.get(
            platform="discord", platform_user_id=str(discord_user_id)
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

# Track which thread belongs to which agent: { thread_id: agent_name }
_thread_agents: dict[str, str] = {}
# Track threads that already have a session (first message sent)
_thread_sessions: set[str] = set()


def _thread_to_uuid(thread_id: str) -> str:
    """Convert Discord thread ID (snowflake) to a deterministic UUID."""
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"discord-thread:{thread_id}"))


async def run_claude(agent: Agent, prompt: str, session_id: str | None = None, resume: bool = False) -> str:
    """Run claude -p subprocess with agent config.

    session_id: UUID (converted from thread_id)
    resume: True면 --resume (후속 질문), False면 --session-id (첫 질문)
    """
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
    """Execute a team of agents. Returns list of { agent_name, result }."""
    results = []

    if team.execution_mode == "parallel":
        # Run all agents concurrently
        tasks = [run_claude(agent, prompt) for agent in agents]
        outputs = await asyncio.gather(*tasks, return_exceptions=True)
        for agent, output in zip(agents, outputs):
            if isinstance(output, Exception):
                results.append({"agent_name": agent.name, "result": f"Error: {output}"})
            else:
                results.append({"agent_name": agent.name, "result": output})
    else:
        # Sequential: pipe output from one agent to the next
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


# ── Helpers ──────────────────────────────────────────────────


def split_message(text: str, limit: int = 2000) -> list[str]:
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


async def get_or_create_webhook(channel) -> discord.Webhook:
    """Get or create Flaude webhook. Handles both TextChannel and Thread."""
    target = channel.parent if isinstance(channel, discord.Thread) else channel
    webhooks = await target.webhooks()
    for wh in webhooks:
        if wh.name == "Flaude":
            return wh
    return await target.create_webhook(name="Flaude")


_AVATAR_BG = ["F9C4AC", "B8E0D2", "D4C5F9", "F9E2AE", "A8D8EA", "F5B7B1", "C3E8BD", "E8D5B7"]


def _avatar_url(agent_name: str) -> str:
    h = sum(ord(c) for c in agent_name)
    bg = _AVATAR_BG[h % len(_AVATAR_BG)]
    return f"https://api.dicebear.com/9.x/notionists/svg?seed={agent_name}&backgroundColor={bg}&backgroundType=solid"


# ── Bot ──────────────────────────────────────────────────────


class FlaudeBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.all()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        # ── Autocomplete ─────────────────────────────────
        async def member_autocomplete(
            interaction: discord.Interaction, current: str
        ) -> list[app_commands.Choice[str]]:
            agents = await get_active_agents()
            # Also include teams
            from asgiref.sync import sync_to_async
            teams = await sync_to_async(list)(AgentTeam.objects.all())

            choices = []
            for a in agents:
                if current.lower() in a.name.lower():
                    choices.append(app_commands.Choice(name=f"{a.name} — {a.role}", value=a.name))
            for t in teams:
                if current.lower() in t.name.lower():
                    choices.append(app_commands.Choice(name=f"{t.name} (Team)", value=t.name))
            return choices[:25]

        # ── /ask ─────────────────────────────────────────
        @self.tree.command(name="ask", description="팀 멤버에게 메시지 보내기")
        @app_commands.describe(member="멤버 또는 팀 선택", message="보낼 메시지")
        @app_commands.autocomplete(member=member_autocomplete)
        async def ask_command(
            interaction: discord.Interaction,
            member: str,
            message: str,
        ):
            member_name = member

            # Check if it's a team
            team = await find_team_by_name(member_name)
            if team:
                agents = await get_team_agents(team)
                if not agents:
                    await interaction.response.send_message(f"Team '{member_name}' has no active agents.", ephemeral=True)
                    return

                await interaction.response.send_message(f"**{team.name}** 팀이 작업을 시작합니다...")
                webhook = await get_or_create_webhook(interaction.channel)
                thread = interaction.channel if isinstance(interaction.channel, discord.Thread) else discord.utils.MISSING
                results = await run_team(team, agents, message)
                for r in results:
                    for chunk in split_message(r["result"]):
                        await webhook.send(
                            content=chunk,
                            username=r["agent_name"],
                            avatar_url=_avatar_url(r["agent_name"]),
                            thread=thread,
                        )
                return

            # Single agent
            found = await find_agent_by_name(member_name)
            if not found:
                agents = await get_active_agents()
                names = ", ".join(a.name for a in agents)
                await interaction.response.send_message(
                    f"`{member_name}` not found. Available: {names or 'none'}", ephemeral=True,
                )
                return

            await interaction.response.send_message(
                f"**{interaction.user.display_name}**: {message}",
            )

            # Try dispatch to user's Mac first
            flaude_user_id = await resolve_discord_user(str(interaction.user.id))
            result = None
            if flaude_user_id:
                from agents.dispatch import dispatch_task
                result = await dispatch_task(str(flaude_user_id), found.name, message)

            if not result:
                result = await run_claude(found, message)

            # Reply in same channel/thread
            webhook = await get_or_create_webhook(interaction.channel)
            thread = interaction.channel if isinstance(interaction.channel, discord.Thread) else discord.utils.MISSING
            for chunk in split_message(result):
                await webhook.send(
                    content=chunk,
                    username=found.name,
                    avatar_url=_avatar_url(found.name),
                    thread=thread,
                )

        # ── /agents ──────────────────────────────────────
        @self.tree.command(name="agents", description="Flaude 멤버 목록")
        async def agents_command(interaction: discord.Interaction):
            agents = await get_active_agents()
            if not agents:
                await interaction.response.send_message("No active agents.", ephemeral=True)
                return
            lines = []
            for a in agents:
                channels = ", ".join(f"<#{c}>" for c in (a.channels or []))
                lines.append(f"**{a.name}** — {a.role}{f' ({channels})' if channels else ''}")
            await interaction.response.send_message("\n".join(lines), ephemeral=True)

        # ── /client ──────────────────────────────────────
        @self.tree.command(name="client", description="클라이언트 등록/업데이트")
        @app_commands.describe(info="클라이언트 정보 (이름, 회사, 이메일, 전화 등)")
        async def client_command(interaction: discord.Interaction, info: str):
            if not info.strip():
                await interaction.response.send_message(
                    "Usage: `/client 삼성SDS 김부장 kim@samsung.com 010-1234-5678`",
                    ephemeral=True,
                )
                return

            await interaction.response.defer()

            from agents.models import Workspace
            ws = await sync_to_async(Workspace.objects.first)()
            ws_id = ws.id if ws else None

            parsed = await parse_client_text(info)
            await save_client_to_db(parsed, ws_id)

            name = parsed.get("contact_name", "")
            company = parsed.get("company", "")
            display = f"{company} {name}".strip() or info

            await interaction.followup.send(
                f"**{display}** 등록했습니다.\n"
                f"```json\n{_format_parsed(parsed)}\n```"
            )

        # ── /link ────────────────────────────────────────
        @self.tree.command(name="link", description="Discord 계정을 Flaude에 연결")
        @app_commands.describe(token="Flaude 앱의 Settings에서 복사한 연결 토큰")
        async def link_command(interaction: discord.Interaction, token: str):
            """Link Discord user to Flaude account using auth token."""
            from agents.models import AuthToken
            try:
                auth = await sync_to_async(
                    lambda: AuthToken.objects.select_related("user").get(token=token)
                )()
                link, created = await sync_to_async(UserPlatformLink.objects.update_or_create)(
                    platform="discord",
                    platform_user_id=str(interaction.user.id),
                    defaults={
                        "user": auth.user,
                        "platform_team_id": str(interaction.guild_id or ""),
                    },
                )
                await interaction.response.send_message(
                    f"연결 완료! Discord 계정이 **{auth.user.first_name or auth.user.email}**에 연결되었습니다.\n"
                    f"이제 `/ask` 명령 시 당신의 맥에서 에이전트가 실행됩니다.",
                    ephemeral=True,
                )
            except AuthToken.DoesNotExist:
                await interaction.response.send_message(
                    "유효하지 않은 토큰입니다. Flaude 앱 Settings에서 정확한 토큰을 복사해주세요.",
                    ephemeral=True,
                )

        # Sync commands globally + per guild for instant availability
        await self.tree.sync()
        logger.info("Slash commands synced (global)")

    async def on_ready(self):
        # Sync to each guild for immediate availability
        for guild in self.guilds:
            try:
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
                logger.info("Commands synced to guild: %s (%s)", guild.name, guild.id)
            except Exception as e:
                logger.warning("Failed to sync to guild %s: %s", guild.name, e)
        logger.info(f"Bot ready: {self.user} (ID: {self.user.id})")
        count = await get_active_agent_count()
        logger.info(f"Active agents: {count}")

    async def on_message(self, message: discord.Message):
        if message.author == self.user or message.author.bot:
            return

        # ── 스레드 내 후속 질문 → --resume ──
        if isinstance(message.channel, discord.Thread):
            thread_id = str(message.channel.id)
            agent_name = _thread_agents.get(thread_id)

            # 스레드에 매핑이 없으면, 스레드가 만들어진 원본 메시지(parent)의 작성자로 에이전트 추론
            if not agent_name:
                try:
                    # thread.id == parent message id (스레드가 달린 메시지)
                    parent_channel = message.channel.parent
                    starter = await parent_channel.fetch_message(message.channel.id)
                    if starter.author.bot:
                        found = await find_agent_by_name(starter.author.display_name)
                        if found:
                            agent_name = found.name
                            _thread_agents[thread_id] = agent_name
                except Exception as e:
                    logger.warning("Failed to find agent for thread: %s", e)

            if agent_name:
                agent = await find_agent_by_name(agent_name)
                if agent:
                    session_uuid = _thread_to_uuid(thread_id)
                    is_first = thread_id not in _thread_sessions
                    async with message.channel.typing():
                        result = await run_claude(
                            agent, message.content,
                            session_id=session_uuid, resume=not is_first,
                        )
                    if is_first:
                        _thread_sessions.add(thread_id)
                    webhook = await get_or_create_webhook(message.channel.parent)
                    for chunk in split_message(result):
                        await webhook.send(
                            content=chunk,
                            username=agent.name,
                            avatar_url=_avatar_url(agent.name),
                            thread=message.channel,
                        )
                    return

        # ── Channel-based routing ──
        agent = await find_agent_for_channel(str(message.channel.id))

        # ── Bot mention routing ──
        if not agent and self.user in message.mentions:
            content = message.content.replace(f"<@{self.user.id}>", "").strip()
            if not content:
                await message.reply(
                    "Usage: `@Flaude <message>` or `/ask <member> <message>`\n"
                    "Type `/agents` to see available members."
                )
                return

            words = content.split(None, 1)
            agent = await find_agent_by_name(words[0]) if words else None
            if agent and len(words) > 1:
                content = words[1]
            elif not agent:
                agent = await get_first_active_agent()

            if not agent:
                await message.reply("No active agents available.")
                return

            async with message.channel.typing():
                result = await run_claude(agent, content)
            webhook = await get_or_create_webhook(message.channel)
            for chunk in split_message(result):
                await webhook.send(
                    content=chunk,
                    username=agent.name,
                    avatar_url=_avatar_url(agent.name),
                )
            return

        # ── Channel-routed agent ──
        if agent:
            async with message.channel.typing():
                result = await run_claude(agent, message.content)
            webhook = await get_or_create_webhook(message.channel)
            for chunk in split_message(result):
                await webhook.send(
                    content=chunk,
                    username=agent.name,
                    avatar_url=_avatar_url(agent.name),
                )


def _format_parsed(parsed: dict) -> str:
    import json
    return json.dumps(
        {k: v for k, v in parsed.items() if v},
        ensure_ascii=False, indent=2,
    )


class Command(BaseCommand):
    help = "Run the Flaude Discord bot"

    def add_arguments(self, parser):
        parser.add_argument(
            "--token", type=str,
            default=os.environ.get("DISCORD_TOKEN", ""),
            help="Discord bot token (or set DISCORD_TOKEN env var)",
        )

    def handle(self, *args, **options):
        token = options["token"]
        if not token:
            self.stderr.write("Error: No Discord token. Set DISCORD_TOKEN env var or pass --token.")
            return

        logging.basicConfig(level=logging.INFO)
        self.stdout.write("Starting Flaude Discord bot...")
        bot = FlaudeBot()
        bot.run(token, log_handler=None)
