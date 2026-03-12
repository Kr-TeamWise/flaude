import logging
import os
import secrets
from datetime import datetime

from django.conf import settings
from django.contrib.auth.models import User
from django.db.models import Avg, Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import NinjaAPI, Schema
from ninja.security import HttpBasicAuth, HttpBearer
from typing import List, Optional

from .models import (
    Agent, AgentMemory, AgentSchedule, AgentTeam, ApprovalRequest,
    AuthToken, Client, ClientHistory, ExecutionLog, Staff, TeamMemory,
    UserPlatformLink, Workspace, WorkspaceInvite, WorkspaceMembership,
    STATUS_PIPELINE,
)

logger = logging.getLogger("flaude.api")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
SERVER_BASE_URL = os.environ.get("SERVER_BASE_URL", "http://localhost:8888")

# Pending OAuth states: { state: { "data": {...} | None, "created_at": float } }
_pending_oauth: dict[str, dict] = {}
_OAUTH_STATE_TTL = 600  # 10 minutes


# ── Auth ────────────────────────────────────────────────────────


class TokenAuth(HttpBearer):
    def authenticate(self, request, token):
        try:
            return AuthToken.objects.select_related("user").get(token=token).user
        except AuthToken.DoesNotExist:
            return None


class BasicAuth(HttpBasicAuth):
    def authenticate(self, request, username, password):
        try:
            user = User.objects.get(username=username)
            if user.check_password(password):
                return user
        except User.DoesNotExist:
            return None


api = NinjaAPI(title="Flaude API", version="1.0.0", auth=[TokenAuth(), BasicAuth()])


# ── Health Check ───────────────────────────────────────────────


@api.get("/health", auth=None)
def health_check(request):
    """Health check for Railway / load balancer."""
    from django.db import connection
    try:
        connection.ensure_connection()
        db_ok = True
    except Exception:
        db_ok = False

    return {"status": "ok" if db_ok else "degraded", "db": db_ok}


# ── Helpers ─────────────────────────────────────────────────────


def _get_workspace(workspace_id: int, user: User) -> Workspace:
    """Get workspace if user is a member (any role)."""
    membership = get_object_or_404(
        WorkspaceMembership, workspace_id=workspace_id, user=user
    )
    return membership.workspace


def _require_admin(workspace_id: int, user: User) -> Workspace:
    """Get workspace if user is owner or admin."""
    membership = get_object_or_404(
        WorkspaceMembership, workspace_id=workspace_id, user=user
    )
    if membership.role not in ("owner", "admin"):
        from ninja.errors import HttpError
        raise HttpError(403, "Admin access required")
    return membership.workspace


# ── Google Auth — Server-side OAuth2 flow (for desktop app) ─────


class AuthStartOut(Schema):
    url: str
    state: str


class AuthOut(Schema):
    token: str
    email: str
    name: str


class AuthPollOut(Schema):
    status: str  # "pending" | "ok"
    token: str = ""
    email: str = ""
    name: str = ""


@api.get("/auth/google/start", response=AuthStartOut, auth=None)
def google_auth_start(request):
    """Generate Google OAuth URL. App opens this in system browser."""
    if not GOOGLE_CLIENT_ID:
        raise Exception("GOOGLE_CLIENT_ID not configured")

    import time
    import urllib.parse
    state = secrets.token_urlsafe(32)

    # Clean up expired states
    now = time.time()
    expired = [k for k, v in _pending_oauth.items() if now - v["created_at"] > _OAUTH_STATE_TTL]
    for k in expired:
        _pending_oauth.pop(k, None)

    _pending_oauth[state] = {"data": None, "created_at": now}

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": f"{SERVER_BASE_URL}/auth/callback",
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "select_account",
    }
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"url": url, "state": state}


@api.get("/auth/google/poll", response=AuthPollOut, auth=None)
def google_auth_poll(request, state: str):
    """App polls this to check if login completed."""
    import time
    entry = _pending_oauth.get(state)
    if entry is None:
        return {"status": "pending"}

    # Check TTL
    if time.time() - entry["created_at"] > _OAUTH_STATE_TTL:
        _pending_oauth.pop(state, None)
        return {"status": "pending"}

    if entry["data"] is None:
        return {"status": "pending"}

    # Clean up and return
    data = entry["data"]
    _pending_oauth.pop(state, None)
    return {"status": "ok", **data}


