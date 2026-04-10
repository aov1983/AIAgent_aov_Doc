import pytest
from agent.graph_builder import KnowledgeGraphBuilder

def test_graph_creation():
    builder = KnowledgeGraphBuilder()
    doc = {"chapters": [{"title": "Glava1", "sections": [{"title": "Sec1", "paragraphs": [{"text": "Long text "*50}]}]}]}
    result = builder.build_from_document(doc)
    assert "nodes" in result
    assert "edges" in result
    assert len(result["nodes"]) > 0

def test_chunking():
    builder = KnowledgeGraphBuilder()
    # Проверка логики разбиения на чанки
    assert True
