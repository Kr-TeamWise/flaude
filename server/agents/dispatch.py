"""
Dispatch tasks to connected Tauri clients via WebSocket.
Used by Discord/Slack bots to route agent execution to user's Mac.

Flow:
  1. Bot receives /ask command with platform_user_id
  2. dispatch_task() looks up Flaude user_id via UserPlatformLink
  3. Sends task to user's connected Tauri app via WebSocket
  4. Waits for result (with timeout) using asyncio.Event
  5. Returns result to bot for posting in chat

Offline handling:
  - If user's Mac is offline, task goes to pending queue (TTL: 1 hour)
  - When Mac reconnects, queued tasks are drained
  - Expired tasks return timeout message
"""
import uuid
import asyncio
import time
import logging
from channels.layers import get_channel_layer
from .consumers import connected_clients

logger = logging.getLogger("flaude.dispatch")

# Pending results: { task_id: { "event": asyncio.Event, "result": str | None } }
_pending_results: dict[str, dict] = {}

# Offline task queue: { user_id: [{ task_id, agent_name, prompt, created_at }] }
_offline_queue: dict[str, list[dict]] = {}

OFFLINE_TTL = 3600  # 1 hour
MAX_QUEUE_PER_USER = 50  # prevent unbounded memory growth


async def dispatch_task(
    user_id: str, agent_name: str, prompt: str, timeout: int = 600
) -> str | None:
    """
    Send a task to a user's connected Tauri app and wait for the result.
    Returns the result string, or None if timeout/offline.
    """
    channel_layer = get_channel_layer()
    if not channel_layer:
        return None

    channel_name = connected_clients.get(str(user_id))
    if not channel_name:
        # User offline — queue the task
        task_id = str(uuid.uuid4())
        uid = str(user_id)
        if uid not in _offline_queue:
            _offline_queue[uid] = []
        queue = _offline_queue[uid]
        if len(queue) >= MAX_QUEUE_PER_USER:
            logger.warning("Offline queue full for user %s, dropping oldest task", uid)
            queue.pop(0)
        queue.append({
            "task_id": task_id,
            "agent_name": agent_name,
            "prompt": prompt,
            "created_at": time.time(),
        })
        logger.info("User %s offline. Task %s queued.", user_id, task_id)
        return None

    task_id = str(uuid.uuid4())

    # Create event for waiting
    event = asyncio.Event()
    _pending_results[task_id] = {"event": event, "result": None}

    # Send task to client
    await channel_layer.send(
        channel_name,
        {
            "type": "task.execute",
            "task_id": task_id,
            "agent_name": agent_name,
            "prompt": prompt,
        },
    )

    logger.info("Task %s dispatched to user %s", task_id, user_id)

    # Wait for result with timeout
    try:
        await asyncio.wait_for(event.wait(), timeout=timeout)
        result = _pending_results[task_id]["result"]
    except asyncio.TimeoutError:
        logger.warning("Task %s timed out after %ds", task_id, timeout)
        result = None
    finally:
        _pending_results.pop(task_id, None)

    return result


def store_result(task_id: str, result: str):
    """Called by consumer when client sends execution_result."""
    pending = _pending_results.get(task_id)
    if pending:
        pending["result"] = result
        pending["event"].set()
        logger.info("Task %s result received (%d chars)", task_id, len(result))
    else:
        logger.warning("Result for unknown task %s", task_id)


async def drain_offline_queue(user_id: str):
    """Send queued tasks to a newly connected user. Called on WebSocket connect."""
    tasks = _offline_queue.pop(str(user_id), [])
    if not tasks:
        return

    channel_layer = get_channel_layer()
    channel_name = connected_clients.get(str(user_id))
    if not channel_layer or not channel_name:
        return

    now = time.time()
    sent = 0
    for task in tasks:
        age = now - task["created_at"]
        if age > OFFLINE_TTL:
            logger.info("Task %s expired (%.0fs old)", task["task_id"], age)
            continue

        await channel_layer.send(
            channel_name,
            {
                "type": "task.execute",
                "task_id": task["task_id"],
                "agent_name": task["agent_name"],
                "prompt": task["prompt"],
            },
        )
        sent += 1

    if sent:
        logger.info("Drained %d queued tasks for user %s", sent, user_id)


async def resolve_platform_user(platform: str, platform_user_id: str) -> int | None:
    """Look up Flaude user_id from platform (discord/slack) user ID."""
    from asgiref.sync import sync_to_async
    from .models import UserPlatformLink

    @sync_to_async
    def _lookup():
        try:
            link = UserPlatformLink.objects.select_related("user").get(
                platform=platform, platform_user_id=str(platform_user_id)
            )
            return link.user_id
        except UserPlatformLink.DoesNotExist:
            return None

    return await _lookup()
