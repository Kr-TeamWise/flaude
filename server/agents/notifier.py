"""
Notification dispatcher for Discord/Slack channels.

Posts updates when:
  - Client status changes
  - Agent completes work on a client
  - Scheduled task completes
  - Team workflow needs approval
"""

import logging
import os

import httpx

logger = logging.getLogger("flaude.notifier")

DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")


async def notify_channel(
    channel_id: str,
    message: str,
    platform: str | None = None,
):
    """Post a message to a Discord or Slack channel.
    If platform is None, auto-detect from channel_id format.
    """
    if not channel_id:
        return

    if platform is None:
        # Discord channel IDs are numeric, Slack are like C0123456789
        platform = "slack" if channel_id.startswith("C") else "discord"

    try:
        if platform == "discord":
            await _send_discord(channel_id, message)
        elif platform == "slack":
            await _send_slack(channel_id, message)
    except Exception as e:
        logger.error("Failed to notify %s channel %s: %s", platform, channel_id, e)


async def notify_client_update(
    client_company: str,
    old_status: str,
    new_status: str,
    agent_name: str,
    result_summary: str,
    notification_channel: str,
):
    """Notify when a client's status changes."""
    if not notification_channel:
        return

    msg = (
        f"📋 **고객 상태 변경**\n"
        f"기업: **{client_company}**\n"
        f"상태: {old_status} → **{new_status}**\n"
        f"담당: {agent_name}\n"
    )
    if result_summary:
        msg += f"\n> {result_summary[:300]}"

    await notify_channel(notification_channel, msg)


async def notify_approval_needed(
    team_name: str,
    agent_name: str,
    next_agent_name: str,
    result_preview: str,
    approval_id: int,
    notification_channel: str,
):
    """Notify when a team workflow needs human approval."""
    if not notification_channel:
        return

    msg = (
        f"⏸️ **승인 대기**\n"
        f"팀: **{team_name}**\n"
        f"{agent_name}의 작업 완료 → {next_agent_name} 실행 대기\n"
        f"승인 ID: `{approval_id}`\n\n"
        f"> {result_preview[:300]}\n\n"
        f"승인하려면: `/approve {approval_id}`\n"
        f"거절하려면: `/reject {approval_id}`"
    )
    await notify_channel(notification_channel, msg)


async def notify_schedule_result(
    schedule_name: str,
    agent_or_team_name: str,
    result: str,
    notification_channel: str,
):
    """Notify when a scheduled task completes."""
    if not notification_channel:
        return

    msg = (
        f"⏰ **스케줄 실행 완료**\n"
        f"작업: **{schedule_name}**\n"
        f"실행: {agent_or_team_name}\n\n"
        f"{result[:1500]}"
    )
    await notify_channel(notification_channel, msg)


# ── Platform-specific senders ────────────────────────────────


async def _send_discord(channel_id: str, message: str):
    """Send a message to a Discord channel via REST API."""
    if not DISCORD_BOT_TOKEN:
        logger.warning("DISCORD_BOT_TOKEN not set, skipping notification")
        return

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            headers={"Authorization": f"Bot {DISCORD_BOT_TOKEN}"},
            json={"content": message[:2000]},
        )
        if resp.status_code not in (200, 201):
            logger.error("Discord API error %d: %s", resp.status_code, resp.text[:200])


async def _send_slack(channel_id: str, message: str):
    """Send a message to a Slack channel via Web API."""
    if not SLACK_BOT_TOKEN:
        logger.warning("SLACK_BOT_TOKEN not set, skipping notification")
        return

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {SLACK_BOT_TOKEN}"},
            json={"channel": channel_id, "text": message[:3000]},
        )
        data = resp.json()
        if not data.get("ok"):
            logger.error("Slack API error: %s", data.get("error", "unknown"))
