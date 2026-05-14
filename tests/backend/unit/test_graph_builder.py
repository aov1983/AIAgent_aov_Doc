import pytest
from agent.graph_builder import KnowledgeGraphBuilder

def test_build_graph():
    builder = KnowledgeGraphBuilder()
    doc = {"chapters": [{"title": "Глава 1", "sections": []}]}
    result = builder.build_from_document(doc)
    assert "nodes" in result
    assert len(result["nodes"]) > 0

def test_add_rag_links():
    builder = KnowledgeGraphBuilder()
    builder.add_rag_links([{"src": "1", "tgt": "2", "score": 0.9}])
    assert len(builder.edges) == 1
