from __future__ import annotations

import aiosqlite

from .config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS used_questions (
    device_id TEXT NOT NULL,
    jenjang   TEXT NOT NULL,
    mapel     TEXT NOT NULL,
    question_id TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (device_id, jenjang, mapel, question_id)
);
CREATE INDEX IF NOT EXISTS idx_used_questions_lookup
    ON used_questions (device_id, jenjang, mapel);
"""


async def init_db() -> None:
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(settings.db_path) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def get_used_question_ids(device_id: str, jenjang: str, mapel: str) -> set[str]:
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        cursor = await db.execute(
            "SELECT question_id FROM used_questions WHERE device_id = ? AND jenjang = ? AND mapel = ?",
            (device_id, jenjang, mapel),
        )
        rows = await cursor.fetchall()
        return {row[0] for row in rows}


async def add_used_question_ids(device_id: str, jenjang: str, mapel: str, question_ids: list[str]) -> None:
    if not question_ids:
        return
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        await db.executemany(
            "INSERT OR IGNORE INTO used_questions (device_id, jenjang, mapel, question_id) VALUES (?, ?, ?, ?)",
            [(device_id, jenjang, mapel, qid) for qid in question_ids],
        )
        await db.commit()


async def clear_used_questions(device_id: str, jenjang: str, mapel: str) -> None:
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "DELETE FROM used_questions WHERE device_id = ? AND jenjang = ? AND mapel = ?",
            (device_id, jenjang, mapel),
        )
        await db.commit()


async def clear_all_history(device_id: str) -> None:
    settings = get_settings()
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("DELETE FROM used_questions WHERE device_id = ?", (device_id,))
        await db.commit()
