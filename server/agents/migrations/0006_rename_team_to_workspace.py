"""Rename Team → Workspace, add WorkspaceMembership and WorkspaceInvite."""
import secrets

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone
from datetime import timedelta


def create_owner_memberships(apps, schema_editor):
    """Create owner memberships for all existing workspace creators."""
    Workspace = apps.get_model("agents", "Workspace")
    WorkspaceMembership = apps.get_model("agents", "WorkspaceMembership")
    for ws in Workspace.objects.all():
        WorkspaceMembership.objects.get_or_create(
            workspace=ws,
            user=ws.created_by,
            defaults={"role": "owner"},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0005_authtoken"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Rename Team model → Workspace
        migrations.RenameModel(old_name="Team", new_name="Workspace"),

        # 2. Rename FK fields from 'team' → 'workspace' on child models
        migrations.RenameField(model_name="agent", old_name="team", new_name="workspace"),
        migrations.RenameField(model_name="agentteam", old_name="team", new_name="workspace"),
        migrations.RenameField(model_name="client", old_name="team", new_name="workspace"),
        migrations.RenameField(model_name="staff", old_name="team", new_name="workspace"),

        # 3. Create WorkspaceMembership
        migrations.CreateModel(
            name="WorkspaceMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("owner", "Owner"), ("admin", "Admin"), ("member", "Member")], default="member", max_length=10)),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="workspace_memberships", to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="agents.workspace")),
            ],
            options={
                "unique_together": {("workspace", "user")},
            },
        ),

        # 4. Create WorkspaceInvite
        migrations.CreateModel(
            name="WorkspaceInvite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("email", models.EmailField(max_length=254)),
                ("role", models.CharField(choices=[("owner", "Owner"), ("admin", "Admin"), ("member", "Member")], default="member", max_length=10)),
                ("token", models.CharField(default=None, max_length=64, unique=True)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("accepted", "Accepted"), ("expired", "Expired")], default="pending", max_length=10)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("invited_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="invites", to="agents.workspace")),
            ],
        ),

        # 5. Create owner memberships for existing workspaces
        migrations.RunPython(create_owner_memberships, migrations.RunPython.noop),

        # 6. Add UserPlatformLink if not exists (in case prev migration didn't have it)
    ]
