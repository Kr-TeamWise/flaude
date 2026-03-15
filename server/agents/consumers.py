import asyncio
import logging
import redis.asyncio as aioredis

try:
    from channels.generic.websocket import AsyncJsonWebSocketConsumer
except ImportError:
    from channels.generic.websocket import AsyncJsonWebsocketConsumer as AsyncJsonWebSocketConsumer

logger = logging.getLogger("flaude.ws")

# Async Redis with connection pool
_pool = aioredis.ConnectionPool.from_url(
    "redis://localhost:6379/0", decode_responses=True, max_connections=20
)
_redis = aioredis.Redis(connection_pool=_pool)
_REDIS_PREFIX = "flaude:ws:client:"
_HEARTBEAT_INTERVAL = 300  # 5 min — refresh Redis TTL


async def set_connected(user_id: str, channel_name: str):
    try:
        await _redis.set(f"{_REDIS_PREFIX}{user_id}", channel_name, ex=600)
    except Exception as e:
        logger.error("Redis set_connected failed: %s", e)


async def get_connected(user_id: str) -> str | None:
    try:
        return await _redis.get(f"{_REDIS_PREFIX}{user_id}")
    except Exception as e:
        logger.error("Redis get_connected failed: %s", e)
        return None


async def remove_connected(user_id: str):
    try:
        await _redis.delete(f"{_REDIS_PREFIX}{user_id}")
    except Exception as e:
        logger.error("Redis remove_connected failed: %s", e)


async def _validate_token(token: str) -> str | None:
    from asgiref.sync import sync_to_async
    from .models import AuthToken

    @sync_to_async
    def _lookup():
        try:
            auth = AuthToken.objects.select_related("user").get(token=token)
            return str(auth.user.id)
        except AuthToken.DoesNotExist:
            return None

    return await _lookup()


class AgentConsumer(AsyncJsonWebSocketConsumer):
    _heartbeat_task = None

    async def connect(self):
        qs = self.scope.get("query_string", b"").decode()
        params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)

        token = params.get("token", "").strip()
        if not token:
            headers = dict(self.scope.get("headers", []))
            auth_header = headers.get(b"authorization", b"").decode()
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]

        if not token:
            await self.close(code=4001)
            return

        user_id = await _validate_token(token)
        if not user_id:
            await self.close(code=4003)
            return

        self.user_id = user_id
        await set_connected(self.user_id, self.channel_name)

        await self.accept()
        await self.send_json({"type": "connected", "user_id": self.user_id})
        logger.info("Client connected: %s (channel: %s)", self.user_id, self.channel_name)

        # Start heartbeat to keep Redis entry alive
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Drain any queued offline tasks
        from .dispatch import drain_offline_queue
        await drain_offline_queue(self.user_id)

    async def _heartbeat_loop(self):
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL)
                if hasattr(self, "user_id"):
                    await set_connected(self.user_id, self.channel_name)
        except asyncio.CancelledError:
            pass

    async def disconnect(self, code):
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        uid = getattr(self, "user_id", None)
        if uid:
            await remove_connected(uid)
            logger.info("Client disconnected: %s", uid)

    async def receive_json(self, content):
        msg_type = content.get("type")
        if msg_type != "execution_result":
            return

        task_id = content.get("task_id")
        result = content.get("result")
        if not task_id:
            return

        from .dispatch import store_result
        await store_result(task_id, result or "")

    async def task_execute(self, event):
        await self.send_json(
            {
                "type": "execute",
                "task_id": event["task_id"],
                "sdk_config": event["sdk_config"],
            }
        )

    async def task_result(self, event):
        await self.send_json(
            {
                "type": "result",
                "task_id": event["task_id"],
                "result": event["result"],
            }
        )
