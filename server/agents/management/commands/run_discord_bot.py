"""
Flaude Discord Bot — Django management command.

Usage:
    python manage.py run_discord_bot

Requires:
    - DISCORD_TOKEN env var or .env file

Features:
    - @agent_name message — Natural message routing (e.g. @ria 안녕)
    - Thread-based session continuity
    - /agents, /teams, /status, /history, /client, /link, /help
"""

import asyncio
import os
import logging

import discord
from discord import app_commands
from django.core.management.base import BaseCommand
from asgiref.sync import sync_to_async

from agents.models import Agent, AgentTeam, Client, UserPlatformLink, ThreadMessage
from agents.orchestrator import (
    run_claude, run_team, get_team_agents_with_meta,
    get_running_executions, get_execution_history,
    get_pending_approvals, decide_approval, resume_after_approval,
    auto_advance_client_status,
)
from agents.notifier import notify_approval_needed

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
def get_all_teams():
    return list(AgentTeam.objects.all())


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


# ── Session tracking ─────────────────────────────────────────

_thread_agents: dict[str, str] = {}
_thread_locks: dict[str, asyncio.Lock] = {}  # prevent concurrent runs per thread


@sync_to_async
def _save_thread_msg(platform: str, thread_id: str, agent_name: str, role: str, content: str):
    ThreadMessage.objects.create(
        platform=platform, thread_id=thread_id,
        agent_name=agent_name, role=role, content=content[:1000],
    )
    ids = list(
        ThreadMessage.objects.filter(platform=platform, thread_id=thread_id)
        .order_by("-created_at").values_list("id", flat=True)[20:]
    )
    if ids:
        ThreadMessage.objects.filter(id__in=ids).delete()


@sync_to_async
def _get_thread_agent_db(platform: str, thread_id: str) -> str | None:
    last = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id, role="agent"
    ).order_by("-created_at").first()
    return last.agent_name if last else None


@sync_to_async
def _get_thread_history(platform: str, thread_id: str) -> list[dict]:
    """Load conversation history from DB for a thread."""
    msgs = ThreadMessage.objects.filter(
        platform=platform, thread_id=thread_id,
    ).order_by("created_at")[:20]
    return [{"role": m.role, "agent": m.agent_name, "content": m.content} for m in msgs]


def _build_thread_prompt(history: list[dict], new_message: str, channel_context: str = "") -> str:
    """Build a prompt that includes conversation history."""
    parts = []
    if channel_context:
        parts.append(channel_context)
    if history:
        parts.append("[이전 대화 내역]")
        for msg in history:
            prefix = "사용자" if msg["role"] == "user" else msg["agent"]
            parts.append(f"{prefix}: {msg['content']}")
        parts.append("")  # blank line separator
    parts.append(f"사용자: {new_message}")
    return "\n".join(parts)


async def _fetch_channel_context(channel, limit: int = 15) -> str:
    """Fetch recent messages from channel as context."""
    messages = []
    async for msg in channel.history(limit=limit):
        if msg.content and not msg.content.startswith("/"):
            author = msg.author.display_name
            messages.append(f"{author}: {msg.content[:300]}")
    if not messages:
        return ""
    messages.reverse()
    return "[채널 최근 메시지]\n" + "\n".join(messages) + "\n\n"


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


async def _send_agent_result(webhook, agent_name, result, thread=discord.utils.MISSING):
    """Send agent result via webhook."""
    for chunk in split_message(result):
        await webhook.send(
            content=chunk,
            username=agent_name,
            avatar_url=_avatar_url(agent_name),
            thread=thread,
        )


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

                team_result = await resume_after_approval(approval)
                webhook = await get_or_create_webhook(interaction.channel)
                await _post_team_result(webhook, team_result)

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

        # ── 스레드 내 후속 질문 → --resume ──
        if isinstance(message.channel, discord.Thread):
            thread_id = str(message.channel.id)
            agent_name = _thread_agents.get(thread_id)

            if not agent_name:
                try:
                    parent_channel = message.channel.parent
                    starter = await parent_channel.fetch_message(message.channel.id)
                    if starter.author.bot:
                        found = await find_agent_by_name(starter.author.display_name)
                        if found:
                            agent_name = found.name
                            _thread_agents[thread_id] = agent_name
                except Exception as e:
                    logger.warning("Failed to find agent for thread: %s", e)

            # Also check DB if not in memory
            if not agent_name:
                agent_name = await _get_thread_agent_db("discord", thread_id)
                if agent_name:
                    _thread_agents[thread_id] = agent_name

            if agent_name:
                agent = await find_agent_by_name(agent_name)
                if agent:
                    if thread_id not in _thread_locks:
                        _thread_locks[thread_id] = asyncio.Lock()
                    lock = _thread_locks[thread_id]
                    if lock.locked():
                        await message.reply("이전 요청을 처리 중입니다. 잠시 기다려주세요.")
                        return
                    async with lock:
                        history = await _get_thread_history("discord", thread_id)
                        # Only fetch channel context for first message in thread
                        if not history:
                            channel_ctx = await _fetch_channel_context(message.channel)
                        else:
                            channel_ctx = ""
                        prompt = _build_thread_prompt(history, message.content, channel_ctx)
                        await _save_thread_msg("discord", thread_id, agent.name, "user", message.content)
                        async with message.channel.typing():
                            result = await run_claude(agent, prompt, platform="discord")
                        await _save_thread_msg("discord", thread_id, agent.name, "agent", result)
                    webhook = await get_or_create_webhook(message.channel.parent)
                    await _send_agent_result(webhook, agent.name, result, thread=message.channel)
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
                    agents_with_meta = await get_team_agents_with_meta(team)
                    if agents_with_meta:
                        async with message.channel.typing():
                            team_result = await run_team(team, agents_with_meta, user_message, platform="discord")
                        await _post_team_result(webhook, team_result, thread)
                        return

                # 에이전트인지 확인
                agent = await find_agent_by_name(target_name)
                if agent:
                    # dispatch to user's Mac if linked
                    flaude_user_id = await resolve_discord_user(str(message.author.id))
                    result = None
                    if flaude_user_id:
                        from agents.dispatch import dispatch_task
                        result = await dispatch_task(str(flaude_user_id), agent.name, user_message)

                    if not result:
                        context = await _fetch_channel_context(message.channel)
                        prompt = context + user_message if context else user_message
                        async with message.channel.typing():
                            result = await run_claude(agent, prompt, platform="discord")

                    # Save to DB for thread persistence
                    thread_id = str(message.channel.id) if isinstance(message.channel, discord.Thread) else str(message.id)
                    _thread_agents[thread_id] = agent.name
                    await _save_thread_msg("discord", thread_id, agent.name, "user", user_message)
                    await _save_thread_msg("discord", thread_id, agent.name, "agent", result)

                    await _send_agent_result(webhook, agent.name, result, thread)
                    return

        # ── Channel-based routing ──
        agent = await find_agent_for_channel(str(message.channel.id))
        if agent:
            context = await _fetch_channel_context(message.channel)
            prompt = context + message.content if context else message.content
            async with message.channel.typing():
                result = await run_claude(agent, prompt, platform="discord")
            webhook = await get_or_create_webhook(message.channel)
            # Save for thread continuity
            reply_id = str(message.id)
            _thread_agents[reply_id] = agent.name
            await _save_thread_msg("discord", reply_id, agent.name, "user", message.content)
            await _save_thread_msg("discord", reply_id, agent.name, "agent", result)
            await _send_agent_result(webhook, agent.name, result)


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
