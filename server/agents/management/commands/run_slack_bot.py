"""
Flaude Slack Bot — Django management command.

Usage:
    python manage.py run_slack_bot

Requires:
    - SLACK_BOT_TOKEN env var
    - SLACK_APP_TOKEN env var (for Socket Mode)

Features:
    - @agent_name message — Natural message routing
    - Thread-based session continuity (SDK session resume)
    - /agents, /teams, /status, /history, /client, /link, /help
    - /approve, /reject, /approvals, /schedule
"""

import asyncio
import json
import os
import logging

from django.core.management.base import BaseCommand
from asgiref.sync import sync_to_async

from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

from agents.models import Agent, AgentTeam, Client, Meeting, MeetingTranscript, UserPlatformLink, ThreadMessage
from agents.orchestrator import (
    execute_agent, run_team, get_team_agents_with_meta,
    get_running_executions, get_execution_history,
    get_pending_approvals, decide_approval, resume_after_approval,
)

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
def get_all_teams():
    return list(AgentTeam.objects.all())


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


# ── Session tracking ─────────────────────────────────────────

_thread_agents: dict[str, str] = {}
_thread_sessions: dict[str, str] = {}  # thread_ts → sdk_session_id


@sync_to_async
def _save_thread_msg(platform: str, thread_id: str, agent_name: str, role: str, content: str, sdk_session_id: str = ""):
    ThreadMessage.objects.create(
        platform=platform, thread_id=thread_id,
        agent_name=agent_name, role=role, content=content[:1000],
        sdk_session_id=sdk_session_id,
    )
    # Keep only last 20 per thread
    ids = list(
        ThreadMessage.objects.filter(platform=platform, thread_id=thread_id)
        .order_by("-created_at").values_list("id", flat=True)[20:]
    )
    if ids:
        ThreadMessage.objects.filter(id__in=ids).delete()


@sync_to_async
def _get_thread_agent(platform: str, thread_id: str) -> str | None:
    last = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id, role="agent"
    ).order_by("-created_at").first()
    return last.agent_name if last else None


@sync_to_async
def _get_thread_session_db(platform: str, thread_id: str) -> str | None:
    """Get the latest SDK session_id for a thread from DB."""
    last = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id, role="agent",
    ).exclude(sdk_session_id="").order_by("-created_at").values_list("sdk_session_id", flat=True).first()
    return last


async def _fetch_slack_channel_context(slack_client, channel_id: str, limit: int = 15) -> str:
    """Fetch recent messages from Slack channel as context."""
    try:
        resp = await slack_client.conversations_history(channel=channel_id, limit=limit)
        messages = []
        for msg in reversed(resp.get("messages", [])):
            text = msg.get("text", "").strip()
            if not text or text.startswith("/"):
                continue
            user = msg.get("user", "someone")
            messages.append(f"{user}: {text[:300]}")
        if not messages:
            return ""
        return "[채널 최근 메시지]\n" + "\n".join(messages) + "\n\n"
    except Exception as e:
        logger.warning("Failed to fetch channel context: %s", e)
        return ""


