"""
Shared agent orchestration — used by both Discord and Slack bots.

Provides:
  - execute_agent(): Execute a single agent via SDK dispatch
  - run_team(): Execute a team of agents (sequential/parallel) with conditions
  - build_context_prompt(): Inject memory + client context
  - auto_advance_client_status(): Auto-advance client pipeline
  - ExecutionLog tracking for /status and /history
"""

import asyncio
import json
import uuid
import logging
from dataclasses import dataclass, field
from typing import Optional

from asgiref.sync import sync_to_async
from django.utils import timezone

from .models import (
    Agent, AgentTeam, AgentMemory, TeamMemory, ApprovalRequest,
    Client, ClientHistory, ExecutionLog, STATUS_PIPELINE,
)

logger = logging.getLogger("flaude.orchestrator")


# ── Memory & Context ─────────────────────────────────────────


@sync_to_async
def build_context_prompt(agent: Agent, base_prompt: str, client: Client | None = None) -> str:
    """Assemble full prompt with agent memory + client context injected."""
    parts = []

    # 1. Agent persistent memories
    memories = list(
        AgentMemory.objects.filter(agent=agent)
        .order_by("-updated_at").values_list("key", "content")[:20]
    )
    if memories:
        mem_text = "\n".join(f"- {k}: {v}" for k, v in memories)
        parts.append(f"[에이전트 메모리]\n{mem_text}")

    # 2. Team shared memories — single query instead of N+1 loop
    agent_teams = AgentTeam.objects.all()
    my_team_ids = [
        t.id for t in agent_teams
        if any(m.get("agent_id") == agent.id for m in (t.members or []))
    ]
    if my_team_ids:
        team_mems = list(
            TeamMemory.objects.filter(team_id__in=my_team_ids)
            .select_related("team").order_by("-updated_at")[:20]
        )
        if team_mems:
            by_team: dict[str, list[str]] = {}
            for m in team_mems:
                by_team.setdefault(m.team.name, []).append(f"- {m.key}: {m.content}")
            for team_name, items in by_team.items():
                parts.append(f"[팀 '{team_name}' 공유 지식]\n" + "\n".join(items[:10]))

    # 3. Client context
    if client:
        parts.append(
            f"[고객 정보]\n"
            f"- 기업: {client.company}\n"
            f"- 담당자: {client.contact_name}\n"
            f"- 이메일: {client.email}\n"
            f"- 전화: {client.phone}\n"
            f"- 부서: {client.department}\n"
            f"- 상태: {client.status}\n"
            f"- 메모: {client.notes}"
        )
        history = ClientHistory.objects.filter(client=client).order_by("-created_at")[:10]
        if history:
            hist_text = "\n".join(
                f"- [{h.created_at:%Y-%m-%d}] {h.agent_name}: {h.action}"
                for h in history
            )
            parts.append(f"[이 고객과의 이전 상호작용]\n{hist_text}")

    if parts:
        context = "\n\n".join(parts)
        return f"{context}\n\n---\n\n{base_prompt}"
    return base_prompt


@sync_to_async
def save_agent_memory(agent: Agent, key: str, content: str, source: str = "auto"):
    """Upsert an agent memory entry."""
    AgentMemory.objects.update_or_create(
        agent=agent, key=key,
        defaults={"content": content, "source": source},
    )


@sync_to_async
def save_team_memory(team: AgentTeam, key: str, content: str, agent: Agent | None = None):
    """Upsert a team shared memory entry."""
    TeamMemory.objects.update_or_create(
        team=team, key=key,
        defaults={"content": content, "created_by_agent": agent},
    )


# ── Client Pipeline ──────────────────────────────────────────


@sync_to_async
def auto_advance_client_status(client_id: int, agent_name: str, result_summary: str) -> tuple[str, str]:
    """After agent execution on a client, auto-advance status to next stage.
    Returns (old_status, new_status).
    """
    client = Client.objects.get(id=client_id)
    old_status = client.status
    try:
        idx = STATUS_PIPELINE.index(old_status)
    except ValueError:
        return old_status, old_status

    if idx < len(STATUS_PIPELINE) - 1:
        new_status = STATUS_PIPELINE[idx + 1]
        client.status = new_status
        client.save(update_fields=["status", "updated_at"])
        ClientHistory.objects.create(
            client=client,
            agent_name=agent_name,
            action=f"상태 변경: {old_status} → {new_status}",
            detail=result_summary[:500],
        )
        return old_status, new_status
    return old_status, old_status


