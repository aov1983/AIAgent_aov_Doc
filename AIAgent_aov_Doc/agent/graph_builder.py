import hashlib
from typing import List, Dict, Any
from dataclasses import dataclass, asdict

@dataclass
class GraphNode:
    id: str
    label: str
    type: str  # chapter, section, paragraph, chunk
    content: str
    metadata: Dict[str, Any]
    level: int = 0

@dataclass
class GraphEdge:
    source: str
    target: str
    type: str  # contains, similar_to, conflicts_with
    weight: float = 1.0

class KnowledgeGraphBuilder:
    def __init__(self):
        self.nodes: List[GraphNode] = []
        self.edges: List[GraphEdge] = []

    def _generate_id(self, text: str, prefix: str) -> str:
        return f"{prefix}_{hashlib.md5(text.encode()).hexdigest()[:8]}"

    def build_from_document(self, doc_structure: Dict[str, Any]):
        """Строит граф из структуры документа: Глава -> Раздел -> Абзац -> Чанк"""
        for chap in doc_structure.get('chapters', []):
            chap_id = self._generate_id(chap['title'], "chap")
            self.nodes.append(GraphNode(id=chap_id, label=chap['title'], type="chapter", content="", metadata={}, level=1))
            
            for sec in chap.get('sections', []):
                sec_id = self._generate_id(sec['title'], "sec")
                self.nodes.append(GraphNode(id=sec_id, label=sec['title'], type="section", content="", metadata={}, level=2))
                self.edges.append(GraphEdge(source=chap_id, target=sec_id, type="contains"))

                for par in sec.get('paragraphs', []):
                    par_id = self._generate_id(par['text'][:50], "par")
                    self.nodes.append(GraphNode(id=par_id, label=f"Абзац", type="paragraph", content=par['text'], metadata=par.get('atoms', {}), level=3))
                    self.edges.append(GraphEdge(source=sec_id, target=par_id, type="contains"))
                    
                    # Разбиение на чанки если текст длинный
                    if len(par['text']) > 300:
                        for i in range(0, len(par['text']), 300):
                            chunk_text = par['text'][i:i+300]
                            chk_id = self._generate_id(chunk_text, "chk")
                            self.nodes.append(GraphNode(id=chk_id, label=f"Чанк", type="chunk", content=chunk_text, metadata={}, level=4))
                            self.edges.append(GraphEdge(source=par_id, target=chk_id, type="contains"))
        return self.to_json()

    def add_rag_links(self, links: List[Dict]):
        """Добавляет связи похожести из RAG"""
        for link in links:
            self.edges.append(GraphEdge(source=link['src'], target=link['tgt'], type="similar_to", weight=link['score']))

    def to_json(self) -> Dict[str, Any]:
        return {"nodes": [asdict(n) for n in self.nodes], "edges": [asdict(e) for e in self.edges]}