def _slack_attachment_context(event: dict) -> str:
    """Build a context string from Slack message file attachments."""
    files = event.get("files", [])
    if not files:
        return ""
    lines = []
    for f in files:
        name = f.get("name", f.get("title", "file"))
        mimetype = f.get("mimetype", "unknown")
        size_kb = (f.get("size", 0)) // 1024
        # url_private_download requires bot token auth; permalink_public is accessible
        url = f.get("permalink_public") or f.get("url_private_download") or f.get("permalink", "")
        lines.append(f"- {name} ({mimetype}, {size_kb}KB): {url}")
    return "\n\n[첨부 파일]\n" + "\n".join(lines) + "\n위 URL에서 파일 내용을 확인할 수 있습니다.\n"


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

    # ── /agents ──────────────────────────────────────────
    @app.command("/agents")
    async def handle_agents(ack, command, client):
        await ack()
        agents = await get_active_agents()
        if not agents:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="No active agents.")
            return
        lines = [f"*{a.name}* — {a.role}" for a in agents]
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n".join(lines))

    # ── /teams ───────────────────────────────────────────
    @app.command("/teams")
    async def handle_teams(ack, command, client):
        await ack()
        teams = await get_all_teams()
        if not teams:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="No teams configured.")
            return
        lines = []
        for t in teams:
            member_count = len(t.members or [])
            has_lead = any(m.get("is_lead") for m in (t.members or []))
            lead_str = " (has lead)" if has_lead else ""
            lines.append(f"*{t.name}* — {t.execution_mode}, {member_count} members{lead_str}")
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n".join(lines))

    # ── /status ──────────────────────────────────────────
    @app.command("/status")
    async def handle_status(ack, command, client):
        await ack()
        agent_filter = (command.get("text") or "").strip() or None
        running = await get_running_executions(agent_filter)
        if not running:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="현재 실행 중인 작업이 없습니다.")
            return
        lines = [f"🔄 *{r['agent_name']}* — `{r['prompt']}` ({r['elapsed_seconds']}s, {r['platform']})" for r in running]
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n".join(lines))

    # ── /history ─────────────────────────────────────────
    @app.command("/history")
    async def handle_history(ack, command, client):
        await ack()
        agent_filter = (command.get("text") or "").strip() or None
        history = await get_execution_history(agent_filter, 10)
        if not history:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="실행 이력이 없습니다.")
            return
        lines = []
        for h in history:
            icon = "✅" if h["status"] == "completed" else "❌"
            duration = f"{h['duration_ms']}ms" if h["duration_ms"] else "?"
            lines.append(f"{icon} *{h['agent_name']}* — `{h['prompt']}` ({duration}, {h['platform']})")
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n".join(lines))

    # ── /client ──────────────────────────────────────────
    @app.command("/client")
    async def handle_client(ack, command, client):
        await ack()
        raw_text = (command.get("text") or "").strip()
        if not raw_text:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="Usage: `/client 삼성SDS 김부장 kim@samsung.com`")
            return

        from agents.models import Workspace
        ws = await sync_to_async(Workspace.objects.first)()
        ws_id = ws.id if ws else None
        parsed = await parse_client_text(raw_text)
        await save_client_to_db(parsed, ws_id)

        name = parsed.get("contact_name", "")
        company = parsed.get("company", "")
        display = f"{company} {name}".strip() or raw_text
        formatted = json.dumps({k: v for k, v in parsed.items() if v}, ensure_ascii=False, indent=2)
        await client.chat_postMessage(channel=command["channel_id"], text=f"*{display}* 등록했습니다.\n```{formatted}```")

    # ── /link ────────────────────────────────────────────
    @app.command("/link")
    async def handle_link(ack, command, client):
        await ack()
        token = (command.get("text") or "").strip()
        if not token:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="Usage: `/link <flaude_token>`")
            return

        from agents.models import AuthToken
        try:
            auth = await sync_to_async(lambda: AuthToken.objects.select_related("user").get(token=token))()
            await sync_to_async(UserPlatformLink.objects.update_or_create)(
                platform="slack", platform_user_id=command["user_id"],
                defaults={"user": auth.user, "platform_team_id": command.get("team_id", "")},
            )
            user_name = auth.user.first_name or auth.user.email
            await client.chat_postEphemeral(
                channel=command["channel_id"], user=command["user_id"],
                text=f"연결 완료! Slack 계정이 *{user_name}*에 연결되었습니다.",
            )
        except AuthToken.DoesNotExist:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="유효하지 않은 토큰입니다.")

    # ── /approve ─────────────────────────────────────────
    @app.command("/approve")
    async def handle_approve(ack, command, client):
        await ack()
        text = (command.get("text") or "").strip()
        if not text or not text.isdigit():
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="Usage: `/approve <id>`")
            return

        approval_id = int(text)
        try:
            from agents.models import ApprovalRequest
            approval = await sync_to_async(
                lambda: ApprovalRequest.objects.select_related("team", "agent", "next_agent").get(
                    id=approval_id, status="pending"
                )
            )()
            approval.status = "approved"
            approval.decided_by = command.get("user_id", "")
            from django.utils import timezone as tz
            approval.decided_at = tz.now()
            await sync_to_async(approval.save)(update_fields=["status", "decided_by", "decided_at"])

            next_name = await sync_to_async(lambda: approval.next_agent.name)()
            await client.chat_postMessage(
                channel=command["channel_id"],
                text=f"✅ 승인 완료! *{next_name}* 실행을 시작합니다..."
            )

            # Resolve user for dispatch
            flaude_user_id = await resolve_slack_user(command.get("user_id", ""))
            if flaude_user_id:
                team_result = await resume_after_approval(approval, flaude_user_id)
                for r in team_result.results:
                    blocks = format_agent_response(r.agent_name, r.role, r.result)
                    await client.chat_postMessage(channel=command["channel_id"], blocks=blocks, text=f"[{r.agent_name}]\n{r.result}")
            else:
                await client.chat_postEphemeral(
                    channel=command["channel_id"], user=command["user_id"],
                    text="Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
                )

        except ApprovalRequest.DoesNotExist:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="해당 승인 요청을 찾을 수 없습니다.")

    # ── /reject ──────────────────────────────────────────
    @app.command("/reject")
    async def handle_reject(ack, command, client):
        await ack()
        text = (command.get("text") or "").strip()
        if not text or not text.isdigit():
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="Usage: `/reject <id>`")
            return

        approval_id = int(text)
        try:
            from agents.models import ApprovalRequest
            approval = await sync_to_async(
                lambda: ApprovalRequest.objects.select_related("team", "next_agent").get(
                    id=approval_id, status="pending"
                )
            )()
            approval.status = "rejected"
            approval.decided_by = command.get("user_id", "")
            from django.utils import timezone as tz
            approval.decided_at = tz.now()
            await sync_to_async(approval.save)(update_fields=["status", "decided_by", "decided_at"])

            next_name = await sync_to_async(lambda: approval.next_agent.name)()
            await client.chat_postMessage(
                channel=command["channel_id"],
                text=f"❌ 거절됨. *{next_name}* 실행이 취소되었습니다."
            )
        except ApprovalRequest.DoesNotExist:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="해당 승인 요청을 찾을 수 없습니다.")

    # ── /approvals ───────────────────────────────────────
    @app.command("/approvals")
    async def handle_approvals(ack, command, client):
        await ack()
        pending = await get_pending_approvals()
        if not pending:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="대기 중인 승인이 없습니다.")
            return
        lines = []
        for a in pending:
            lines.append(
                f"⏸️ ID: `{a['id']}` — *{a['team_name']}*: "
                f"{a['agent_name']} → {a['next_agent_name']}\n"
                f"  > {a['result_preview'][:100]}...\n"
                f"  `/approve {a['id']}` 또는 `/reject {a['id']}`"
            )
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n\n".join(lines))

    # ── /schedule ────────────────────────────────────────
    @app.command("/schedule")
    async def handle_schedule(ack, command, client):
        await ack()
        from agents.models import AgentSchedule
        schedules = await sync_to_async(
            lambda: list(AgentSchedule.objects.filter(is_active=True).select_related("agent", "team")[:20])
        )()
        if not schedules:
            await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="등록된 스케줄이 없습니다.")
            return
        lines = []
        for s in schedules:
            target = s.agent.name if s.agent else (s.team.name if s.team else "?")
            last = s.last_run_at.strftime("%m/%d %H:%M") if s.last_run_at else "없음"
            lines.append(
                f"⏰ *{s.name}* — `{s.cron_expression}`\n"
                f"  대상: {target} | 마지막 실행: {last}"
            )
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text="\n\n".join(lines))

    # ── /meeting ─────────────────────────────────────────
    @app.command("/meeting")
    async def handle_meeting(ack, command, client):
        await ack()
        text = command.get("text", "").strip()
        user_id = command["user_id"]
        channel_id = command["channel_id"]

        @sync_to_async
        def get_user_meetings():
            from agents.models import Workspace, WorkspaceMembership
            link = UserPlatformLink.objects.filter(platform="slack", platform_user_id=user_id).select_related("user").first()
            if not link:
                return None, "Flaude 계정을 먼저 연결하세요. `/link <token>`"
            membership = WorkspaceMembership.objects.filter(user=link.user).first()
            if not membership:
                return None, "워크스페이스가 없습니다."
            meetings = list(Meeting.objects.filter(workspace=membership.workspace, status="completed").order_by("-meeting_date")[:5])
            return meetings, None

        @sync_to_async
        def get_transcript(meeting_id):
            try:
                return MeetingTranscript.objects.get(meeting_id=meeting_id).full_text
            except MeetingTranscript.DoesNotExist:
                return None

        meetings, error = await get_user_meetings()
        if error:
            await client.chat_postEphemeral(channel=channel_id, user=user_id, text=error)
            return
        if not meetings:
            await client.chat_postEphemeral(channel=channel_id, user=user_id, text="아직 회의 기록이 없습니다.")
            return

        if text.startswith("summary"):
            latest = meetings[0]
            transcript = await get_transcript(latest.id)
            if not transcript:
                await client.chat_postEphemeral(channel=channel_id, user=user_id, text="전사본이 없습니다.")
                return

            target_agent = await sync_to_async(lambda: Agent.objects.filter(status="active").first())()
            if not target_agent:
                await client.chat_postEphemeral(channel=channel_id, user=user_id, text="활성 에이전트가 없습니다.")
                return

            await client.chat_postMessage(channel=channel_id, text=f"_{target_agent.name}이(가) 회의록을 요약하고 있습니다..._")

            prompt = (
                f"다음 회의 녹취록을 요약해주세요.\n"
                f"주요 논의 사항, 결정 사항, 참석자별 발언 요점을 정리해주세요.\n"
                f"참석자: {', '.join(latest.participants) if latest.participants else '미상'}\n\n"
                f"녹취록:\n{transcript[:8000]}"
            )

            try:
                result, _ = await execute_agent(target_agent, prompt, "slack", channel_id=channel_id)
                await client.chat_postMessage(channel=channel_id, text=f"*{latest.title} 요약* (by {target_agent.name})\n\n{result[:3000]}")
            except Exception as e:
                await client.chat_postMessage(channel=channel_id, text=f"요약 실패: {e}")
        else:
            lines = []
            for m in meetings:
                date = m.meeting_date.strftime("%m/%d %H:%M")
                dur = f" ({m.duration_seconds // 60}분)" if m.duration_seconds else ""
                lines.append(f"*{m.title}* — {date}{dur}")
            await client.chat_postEphemeral(
                channel=channel_id, user=user_id,
                text="*최근 회의*\n" + "\n".join(lines) + "\n\n`/meeting summary` — 최근 회의 요약"
            )

    # ── /help ────────────────────────────────────────────
    @app.command("/help")
    async def handle_help(ack, command, client):
        await ack()
        agents = await get_active_agents()
        agent_names = ", ".join(f"`{a.name}`" for a in agents) or "(없음)"
        teams = await get_all_teams()
        team_names = ", ".join(f"`{t.name}`" for t in teams) or "(없음)"

        text = (
            "*Flaude 사용법*\n\n"
            "*메시지 보내기* (일반 채팅으로)\n"
            "`@멤버이름 메시지` — 예: `@ria 안녕`\n"
            "`@팀이름 메시지` — 예: `@sales 분석해줘`\n\n"
            "*스레드*\n"
            "에이전트 답변 스레드에서 `@` 없이 그냥 메시지만 보내면 세션이 유지됩니다.\n\n"
            "*슬래시 명령어*\n"
            "`/agents` — 멤버 목록\n"
            "`/teams` — 팀 목록\n"
            "`/status` — 실행 중인 작업\n"
            "`/history` — 실행 이력\n"
            "`/client` — 클라이언트 등록\n"
            "`/approvals` — 대기 중인 승인 목록\n"
            "`/approve <id>` — 워크플로우 승인\n"
            "`/reject <id>` — 워크플로우 거절\n"
            "`/meeting` — 최근 회의록 목록\n"
            "`/meeting summary` — 최근 회의 요약\n"
            "`/schedule` — 스케줄 목록\n"
            "`/link` — Flaude 계정 연결\n\n"
            f"*멤버*: {agent_names}\n"
            f"*팀*: {team_names}"
        )
        await client.chat_postEphemeral(channel=command["channel_id"], user=command["user_id"], text=text)

    # ── Message handler: @agent routing + thread resume ──
    @app.event("message")
    async def handle_message(event, client):
        if event.get("bot_id") or event.get("subtype"):
            return

        user_text = event.get("text", "").strip()
        file_ctx = _slack_attachment_context(event)
        if not user_text and not file_ctx:
            return
        user_text = (user_text + file_ctx).strip()

        channel_id = event.get("channel", "")
        thread_ts = event.get("thread_ts")
        slack_user_id = event.get("user", "")

        # Thread follow-up: use SDK session resume
        if thread_ts:
            agent_name = _thread_agents.get(thread_ts) or await _get_thread_agent("slack", thread_ts)
            if agent_name:
                _thread_agents[thread_ts] = agent_name
                agent = await find_agent_by_name(agent_name)
                if agent:
                    flaude_user_id = await resolve_slack_user(slack_user_id)
                    if not flaude_user_id:
                        await client.chat_postEphemeral(
                            channel=channel_id, user=slack_user_id,
                            text="Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
                        )
                        return

                    # Get SDK session for resume
                    sdk_session = _thread_sessions.get(thread_ts)
                    if not sdk_session:
                        sdk_session = await _get_thread_session_db("slack", thread_ts)

                    if sdk_session:
                        result, new_session = await execute_agent(
                            agent, user_text, flaude_user_id,
                            session_id=sdk_session, resume=True,
                            platform="slack",
                        )
                    else:
                        context = await _fetch_slack_channel_context(client, channel_id)
                        prompt = context + user_text if context else user_text
                        result, new_session = await execute_agent(
                            agent, prompt, flaude_user_id,
                            platform="slack",
                        )

                    if new_session:
                        _thread_sessions[thread_ts] = new_session

                    await _save_thread_msg("slack", thread_ts, agent.name, "user", user_text)
                    await _save_thread_msg("slack", thread_ts, agent.name, "agent", result, sdk_session_id=new_session or "")
                    blocks = format_agent_response(agent.name, agent.role, result)
                    await client.chat_postMessage(channel=channel_id, thread_ts=thread_ts, blocks=blocks, text=f"[{agent.name}]\n{result}")
                    return

        # @agent_name message 패턴
        if user_text.startswith("@"):
            parts = user_text[1:].split(None, 1)
            if len(parts) >= 2:
                target_name = parts[0]
                user_message = parts[1]

                # 팀인지 확인
                team = await find_team_by_name(target_name)
                if team:
                    flaude_user_id = await resolve_slack_user(slack_user_id)
                    if not flaude_user_id:
                        await client.chat_postEphemeral(
                            channel=channel_id, user=slack_user_id,
                            text="Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
                        )
                        return

                    agents_with_meta = await get_team_agents_with_meta(team)
                    if agents_with_meta:
                        initial = await client.chat_postMessage(channel=channel_id, text=f"*{team.name}* 팀이 작업을 시작합니다...")
                        team_result = await run_team(
                            team, agents_with_meta, user_message,
                            user_id=flaude_user_id, platform="slack",
                        )

                        for r in team_result.results:
                            if r.display_mode in ("status", "intermediate"):
                                label = "✅" if r.display_mode == "status" else "📋"
                                await client.chat_postMessage(channel=channel_id, thread_ts=initial["ts"], text=f"{label} *{r.agent_name}* ({r.role}) 완료")
                            elif r.display_mode == "full":
                                blocks = format_agent_response(r.agent_name, r.role, r.result)
                                await client.chat_postMessage(channel=channel_id, thread_ts=initial["ts"], blocks=blocks, text=f"[{r.agent_name}]\n{r.result}")

                        if team_result.synthesis:
                            s = team_result.synthesis
                            blocks = format_agent_response(s.agent_name, s.role, s.result)
                            await client.chat_postMessage(channel=channel_id, thread_ts=initial["ts"], blocks=blocks, text=f"[{s.agent_name}]\n{s.result}")
                        return

                # 에이전트인지 확인
                agent = await find_agent_by_name(target_name)
                if agent:
                    flaude_user_id = await resolve_slack_user(slack_user_id)
                    if not flaude_user_id:
                        await client.chat_postEphemeral(
                            channel=channel_id, user=slack_user_id,
                            text="Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
                        )
                        return

                    context = await _fetch_slack_channel_context(client, channel_id)
                    prompt = context + user_message if context else user_message
                    result, sdk_session = await execute_agent(
                        agent, prompt, flaude_user_id,
                        platform="slack",
                    )

                    reply_ts = thread_ts or event.get("ts")
                    _thread_agents[reply_ts] = agent.name
                    if sdk_session:
                        _thread_sessions[reply_ts] = sdk_session
                    await _save_thread_msg("slack", reply_ts, agent.name, "user", user_message)
                    await _save_thread_msg("slack", reply_ts, agent.name, "agent", result, sdk_session_id=sdk_session or "")
                    blocks = format_agent_response(agent.name, agent.role, result)
                    await client.chat_postMessage(channel=channel_id, thread_ts=reply_ts, blocks=blocks, text=f"[{agent.name}]\n{result}")
                    return

        # Channel-based routing
        agent = await find_agent_for_channel(channel_id)
        if not agent:
            return

        flaude_user_id = await resolve_slack_user(slack_user_id)
        if not flaude_user_id:
            await client.chat_postEphemeral(
                channel=channel_id, user=slack_user_id,
                text="Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
            )
            return

        reply_ts = thread_ts or event.get("ts")

        # Thread follow-up with SDK session resume
        if thread_ts:
            sdk_session = _thread_sessions.get(thread_ts)
            if not sdk_session:
                sdk_session = await _get_thread_session_db("slack", thread_ts)

            if sdk_session:
                result, new_session = await execute_agent(
                    agent, user_text, flaude_user_id,
                    session_id=sdk_session, resume=True,
                    platform="slack",
                )
            else:
                context = await _fetch_slack_channel_context(client, channel_id)
                prompt = context + user_text if context else user_text
                result, new_session = await execute_agent(
                    agent, prompt, flaude_user_id,
                    platform="slack",
                )

            if new_session:
                _thread_sessions[thread_ts] = new_session
            await _save_thread_msg("slack", thread_ts, agent.name, "user", user_text)
            await _save_thread_msg("slack", thread_ts, agent.name, "agent", result, sdk_session_id=new_session or "")
        else:
            context = await _fetch_slack_channel_context(client, channel_id)
            prompt = context + user_text if context else user_text
            result, sdk_session = await execute_agent(
                agent, prompt, flaude_user_id,
                platform="slack",
            )
            if sdk_session:
                _thread_sessions[reply_ts] = sdk_session
            await _save_thread_msg("slack", reply_ts, agent.name, "user", user_text)
            await _save_thread_msg("slack", reply_ts, agent.name, "agent", result, sdk_session_id=sdk_session or "")

        blocks = format_agent_response(agent.name, agent.role, result)
        _thread_agents[reply_ts] = agent.name
        await client.chat_postMessage(channel=channel_id, thread_ts=reply_ts, blocks=blocks, text=f"[{agent.name}]\n{result}")

    return app


# ── Django management command ────────────────────────────────


class Command(BaseCommand):
    help = "Run the Flaude Slack bot"

    def add_arguments(self, parser):
        parser.add_argument("--token", type=str, default=os.environ.get("SLACK_BOT_TOKEN", ""))
        parser.add_argument("--app-token", type=str, default=os.environ.get("SLACK_APP_TOKEN", ""))

    def handle(self, *args, **options):
        token = options["token"]
        app_token = options["app_token"]
        if not token:
            self.stderr.write("Error: No Slack bot token. Set SLACK_BOT_TOKEN env var.")
            return
        if not app_token:
            self.stderr.write("Error: No Slack app token. Set SLACK_APP_TOKEN env var.")
            return

        logging.basicConfig(level=logging.INFO)
        self.stdout.write("Starting Flaude Slack bot...")
        slack_app = create_slack_app(token)

        async def _run():
            handler = AsyncSocketModeHandler(slack_app, app_token)
            await handler.start_async()

        asyncio.run(_run())