def _create_or_get_user_token(email: str, name: str) -> dict:
    """Create or get user and return token dict."""
    user, created = User.objects.get_or_create(
        username=email,
        defaults={"email": email, "first_name": name},
    )
    if not created and not user.first_name:
        user.first_name = name
        user.save(update_fields=["first_name"])

    token_obj, _ = AuthToken.objects.get_or_create(
        user=user,
        defaults={"token": secrets.token_urlsafe(48)},
    )

    # Auto-create a workspace + owner membership if user has none
    if not WorkspaceMembership.objects.filter(user=user).exists():
        ws = Workspace.objects.create(name="My Workspace", created_by=user)
        WorkspaceMembership.objects.create(workspace=ws, user=user, role="owner")

    return {"token": token_obj.token, "email": email, "name": name}


# ── Me ──────────────────────────────────────────────────────────


class MeOut(Schema):
    id: int
    email: str
    name: str


@api.get("/me", response=MeOut)
def get_me(request):
    user = request.auth
    return {"id": user.id, "email": user.email, "name": user.first_name or user.username}


# ── Schemas ──────────────────────────────────────────────────────


class WorkspaceIn(Schema):
    name: str


class WorkspaceOut(Schema):
    id: int
    name: str
    created_at: datetime


class WorkspaceMemberOut(Schema):
    id: int
    user_id: int
    email: str
    name: str
    role: str
    joined_at: datetime


class WorkspaceInviteIn(Schema):
    email: str
    role: str = "member"


class WorkspaceInviteOut(Schema):
    id: int
    email: str
    role: str
    status: str
    created_at: datetime
    expires_at: datetime


class AgentIn(Schema):
    name: str
    role: str
    instructions: str
    tools: list = []
    not_allowed: list = []
    channels: list = []
    avatar_url: str = ""


class AgentOut(Schema):
    id: int
    name: str
    role: str
    instructions: str
    tools: list
    not_allowed: list
    channels: list
    avatar_url: str
    status: str
    fired_reason: str
    created_at: datetime
    fired_at: Optional[datetime] = None


class AgentFireIn(Schema):
    reason: str = ""


class ExecutionLogIn(Schema):
    prompt: str
    platform: str = "app"
    session_id: str = ""


class ExecutionCompleteIn(Schema):
    result: str = ""
    status: str = "completed"
    duration_ms: Optional[int] = None


class ExecutionLogOut(Schema):
    id: int
    agent_id: int
    platform: str
    prompt: str
    result: str
    status: str
    duration_ms: Optional[int] = None
    session_id: str
    created_at: datetime
    completed_at: Optional[datetime] = None


class AgentStatsOut(Schema):
    total_runs: int
    completed: int
    failed: int
    avg_duration_ms: Optional[float] = None


class AgentTeamMemberIn(Schema):
    agent_id: int
    order: int = 0
    is_lead: bool = False


class AgentTeamIn(Schema):
    name: str
    members: list = []
    execution_mode: str = "sequential"


class AgentTeamOut(Schema):
    id: int
    name: str
    members: list
    execution_mode: str
    created_at: datetime


class AgentTeamRunIn(Schema):
    prompt: str


class ClientIn(Schema):
    company: str = ""
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    department: str = ""
    notes: str = ""
    status: str = "new"
    assigned_agent: str = ""


class ClientOut(Schema):
    id: int
    company: str
    contact_name: str
    email: str
    phone: str
    department: str
    notes: str
    status: str
    assigned_agent: str
    created_at: datetime
    updated_at: datetime


class ClientHistoryOut(Schema):
    id: int
    agent_name: str
    action: str
    detail: str
    created_at: datetime


# ── Workspaces ──────────────────────────────────────────────────


@api.post("/workspaces", response=WorkspaceOut)
def create_workspace(request, payload: WorkspaceIn):
    ws = Workspace.objects.create(name=payload.name, created_by=request.auth)
    WorkspaceMembership.objects.create(workspace=ws, user=request.auth, role="owner")
    return ws


