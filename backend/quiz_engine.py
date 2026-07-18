"""
Server-authoritative quiz engine.

Everything that used to live in js/question-bank.js and js/quiz-view.js
(question selection, option shuffling, and answer grading) now lives here,
server-side. The browser only ever receives *stripped* question payloads
(no `Answer` field, no `IsCorrect` flags) — see `to_public_question()`.
Grading happens here, against the original record kept only in server
memory, so a client can never see or tamper with the correct answer.
"""
from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from . import qdf

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

_WS_RE = re.compile(r"\s+")


def _normalize_type(t: Optional[str]) -> str:
    if not t:
        return ""
    return _WS_RE.sub("", str(t)).lower()


def is_choice_type(t: Optional[str]) -> bool:
    n = _normalize_type(t)
    return n in ("pilihanganda", "multiplechoice")


def is_mcma_type(t: Optional[str]) -> bool:
    n = _normalize_type(t)
    return n in ("pilihangandakompleks", "mcma")


def is_true_false_type(t: Optional[str]) -> bool:
    n = _normalize_type(t)
    return n in ("benarsalah", "truefalse")


def resolve_correct_index(options: list[dict], answer: Optional[str]) -> int:
    for i, opt in enumerate(options):
        if opt.get("Text") == answer:
            return i
    if isinstance(answer, str) and re.fullmatch(r"[A-Za-z]", answer.strip() or ""):
        letter_index = ord(answer.strip().upper()) - ord("A")
        if 0 <= letter_index < len(options):
            return letter_index
    for i, opt in enumerate(options):
        if str(opt.get("IsCorrect", "")).lower() == "true":
            return i
    return -1


def _expected_tf(opt: dict) -> str:
    val = str(opt.get("IsCorrect", "")).strip().lower()
    return "Salah" if val in ("false", "salah") else "Benar"


# ---------------------------------------------------------------------------
# Question bank discovery & caching
# ---------------------------------------------------------------------------

class QuestionBankError(Exception):
    pass


@dataclass
class _CacheEntry:
    mtime: float
    records: list[dict]


_cache: dict[tuple[str, str], _CacheEntry] = {}


def discover_catalog() -> dict[str, list[str]]:
    """Scans data/<jenjang>/<mapel>.qdf on disk to build a whitelist.

    This whitelist (not raw client input) is what request validation is
    checked against, which is what prevents path traversal / arbitrary
    file reads via the jenjang/mapel parameters.
    """
    catalog: dict[str, list[str]] = {}
    if not DATA_DIR.exists():
        return catalog
    for jenjang_dir in sorted(p for p in DATA_DIR.iterdir() if p.is_dir()):
        mapels = sorted(p.stem for p in jenjang_dir.glob("*.qdf"))
        if mapels:
            catalog[jenjang_dir.name] = mapels
    return catalog


def _safe_path(jenjang: str, mapel: str) -> Path:
    """Resolves the on-disk path for a (jenjang, mapel) pair that has
    already been validated against discover_catalog(), with a defense-in-
    depth containment check so a resolved path can never escape DATA_DIR.
    """
    candidate = (DATA_DIR / jenjang / f"{mapel}.qdf").resolve()
    if DATA_DIR.resolve() not in candidate.parents:
        raise QuestionBankError("invalid data path")
    return candidate


def load_bank(jenjang: str, mapel: str) -> list[dict]:
    path = _safe_path(jenjang, mapel)
    if not path.is_file():
        raise QuestionBankError(f"question bank not found: {jenjang}/{mapel}")

    mtime = path.stat().st_mtime
    key = (jenjang, mapel)
    cached = _cache.get(key)
    if cached and cached.mtime == mtime:
        return cached.records

    text = path.read_text(encoding="utf-8")
    records = qdf.parse(text, on_error="skip")
    _cache[key] = _CacheEntry(mtime=mtime, records=records)
    return records


def clear_cache():
    _cache.clear()


# ---------------------------------------------------------------------------
# Question selection (ports question-bank.js buildQuizSet)
# ---------------------------------------------------------------------------

def _shuffle(items: list) -> list:
    result = list(items)
    random.shuffle(result)
    return result


