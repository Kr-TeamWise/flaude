"""
Flaude Discord Bot — Django management command.

Usage:
    python manage.py run_discord_bot

Requires:
    - DISCORD_TOKEN env var or .env file

Features:
    - @agent_name message — Natural message routing (e.g. @ria 안녕)
    - Thread-based session continuity (SDK session resume)
    - /agents, /teams, /status, /history, /client, /link, /help
"""

import asyncio
import json
import os
import logging
from collections import OrderedDict
from urllib.parse import quote

import discord
from discord import app_commands
from django.core.management.base import BaseCommand
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentTeam, Client, UserPlatformLink, ThreadMessage
from agents.orchestrator import (
    execute_agent, build_context_prompt,
    get_running_executions, get_execution_history,
    get_pending_approvals, decide_approval, resume_after_approval,
)
from agents.notifier import notify_approval_needed

logger = logging.getLogger("flaude.discord")


# ── TTL Cache ────────────────────────────────────────────────

import time as _time

_CACHE_TTL = 30  # seconds


class _TTLCache:
    """Simple TTL cache for DB queries."""
    def __init__(self, ttl: int = _CACHE_TTL):
        self._data: dict[str, tuple[float, object]] = {}
        self._ttl = ttl

    def get(self, key: str):
        entry = self._data.get(key)
        if entry and _time.time() - entry[0] < self._ttl:
            return entry[1]
        return None

    def set(self, key: str, value):
        self._data[key] = (_time.time(), value)

    def clear(self):
        self._data.clear()


_agent_cache = _TTLCache()
_team_cache = _TTLCache()
_channel_map_cache = _TTLCache(ttl=60)
_webhook_cache: dict[str, discord.Webhook] = {}


# ── DB helpers ───────────────────────────────────────────────


@sync_to_async
def find_agent_by_name(name: str) -> Agent | None:
    cached = _agent_cache.get(f"name:{name.lower()}")
    if cached is not None:
        return cached
    try:
        agent = Agent.objects.get(status="active", name__iexact=name)
        _agent_cache.set(f"name:{name.lower()}", agent)
        return agent
    except Agent.DoesNotExist:
        _agent_cache.set(f"name:{name.lower()}", None)
        return None


@sync_to_async
def find_agent_for_channel(channel_id: str) -> Agent | None:
    cached = _channel_map_cache.get(f"ch:{channel_id}")
    if cached is not None:
        return cached if cached != "_none_" else None
    for agent in Agent.objects.filter(status="active"):
        if str(channel_id) in [str(c) for c in (agent.channels or [])]:
            _channel_map_cache.set(f"ch:{channel_id}", agent)
            return agent
    _channel_map_cache.set(f"ch:{channel_id}", "_none_")
    return None


@sync_to_async
def get_active_agents():
    cached = _agent_cache.get("_all_")
    if cached is not None:
        return cached
    agents = list(Agent.objects.filter(status="active"))
    _agent_cache.set("_all_", agents)
    return agents


@sync_to_async
def get_active_agent_count():
    agents = _agent_cache.get("_all_")
    if agents is not None:
        return len(agents)
    return Agent.objects.filter(status="active").count()


@sync_to_async
def get_first_active_agent():
    return Agent.objects.filter(status="active").first()


@sync_to_async
def find_team_by_name(name: str) -> AgentTeam | None:
    cached = _team_cache.get(f"name:{name.lower()}")
    if cached is not None:
        return cached if cached != "_none_" else None
    try:
        team = AgentTeam.objects.get(name__iexact=name)
        _team_cache.set(f"name:{name.lower()}", team)
        return team
    except AgentTeam.DoesNotExist:
        _team_cache.set(f"name:{name.lower()}", "_none_")
        return None


@sync_to_async
def get_all_teams():
    cached = _team_cache.get("_all_")
    if cached is not None:
        return cached
    teams = list(AgentTeam.objects.all())
    _team_cache.set("_all_", teams)
    return teams