@api.get("/workspaces", response=List[WorkspaceOut])
def list_workspaces(request):
    ws_ids = WorkspaceMembership.objects.filter(user=request.auth).values_list("workspace_id", flat=True)
    return list(Workspace.objects.filter(id__in=ws_ids))


@api.put("/workspaces/{ws_id}", response=WorkspaceOut)
def update_workspace(request, ws_id: int, payload: WorkspaceIn):
    ws = _require_admin(ws_id, request.auth)
    ws.name = payload.name
    ws.save(update_fields=["name"])
    return ws


# ── Workspace Members ───────────────────────────────────────────


@api.get("/workspaces/{ws_id}/members", response=List[WorkspaceMemberOut])
def list_workspace_members(request, ws_id: int):
    _get_workspace(ws_id, request.auth)
    memberships = WorkspaceMembership.objects.filter(workspace_id=ws_id).select_related("user")
    return [
        {
            "id": m.id,
            "user_id": m.user.id,
            "email": m.user.email,
            "name": m.user.first_name or m.user.username,
            "role": m.role,
            "joined_at": m.joined_at,
        }
        for m in memberships
    ]


@api.put("/workspaces/{ws_id}/members/{member_id}/role")
def update_member_role(request, ws_id: int, member_id: int, role: str):
    _require_admin(ws_id, request.auth)
    membership = get_object_or_404(WorkspaceMembership, id=member_id, workspace_id=ws_id)
    if role not in ("admin", "member"):
        from ninja.errors import HttpError
        raise HttpError(400, "Invalid role")
    membership.role = role
    membership.save(update_fields=["role"])
    return {"ok": True}


@api.delete("/workspaces/{ws_id}/members/{member_id}", response={204: None})
def remove_workspace_member(request, ws_id: int, member_id: int):
    _require_admin(ws_id, request.auth)
    membership = get_object_or_404(WorkspaceMembership, id=member_id, workspace_id=ws_id)
    if membership.role == "owner":
        from ninja.errors import HttpError
        raise HttpError(400, "Cannot remove workspace owner")
    membership.delete()
    return 204, None


# ── Workspace Invites ───────────────────────────────────────────


@api.get("/workspaces/{ws_id}/invites", response=List[WorkspaceInviteOut])
def list_workspace_invites(request, ws_id: int):
    _require_admin(ws_id, request.auth)
    return list(WorkspaceInvite.objects.filter(workspace_id=ws_id, status="pending"))


@api.post("/workspaces/{ws_id}/invites", response=WorkspaceInviteOut)
def create_workspace_invite(request, ws_id: int, payload: WorkspaceInviteIn):
    ws = _require_admin(ws_id, request.auth)
    invite = WorkspaceInvite.objects.create(
        workspace=ws,
        email=payload.email,
        invited_by=request.auth,
        role=payload.role,
    )
    return invite


@api.delete("/invites/{invite_id}", response={204: None})
def cancel_invite(request, invite_id: int):
    invite = get_object_or_404(WorkspaceInvite, id=invite_id, invited_by=request.auth, status="pending")
    invite.status = "expired"
    invite.save(update_fields=["status"])
    return 204, None


@api.post("/invites/accept", auth=None)
def accept_invite(request, token: str):
    """Accept workspace invite via token. Requires authenticated user."""
    invite = get_object_or_404(WorkspaceInvite, token=token, status="pending")
    if invite.expires_at < timezone.now():
        invite.status = "expired"
        invite.save(update_fields=["status"])
        return {"error": "Invite expired"}

    # Need the user from auth header
    user = None
    auth_token = request.headers.get("Authorization", "")
    if auth_token.startswith("Bearer "):
        try:
            user = AuthToken.objects.select_related("user").get(token=auth_token[7:]).user
        except AuthToken.DoesNotExist:
            pass

    if not user:
        from ninja.errors import HttpError
        raise HttpError(401, "Authentication required to accept invite")

    membership, created = WorkspaceMembership.objects.get_or_create(
        workspace=invite.workspace,
        user=user,
        defaults={"role": invite.role},
    )
    invite.status = "accepted"
    invite.save(update_fields=["status"])
    return {"ok": True, "workspace_id": invite.workspace.id, "workspace_name": invite.workspace.name}


