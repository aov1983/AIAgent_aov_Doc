"""
Статические тесты структуры wf_api_documents.json.

Не требуют живого n8n: проверяют, что патч из _patch_requirements.py создал
все нужные узлы и связи для второго LLM-вызова и эндпоинтов /requirements.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest


WF_PATH = Path(__file__).resolve().parents[1] / "workflows" / "wf_api_documents.json"


@pytest.fixture(scope="module")
def wf() -> dict:
    assert WF_PATH.exists(), f"не нашёл workflow по пути {WF_PATH}"
    return json.loads(WF_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def nodes_by_name(wf: dict) -> dict[str, dict]:
    return {n["name"]: n for n in wf["nodes"]}


def test_llm_requirements_node_exists(nodes_by_name: dict[str, dict]) -> None:
    node = nodes_by_name.get("[upload] LLM Requirements")
    assert node is not None, "нет узла [upload] LLM Requirements"
    assert node["type"] == "@n8n/n8n-nodes-langchain.chainLlm"
    text = node["parameters"]["text"]
    # В промпте должны быть оба типа
    for kw in ("ФТ", "НФТ", "extracted_requirements"):
        assert kw in text, f"в промпте LLM Requirements нет {kw!r}"


def test_llm_chain_wired_after_decompose(wf: dict) -> None:
    conn = wf["connections"]
    decompose_targets = [
        t["node"]
        for group in conn["[upload] LLM Decompose."]["main"]
        for t in group
    ]
    assert decompose_targets == ["[upload] LLM Requirements"], (
        f"LLM Decompose должен идти в LLM Requirements, а идёт в {decompose_targets}"
    )
    req_targets = [
        t["node"]
        for group in conn["[upload] LLM Requirements"]["main"]
        for t in group
    ]
    assert req_targets == ["[upload] Build Everything"], (
        f"LLM Requirements должен идти в Build Everything, а идёт в {req_targets}"
    )


def test_ollama_model_feeds_both_llm_nodes(wf: dict) -> None:
    targets = [
        t["node"]
        for group in wf["connections"]["[upload] Ollama Model"]["ai_languageModel"]
        for t in group
    ]
    assert "[upload] LLM Decompose." in targets
    assert "[upload] LLM Requirements" in targets


def test_build_everything_parses_second_llm(nodes_by_name: dict[str, dict]) -> None:
    js = nodes_by_name["[upload] Build Everything"]["parameters"]["jsCode"]
    # Парсинг и проброс в payload
    assert "[upload] LLM Requirements" in js, (
        "Build Everything не читает выход второго LLM"
    )
    assert "extracted_requirements: extractedReqs" in js, (
        "extracted_requirements не прокидывается в payload"
    )


@pytest.mark.parametrize(
    "prefix,path,query_key",
    [
        ("reqs", "requirements", "job_id"),
        ("reqsByDoc", "requirements/by-document", "document_id"),
    ],
)
def test_requirements_endpoint_nodes(
    nodes_by_name: dict[str, dict], wf: dict, prefix: str, path: str, query_key: str
) -> None:
    for suffix in ("Webhook: GET /" + path, "Auth", "If Auth OK", "Fetch Job", "Build Response", "Respond"):
        name = f"[{prefix}] {suffix}"
        assert name in nodes_by_name, f"нет узла {name}"

    webhook = nodes_by_name[f"[{prefix}] Webhook: GET /{path}"]
    assert webhook["parameters"]["path"] == path
    assert webhook["parameters"]["responseMode"] == "responseNode"

    fetch = nodes_by_name[f"[{prefix}] Fetch Job"]
    assert fetch["parameters"]["dataTableId"]["value"] == "jobs", (
        f"{prefix} должен читать из jobs, а читает из {fetch['parameters']['dataTableId']['value']!r}"
    )
    cond = fetch["parameters"]["filters"]["conditions"][0]
    assert cond["keyName"] == query_key
    assert query_key in cond["keyValue"]

    build_js = nodes_by_name[f"[{prefix}] Build Response"]["parameters"]["jsCode"]
    assert "extracted_requirements" in build_js, (
        f"[{prefix}] Build Response не отдаёт extracted_requirements"
    )

    # If Auth OK → fetch (true) и → respond (false)
    if_targets = wf["connections"][f"[{prefix}] If Auth OK"]["main"]
    assert if_targets[0][0]["node"] == f"[{prefix}] Fetch Job"
    assert if_targets[1][0]["node"] == f"[{prefix}] Respond"


def test_no_dangling_connections(wf: dict) -> None:
    """Каждая связь должна указывать на существующий узел."""
    names = {n["name"] for n in wf["nodes"]}
    bad: list[str] = []
    for src, groups in wf["connections"].items():
        if src not in names:
            bad.append(f"source {src!r} не существует")
        for kind, lanes in groups.items():
            for lane in lanes:
                for t in lane:
                    if t["node"] not in names:
                        bad.append(f"{src} -[{kind}]-> {t['node']!r} (не существует)")
    assert not bad, "битые связи:\n  " + "\n  ".join(bad)
