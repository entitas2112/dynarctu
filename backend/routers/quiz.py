from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status

from .. import db, quiz_engine
from ..schemas import QuizAnswerRequest, QuizFinishRequest, QuizStartRequest
from ..security import client_ip, get_or_create_device_id, rate_limiter
from ..sessions import store
from ..config import get_settings

router = APIRouter(prefix="/api/quiz", tags=["quiz"])


def _catalog_or_404(jenjang: str, mapel: str) -> None:
    catalog = quiz_engine.discover_catalog()
    if jenjang not in catalog or mapel not in catalog[jenjang]:
        # Generic message: don't reveal which part (jenjang vs mapel) was wrong.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="question bank not available")


@router.get("/catalog")
async def get_catalog():
    """Whitelist of valid jenjang/mapel combinations, derived from disk."""
    return quiz_engine.discover_catalog()


@router.post("/start")
async def start_quiz(payload: QuizStartRequest, request: Request, response: Response):
    settings = get_settings()
    rate_limiter.check("quiz_start", client_ip(request), settings.rate_limit_quiz_start)

    _catalog_or_404(payload.jenjang, payload.mapel)
    device_id = get_or_create_device_id(request, response)

    used_ids = await db.get_used_question_ids(device_id, payload.jenjang, payload.mapel)

    try:
        questions, history_was_reset, new_ids = quiz_engine.build_quiz_set(
            payload.jenjang, payload.mapel, payload.jumlah, used_ids
        )
    except quiz_engine.QuestionBankError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="question bank not available")

    if history_was_reset:
        await db.clear_used_questions(device_id, payload.jenjang, payload.mapel)

    if not questions:
        return {
            "questions": [],
            "sessionToken": None,
            "historyWasReset": history_was_reset,
        }

    await db.add_used_question_ids(device_id, payload.jenjang, payload.mapel, new_ids)

    session = await store.create(
        device_id=device_id,
        jenjang=payload.jenjang,
        mapel=payload.mapel,
        questions=questions,
        duration_seconds=payload.durasi * 60,
    )

    public_questions = [quiz_engine.to_public_question(q, i) for i, q in enumerate(questions)]
    return {
        "sessionToken": session.session_token,
        "durationSeconds": session.duration_seconds,
        "historyWasReset": history_was_reset,
        "questions": public_questions,
    }


@router.post("/answer")
async def answer_question(payload: QuizAnswerRequest, request: Request, response: Response):
    settings = get_settings()
    rate_limiter.check("quiz_answer", client_ip(request), settings.rate_limit_default)

    device_id = get_or_create_device_id(request, response)
    session = await store.get(payload.session_token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found or expired")
    if session.finished:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="quiz already finished")
    if payload.question_index in session.answered:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="question already answered")
    if payload.question_index >= len(session.questions):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid question index")

    question = session.questions[payload.question_index]
    try:
        result = quiz_engine.grade_answer(question, payload.model_dump())
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid answer payload")

    session.answered[payload.question_index] = result["isCorrect"]
    return result


@router.post("/finish")
async def finish_quiz(payload: QuizFinishRequest, request: Request, response: Response):
    settings = get_settings()
    rate_limiter.check("quiz_finish", client_ip(request), settings.rate_limit_default)
    device_id = get_or_create_device_id(request, response)
    session = await store.get(payload.session_token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found or expired")

    total = len(session.questions)
    correct = sum(1 for v in session.answered.values() if v)
    score = round((correct / total) * 100) if total else 0

    session.finished = True
    await store.drop(payload.session_token)

    return {"correctCount": correct, "total": total, "score": score}


@router.delete("/history")
async def reset_history(request: Request, response: Response):
    settings = get_settings()
    rate_limiter.check("reset_history", client_ip(request), settings.rate_limit_default)
    device_id = get_or_create_device_id(request, response)
    await db.clear_all_history(device_id)
    return {"ok": True}
