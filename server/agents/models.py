import secrets
from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta


def _generate_invite_token():
    return secrets.token_urlsafe(32)


def _default_invite_expiry():
    return timezone.now() + timedelta(days=7)


class Workspace(models.Model):
    """A workspace (organization) that owns all resources."""
    name = models.CharField(max_length=100)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name="owned_workspaces")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class WorkspaceMembership(models.Model):
    """Links users to workspaces with roles."""
    ROLE_CHOICES = [("owner", "Owner"), ("admin", "Admin"), ("member", "Member")]
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="workspace_memberships")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="member")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("workspace", "user")

    def __str__(self):
        return f"{self.user.username} @ {self.workspace.name} ({self.role})"


class WorkspaceInvite(models.Model):
    """Pending invitation to join a workspace."""
    STATUS_CHOICES = [("pending", "Pending"), ("accepted", "Accepted"), ("expired", "Expired")]
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invites")
    email = models.EmailField()
    invited_by = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=10, choices=WorkspaceMembership.ROLE_CHOICES, default="member")
    token = models.CharField(max_length=64, unique=True, default=_generate_invite_token)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=_default_invite_expiry)

    def __str__(self):
        return f"Invite {self.email} to {self.workspace.name}"


class Agent(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="agents")
    name = models.CharField(max_length=50)
    role = models.CharField(max_length=100)
    instructions = models.TextField()
    tools = models.JSONField(default=list)
    not_allowed = models.JSONField(default=list, blank=True)
    channels = models.JSONField(default=list, blank=True)
    avatar_url = models.URLField(blank=True)
    status = models.CharField(max_length=10, default="active", choices=[("active", "Active"), ("fired", "Fired")])
    fired_reason = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    fired_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.role})"


class AgentTeam(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="agent_teams")
    name = models.CharField(max_length=100)
    members = models.JSONField(default=list)
    execution_mode = models.CharField(max_length=20, default="sequential", choices=[("sequential", "Sequential"), ("parallel", "Parallel")])
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Client(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="clients")
    company = models.CharField(max_length=200, blank=True)
    contact_name = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    department = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, default="new", choices=[
        ("new", "New"), ("researching", "Researching"), ("contacted", "Contacted"),
        ("meeting", "Meeting"), ("closed", "Closed"),
    ])
    assigned_agent = models.CharField(max_length=50, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.company} - {self.contact_name}"


class ClientHistory(models.Model):
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name="history")
    agent_name = models.CharField(max_length=50)
    action = models.CharField(max_length=200)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ExecutionLog(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="executions")
    platform = models.CharField(max_length=20, default="app")
    prompt = models.TextField()
    result = models.TextField(blank=True)
    status = models.CharField(max_length=20, default="running", choices=[
        ("running", "Running"), ("completed", "Completed"), ("failed", "Failed"),
    ])
    duration_ms = models.IntegerField(null=True, blank=True)
    session_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.agent.name} - {self.status} ({self.created_at})"


class Staff(models.Model):
    """Human team members (not AI agents)."""
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="staff")
    name = models.CharField(max_length=100)
    role = models.CharField(max_length=100, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.role})"


class AuthToken(models.Model):
    """Simple token-based auth for API access."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="auth_token")
    token = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Token for {self.user.username}"


class UserPlatformLink(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="platform_links")
    platform = models.CharField(max_length=20)
    platform_user_id = models.CharField(max_length=100)
    platform_team_id = models.CharField(max_length=100, blank=True)
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("platform", "platform_user_id")
