#!/usr/bin/env python3
"""
DYNARCTU — single-command launcher.

    python server.py

This script is the ONLY thing you need to run. On first launch it will:
  1. Install any missing Python dependencies automatically.
  2. Generate a `.env` file with a fresh admin token and session secret
     (never committed, never printed except once, to your terminal).
  3. Initialize the local SQLite database.
  4. Start the production ASGI server (Uvicorn) serving both the API and
     the web frontend from a single process/port.

No manual virtualenv setup, no manual config editing required for a
default local/single-host deployment. For production behind a reverse
proxy / real TLS certs, see README.md.
"""
from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIREMENTS_FILE = ROOT / "requirements.txt"
ENV_FILE = ROOT / ".env"

REQUIRED_MODULES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn[standard]",
    "pydantic": "pydantic",
    "aiosqlite": "aiosqlite",
    "dotenv": "python-dotenv",
    "multipart": "python-multipart",
}


def _pip_install(packages: list[str]) -> None:
    base_cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check"]
    try:
        subprocess.check_call(base_cmd + packages)
    except subprocess.CalledProcessError:
        # Externally-managed environments (PEP 668 / Debian, etc.) require
        # an explicit opt-in flag to pip-install outside a virtualenv.
        subprocess.check_call(base_cmd + ["--break-system-packages"] + packages)


def bootstrap_dependencies() -> None:
    missing = []
    for module_name, package_name in REQUIRED_MODULES.items():
        try:
            __import__(module_name)
        except ImportError:
            missing.append(package_name)
    if missing:
        print(f"[setup] Installing missing dependencies: {', '.join(missing)}")
        _pip_install(missing)


def ensure_env_file() -> None:
    if ENV_FILE.exists():
        return
    admin_token = secrets.token_urlsafe(32)
    session_secret = secrets.token_urlsafe(48)
    content = f"""# Auto-generated on first run by server.py.
# Keep this file secret. Do not commit it to version control.

ENV=production
HOST=0.0.0.0
PORT=8000

# Bearer token required for /api/admin/* endpoints.
ADMIN_TOKEN={admin_token}

# Used to sign the anonymous device-history cookie (HMAC key).
SESSION_SECRET={session_secret}

# Set to true only when served over HTTPS (e.g. behind a TLS-terminating
# reverse proxy), so browsers enforce HTTPS on future visits.
ENABLE_HSTS=false

# Comma-separated list of extra allowed origins for cross-origin API
# access. Leave empty for a same-origin single-host deployment (default
# and recommended): the browser will then block all cross-origin calls.
ALLOWED_ORIGINS=

# Optional: paths to a TLS certificate/key if you want Uvicorn itself to
# terminate TLS instead of a reverse proxy.
SSL_CERTFILE=
SSL_KEYFILE=

LOG_LEVEL=info
"""
    ENV_FILE.write_text(content, encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass  # best-effort on platforms without POSIX permissions
    print("[setup] Generated .env with a new admin token and session secret.")
    print(f"[setup] Admin token (needed for /api/admin/* — store it securely):\n         {admin_token}")


def main() -> None:
    bootstrap_dependencies()
    ensure_env_file()

    from dotenv import load_dotenv
    load_dotenv(ENV_FILE)

    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    ssl_certfile = os.environ.get("SSL_CERTFILE") or None
    ssl_keyfile = os.environ.get("SSL_KEYFILE") or None
    log_level = os.environ.get("LOG_LEVEL", "info")

    print(f"[dynarctu] Starting on http://{host}:{port} (Ctrl+C to stop)")
    uvicorn.run(
        "backend.main:app",
        host=host,
        port=port,
        reload=False,
        server_header=False,
        date_header=False,
        ssl_certfile=ssl_certfile,
        ssl_keyfile=ssl_keyfile,
        log_level=log_level,
    )


if __name__ == "__main__":
    main()