# ── Agents ───────────────────────────────────────────────────────


@api.get("/workspaces/{ws_id}/agents", response=List[AgentOut])
def list_agents(request, ws_id: int):
    ws = _get_workspace(ws_id, request.auth)
    return list(ws.agents.all())


@api.post("/workspaces/{ws_id}/agents", response=AgentOut)
def create_agent(request, ws_id: int, payload: AgentIn):
    ws = _get_workspace(ws_id, request.auth)
    agent = Agent.objects.create(
        workspace=ws,
        created_by=request.auth,
        name=payload.name,
        role=payload.role,
        instructions=payload.instructions,
        tools=payload.tools,
        not_allowed=payload.not_allowed,
        channels=payload.channels,
        avatar_url=payload.avatar_url,
    )
    return agent


@api.get("/agents/{agent_id}", response=AgentOut)
def get_agent(request, agent_id: int):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    return agent


@api.put("/agents/{agent_id}", response=AgentOut)
def update_agent(request, agent_id: int, payload: AgentIn):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    for attr, value in payload.dict().items():
        setattr(agent, attr, value)
    agent.save()
    return agent


@api.post("/agents/{agent_id}/fire", response=AgentOut)
def fire_agent(request, agent_id: int, payload: AgentFireIn):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    agent.status = "fired"
    agent.fired_reason = payload.reason
    agent.fired_at = timezone.now()
    agent.save()
    return agent


@api.post("/agents/{agent_id}/rehire", response=AgentOut)
def rehire_agent(request, agent_id: int):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    agent.status = "active"
    agent.fired_reason = ""
    agent.fired_at = None
    agent.save()
    return agent


@api.delete("/agents/{agent_id}", response={204: None})
def delete_agent(request, agent_id: int):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    agent.delete()
    return 204, None


# ── Execution Logs ──────────────────────────────────────────────


@api.post("/agents/{agent_id}/executions", response=ExecutionLogOut)
def create_execution(request, agent_id: int, payload: ExecutionLogIn):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    log = ExecutionLog.objects.create(
        agent=agent,
        prompt=payload.prompt,
        platform=payload.platform,
        session_id=payload.session_id,
    )
    return log


@api.put("/executions/{exec_id}/complete", response=ExecutionLogOut)
def complete_execution(request, exec_id: int, payload: ExecutionCompleteIn):
    log = get_object_or_404(ExecutionLog, id=exec_id)
    _get_workspace(log.agent.workspace_id, request.auth)
    log.result = payload.result
    log.status = payload.status
    log.duration_ms = payload.duration_ms
    log.completed_at = timezone.now()
    log.save()
    return log


@api.get("/agents/{agent_id}/stats", response=AgentStatsOut)
def agent_stats(request, agent_id: int):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    qs = agent.executions.all()
    stats = qs.aggregate(
        total_runs=Count("id"),
        completed=Count("id", filter=Q(status="completed")),
        failed=Count("id", filter=Q(status="failed")),
        avg_duration_ms=Avg("duration_ms", filter=Q(duration_ms__isnull=False)),
    )
    return stats


# ── Agent Teams ──────────────────────────────────────────────────


@api.get("/workspaces/{ws_id}/agent-teams", response=List[AgentTeamOut])
def list_agent_teams(request, ws_id: int):
    ws = _get_workspace(ws_id, request.auth)
    return list(ws.agent_teams.all())


@api.post("/workspaces/{ws_id}/agent-teams", response=AgentTeamOut)
def create_agent_team(request, ws_id: int, payload: AgentTeamIn):
    ws = _get_workspace(ws_id, request.auth)
    agent_team = AgentTeam.objects.create(
        workspace=ws,
        name=payload.name,
        members=payload.members,
        execution_mode=payload.execution_mode,
    )
    return agent_team


