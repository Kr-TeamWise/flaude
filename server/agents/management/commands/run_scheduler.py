"""
APScheduler-based task scheduler for Flaude.

Loads AgentSchedule entries and executes them on cron.
Results are posted to configured notification channels.

Usage: python manage.py run_scheduler
"""

import asyncio
import logging

from django.core.management.base import BaseCommand
from django.utils import timezone

logger = logging.getLogger("flaude.scheduler")


class Command(BaseCommand):
    help = "Run the Flaude task scheduler (APScheduler)"

    def handle(self, *args, **options):
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            from apscheduler.triggers.cron import CronTrigger
        except ImportError:
            self.stderr.write(
                "apscheduler is required. Install with: pip install apscheduler>=3.10"
            )
            return

        scheduler = AsyncIOScheduler()

        async def main():
            await _load_schedules(scheduler, CronTrigger)
            scheduler.start()
            logger.info("Scheduler started. Loaded jobs: %d", len(scheduler.get_jobs()))

            # Reload schedules every 60 seconds to pick up changes
            while True:
                await asyncio.sleep(60)
                await _load_schedules(scheduler, CronTrigger)

        self.stdout.write("Starting Flaude scheduler...")
        asyncio.run(main())


async def _load_schedules(scheduler, CronTrigger):
    """Load all active schedules from DB and register as APScheduler jobs."""
    from asgiref.sync import sync_to_async
    from agents.models import AgentSchedule

    @sync_to_async
    def get_active_schedules():
        return list(
            AgentSchedule.objects.filter(is_active=True)
            .select_related("agent", "team", "client")
        )

    schedules = await get_active_schedules()
    existing_ids = {j.id for j in scheduler.get_jobs()}
    active_ids = set()

    for sched in schedules:
        job_id = f"schedule_{sched.id}"
        active_ids.add(job_id)

        if job_id not in existing_ids:
            try:
                trigger = CronTrigger.from_crontab(sched.cron_expression)
                scheduler.add_job(
                    _execute_schedule,
                    trigger,
                    id=job_id,
                    args=[sched.id],
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                logger.info("Registered schedule: %s (%s)", sched.name, sched.cron_expression)
            except Exception as e:
                logger.error("Failed to register schedule %s: %s", sched.name, e)

    # Remove jobs for deleted/disabled schedules
    for job_id in existing_ids - active_ids:
        if job_id.startswith("schedule_"):
            scheduler.remove_job(job_id)


async def _execute_schedule(schedule_id: int):
    """Execute a single scheduled task."""
    from asgiref.sync import sync_to_async
    from agents.models import AgentSchedule
    from agents.orchestrator import (
        execute_agent, run_team, get_team_agents_with_meta,
    )
    from agents.notifier import notify_schedule_result

    @sync_to_async
    def load_schedule(sid):
        return AgentSchedule.objects.select_related(
            "agent", "team", "client", "agent__workspace", "team__workspace",
        ).get(id=sid)

    @sync_to_async
    def get_workspace_owner_id(workspace):
        return workspace.created_by_id

    @sync_to_async
    def update_last_run(sched):
        sched.last_run_at = timezone.now()
        sched.save(update_fields=["last_run_at"])

    try:
        sched = await load_schedule(schedule_id)
    except Exception:
        logger.error("Schedule %d not found", schedule_id)
        return

    # Resolve workspace owner as the user for dispatch
    workspace = sched.agent.workspace if sched.agent else (sched.team.workspace if sched.team else None)
    if not workspace:
        logger.warning("Schedule %d has no workspace", schedule_id)
        return
    user_id = await get_workspace_owner_id(workspace)

    logger.info("Executing schedule: %s", sched.name)

    try:
        if sched.agent:
            result, _ = await execute_agent(
                sched.agent, sched.prompt, user_id,
                platform="scheduler",
                client=sched.client,
            )
            target_name = sched.agent.name
        elif sched.team:
            agents_with_meta = await get_team_agents_with_meta(sched.team)
            team_result = await run_team(
                sched.team, agents_with_meta, sched.prompt,
                user_id=user_id,
                platform="scheduler", client=sched.client,
            )
            # Combine results
            parts = [r.result for r in team_result.results if not r.skipped]
            if team_result.synthesis:
                parts.append(f"[종합] {team_result.synthesis.result}")
            result = "\n\n".join(parts)
            target_name = sched.team.name
        else:
            logger.warning("Schedule %d has no agent or team", schedule_id)
            return

        await update_last_run(sched)

        # Notify
        if sched.notification_channel:
            await notify_schedule_result(
                schedule_name=sched.name,
                agent_or_team_name=target_name,
                result=result,
                notification_channel=sched.notification_channel,
            )

        logger.info("Schedule %s completed successfully", sched.name)

    except Exception as e:
        logger.error("Schedule %s failed: %s", sched.name, e)
        if sched.notification_channel:
            await notify_schedule_result(
                schedule_name=sched.name,
                agent_or_team_name=sched.agent.name if sched.agent else sched.team.name,
                result=f"Error: {e}",
                notification_channel=sched.notification_channel,
            )