def shuffle_question_options(question: dict) -> dict:
    options = question.get("Options")
    if not isinstance(options, list) or len(options) < 2:
        return question
    q = dict(question)
    if is_choice_type(q.get("Type")):
        correct_index = resolve_correct_index(options, q.get("Answer"))
        correct_option = options[correct_index] if correct_index >= 0 else None
        q["Options"] = _shuffle(options)
        if correct_option is not None:
            q["Answer"] = correct_option.get("Text", q.get("Answer"))
    else:
        q["Options"] = _shuffle(options)
    return q


def build_quiz_set(jenjang: str, mapel: str, jumlah: int, used_ids: set[str]):
    data = load_bank(jenjang, mapel)

    target_choice = math.floor(jumlah * 0.5 + 0.5)
    target_mcma = math.floor(jumlah * 0.3 + 0.5)
    target_tf = jumlah - target_choice - target_mcma

    all_choice = [r for r in data if is_choice_type(r.get("Type"))]
    all_mcma = [r for r in data if is_mcma_type(r.get("Type"))]
    all_tf = [r for r in data if is_true_false_type(r.get("Type"))]

    choice_pool = [r for r in all_choice if r.get("ID") not in used_ids]
    mcma_pool = [r for r in all_mcma if r.get("ID") not in used_ids]
    tf_pool = [r for r in all_tf if r.get("ID") not in used_ids]

    history_was_reset = False
    if len(choice_pool) < target_choice or len(mcma_pool) < target_mcma or len(tf_pool) < target_tf:
        history_was_reset = True
        choice_pool, mcma_pool, tf_pool = all_choice, all_mcma, all_tf

    picked = (
        _shuffle(choice_pool)[:target_choice]
        + _shuffle(mcma_pool)[:target_mcma]
        + _shuffle(tf_pool)[:target_tf]
    )
    questions = [shuffle_question_options(q) for q in _shuffle(picked)]

    new_ids = [q.get("ID") for q in questions if q.get("ID")]
    return questions, history_was_reset, new_ids


# ---------------------------------------------------------------------------
# Public (client-safe) question representation — answers stripped.
# ---------------------------------------------------------------------------

def to_public_question(question: dict, index: int) -> dict:
    options = question.get("Options") or []
    public_options = [{"text": opt.get("Text", "")} for opt in options]
    return {
        "index": index,
        "type": question.get("Type", ""),
        "question": question.get("Question", ""),
        "options": public_options,
    }


# ---------------------------------------------------------------------------
# Grading (ports quiz-view.js checkAnswer) — server authoritative.
# ---------------------------------------------------------------------------

def grade_choice(question: dict, selected_index: Any):
    options = question.get("Options") or []
    if not isinstance(selected_index, int) or not (0 <= selected_index < len(options)):
        raise ValueError("invalid selected_index")
    correct_index = resolve_correct_index(options, question.get("Answer"))
    is_correct = selected_index == correct_index
    return {
        "isCorrect": is_correct,
        "correctIndex": correct_index,
        "correctText": options[correct_index].get("Text") if correct_index >= 0 else question.get("Answer"),
        "explanation": question.get("Explanation", ""),
    }


def grade_mcma(question: dict, selected_indices: Any):
    options = question.get("Options") or []
    if not isinstance(selected_indices, list) or not all(isinstance(i, int) for i in selected_indices):
        raise ValueError("invalid selected_indices")
    selected_set = set(selected_indices)
    correct_indices = [i for i, opt in enumerate(options) if str(opt.get("IsCorrect", "")).lower() == "true"]
    correct_set = set(correct_indices)
    is_correct = selected_set == correct_set
    return {
        "isCorrect": is_correct,
        "correctIndices": correct_indices,
        "explanation": question.get("Explanation", ""),
    }


def grade_true_false(question: dict, answers: Any):
    options = question.get("Options") or []
    if not isinstance(answers, dict):
        raise ValueError("invalid answers")
    correct_answers = {}
    all_match = True
    for i, opt in enumerate(options):
        expected = _expected_tf(opt)
        correct_answers[str(i)] = expected
        given = answers.get(str(i))
        if given != expected:
            all_match = False
    return {
        "isCorrect": all_match,
        "correctAnswers": correct_answers,
        "explanation": question.get("Explanation", ""),
    }


def grade_answer(question: dict, payload: dict) -> dict:
    if is_choice_type(question.get("Type")):
        return grade_choice(question, payload.get("selected_index"))
    if is_mcma_type(question.get("Type")):
        return grade_mcma(question, payload.get("selected_indices"))
    if is_true_false_type(question.get("Type")):
        return grade_true_false(question, payload.get("answers"))
    raise ValueError("unknown question type")