@api.put("/agent-teams/{at_id}", response=AgentTeamOut)
def update_agent_team(request, at_id: int, payload: AgentTeamIn):
    at = get_object_or_404(AgentTeam, id=at_id)
    _get_workspace(at.workspace_id, request.auth)
    at.name = payload.name
    at.members = payload.members
    at.execution_mode = payload.execution_mode
    at.save()
    return at


@api.delete("/agent-teams/{at_id}", response={204: None})
def delete_agent_team(request, at_id: int):
    at = get_object_or_404(AgentTeam, id=at_id)
    _get_workspace(at.workspace_id, request.auth)
    at.delete()
    return 204, None


@api.post("/agent-teams/{at_id}/run")
def run_agent_team(request, at_id: int, payload: AgentTeamRunIn):
    """Returns ordered list of agents to execute. Actual execution happens on client."""
    at = get_object_or_404(AgentTeam, id=at_id)
    ws = _get_workspace(at.workspace_id, request.auth)
    sorted_members = sorted(at.members, key=lambda m: m.get("order", 0))
    result = []
    for m in sorted_members:
        try:
            agent = Agent.objects.get(id=m["agent_id"], workspace=ws)
            result.append({
                "agent_id": agent.id,
                "name": agent.name,
                "instructions": agent.instructions,
                "tools": agent.tools,
                "not_allowed": agent.not_allowed,
                "is_lead": m.get("is_lead", False),
                "order": m.get("order", 0),
            })
        except Agent.DoesNotExist:
            continue
    return {
        "team_name": at.name,
        "execution_mode": at.execution_mode,
        "prompt": payload.prompt,
        "agents": result,
    }


# ── Clients ──────────────────────────────────────────────────────


@api.get("/workspaces/{ws_id}/clients", response=List[ClientOut])
def list_clients(request, ws_id: int):
    ws = _get_workspace(ws_id, request.auth)
    return list(ws.clients.all())


@api.post("/workspaces/{ws_id}/clients", response=ClientOut)
def create_client(request, ws_id: int, payload: ClientIn):
    ws = _get_workspace(ws_id, request.auth)
    client = Client.objects.create(
        workspace=ws,
        created_by=request.auth,
        **payload.dict(),
    )
    return client


@api.get("/clients/{client_id}", response=ClientOut)
def get_client(request, client_id: int):
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)
    return client


@api.put("/clients/{client_id}", response=ClientOut)
def update_client(request, client_id: int, payload: ClientIn):
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)
    for attr, value in payload.dict().items():
        setattr(client, attr, value)
    client.save()
    return client


@api.delete("/clients/{client_id}", response={204: None})
def delete_client(request, client_id: int):
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)
    client.delete()
    return 204, None


@api.get("/clients/{client_id}/history", response=List[ClientHistoryOut])
def client_history(request, client_id: int):
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)
    return list(client.history.order_by("-created_at"))


class ClientHistoryIn(Schema):
    agent_name: str
    action: str
    detail: str = ""


@api.post("/clients/{client_id}/history", response=ClientHistoryOut)
def create_client_history(request, client_id: int, payload: ClientHistoryIn):
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)
    entry = ClientHistory.objects.create(
        client=client,
        agent_name=payload.agent_name,
        action=payload.action,
        detail=payload.detail,
    )
    return entry


# ── Staff (Human Team Members) ─────────────────────────────────


class StaffIn(Schema):
    name: str
    role: str = ""
    email: str = ""
    phone: str = ""
    notes: str = ""


class StaffOut(Schema):
    id: int
    name: str
    role: str
    email: str
    phone: str
    notes: str
    created_at: datetime


@api.get("/workspaces/{ws_id}/staff", response=List[StaffOut])
def list_staff(request, ws_id: int):
    ws = _get_workspace(ws_id, request.auth)
    return list(ws.staff.all())


@api.post("/workspaces/{ws_id}/staff", response=StaffOut)
def create_staff(request, ws_id: int, payload: StaffIn):
    ws = _get_workspace(ws_id, request.auth)
    return Staff.objects.create(workspace=ws, created_by=request.auth, **payload.dict())