# ── Condition Evaluation ─────────────────────────────────────


def _evaluate_condition(condition: str, previous_result: str) -> bool:
    """Evaluate a team member's condition against previous agent's result."""
    if not condition:
        return True
    if condition.startswith("result_contains:"):
        keyword = condition[len("result_contains:"):]
        return keyword.lower() in previous_result.lower()
    if condition.startswith("result_not_contains:"):
        keyword = condition[len("result_not_contains:"):]
        return keyword.lower() not in previous_result.lower()
    if condition.startswith("status:"):
        expected = condition[len("status:"):]
        return expected.lower() in previous_result.lower()
    return True


# ── Execution Log helpers ────────────────────────────────────


@sync_to_async
def _create_log(
    agent: Agent, prompt: str, platform: str,
    team_run_id: str = "", client: Client | None = None,
) -> ExecutionLog:
    return ExecutionLog.objects.create(
        agent=agent,
        client=client,
        prompt=prompt[:2000],
        platform=platform,
        status="running",
        team_run_id=team_run_id,
    )


@sync_to_async
def _complete_log(
    log: ExecutionLog, result: str, status: str, duration_ms: int,
    sdk_session_id: str = "", cost_usd: float | None = None,
    num_turns: int | None = None,
):
    log.result = result[:5000]
    log.status = status
    log.duration_ms = duration_ms
    log.sdk_session_id = sdk_session_id
    log.cost_usd = cost_usd
    log.num_turns = num_turns
    log.completed_at = timezone.now()
    log.save(update_fields=[
        "result", "status", "duration_ms", "completed_at",
        "sdk_session_id", "cost_usd", "num_turns",
    ])


# ── Agent execution via SDK dispatch ─────────────────────────


async def execute_agent(
    agent: Agent,
    prompt: str,
    user_id: int | str,
    session_id: str | None = None,
    resume: bool = False,
    platform: str = "app",
    team_run_id: str = "",
    client: Client | None = None,
    subagents: dict | None = None,
) -> tuple[str, str | None]:
    """Execute agent via dispatch to user's Mac. Returns (result, sdk_session_id)."""
    if not prompt or not prompt.strip():
        return "Error: 빈 메시지입니다.", None

    from .dispatch import dispatch_task

    enriched_prompt = await build_context_prompt(agent, prompt, client)
    log = await _create_log(agent, prompt, platform, team_run_id, client)
    start = asyncio.get_event_loop().time()

    sdk_config = {
        "prompt": enriched_prompt,
        "systemPrompt": agent.instructions or "",
        "allowedTools": agent.tools or [],
        "disallowedTools": agent.not_allowed or [],
        "agents": subagents or {},
        "sessionId": session_id,
        "resume": resume,
        "model": "opus",
        "permissionMode": "bypassPermissions",
        "enableCheckpointing": True,
    }

    result_json = await dispatch_task(
        str(user_id),
        agent.name,
        json.dumps(sdk_config),
        timeout=600,
    )

    duration_ms = int((asyncio.get_event_loop().time() - start) * 1000)

    if not result_json:
        await _complete_log(log, "Flaude 앱 미연결", "failed", duration_ms)
        return "Flaude 앱이 연결되어 있지 않습니다.", None

    try:
        parsed = json.loads(result_json)
        result = parsed.get("result", result_json)
        sdk_session = parsed.get("session_id")
        cost = parsed.get("cost_usd")
        turns = parsed.get("num_turns")
    except json.JSONDecodeError:
        result = result_json
        sdk_session = None
        cost = None
        turns = None

    await _complete_log(
        log, result, "completed", duration_ms,
        sdk_session_id=sdk_session or "",
        cost_usd=cost,
        num_turns=turns,
    )
    return result, sdk_session


# ── Team Orchestrator ────────────────────────────────────────


@dataclass
class AgentResult:
    agent_name: str
    role: str
    result: str
    display_mode: str  # "status" | "full" | "intermediate"
    is_lead: bool = False
    skipped: bool = False


@dataclass
class TeamResult:
    results: list[AgentResult] = field(default_factory=list)
    synthesis: AgentResult | None = None
    execution_mode: str = "sequential"
    awaiting_approval: bool = False
    approval_id: int | None = None


