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

    class Meta:
        unique_together = [("workspace", "name")]

    def __str__(self):
        return f"{self.name} ({self.role})"


class AgentTeam(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="agent_teams")
    name = models.CharField(max_length=100)
    members = models.JSONField(default=list)
    execution_mode = models.CharField(max_length=20, default="sequential", choices=[("sequential", "Sequential"), ("parallel", "Parallel")])
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("workspace", "name")]

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
    notification_channel = models.CharField(max_length=100, blank=True)  # Discord/Slack channel for updates
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


class AgentMemory(models.Model):
    """Persistent per-agent knowledge entries that survive across sessions."""
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="memories")
    key = models.CharField(max_length=200)
    content = models.TextField()
    source = models.CharField(max_length=50, default="manual")  # manual, auto, execution
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("agent", "key")

    def __str__(self):
        return f"{self.agent.name}: {self.key}"


class TeamMemory(models.Model):
    """Shared knowledge for a team, accessible by all members."""
    team = models.ForeignKey(AgentTeam, on_delete=models.CASCADE, related_name="memories")
    key = models.CharField(max_length=200)
    content = models.TextField()
    created_by_agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("team", "key")

    def __str__(self):
        return f"{self.team.name}: {self.key}"


class ExecutionLog(models.Model):
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="executions")
    client = models.ForeignKey('Client', null=True, blank=True, on_delete=models.SET_NULL, related_name="executions")
    platform = models.CharField(max_length=20, default="app")
    prompt = models.TextField()
    result = models.TextField(blank=True)
    status = models.CharField(max_length=20, default="running", choices=[
        ("running", "Running"), ("completed", "Completed"), ("failed", "Failed"),
    ])
    duration_ms = models.IntegerField(null=True, blank=True)
    session_id = models.CharField(max_length=100, blank=True)
    sdk_session_id = models.CharField(max_length=100, blank=True, default="")
    cost_usd = models.FloatField(null=True, blank=True)
    num_turns = models.IntegerField(null=True, blank=True)
    team_run_id = models.CharField(max_length=100, blank=True)
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


STATUS_PIPELINE = ["new", "researching", "contacted", "meeting", "closed"]


class AgentSchedule(models.Model):
    """Cron-based scheduled execution of agents or teams."""
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="schedules")
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.CASCADE, related_name="schedules")
    team = models.ForeignKey(AgentTeam, null=True, blank=True, on_delete=models.CASCADE, related_name="schedules")
    name = models.CharField(max_length=200)
    cron_expression = models.CharField(max_length=100)  # e.g. "0 9 * * 1-5"
    prompt = models.TextField()
    client = models.ForeignKey(Client, null=True, blank=True, on_delete=models.SET_NULL)
    notification_channel = models.CharField(max_length=100, blank=True)  # Discord/Slack channel for results
    is_active = models.BooleanField(default=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        target = self.agent.name if self.agent else (self.team.name if self.team else "?")
        return f"Schedule: {self.name} ({target}) [{self.cron_expression}]"


class ApprovalRequest(models.Model):
    """Human-in-the-loop approval for team workflows."""
    team_run_id = models.CharField(max_length=100)
    team = models.ForeignKey(AgentTeam, on_delete=models.CASCADE, related_name="approvals")
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="+")  # produced result
    next_agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="+")  # waiting
    result_so_far = models.TextField()
    prompt = models.TextField()
    platform = models.CharField(max_length=20)
    platform_channel_id = models.CharField(max_length=100, blank=True)
    platform_message_id = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, default="pending", choices=[
        ("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected"),
    ])
    decided_by = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Approval: {self.team.name} [{self.status}]"


class UserPlatformLink(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="platform_links")
    platform = models.CharField(max_length=20)
    platform_user_id = models.CharField(max_length=100)
    platform_team_id = models.CharField(max_length=100, blank=True)
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("platform", "platform_user_id")


class Meeting(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="meetings")
    title = models.CharField(max_length=200)
    meeting_date = models.DateTimeField()
    duration_seconds = models.IntegerField(null=True, blank=True)
    participants = models.JSONField(default=list)
    client = models.ForeignKey(Client, null=True, blank=True, on_delete=models.SET_NULL, related_name="meetings")
    audio_filename = models.CharField(max_length=500, blank=True)
    whisper_model = models.CharField(max_length=20, default="small")
    audio_source = models.CharField(max_length=20, default="upload", choices=[
        ("system", "System Audio"), ("mic", "Microphone"),
        ("upload", "Upload"), ("import", "Import"),
    ])
    status = models.CharField(max_length=20, default="uploaded", choices=[
        ("recording", "Recording"), ("uploaded", "Uploaded"),
        ("transcribing", "Transcribing"), ("completed", "Completed"),
        ("failed", "Failed"),
    ])
    error_message = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-meeting_date"]

    def __str__(self):
        return f"{self.title} ({self.meeting_date})"


class MeetingTranscript(models.Model):
    meeting = models.OneToOneField(Meeting, on_delete=models.CASCADE, related_name="transcript")
    full_text = models.TextField()
    segments = models.JSONField(default=list)
    language = models.CharField(max_length=10, default="ko")

    def __str__(self):
        return f"Transcript for {self.meeting.title}"


class MeetingAgentResult(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="agent_results")
    agent = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="meeting_results")
    processing_type = models.CharField(max_length=30, choices=[
        ("summary", "Summary"), ("action_items", "Action Items"),
        ("follow_up_email", "Follow-up Email"), ("proposal", "Proposal"),
        ("custom", "Custom"),
    ])
    custom_prompt = models.TextField(blank=True)
    result = models.TextField(blank=True)
    execution_log = models.ForeignKey(ExecutionLog, null=True, blank=True, on_delete=models.SET_NULL)
    status = models.CharField(max_length=20, default="pending", choices=[
        ("pending", "Pending"), ("running", "Running"),
        ("completed", "Completed"), ("failed", "Failed"),
    ])
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.agent.name} - {self.processing_type} for {self.meeting.title}"


class ThreadMessage(models.Model):
    """Persisted chat history for Discord/Slack threads."""
    platform = models.CharField(max_length=20)  # "discord" or "slack"
    thread_id = models.CharField(max_length=100)
    agent_name = models.CharField(max_length=100)
    role = models.CharField(max_length=10)  # "user" or "agent"
    content = models.TextField()
    sdk_session_id = models.CharField(max_length=100, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["platform", "thread_id"]),
            models.Index(fields=["platform", "thread_id", "-created_at"]),
        ]
