import asyncio
import logging
try:
    from channels.generic.websocket import AsyncJsonWebSocketConsumer
except ImportError:
    from channels.generic.websocket import AsyncJsonWebsocketConsumer as AsyncJsonWebSocketConsumer

logger = logging.getLogger("flaude.ws")

# Track connected clients: { user_id: channel_name }
_clients_lock = asyncio.Lock()
connected_clients: dict[str, str] = {}


async def _validate_token(token: str) -> str | None:
    """Validate auth token and return user_id, or None if invalid."""
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
    async def connect(self):
        qs = self.scope.get("query_string", b"").decode()
        params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)

        # Authenticate via token (required)
        token = params.get("token", "").strip()
        if not token:
            # Fallback: check Authorization header
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

        async with _clients_lock:
            connected_clients[self.user_id] = self.channel_name

        await self.accept()
        await self.send_json({"type": "connected", "user_id": self.user_id})
        logger.info("Client connected: %s", self.user_id)

        # Drain any queued offline tasks
        from .dispatch import drain_offline_queue
        await drain_offline_queue(self.user_id)

    async def disconnect(self, code):
        uid = getattr(self, "user_id", None)
        if uid:
            async with _clients_lock:
                connected_clients.pop(uid, None)
            logger.info("Client disconnected: %s", uid)

    async def receive_json(self, content):
        msg_type = content.get("type")
        if msg_type != "execution_result":
            return

        task_id = content.get("task_id")
        result = content.get("result")
        if not task_id:
            return

        # Store result to wake up the waiting dispatch_task()
        from .dispatch import store_result
        store_result(task_id, result or "")

    async def task_execute(self, event):
        """Server pushes a task to the client for execution"""
        await self.send_json(
            {
                "type": "execute",
                "task_id": event["task_id"],
                "agent_name": event["agent_name"],
                "prompt": event["prompt"],
            }
        )

    async def task_result(self, event):
        """Relay task result"""
        await self.send_json(
            {
                "type": "result",
                "task_id": event["task_id"],
                "result": event["result"],
            }
        )