@sync_to_async
def get_team_agents_with_meta(team: AgentTeam) -> list[tuple[Agent, dict]]:
    """Load team's agents with their metadata (order, is_lead, condition)."""
    sorted_members = sorted(team.members, key=lambda m: m.get("order", 0))
    result = []
    for m in sorted_members:
        try:
            agent = Agent.objects.get(id=m["agent_id"], status="active")
            result.append((agent, m))
        except Agent.DoesNotExist:
            continue
    return result


async def run_team(
    team: AgentTeam,
    agents_with_meta: list[tuple[Agent, dict]],
    prompt: str,
    user_id: int | str,
    platform: str = "app",
    client: Client | None = None,
) -> TeamResult:
    """Execute a team of agents via SDK subagents.

    The lead agent receives workers as SDK subagents so Claude handles
    orchestration (parallel or sequential delegation) automatically.
    Approval gates fall back to explicit sequential execution.
    """
    team_run_id = str(uuid.uuid4())
    result = TeamResult(execution_mode=team.execution_mode)

    # Identify lead and workers
    leads = [(a, m) for a, m in agents_with_meta if m.get("is_lead", False)]
    workers = [(a, m) for a, m in agents_with_meta if not m.get("is_lead", False)]

    lead_agent = leads[0][0] if leads else (workers[0][0] if workers else None)
    # If no explicit lead, first worker becomes lead — remove from workers
    if not leads and workers:
        workers = workers[1:]

    if lead_agent is None:
        result.results.append(AgentResult(
            agent_name="System", role="", result="팀에 활성 에이전트가 없습니다.",
            display_mode="full",
        ))
        return result

    # Check if any worker requires approval — use sequential fallback
    needs_approval = any(
        m.get("requires_approval", False) for _, m in workers
    )

    if needs_approval:
        # ── Sequential fallback with approval gates ──
        accumulated_context = ""
        agents_list = [a for a, _ in agents_with_meta]

        for i, (agent, meta) in enumerate(agents_with_meta):
            is_last = (i == len(agents_with_meta) - 1)

            # Check condition
            condition = meta.get("condition", "")
            if condition and i > 0 and not _evaluate_condition(condition, accumulated_context):
                result.results.append(AgentResult(
                    agent_name=agent.name,
                    role=agent.role,
                    result=f"조건 불충족으로 건너뜀: {condition}",
                    display_mode="status",
                    skipped=True,
                ))
                continue

            # Check approval gate
            if meta.get("requires_approval", False) and i > 0:
                approval = await _create_approval(
                    team_run_id=team_run_id,
                    team=team,
                    agent=agents_list[i - 1],
                    next_agent=agent,
                    result_so_far=accumulated_context,
                    prompt=prompt,
                    platform=platform,
                )
                result.awaiting_approval = True
                result.approval_id = approval.id
                result.results.append(AgentResult(
                    agent_name=agent.name,
                    role=agent.role,
                    result="승인 대기 중...",
                    display_mode="status",
                ))
                return result  # Pause — resumed on approval

            if i == 0:
                full_prompt = prompt
            else:
                full_prompt = (
                    f"이전 에이전트({agents_list[i-1].name})의 결과:\n"
                    f"---\n{accumulated_context}\n---\n\n"
                    f"사용자 요청: {prompt}"
                )

            output, _ = await execute_agent(
                agent, full_prompt, user_id,
                platform=platform, team_run_id=team_run_id, client=client,
            )
            accumulated_context = output

            result.results.append(AgentResult(
                agent_name=agent.name,
                role=agent.role,
                result=output,
                display_mode="full" if is_last else "status",
            ))

        return result

    # ── SDK subagent path — Claude orchestrates delegation ──

    # Build subagents map for SDK
    subagents = {}
    for agent, meta in workers:
        subagents[agent.name] = {
            "description": f"{agent.role}. {(agent.instructions or '')[:200]}",
            "prompt": agent.instructions or f"You are {agent.name}, a {agent.role}.",
            "tools": agent.tools or [],
        }

    # Single dispatch: lead agent + subagents
    team_prompt = f"팀 명령: {prompt}\n\n필요한 팀원에게 작업을 위임하고 결과를 종합해주세요."
    output, sdk_session = await execute_agent(
        lead_agent, team_prompt, user_id,
        platform=platform, team_run_id=team_run_id, client=client,
        subagents=subagents if subagents else None,
    )

    result.results.append(AgentResult(
        agent_name=lead_agent.name,
        role=lead_agent.role,
        result=output,
        display_mode="full",
        is_lead=True,
    ))

    return result


