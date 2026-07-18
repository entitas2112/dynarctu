from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware

from .config import get_settings

# ---------------------------------------------------------------------------
# Signed anonymous device id (used only to key non-sensitive quiz-history
# rows — which questions a browser has already seen — never for privileged
# access). Signed with HMAC so a client can't pick an arbitrary device id
# and tamper with someone else's rotation history.
# ---------------------------------------------------------------------------

DEVICE_COOKIE_NAME = "dynarctu_device"


def _sign(value: str, secret: str) -> str:
    mac = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
    return f"{value}.{mac}"


def _verify(signed: str, secret: str) -> str | None:
    try:
        value, mac = signed.rsplit(".", 1)
    except ValueError:
        return None
    expected = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(mac, expected):
        return None
    return value


def get_or_create_device_id(request: Request, response: Response) -> str:
    settings = get_settings()
    raw = request.cookies.get(DEVICE_COOKIE_NAME)
    device_id = _verify(raw, settings.session_secret) if raw else None
    if not device_id:
        device_id = secrets.token_urlsafe(24)
        signed = _sign(device_id, settings.session_secret)
        response.set_cookie(
            key=DEVICE_COOKIE_NAME,
            value=signed,
            max_age=365 * 24 * 60 * 60,
            httponly=True,
            secure=settings.env != "development",
            samesite="lax",
            path="/",
        )
    return device_id


# ---------------------------------------------------------------------------
# Admin authentication (bearer token, constant-time compare).
# ---------------------------------------------------------------------------

def require_admin_token(request: Request) -> None:
    settings = get_settings()
    auth = request.headers.get("authorization", "")
    prefix = "Bearer "
    token = auth[len(prefix):] if auth.startswith(prefix) else ""
    if not token or not hmac.compare_digest(token, settings.admin_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


# ---------------------------------------------------------------------------
# Secure response headers.
# ---------------------------------------------------------------------------

class SecureHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=(), payment=()"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "frame-ancestors 'none'"
        )
        if settings.enable_hsts:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        if "server" in response.headers:
            del response.headers["server"]
        return response


# ---------------------------------------------------------------------------
# Lightweight in-process rate limiter (fixed window per client IP + bucket).
# Sufficient for the single-process "python server.py" deployment target;
# swap for a Redis-backed limiter if scaling out to multiple workers/hosts.
# ---------------------------------------------------------------------------

class RateLimiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, bucket: str, client_key: str, limit_per_min: int) -> None:
        now = time.monotonic()
        window_start = now - 60
        key = f"{bucket}:{client_key}"
        hits = self._hits[key]
        while hits and hits[0] < window_start:
            hits.popleft()
        if len(hits) >= limit_per_min:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="too many requests, please slow down",
            )
        hits.append(now)


rate_limiter = RateLimiter()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
