from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .config import get_settings
from .routers import admin, quiz
from .security import SecureHeadersMiddleware

logger = logging.getLogger("dynarctu")

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT_DIR / "web"

settings = get_settings()

logging.basicConfig(level=settings.log_level.upper())

app = FastAPI(
    title="DYNARCTU API",
    docs_url=None if settings.env == "production" else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.env == "production" else "/api/openapi.json",
)


@app.on_event("startup")
async def _startup():
    await db.init_db()
    logger.info("DYNARCTU started (env=%s)", settings.env)


# --- Middleware --------------------------------------------------------
app.add_middleware(SecureHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=512)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
# If ALLOWED_ORIGINS is unset (the default), no CORS middleware is added at
# all: the browser same-origin policy then blocks all cross-origin access
# to the API, which is the correct default for an app that ships its own
# frontend from the same origin.


# --- Sanitized error handling -------------------------------------------
# Never leak stack traces, internal paths, or exception details to the
# client. Full detail still goes to the server-side log.

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "internal server error"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": "invalid request"},
    )


# --- Routers -------------------------------------------------------------
app.include_router(quiz.router)
app.include_router(admin.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# --- Static frontend (mounted last; never serves /data, which lives
#     outside WEB_DIR specifically so answer keys can't be fetched raw).
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
