"""
Dispatch tasks to connected Tauri clients via WebSocket.

Flow:
  1. Bot receives message with platform_user_id
  2. dispatch_task() looks up channel via Redis
  3. Sends task via Redis channel layer
  4. Waits for result via Redis pub/sub (event-driven, no polling)
  5. Returns result to bot
"""
import uuid
import asyncio
import time
import logging
import redis.asyncio as aioredis
from channels.layers import get_channel_layer
from .consumers import get_connected

logger = logging.getLogger("flaude.dispatch")

# Async Redis with connection pool (shared with consumers)
_pool = aioredis.ConnectionPool.from_url(
    "redis://localhost:6379/0", decode_responses=True, max_connections=20
)
_redis = aioredis.Redis(connection_pool=_pool)
_RESULT_PREFIX = "flaude:task:result:"
_RESULT_CHANNEL = "flaude:task:done:"
_RESULT_TTL = 700

# Offline task queue (Redis-backed for persistence)
_OFFLINE_PREFIX = "flaude:offline:"
OFFLINE_TTL = 3600
MAX_QUEUE_PER_USER = 50


async def dispatch_task(
    user_id: str, agent_name: str, payload: str, timeout: int = 600,
) -> str | None:
    """
    Send a task to a user's connected Tauri app and wait for the result.
    payload is the SDK config JSON string.
    Uses Redis pub/sub for event-driven result retrieval (no polling).
    """
    channel_layer = get_channel_layer()
    if not channel_layer:
        return None

    channel_name = await get_connected(str(user_id))
    if not channel_name:
        await _queue_offline_task(user_id, agent_name, payload)
        return None

    task_id = str(uuid.uuid4())

    # Subscribe to result channel BEFORE sending task
    pubsub = _redis.pubsub()
    result_channel = f"{_RESULT_CHANNEL}{task_id}"
    await pubsub.subscribe(result_channel)

    try:
        # Send task to client via channel layer
        await channel_layer.send(
            channel_name,
            {
                "type": "task.execute",
                "task_id": task_id,
                "sdk_config": payload,
            },
        )
        logger.info("Task %s dispatched to user %s", task_id, user_id)

        # Wait for result via pub/sub (event-driven)
        deadline = time.time() + timeout
        async for message in pubsub.listen():
            if time.time() > deadline:
                break
            if message["type"] == "message":
                # Result notification received, fetch from Redis
                result_key = f"{_RESULT_PREFIX}{task_id}"
                val = await _redis.getdel(result_key)
                if val is not None:
                    logger.info("Task %s result received (%d chars)", task_id, len(val))
                    return val
                break

        logger.warning("Task %s timed out after %ds", task_id, timeout)
        return None
    finally:
        await pubsub.unsubscribe(result_channel)
        await pubsub.close()


async def store_result(task_id: str, result: str):
    """Called by consumer when client sends execution_result. Stores in Redis + notifies."""
    result_key = f"{_RESULT_PREFIX}{task_id}"
    result_channel = f"{_RESULT_CHANNEL}{task_id}"
    await _redis.set(result_key, result, ex=_RESULT_TTL)
    await _redis.publish(result_channel, "done")
    logger.info("Task %s result stored (%d chars)", task_id, len(result))


async def _queue_offline_task(user_id: str, agent_name: str, payload: str):
    """Queue task in Redis for when user reconnects."""
    import json
    task_id = str(uuid.uuid4())
    queue_key = f"{_OFFLINE_PREFIX}{user_id}"
    task_data = json.dumps({
        "task_id": task_id,
        "sdk_config": payload,
        "created_at": time.time(),
    })
    await _redis.rpush(queue_key, task_data)
    await _redis.ltrim(queue_key, -MAX_QUEUE_PER_USER, -1)
    await _redis.expire(queue_key, OFFLINE_TTL)
    logger.info("User %s offline. Task %s queued.", user_id, task_id)


async def drain_offline_queue(user_id: str):
    """Send queued tasks to a newly connected user."""
    import json
    queue_key = f"{_OFFLINE_PREFIX}{user_id}"
    channel_layer = get_channel_layer()
    channel_name = await get_connected(str(user_id))
    if not channel_layer or not channel_name:
        return

    sent = 0
    now = time.time()
    while True:
        raw = await _redis.lpop(queue_key)
        if not raw:
            break
        try:
            task = json.loads(raw)
        except json.JSONDecodeError:
            continue

        age = now - task.get("created_at", 0)
        if age > OFFLINE_TTL:
            logger.info("Task %s expired (%.0fs old)", task.get("task_id"), age)
            continue

        await channel_layer.send(
            channel_name,
            {
                "type": "task.execute",
                "task_id": task["task_id"],
                "sdk_config": task["sdk_config"],
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
