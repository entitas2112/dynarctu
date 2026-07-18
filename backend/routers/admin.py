from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .. import quiz_engine
from ..config import get_settings
from ..security import client_ip, rate_limiter, require_admin_token

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_token)])


def _limited(request: Request):
    settings = get_settings()
    rate_limiter.check("admin", client_ip(request), settings.rate_limit_admin)


@router.get("/catalog", dependencies=[Depends(_limited)])
async def admin_catalog():
    """Question bank inventory (counts only — never returns question content
    or answers, so a leaked admin token still can't be used to scrape the
    bank; use the authoring files on disk for that)."""
    catalog = quiz_engine.discover_catalog()
    inventory = {}
    for jenjang, mapels in catalog.items():
        inventory[jenjang] = {}
        for mapel in mapels:
            try:
                records = quiz_engine.load_bank(jenjang, mapel)
            except quiz_engine.QuestionBankError:
                records = []
            inventory[jenjang][mapel] = len(records)
    return inventory


@router.post("/cache/reload", dependencies=[Depends(_limited)])
async def reload_cache():
    """Clears the in-memory parsed-question-bank cache so edited .qdf files
    on disk are picked up without restarting the process."""
    quiz_engine.clear_cache()
    return {"ok": True}