@sync_to_async
def resolve_discord_user(discord_user_id: str) -> int | None:
    try:
        link = UserPlatformLink.objects.get(
            platform="discord", platform_user_id=str(discord_user_id)
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


# ── Session tracking (LRU caches to prevent memory leaks) ────

_MAX_CACHE = 500


class _LRUCache(OrderedDict):
    """Simple LRU cache with max size."""
    def __init__(self, maxsize: int = _MAX_CACHE):
        super().__init__()
        self._maxsize = maxsize

    def get_val(self, key, default=None):
        if key in self:
            self.move_to_end(key)
            return self[key]
        return default

    def set_val(self, key, value):
        if key in self:
            self.move_to_end(key)
        self[key] = value
        while len(self) > self._maxsize:
            self.popitem(last=False)


_thread_agents = _LRUCache(_MAX_CACHE)
_thread_locks = _LRUCache(_MAX_CACHE)
_thread_sessions = _LRUCache(_MAX_CACHE)  # thread_id → sdk_session_id


@sync_to_async
def _save_thread_msg(platform: str, thread_id: str, agent_name: str, role: str, content: str, sdk_session_id: str = ""):
    ThreadMessage.objects.create(
        platform=platform, thread_id=thread_id,
        agent_name=agent_name, role=role, content=content[:2000],
        sdk_session_id=sdk_session_id,
    )
    # Efficient cleanup: keep only latest 20 messages per thread
    keep_ids = list(
        ThreadMessage.objects.filter(platform=platform, thread_id=thread_id)
        .order_by("-created_at").values_list("id", flat=True)[:20]
    )
    if keep_ids:
        ThreadMessage.objects.filter(
            platform=platform, thread_id=thread_id,
        ).exclude(id__in=keep_ids).delete()


@sync_to_async
def _get_thread_agent_db(platform: str, thread_id: str) -> str | None:
    last = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id, role="agent"
    ).order_by("-created_at").values_list("agent_name", flat=True).first()
    return last


@sync_to_async
def _get_thread_session_db(platform: str, thread_id: str) -> str | None:
    """Get the latest SDK session_id for a thread from DB."""
    last = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id, role="agent",
    ).exclude(sdk_session_id="").order_by("-created_at").values_list("sdk_session_id", flat=True).first()
    return last


async def _fetch_channel_context(channel, limit: int = 15) -> str:
    """Fetch recent messages from channel as context."""
    try:
        messages = []
        async for msg in channel.history(limit=limit):
            if msg.content and not msg.content.startswith("/"):
                author = msg.author.display_name
                messages.append(f"{author}: {msg.content[:300]}")
        if not messages:
            return ""
        messages.reverse()
        return "[채널 최근 메시지]\n" + "\n".join(messages) + "\n\n"
    except Exception as e:
        logger.warning("Failed to fetch channel context: %s", e)
        return ""


def _attachment_context(message: discord.Message) -> str:
    """Build a context string from Discord message attachments (files, images)."""
    if not message.attachments:
        return ""
    lines = []
    for att in message.attachments:
        size_kb = (att.size or 0) // 1024
        lines.append(f"- {att.filename} ({att.content_type or 'unknown'}, {size_kb}KB): {att.url}")
    return "\n\n[첨부 파일]\n" + "\n".join(lines) + "\n위 URL에서 파일 내용을 확인할 수 있습니다.\n"


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


async def get_or_create_webhook(channel) -> discord.Webhook | None:
    target = channel.parent if isinstance(channel, discord.Thread) else channel
    cache_key = str(target.id)
    if cache_key in _webhook_cache:
        return _webhook_cache[cache_key]
    try:
        webhooks = await target.webhooks()
        for wh in webhooks:
            if wh.name == "Flaude":
                _webhook_cache[cache_key] = wh
                return wh
        wh = await target.create_webhook(name="Flaude")
        _webhook_cache[cache_key] = wh
        return wh
    except discord.Forbidden:
        logger.warning("Missing Manage Webhooks permission on %s", cache_key)
        return None


_AVATAR_BG = ["F9C4AC", "B8E0D2", "D4C5F9", "F9E2AE", "A8D8EA", "F5B7B1", "C3E8BD", "E8D5B7"]


