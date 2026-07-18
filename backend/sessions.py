from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from .config import get_settings


@dataclass
class QuizSession:
    session_token: str
    device_id: str
    jenjang: str
    mapel: str
    questions: list[dict]          # full records, WITH answers — never sent to client as-is
    answered: dict[int, bool]      # index -> isCorrect
    created_at: float
    expires_at: float
    duration_seconds: int
    finished: bool = False


class SessionStore:
    def __init__(self):
        self._sessions: dict[str, QuizSession] = {}
        self._lock = asyncio.Lock()

    async def create(self, device_id: str, jenjang: str, mapel: str, questions: list[dict], duration_seconds: int) -> QuizSession:
        settings = get_settings()
        now = time.monotonic()
        session = QuizSession(
            session_token=secrets.token_urlsafe(32),
            device_id=device_id,
            jenjang=jenjang,
            mapel=mapel,
            questions=questions,
            answered={},
            created_at=now,
            expires_at=now + settings.quiz_session_ttl_seconds,
            duration_seconds=duration_seconds,
        )
        async with self._lock:
            await self._sweep_locked()
            self._sessions[session.session_token] = session
        return session

    async def get(self, session_token: str) -> Optional[QuizSession]:
        async with self._lock:
            session = self._sessions.get(session_token)
            if session is None:
                return None
            if time.monotonic() > session.expires_at:
                self._sessions.pop(session_token, None)
                return None
            return session

    async def drop(self, session_token: str) -> None:
        async with self._lock:
            self._sessions.pop(session_token, None)

    async def _sweep_locked(self) -> None:
        now = time.monotonic()
        expired = [tok for tok, s in self._sessions.items() if now > s.expires_at]
        for tok in expired:
            self._sessions.pop(tok, None)


store = SessionStore()