@api.put("/staff/{staff_id}", response=StaffOut)
def update_staff(request, staff_id: int, payload: StaffIn):
    s = get_object_or_404(Staff, id=staff_id)
    _get_workspace(s.workspace_id, request.auth)
    for attr, value in payload.dict().items():
        setattr(s, attr, value)
    s.save()
    return s


@api.delete("/staff/{staff_id}", response={204: None})
def delete_staff(request, staff_id: int):
    s = get_object_or_404(Staff, id=staff_id)
    _get_workspace(s.workspace_id, request.auth)
    s.delete()
    return 204, None


# ── Platform Linking (Discord / Slack) ────────────────────────


class PlatformLinkIn(Schema):
    platform: str  # "discord" or "slack"
    platform_user_id: str
    platform_team_id: str = ""


class PlatformLinkOut(Schema):
    id: int
    platform: str
    platform_user_id: str
    platform_team_id: str
    linked_at: datetime


@api.get("/me/platform-links", response=List[PlatformLinkOut])
def list_platform_links(request):
    """List current user's linked platforms."""
    return list(UserPlatformLink.objects.filter(user=request.auth))


@api.post("/me/platform-links", response=PlatformLinkOut)
def create_platform_link(request, payload: PlatformLinkIn):
    """Link a Discord/Slack account to the current user."""
    if payload.platform not in ("discord", "slack"):
        from ninja.errors import HttpError
        raise HttpError(400, "Platform must be 'discord' or 'slack'")

    link, created = UserPlatformLink.objects.update_or_create(
        platform=payload.platform,
        platform_user_id=payload.platform_user_id,
        defaults={
            "user": request.auth,
            "platform_team_id": payload.platform_team_id,
        },
    )
    return link


@api.delete("/me/platform-links/{link_id}", response={204: None})
def delete_platform_link(request, link_id: int):
    """Unlink a platform account."""
    link = get_object_or_404(UserPlatformLink, id=link_id, user=request.auth)
    link.delete()
    return 204, None


# ── Client Parsing (Claude Code CLI) ─────────────────────────


