from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

ALLOWED_JUMLAH = (10, 20, 30)
ALLOWED_DURASI = (10, 20, 30)


class QuizStartRequest(BaseModel):
    jenjang: str = Field(..., min_length=1, max_length=20)
    mapel: str = Field(..., min_length=1, max_length=30)
    jumlah: int
    durasi: int

    @field_validator("jenjang", "mapel")
    @classmethod
    def _no_path_chars(cls, v: str) -> str:
        # Defense in depth: reject anything that isn't a bare identifier
        # before it's even checked against the on-disk whitelist.
        if not v.isascii() or not v.replace("_", "").isalnum():
            raise ValueError("invalid identifier")
        return v.lower()

    @field_validator("jumlah")
    @classmethod
    def _jumlah_allowed(cls, v: int) -> int:
        if v not in ALLOWED_JUMLAH:
            raise ValueError(f"jumlah must be one of {ALLOWED_JUMLAH}")
        return v

    @field_validator("durasi")
    @classmethod
    def _durasi_allowed(cls, v: int) -> int:
        if v not in ALLOWED_DURASI:
            raise ValueError(f"durasi must be one of {ALLOWED_DURASI}")
        return v


class QuizAnswerRequest(BaseModel):
    session_token: str = Field(..., min_length=10, max_length=200)
    question_index: int = Field(..., ge=0, lt=100)
    selected_index: Optional[int] = None
    selected_indices: Optional[list[int]] = None
    answers: Optional[dict[str, str]] = None


class QuizFinishRequest(BaseModel):
    session_token: str = Field(..., min_length=10, max_length=200)