# ── Approval Helpers ─────────────────────────────────────────


@sync_to_async
def _create_approval(
    team_run_id: str, team: AgentTeam, agent: Agent,
    next_agent: Agent, result_so_far: str, prompt: str, platform: str,
) -> ApprovalRequest:
    return ApprovalRequest.objects.create(
        team_run_id=team_run_id,
        team=team,
        agent=agent,
        next_agent=next_agent,
        result_so_far=result_so_far[:5000],
        prompt=prompt[:2000],
        platform=platform,
    )


@sync_to_async
def get_pending_approvals() -> list[dict]:
    qs = ApprovalRequest.objects.filter(status="pending").select_related("team", "agent", "next_agent")
    return [
        {
            "id": a.id,
            "team_name": a.team.name,
            "agent_name": a.agent.name,
            "next_agent_name": a.next_agent.name,
            "result_preview": a.result_so_far[:200],
            "prompt": a.prompt[:100],
            "platform": a.platform,
            "created_at": a.created_at.isoformat(),
        }
        for a in qs.order_by("-created_at")[:20]
    ]


@sync_to_async
def decide_approval(approval_id: int, decision: str, decided_by: str = "") -> ApprovalRequest:
    approval = ApprovalRequest.objects.select_related("team", "agent", "next_agent").get(id=approval_id)
    approval.status = decision  # "approved" or "rejected"
    approval.decided_by = decided_by
    approval.decided_at = timezone.now()
    approval.save(update_fields=["status", "decided_by", "decided_at"])
    return approval


async def resume_after_approval(approval: ApprovalRequest, user_id: int | str) -> TeamResult:
    """Resume team execution after an approval is granted."""
    team = approval.team
    agents_with_meta = await get_team_agents_with_meta(team)

    # Find the index of next_agent
    start_idx = None
    for i, (agent, meta) in enumerate(agents_with_meta):
        if agent.id == approval.next_agent_id:
            start_idx = i
            break

    if start_idx is None:
        return TeamResult(results=[AgentResult(
            agent_name="System", role="", result="승인된 에이전트를 찾을 수 없습니다.",
            display_mode="full",
        )])

    result = TeamResult(execution_mode="sequential")
    accumulated_context = approval.result_so_far
    agents_list = [a for a, _ in agents_with_meta]

    for i in range(start_idx, len(agents_with_meta)):
        agent, meta = agents_with_meta[i]
        is_last = (i == len(agents_with_meta) - 1)

        full_prompt = (
            f"이전 에이전트({agents_list[i-1].name})의 결과:\n"
            f"---\n{accumulated_context}\n---\n\n"
            f"사용자 요청: {approval.prompt}"
        )

        output, _ = await execute_agent(
            agent, full_prompt, user_id,
            platform=approval.platform, team_run_id=approval.team_run_id,
        )
        accumulated_context = output

        result.results.append(AgentResult(
            agent_name=agent.name,
            role=agent.role,
            result=output,
            display_mode="full" if is_last else "status",
        ))

    return result


# ── Query helpers for /status and /history ─────────────────


@sync_to_async
def get_running_executions(agent_name: str | None = None) -> list[dict]:
    qs = ExecutionLog.objects.filter(status="running").select_related("agent")
    if agent_name:
        qs = qs.filter(agent__name__iexact=agent_name)
    results = []
    for log in qs.order_by("-created_at")[:10]:
        elapsed = (timezone.now() - log.created_at).total_seconds()
        results.append({
            "agent_name": log.agent.name,
            "prompt": log.prompt[:80],
            "started_at": log.created_at.isoformat(),
            "elapsed_seconds": int(elapsed),
            "platform": log.platform,
        })
    return results


@sync_to_async
def get_execution_history(agent_name: str | None = None, limit: int = 10) -> list[dict]:
    qs = ExecutionLog.objects.filter(
        status__in=["completed", "failed"]
    ).select_related("agent")
    if agent_name:
        qs = qs.filter(agent__name__iexact=agent_name)
    results = []
    for log in qs.order_by("-created_at")[:limit]:
        results.append({
            "agent_name": log.agent.name,
            "status": log.status,
            "prompt": log.prompt[:80],
            "duration_ms": log.duration_ms,
            "created_at": log.created_at.isoformat(),
            "platform": log.platform,
        })
    return results
