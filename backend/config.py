from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


def _bool_env(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _list_env(name: str) -> list[str]:
    val = os.environ.get(name, "")
    return [v.strip() for v in val.split(",") if v.strip()]


class Settings:
    def __init__(self):
        self.env = os.environ.get("ENV", "production")
        self.host = os.environ.get("HOST", "0.0.0.0")
        self.port = int(os.environ.get("PORT", "8000"))

        self.admin_token = os.environ.get("ADMIN_TOKEN", "")
        self.session_secret = os.environ.get("SESSION_SECRET", "")

        self.enable_hsts = _bool_env("ENABLE_HSTS", False)
        self.allowed_origins = _list_env("ALLOWED_ORIGINS")

        self.rate_limit_default = int(os.environ.get("RATE_LIMIT_DEFAULT_PER_MIN", "120"))
        self.rate_limit_quiz_start = int(os.environ.get("RATE_LIMIT_QUIZ_START_PER_MIN", "12"))
        self.rate_limit_admin = int(os.environ.get("RATE_LIMIT_ADMIN_PER_MIN", "30"))

        self.quiz_session_ttl_seconds = int(os.environ.get("QUIZ_SESSION_TTL_SECONDS", str(2 * 60 * 60)))

        self.db_path = ROOT_DIR / "var" / "dynarctu.sqlite3"
        self.log_level = os.environ.get("LOG_LEVEL", "info")

        if not self.admin_token or not self.session_secret:
            raise RuntimeError(
                "ADMIN_TOKEN and SESSION_SECRET must be set in .env — "
                "run `python server.py` (not the ASGI app directly) so they "
                "can be generated automatically on first launch."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
