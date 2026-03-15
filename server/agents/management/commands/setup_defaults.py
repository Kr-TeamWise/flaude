"""
Create default agents and a default team for every workspace that has none.

Usage:
    python manage.py setup_defaults
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

User = get_user_model()

DEFAULT_AGENTS = [
    {
        "name": "Ria",
        "role": "Market Research",
        "instructions": (
            "당신은 시장 조사 전문 에이전트입니다. 웹에서 최신 시장·산업·경쟁사 자료를 수집하고, "
            "교차 검증하여 체계적인 보고서를 작성합니다."
        ),
        "tools": ["WebSearch", "WebFetch", "Bash", "Read", "Write"],
        "not_allowed": [],
        "is_lead": False,
    },
    {
        "name": "Kade",
        "role": "Sales Outreach",
        "instructions": (
            "당신은 B2B 영업 전문 에이전트입니다. 잠재 고객에게 개인화된 이메일을 보내고, "
            "미팅을 잡고, 팔로업을 관리합니다."
        ),
        "tools": ["Bash", "Read", "Write"],
        "not_allowed": [],
        "is_lead": True,
    },
    {
        "name": "Noa",
        "role": "Assistant",
        "instructions": (
            "당신은 비즈니스 어시스턴트 에이전트입니다. 일정 관리, 회의록 정리, "
            "문서 관리 등 팀의 생산성을 높이는 업무를 수행합니다."
        ),
        "tools": ["Bash", "Read", "Write"],
        "not_allowed": [],
        "is_lead": False,
    },
]

DEFAULT_TEAM_NAME = "영업팀"


class Command(BaseCommand):
    help = "Create default agents and team for workspaces that have no agents"

    def handle(self, *args, **options):
        from agents.models import Workspace, Agent, AgentTeam

        admin = User.objects.filter(is_superuser=True).first()
        if not admin:
            admin = User.objects.first()
        if not admin:
            self.stderr.write("No users found. Create a user first.")
            return

        for ws in Workspace.objects.all():
            if Agent.objects.filter(workspace=ws).exists():
                self.stdout.write(f"  [{ws.name}] already has agents — skipping")
                continue

            self.stdout.write(f"  [{ws.name}] creating default agents...")
            created = []
            for spec in DEFAULT_AGENTS:
                agent, was_created = Agent.objects.get_or_create(
                    workspace=ws,
                    name=spec["name"],
                    defaults={
                        "role": spec["role"],
                        "instructions": spec["instructions"],
                        "tools": spec["tools"],
                        "not_allowed": spec["not_allowed"],
                        "created_by": admin,
                    },
                )
                if was_created:
                    self.stdout.write(f"    + {agent.name} ({agent.role})")
                else:
                    self.stdout.write(f"    = {agent.name} already exists")
                created.append({"agent": agent, "is_lead": spec["is_lead"]})

            # Create default team
            if not AgentTeam.objects.filter(workspace=ws, name=DEFAULT_TEAM_NAME).exists():
                AgentTeam.objects.create(
                    workspace=ws,
                    name=DEFAULT_TEAM_NAME,
                    members=[
                        {
                            "agent_id": c["agent"].id,
                            "order": i + 1,
                            "is_lead": c["is_lead"],
                        }
                        for i, c in enumerate(created)
                    ],
                )
                self.stdout.write(f"    + Team '{DEFAULT_TEAM_NAME}' created")
            else:
                self.stdout.write(f"    = Team '{DEFAULT_TEAM_NAME}' already exists")

        self.stdout.write(self.style.SUCCESS("Done."))
