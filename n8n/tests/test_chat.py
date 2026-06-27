"""
Тесты wf_api_chat → POST /chat/ask. Требуют embeddings_service + Ollama.

Покрывает шаг 9 из e2e.sh.
"""
from __future__ import annotations

import re

import pytest
import requests

from conftest import HTTP_TIMEOUT, UploadedDoc


@pytest.mark.requires_embeddings
@pytest.mark.requires_ollama
def test_chat_ask_grounds_answer_in_document(
    base_url: str,
    auth_headers: dict[str, str],
    uploaded_document: UploadedDoc,
) -> None:
    question = "Сколько дней должны храниться резервные копии и как часто их делать?"
    r = requests.post(
        f"{base_url}/webhook/chat/ask",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"message": question, "history": [], "document_id": uploaded_document.document_id},
        timeout=HTTP_TIMEOUT * 3,  # LLM медленнее остальных эндпоинтов
    )
    assert r.status_code == 200, r.text[:400]
    body = r.json()
    answer = body.get("answer") or ""
    sources = body.get("sources") or []

    assert answer and answer != "(пустой ответ)", f"пустой ответ: {body!r}"
    assert isinstance(sources, list)

    # Базовый ground-truth check: ответ должен зацепить хотя бы один факт
    # из исходного документа (90 дней / ежедневно).
    mentions_90 = bool(re.search(r"\b90\b|девяносто", answer))
    mentions_daily = bool(re.search(r"ежедневн|кажд", answer, re.IGNORECASE))
    assert mentions_90 or mentions_daily, (
        f"ответ LLM не упоминает ни '90 дней', ни 'ежедневно' — "
        f"вероятно, RAG-контекст не дошёл до промпта. "
        f"answer={answer[:300]!r}"
    )
