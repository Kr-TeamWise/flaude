import os
import logging

import requests
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt

from .api import _pending_oauth, _create_or_get_user_token

logger = logging.getLogger("flaude.auth")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
SERVER_BASE_URL = os.environ.get("SERVER_BASE_URL", "http://localhost:8888")


@csrf_exempt
def google_callback(request):
    """Handle Google OAuth2 callback — exchanges code for token, creates user."""
    code = request.GET.get("code")
    state = request.GET.get("state")
    error = request.GET.get("error")

    if error or not code or not state:
        return HttpResponse(_error_html(error or "Missing code"), content_type="text/html")

    if state not in _pending_oauth:
        return HttpResponse(_error_html("Invalid state"), content_type="text/html")

    # Exchange code for tokens
    try:
        token_resp = requests.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": f"{SERVER_BASE_URL}/auth/callback",
            "grant_type": "authorization_code",
        })
        token_data = token_resp.json()

        if "error" in token_data:
            return HttpResponse(_error_html(token_data["error_description"]), content_type="text/html")

        # Get user info
        userinfo_resp = requests.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={
            "Authorization": f"Bearer {token_data['access_token']}",
        })
        userinfo = userinfo_resp.json()

        email = userinfo["email"]
        name = userinfo.get("name", email.split("@")[0])

        # Create user + app token
        result = _create_or_get_user_token(email, name)

        # Store result for polling (update existing entry)
        _pending_oauth[state]["data"] = result

        return HttpResponse(_success_html(name), content_type="text/html")

    except Exception as e:
        logger.exception("Google OAuth callback failed")
        return HttpResponse(_error_html(str(e)), content_type="text/html")


def _success_html(name: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flaude</title>
<style>
body {{ font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #FAF9F6; color: #1A1A1A; }}
.card {{ text-align: center; padding: 40px; }}
h1 {{ color: #D97706; font-size: 24px; margin-bottom: 8px; }}
p {{ color: #6B7280; font-size: 14px; }}
</style></head>
<body><div class="card">
<h1>Flaude</h1>
<p>{name}님, 환영합니다!</p>
<p style="margin-top: 16px;">이 탭을 닫고 앱으로 돌아가세요.</p>
<p>Welcome, {name}! You can close this tab and return to the app.</p>
</div></body></html>"""


def _error_html(error: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flaude - Error</title>
<style>
body {{ font-family: -apple-system, system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #FAF9F6; }}
.card {{ text-align: center; padding: 40px; }}
h1 {{ color: #D97706; }}
p {{ color: #EF4444; font-size: 14px; }}
</style></head>
<body><div class="card">
<h1>Flaude</h1>
<p>Login failed: {error}</p>
</div></body></html>"""
