import hashlib
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict, field

@dataclass
class GraphNode:
    id: str
    label: str
    type: str  # chapter, section, paragraph, chunk
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    level: int = 0

@dataclass
class GraphEdge:
    source: str
    target: str
    type: str  # contains, similar_to, conflicts_with
    weight: float = 1.0

class KnowledgeGraphBuilder:
    """Построитель графа знаний для декомпозированных документов"""
    
    def __init__(self):
        self.nodes: List[GraphNode] = []
        self.edges: List[GraphEdge] = []
        self.node_map: Dict[str, GraphNode] = {}

    def _generate_id(self, text: str, prefix: str) -> str:
        """Генерирует уникальный ID на основе текста"""
        hash_part = hashlib.md5(text.encode('utf-8')).hexdigest()[:8]
        return f"{prefix}_{hash_part}"

    def build_from_document(self, document_structure: Dict[str, Any]) -> Dict[str, Any]:
        """
        Строит граф из структуры документа.
        Иерархия: Глава -> Раздел -> Абзац -> Чанк
        """
        chapters = document_structure.get('chapters', [])
        
        for chap_idx, chapter in enumerate(chapters):
            chap_title = chapter.get('title', f'Глава {chap_idx+1}')
            chap_id = self._generate_id(chap_title, "chap")
            
            # Добавляем узел Главы
            chap_node = GraphNode(
                id=chap_id, 
                label=chap_title, 
                type="chapter",
                content=chapter.get('content', ''),
                metadata={"index": chap_idx},
                level=1
            )
            self.nodes.append(chap_node)
            self.node_map[chap_id] = chap_node
            
            # Обрабатываем разделы
            for sec_idx, section in enumerate(chapter.get('sections', [])):
                sec_title = section.get('title', f'Раздел {sec_idx+1}')
                sec_id = self._generate_id(sec_title, "sec")
                
                sec_node = GraphNode(
                    id=sec_id,
                    label=sec_title,
                    type="section",
                    content=section.get('content', ''),
                    metadata={"index": sec_idx},
                    level=2
                )
                self.nodes.append(sec_node)
                self.node_map[sec_id] = sec_node
                
                # Связь Глава -> Раздел
                self.edges.append(GraphEdge(source=chap_id, target=sec_id, type="contains"))

                # Обрабатываем абзацы
                for par_idx, paragraph in enumerate(section.get('paragraphs', [])):
                    par_text = paragraph.get('text', '')
                    par_summary = par_text[:50] if len(par_text) > 50 else par_text
                    par_id = self._generate_id(par_summary, "par")
                    
                    par_atoms = paragraph.get('atoms', {})
                    
                    par_node = GraphNode(
                        id=par_id,
                        label=f"Абзац {par_idx+1}",
                        type="paragraph",
                        content=par_text,
                        metadata=par_atoms,
                        level=3
                    )
                    self.nodes.append(par_node)
                    self.node_map[par_id] = par_node
                    
                    # Связь Раздел -> Абзац
                    self.edges.append(GraphEdge(source=sec_id, target=par_id, type="contains"))

                    # Разбиение на чанки если текст длинный (>300 символов)
                    if len(par_text) > 300:
                        chunks = [par_text[i:i+300] for i in range(0, len(par_text), 300)]
                        for c_idx, chunk_text in enumerate(chunks):
                            chunk_id = self._generate_id(chunk_text[:30], "chk")
                            
                            chunk_node = GraphNode(
                                id=chunk_id,
                                label=f"Чанк {c_idx+1}",
                                type="chunk",
                                content=chunk_text,
                                metadata={"chunk_index": c_idx, "parent_paragraph": par_id},
                                level=4
                            )
                            self.nodes.append(chunk_node)
                            self.node_map[chunk_id] = chunk_node
                            
                            # Связь Абзац -> Чанк
                            self.edges.append(GraphEdge(source=par_id, target=chunk_id, type="contains"))
        
        return self.to_json()

    def add_semantic_links(self, rag_results: List[Dict[str, Any]], threshold: float = 0.5):
        """Добавляет семантические связи (похожесть) из результатов RAG"""
        for res in rag_results:
            similarity = res.get('similarity', 0)
            if similarity >= threshold:
                self.edges.append(GraphEdge(
                    source=res.get('source_id', ''),
                    target=res.get('target_id', ''),
                    type="similar_to",
                    weight=similarity
                ))

    def add_conflict_links(self, conflicts: List[Dict[str, Any]]):
        """Добавляет связи противоречий"""
        for conf in conflicts:
            self.edges.append(GraphEdge(
                source=conf.get('source_id', ''),
                target=conf.get('target_id', ''),
                type="conflicts_with",
                weight=1.0
            ))

    def get_path_to_node(self, node_id: str) -> List[str]:
        """Возвращает путь от корня до узла (Заголовки)"""
        path = []
        current_id = node_id
        
        # Ищем предков пока не дойдем до корня
        while current_id:
            node = self.node_map.get(current_id)
            if not node:
                break
            path.insert(0, node.label)
            
            # Ищем родителя
            parent_edge = next((e for e in self.edges if e.target == current_id and e.type == "contains"), None)
            if parent_edge:
                current_id = parent_edge.source
            else:
                break
                
        return path

    def to_json(self) -> Dict[str, Any]:
        """Экспорт графа в JSON формат для визуализации"""
        return {
            "nodes": [
                {
                    "id": n.id,
                    "label": n.label,
                    "type": n.type,
                    "level": n.level,
                    "metadata": n.metadata
                }
                for n in self.nodes
            ],
            "edges": [
                {
                    "source": e.source,
                    "target": e.target,
                    "type": e.type,
                    "weight": e.weight
                }
                for e in self.edges
            ],
            "stats": {
                "total_nodes": len(self.nodes),
                "total_edges": len(self.edges),
                "chapters": sum(1 for n in self.nodes if n.type == "chapter"),
                "sections": sum(1 for n in self.nodes if n.type == "section"),
                "paragraphs": sum(1 for n in self.nodes if n.type == "paragraph"),
                "chunks": sum(1 for n in self.nodes if n.type == "chunk")
            }
        }
