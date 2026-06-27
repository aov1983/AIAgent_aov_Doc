"""
Тесты docling-serve напрямую (минуя n8n) — проверяем, что сервис умеет
конвертить .docx в Markdown, и в выходе видны ключевые разделы документа.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from conftest import docling_convert_to_markdown


@pytest.mark.requires_docling
def test_docling_converts_paygate_docx(example_docx_paths: list[Path]) -> None:
    src = next(p for p in example_docx_paths if p.name == "PayGate.docx")
    md = docling_convert_to_markdown(src)

    assert "PayGate" in md, f"в выходе нет 'PayGate': {md[:300]!r}"
    # Должны быть распознаны заголовки разделов ТЗ.
    assert "Функциональные требования" in md, "не распознан раздел 'Функциональные требования'"
    assert "Нефункциональные требования" in md, "не распознан раздел 'Нефункциональные требования'"


@pytest.mark.requires_docling
def test_docling_converts_cashhub_docx_with_paygate_reference(example_docx_paths: list[Path]) -> None:
    src = next(p for p in example_docx_paths if p.name == "CashHub.docx")
    md = docling_convert_to_markdown(src)

    assert "CashHub" in md, "не распознан заголовок CashHub"
    # CashHub.docx явно ссылается на PayGate v2 — это ключевая связь для cross-document теста.
    assert "PayGate" in md, (
        f"в CashHub.docx есть упоминание PayGate v2, но Docling его не сохранил: "
        f"{md[:500]!r}"
    )