@api.post("/workspaces/{ws_id}/clients/parse")
def parse_client_info(request, ws_id: int, raw_text: str):
    """Parse free-form client text into structured data using claude CLI.
    Used by /client slash command in Discord/Slack bots."""
    _get_workspace(ws_id, request.auth)
    import json as json_mod
    import subprocess

    try:
        prompt = (
            f"Parse the following client info into JSON. "
            f"Extract: company, contact_name, email, phone, department, notes. "
            f"Return ONLY valid JSON, no markdown.\n\nInput: {raw_text}"
        )
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        result = subprocess.run(
            ["claude", "-p", prompt, "--model", "haiku"],
            capture_output=True, text=True, env=env, timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            text = result.stdout.strip()
            # Strip markdown code fences if present
            if text.startswith("```"):
                text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = "\n".join(text.split("\n")[:-1])
            parsed = json_mod.loads(text.strip())
            return {"parsed": parsed}
    except Exception as e:
        logger.warning("Claude CLI parsing failed: %s", e)

    return {"parsed": _fallback_parse(raw_text)}


# ── Agent Memory ────────────────────────────────────────────


class AgentMemoryIn(Schema):
    key: str
    content: str


class AgentMemoryOut(Schema):
    id: int
    key: str
    content: str
    source: str
    created_at: datetime
    updated_at: datetime


@api.get("/agents/{agent_id}/memories", response=List[AgentMemoryOut])
def list_agent_memories(request, agent_id: int):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    return list(AgentMemory.objects.filter(agent=agent).order_by("-updated_at"))


@api.post("/agents/{agent_id}/memories", response=AgentMemoryOut)
def create_agent_memory(request, agent_id: int, payload: AgentMemoryIn):
    agent = get_object_or_404(Agent, id=agent_id)
    _get_workspace(agent.workspace_id, request.auth)
    mem, _ = AgentMemory.objects.update_or_create(
        agent=agent, key=payload.key,
        defaults={"content": payload.content, "source": "manual"},
    )
    return mem


@api.delete("/memories/{memory_id}", response={204: None})
def delete_agent_memory(request, memory_id: int):
    mem = get_object_or_404(AgentMemory, id=memory_id)
    _get_workspace(mem.agent.workspace_id, request.auth)
    mem.delete()
    return 204, None


# ── Team Memory ─────────────────────────────────────────────


class TeamMemoryIn(Schema):
    key: str
    content: str


class TeamMemoryOut(Schema):
    id: int
    key: str
    content: str
    created_at: datetime
    updated_at: datetime


@api.get("/agent-teams/{team_id}/memories", response=List[TeamMemoryOut])
def list_team_memories(request, team_id: int):
    team = get_object_or_404(AgentTeam, id=team_id)
    _get_workspace(team.workspace_id, request.auth)
    return list(TeamMemory.objects.filter(team=team).order_by("-updated_at"))


@api.post("/agent-teams/{team_id}/memories", response=TeamMemoryOut)
def create_team_memory(request, team_id: int, payload: TeamMemoryIn):
    team = get_object_or_404(AgentTeam, id=team_id)
    _get_workspace(team.workspace_id, request.auth)
    mem, _ = TeamMemory.objects.update_or_create(
        team=team, key=payload.key,
        defaults={"content": payload.content},
    )
    return mem


@api.delete("/team-memories/{memory_id}", response={204: None})
def delete_team_memory(request, memory_id: int):
    mem = get_object_or_404(TeamMemory, id=memory_id)
    _get_workspace(mem.team.workspace_id, request.auth)
    mem.delete()
    return 204, None


# ── Client Run & Timeline ──────────────────────────────────


class ClientRunIn(Schema):
    prompt: str = ""
    auto_advance: bool = True


class TimelineEntry(Schema):
    id: int
    type: str  # "history" | "execution"
    agent_name: str
    action: str
    detail: str
    created_at: datetime


@api.get("/clients/{client_id}/timeline", response=List[TimelineEntry])
def client_timeline(request, client_id: int):
    """Unified timeline: ClientHistory + ExecutionLog for this client."""
    client = get_object_or_404(Client, id=client_id)
    _get_workspace(client.workspace_id, request.auth)

    entries = []
    for h in ClientHistory.objects.filter(client=client).order_by("-created_at")[:50]:
        entries.append({
            "id": h.id,
            "type": "history",
            "agent_name": h.agent_name,
            "action": h.action,
            "detail": h.detail,
            "created_at": h.created_at,
        })
    for e in ExecutionLog.objects.filter(client=client, status__in=["completed", "failed"]).select_related("agent").order_by("-created_at")[:50]:
        entries.append({
            "id": e.id + 100000,  # offset to avoid ID collision
            "type": "execution",
            "agent_name": e.agent.name,
            "action": f"실행 ({e.status})",
            "detail": e.result[:300] if e.result else "",
            "created_at": e.created_at,
        })
    entries.sort(key=lambda x: x["created_at"], reverse=True)
    return entries[:50]


class BatchRunIn(Schema):
    client_ids: list
    agent_name: str = ""
    prompt: str = ""


@api.post("/workspaces/{ws_id}/clients/batch-run")
def batch_run_clients(request, ws_id: int, payload: BatchRunIn):
    """Queue batch run of an agent on multiple clients. Returns immediately."""
    ws = _get_workspace(ws_id, request.auth)
    count = 0
    for cid in payload.client_ids:
        try:
            client = Client.objects.get(id=cid, workspace=ws)
            agent_name = payload.agent_name or client.assigned_agent
            if agent_name:
                count += 1
        except Client.DoesNotExist:
            continue
    return {"queued": count, "message": f"{count}건의 작업이 대기열에 추가되었습니다."}


# ── Schedules ───────────────────────────────────────────────


class ScheduleIn(Schema):
    name: str
    agent_id: Optional[int] = None
    team_id: Optional[int] = None
    cron_expression: str
    prompt: str
    client_id: Optional[int] = None
    notification_channel: str = ""
    is_active: bool = True


class ScheduleOut(Schema):
    id: int
    name: str
    agent_id: Optional[int] = None
    team_id: Optional[int] = None
    cron_expression: str
    prompt: str
    client_id: Optional[int] = None
    notification_channel: str
    is_active: bool
    last_run_at: Optional[datetime] = None
    created_at: datetime


@api.get("/workspaces/{ws_id}/schedules", response=List[ScheduleOut])
def list_schedules(request, ws_id: int):
    ws = _get_workspace(ws_id, request.auth)
    return list(AgentSchedule.objects.filter(workspace=ws).order_by("-created_at"))


@api.post("/workspaces/{ws_id}/schedules", response=ScheduleOut)
def create_schedule(request, ws_id: int, payload: ScheduleIn):
    ws = _get_workspace(ws_id, request.auth)
    sched = AgentSchedule.objects.create(
        workspace=ws,
        name=payload.name,
        agent_id=payload.agent_id,
        team_id=payload.team_id,
        cron_expression=payload.cron_expression,
        prompt=payload.prompt,
        client_id=payload.client_id,
        notification_channel=payload.notification_channel,
        is_active=payload.is_active,
    )
    return sched


@api.put("/schedules/{schedule_id}", response=ScheduleOut)
def update_schedule(request, schedule_id: int, payload: ScheduleIn):
    sched = get_object_or_404(AgentSchedule, id=schedule_id)
    _get_workspace(sched.workspace_id, request.auth)
    for attr, value in payload.dict().items():
        setattr(sched, attr, value)
    sched.save()
    return sched


@api.delete("/schedules/{schedule_id}", response={204: None})
def delete_schedule(request, schedule_id: int):
    sched = get_object_or_404(AgentSchedule, id=schedule_id)
    _get_workspace(sched.workspace_id, request.auth)
    sched.delete()
    return 204, None


# ── Approvals ───────────────────────────────────────────────


class ApprovalOut(Schema):
    id: int
    team_name: str
    agent_name: str
    next_agent_name: str
    result_preview: str
    prompt: str
    status: str
    platform: str
    created_at: datetime
    decided_at: Optional[datetime] = None


class ApprovalDecisionIn(Schema):
    decision: str  # "approved" or "rejected"


@api.get("/approvals/pending", response=List[ApprovalOut])
def list_pending_approvals(request):
    qs = ApprovalRequest.objects.filter(status="pending").select_related("team", "agent", "next_agent")
    return [
        {
            "id": a.id,
            "team_name": a.team.name,
            "agent_name": a.agent.name,
            "next_agent_name": a.next_agent.name,
            "result_preview": a.result_so_far[:300],
            "prompt": a.prompt[:200],
            "status": a.status,
            "platform": a.platform,
            "created_at": a.created_at,
            "decided_at": a.decided_at,
        }
        for a in qs.order_by("-created_at")[:20]
    ]


@api.post("/approvals/{approval_id}/decide")
def decide_approval_api(request, approval_id: int, payload: ApprovalDecisionIn):
    approval = get_object_or_404(ApprovalRequest, id=approval_id, status="pending")
    approval.status = payload.decision
    approval.decided_by = request.auth.email if hasattr(request.auth, 'email') else str(request.auth)
    approval.decided_at = timezone.now()
    approval.save(update_fields=["status", "decided_by", "decided_at"])
    return {"ok": True, "status": approval.status}


def _fallback_parse(raw_text: str) -> dict:
    """Simple regex-based fallback when Haiku API is unavailable."""
    import re
    result = {"company": "", "contact_name": "", "email": "", "phone": "", "department": "", "notes": ""}

    # Extract email
    email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', raw_text)
    if email_match:
        result["email"] = email_match.group()
        raw_text = raw_text.replace(result["email"], "").strip()

    # Extract phone
    phone_match = re.search(r'[\d]{2,4}[-.][\d]{3,4}[-.][\d]{4}', raw_text)
    if phone_match:
        result["phone"] = phone_match.group()
        raw_text = raw_text.replace(result["phone"], "").strip()

    # Remaining words: first is likely company or name
    words = raw_text.split()
    if len(words) >= 2:
        result["company"] = words[0]
        result["contact_name"] = words[1]
        if len(words) > 2:
            result["notes"] = " ".join(words[2:])
    elif len(words) == 1:
        result["contact_name"] = words[0]

    return result