def _avatar_url(agent_name: str) -> str:
    h = sum(ord(c) for c in agent_name)
    bg = _AVATAR_BG[h % len(_AVATAR_BG)]
    seed = quote(agent_name, safe="")
    return f"https://api.dicebear.com/9.x/notionists/png?seed={seed}&backgroundColor={bg}&backgroundType=solid&size=128"


async def _send_agent_result(webhook, agent_name, result, thread=discord.utils.MISSING, fallback_channel=None):
    """Send agent result. Auto-creates thread for long responses."""
    chunks = split_message(result)
    is_long = len(chunks) > 1

    if webhook:
        first_msg = await webhook.send(
            content=chunks[0],
            username=agent_name,
            avatar_url=_avatar_url(agent_name),
            thread=thread,
            wait=True if is_long else False,
        )
        if is_long and thread is discord.utils.MISSING and first_msg:
            # Auto-create thread for long responses
            auto_thread = await first_msg.create_thread(name=f"{agent_name} 응답")
            for chunk in chunks[1:]:
                await webhook.send(
                    content=chunk,
                    username=agent_name,
                    avatar_url=_avatar_url(agent_name),
                    thread=auto_thread,
                )
        else:
            for chunk in chunks[1:]:
                await webhook.send(
                    content=chunk,
                    username=agent_name,
                    avatar_url=_avatar_url(agent_name),
                    thread=thread,
                )
    elif fallback_channel:
        first_msg = await fallback_channel.send(f"**{agent_name}**: {chunks[0]}")
        if is_long:
            auto_thread = await first_msg.create_thread(name=f"{agent_name} 응답")
            for chunk in chunks[1:]:
                await auto_thread.send(f"**{agent_name}**: {chunk}")


async def _send_agent_result_and_get(webhook, agent_name, result, thread=discord.utils.MISSING, fallback_channel=None):
    """Send agent result and return first message. Auto-creates thread for long responses."""
    chunks = split_message(result)
    is_long = len(chunks) > 1
    first_msg = None

    if webhook:
        first_msg = await webhook.send(
            content=chunks[0],
            username=agent_name,
            avatar_url=_avatar_url(agent_name),
            thread=thread,
            wait=True,
        )
        if is_long and thread is discord.utils.MISSING and first_msg:
            auto_thread = await first_msg.create_thread(name=f"{agent_name} 응답")
            for chunk in chunks[1:]:
                await webhook.send(
                    content=chunk,
                    username=agent_name,
                    avatar_url=_avatar_url(agent_name),
                    thread=auto_thread,
                )
        else:
            for chunk in chunks[1:]:
                await webhook.send(
                    content=chunk,
                    username=agent_name,
                    avatar_url=_avatar_url(agent_name),
                    thread=thread,
                    wait=True,
                )
    elif fallback_channel:
        first_msg = await fallback_channel.send(f"**{agent_name}**: {chunks[0]}")
        if is_long:
            auto_thread = await first_msg.create_thread(name=f"{agent_name} 응답")
            for chunk in chunks[1:]:
                await auto_thread.send(f"**{agent_name}**: {chunk}")

    return first_msg


async def _post_team_result(webhook, team_result, thread=discord.utils.MISSING):
    """Post team execution results via webhook."""
    for r in team_result.results:
        if r.display_mode in ("status", "intermediate"):
            label = "✅" if r.display_mode == "status" else "📋"
            await webhook.send(
                content=f"{label} **{r.agent_name}** ({r.role}) 완료",
                username=r.agent_name,
                avatar_url=_avatar_url(r.agent_name),
                thread=thread,
            )
        elif r.display_mode == "full":
            await _send_agent_result(webhook, r.agent_name, r.result, thread)

    if team_result.synthesis:
        s = team_result.synthesis
        await _send_agent_result(webhook, s.agent_name, s.result, thread)


# ── Bot ──────────────────────────────────────────────────────


class FlaudeBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.all()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        # ── /agents ──────────────────────────────────────
        @self.tree.command(name="agents", description="멤버 목록 보기")
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

        # ── /teams ───────────────────────────────────────
        @self.tree.command(name="teams", description="팀 목록 보기")
        async def teams_command(interaction: discord.Interaction):
            teams = await get_all_teams()
            if not teams:
                await interaction.response.send_message("No teams configured.", ephemeral=True)
                return
            lines = []
            for t in teams:
                member_count = len(t.members or [])
                has_lead = any(m.get("is_lead") for m in (t.members or []))
                lead_str = " (has lead)" if has_lead else ""
                lines.append(f"**{t.name}** — {t.execution_mode}, {member_count} members{lead_str}")
            await interaction.response.send_message("\n".join(lines), ephemeral=True)

        # ── /status ──────────────────────────────────────
        @self.tree.command(name="status", description="현재 실행 중인 작업 보기")
        @app_commands.describe(agent="특정 에이전트 필터 (선택)")
        async def status_command(interaction: discord.Interaction, agent: str | None = None):
            running = await get_running_executions(agent)
            if not running:
                await interaction.response.send_message("현재 실행 중인 작업이 없습니다.", ephemeral=True)
                return
            lines = []
            for r in running:
                lines.append(
                    f"🔄 **{r['agent_name']}** — `{r['prompt']}` "
                    f"({r['elapsed_seconds']}s, {r['platform']})"
                )
            await interaction.response.send_message("\n".join(lines), ephemeral=True)

        # ── /history ─────────────────────────────────────
        @self.tree.command(name="history", description="최근 실행 이력 보기")
        @app_commands.describe(agent="특정 에이전트 필터 (선택)", limit="표시할 개수 (기본 10)")
        async def history_command(interaction: discord.Interaction, agent: str | None = None, limit: int = 10):
            history = await get_execution_history(agent, min(limit, 25))
            if not history:
                await interaction.response.send_message("실행 이력이 없습니다.", ephemeral=True)
                return
            lines = []
            for h in history:
                icon = "✅" if h["status"] == "completed" else "❌"
                duration = f"{h['duration_ms']}ms" if h["duration_ms"] else "?"
                lines.append(
                    f"{icon} **{h['agent_name']}** — `{h['prompt']}` "
                    f"({duration}, {h['platform']})"
                )
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
            from agents.models import AuthToken
            try:
                auth = await sync_to_async(
                    lambda: AuthToken.objects.select_related("user").get(token=token)
                )()
                await sync_to_async(UserPlatformLink.objects.update_or_create)(
                    platform="discord",
                    platform_user_id=str(interaction.user.id),
                    defaults={
                        "user": auth.user,
                        "platform_team_id": str(interaction.guild_id or ""),
                    },
                )
                await interaction.response.send_message(
                    f"연결 완료! Discord 계정이 **{auth.user.first_name or auth.user.email}**에 연결되었습니다.\n"
                    f"이제 `@멤버이름 메시지` 시 당신의 맥에서 에이전트가 실행됩니다.",
                    ephemeral=True,
                )
            except AuthToken.DoesNotExist:
                await interaction.response.send_message(
                    "유효하지 않은 토큰입니다. Flaude 앱 Settings에서 정확한 토큰을 복사해주세요.",
                    ephemeral=True,
                )

        # ── /approve ───────────────────────────────────────
        @self.tree.command(name="approve", description="팀 워크플로우 승인")
        @app_commands.describe(approval_id="승인 ID")
        async def approve_command(interaction: discord.Interaction, approval_id: int):
            await interaction.response.defer()
            try:
                from agents.models import ApprovalRequest
                approval = await sync_to_async(
                    lambda: ApprovalRequest.objects.select_related("team", "agent", "next_agent").get(
                        id=approval_id, status="pending"
                    )
                )()
                approval.status = "approved"
                approval.decided_by = str(interaction.user)
                from django.utils import timezone as tz
                approval.decided_at = tz.now()
                await sync_to_async(approval.save)(update_fields=["status", "decided_by", "decided_at"])

                await interaction.followup.send(
                    f"✅ 승인 완료! **{approval.next_agent.name}** 실행을 시작합니다..."
                )

                # Resolve user for dispatch
                flaude_user_id = await resolve_discord_user(str(interaction.user.id))
                if flaude_user_id:
                    team_result = await resume_after_approval(approval, flaude_user_id)
                    webhook = await get_or_create_webhook(interaction.channel)
                    await _post_team_result(webhook, team_result)
                else:
                    await interaction.followup.send(
                        "Flaude 계정이 연결되어 있지 않습니다. `/link` 명령어로 연결해주세요.",
                        ephemeral=True,
                    )

            except ApprovalRequest.DoesNotExist:
                await interaction.followup.send("해당 승인 요청을 찾을 수 없습니다.", ephemeral=True)

        # ── /reject ────────────────────────────────────────
        @self.tree.command(name="reject", description="팀 워크플로우 거절")
        @app_commands.describe(approval_id="승인 ID")
        async def reject_command(interaction: discord.Interaction, approval_id: int):
            try:
                from agents.models import ApprovalRequest
                approval = await sync_to_async(
                    lambda: ApprovalRequest.objects.select_related("team", "next_agent").get(
                        id=approval_id, status="pending"
                    )
                )()
                approval.status = "rejected"
                approval.decided_by = str(interaction.user)
                from django.utils import timezone as tz
                approval.decided_at = tz.now()
                await sync_to_async(approval.save)(update_fields=["status", "decided_by", "decided_at"])
                await interaction.response.send_message(
                    f"❌ 거절됨. **{approval.next_agent.name}** 실행이 취소되었습니다."
                )
            except ApprovalRequest.DoesNotExist:
                await interaction.response.send_message("해당 승인 요청을 찾을 수 없습니다.", ephemeral=True)

        # ── /approvals ─────────────────────────────────────
        @self.tree.command(name="approvals", description="대기 중인 승인 목록")
        async def approvals_command(interaction: discord.Interaction):
            pending = await get_pending_approvals()
            if not pending:
                await interaction.response.send_message("대기 중인 승인이 없습니다.", ephemeral=True)
                return
            lines = []
            for a in pending:
                lines.append(
                    f"⏸️ ID: `{a['id']}` — **{a['team_name']}**: "
                    f"{a['agent_name']} → {a['next_agent_name']}\n"
                    f"  > {a['result_preview'][:100]}...\n"
                    f"  `/approve {a['id']}` 또는 `/reject {a['id']}`"
                )
            await interaction.response.send_message("\n\n".join(lines), ephemeral=True)

        # ── /schedule ──────────────────────────────────────
        @self.tree.command(name="schedule", description="스케줄 목록 보기")
        async def schedule_command(interaction: discord.Interaction):
            from agents.models import AgentSchedule
            schedules = await sync_to_async(
                lambda: list(AgentSchedule.objects.filter(is_active=True).select_related("agent", "team")[:20])
            )()
            if not schedules:
                await interaction.response.send_message("등록된 스케줄이 없습니다.", ephemeral=True)
                return
            lines = []
            for s in schedules:
                target = s.agent.name if s.agent else (s.team.name if s.team else "?")
                last = s.last_run_at.strftime("%m/%d %H:%M") if s.last_run_at else "없음"
                lines.append(
                    f"⏰ **{s.name}** — `{s.cron_expression}`\n"
                    f"  대상: {target} | 마지막 실행: {last}"
                )
            await interaction.response.send_message("\n\n".join(lines), ephemeral=True)

        # ── /help ────────────────────────────────────────
        @self.tree.command(name="help", description="Flaude 사용법")
        async def help_command(interaction: discord.Interaction):
            agents = await get_active_agents()
            agent_names = ", ".join(f"`{a.name}`" for a in agents) or "(없음)"
            teams = await get_all_teams()
            team_names = ", ".join(f"`{t.name}`" for t in teams) or "(없음)"

            text = (
                "**Flaude 사용법**\n\n"
                "**메시지 보내기** (일반 채팅으로)\n"
                "`@멤버이름 메시지` — 예: `@ria 안녕`\n"
                "`@팀이름 메시지` — 예: `@sales 분석해줘`\n\n"
                "**스레드**\n"
                "에이전트 답변에 스레드를 만들면 세션이 유지됩니다.\n"
                "스레드 안에서는 `@` 없이 그냥 메시지만 보내면 됩니다.\n\n"
                "**슬래시 명령어**\n"
                "`/agents` — 멤버 목록\n"
                "`/teams` — 팀 목록\n"
                "`/status` — 실행 중인 작업\n"
                "`/history` — 실행 이력\n"
                "`/client` — 클라이언트 등록\n"
                "`/approvals` — 대기 중인 승인 목록\n"
                "`/approve <id>` — 워크플로우 승인\n"
                "`/reject <id>` — 워크플로우 거절\n"
                "`/schedule` — 스케줄 목록\n"
                "`/link` — Flaude 계정 연결\n\n"
                f"**멤버**: {agent_names}\n"
                f"**팀**: {team_names}"
            )
            await interaction.response.send_message(text, ephemeral=True)

        # Sync commands
        await self.tree.sync()
        logger.info("Slash commands synced (global)")

    async def on_ready(self):
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

        # ── 스레드 내 후속 질문 (SDK session resume) ──
        if isinstance(message.channel, discord.Thread):
            thread_id = str(message.channel.id)
            content = message.content.strip()

            # Check if message mentions a different agent via @name
            mentioned_agent = None
            user_message = content
            if content.startswith("@"):
                parts = content[1:].split(None, 1)
                if len(parts) >= 1:
                    mentioned = await find_agent_by_name(parts[0])
                    if mentioned:
                        mentioned_agent = mentioned
                        user_message = parts[1] if len(parts) >= 2 else ""

            if mentioned_agent:
                # Switch to the mentioned agent within this thread
                agent = mentioned_agent
                agent_name = agent.name
                _thread_agents.set_val(thread_id, agent_name)
            else:
                # Use the thread's original agent
                agent_name = _thread_agents.get_val(thread_id)

                # Try to identify agent from thread starter message
                if not agent_name:
                    try:
                        starter = await message.channel.fetch_message(message.channel.id)
                        if starter.author.bot:
                            found = await find_agent_by_name(starter.author.display_name)
                            if found:
                                agent_name = found.name
                                _thread_agents.set_val(thread_id, agent_name)
                    except Exception:
                        pass

                # Fallback: check DB
                if not agent_name:
                    agent_name = await _get_thread_agent_db("discord", thread_id)
                    if agent_name:
                        _thread_agents.set_val(thread_id, agent_name)

                agent = await find_agent_by_name(agent_name) if agent_name else None

            if agent:
                lock = _thread_locks.get_val(thread_id)
                if lock is None:
                    lock = asyncio.Lock()
                    _thread_locks.set_val(thread_id, lock)
                if lock.locked():
                    await message.reply("이전 요청을 처리 중입니다. 잠시 기다려주세요.")
                    return
                async with lock:
                    flaude_user_id = await resolve_discord_user(str(message.author.id))
                    if not flaude_user_id:
                        await message.reply(
                            "Flaude 계정이 연결되어 있지 않습니다. "
                            "Flaude 앱에서 `/link` 명령어로 연결해주세요."
                        )
                        return

                    # If switching agent, start fresh session for new agent
                    if mentioned_agent:
                        sdk_session = None
                    else:
                        sdk_session = _thread_sessions.get_val(thread_id)
                        if not sdk_session:
                            sdk_session = await _get_thread_session_db("discord", thread_id)

                    prompt_text = user_message if user_message else message.content
                    prompt_text += _attachment_context(message)

                    if sdk_session:
                        result, new_session = await execute_agent(
                            agent, prompt_text, flaude_user_id,
                            session_id=sdk_session, resume=True,
                            platform="discord",
                        )
                    else:
                        channel_ctx = await _fetch_channel_context(message.channel.parent)
                        prompt = f"{channel_ctx}사용자: {prompt_text}" if channel_ctx else prompt_text
                        result, new_session = await execute_agent(
                            agent, prompt, flaude_user_id,
                            platform="discord",
                        )

                    if new_session:
                        _thread_sessions.set_val(thread_id, new_session)

                    await _save_thread_msg("discord", thread_id, agent.name, "user", message.content)
                    await _save_thread_msg("discord", thread_id, agent.name, "agent", result, sdk_session_id=new_session or "")

                webhook = await get_or_create_webhook(message.channel.parent)
                await _send_agent_result(webhook, agent.name, result, thread=message.channel, fallback_channel=message.channel)
                return

        # ── @agent_name message 패턴 ──
        content = message.content.strip()
        if content.startswith("@"):
            parts = content[1:].split(None, 1)
            if len(parts) >= 2:
                target_name = parts[0]
                user_message = parts[1]
                webhook = await get_or_create_webhook(message.channel)
                thread = message.channel if isinstance(message.channel, discord.Thread) else discord.utils.MISSING

                # 팀인지 확인
                team = await find_team_by_name(target_name)
                if team:
                    flaude_user_id = await resolve_discord_user(str(message.author.id))
                    if not flaude_user_id:
                        await message.reply(
                            "Flaude 계정이 연결되어 있지 않습니다. "
                            "Flaude 앱에서 `/link` 명령어로 연결해주세요."
                        )
                        return

                    from agents.orchestrator import get_team_agents_with_meta, run_team
                    agents_with_meta = await get_team_agents_with_meta(team)
                    async with message.channel.typing():
                        team_result = await run_team(
                            team, agents_with_meta, user_message,
                            user_id=flaude_user_id, platform="discord",
                        )
                    if webhook:
                        await _post_team_result(webhook, team_result, thread)
                    else:
                        # Fallback: post synthesis or last result
                        final = team_result.synthesis or (team_result.results[-1] if team_result.results else None)
                        if final:
                            await message.channel.send(f"**{final.agent_name}**: {final.result}")
                    return

                # 에이전트인지 확인
                agent = await find_agent_by_name(target_name)
                if agent:
                    flaude_user_id = await resolve_discord_user(str(message.author.id))
                    if not flaude_user_id:
                        await message.reply(
                            "Flaude 계정이 연결되어 있지 않습니다. "
                            "Flaude 앱에서 `/link` 명령어로 연결해주세요."
                        )
                        return

                    channel_ctx = await _fetch_channel_context(message.channel)
                    full_msg = user_message + _attachment_context(message)
                    prompt = f"{channel_ctx}사용자: {full_msg}" if channel_ctx else full_msg
                    async with message.channel.typing():
                        result, sdk_session = await execute_agent(
                            agent, prompt, flaude_user_id,
                            platform="discord",
                        )

                    sent = await _send_agent_result_and_get(webhook, agent.name, result, thread, fallback_channel=message.channel)
                    thread_id = str(sent.id) if sent else str(message.id)
                    _thread_agents.set_val(thread_id, agent.name)
                    if sdk_session:
                        _thread_sessions.set_val(thread_id, sdk_session)
                    await _save_thread_msg("discord", thread_id, agent.name, "user", user_message)
                    await _save_thread_msg("discord", thread_id, agent.name, "agent", result, sdk_session_id=sdk_session or "")
                    return

        # ── Channel-based routing ──
        agent = await find_agent_for_channel(str(message.channel.id))
        if agent:
            flaude_user_id = await resolve_discord_user(str(message.author.id))
            if not flaude_user_id:
                await message.reply(
                    "Flaude 계정이 연결되어 있지 않습니다. "
                    "Flaude 앱에서 `/link` 명령어로 연결해주세요."
                )
                return

            channel_ctx = await _fetch_channel_context(message.channel)
            full_msg = message.content + _attachment_context(message)
            prompt = f"{channel_ctx}사용자: {full_msg}" if channel_ctx else full_msg
            async with message.channel.typing():
                result, sdk_session = await execute_agent(
                    agent, prompt, flaude_user_id,
                    platform="discord",
                )

            webhook = await get_or_create_webhook(message.channel)
            sent = await _send_agent_result_and_get(webhook, agent.name, result, fallback_channel=message.channel)
            reply_id = str(sent.id) if sent else str(message.id)
            _thread_agents.set_val(reply_id, agent.name)
            if sdk_session:
                _thread_sessions.set_val(reply_id, sdk_session)
            await _save_thread_msg("discord", reply_id, agent.name, "user", message.content)
            await _save_thread_msg("discord", reply_id, agent.name, "agent", result, sdk_session_id=sdk_session or "")


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
