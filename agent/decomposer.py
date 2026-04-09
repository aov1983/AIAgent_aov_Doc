"""
Модуль декомпозиции документов на атомарные требования.

Реализует FR-03: Атомарная декомпозиция
- Иерархическая разбивка (Глава -> Раздел -> Абзац)
- Атомарная экстракция (Факт, Риск, Рекомендация)
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from .parser import ParsedDocument, DocumentElement
from .models import BaseModelClient


@dataclass
class AtomicRequirement:
    """Атомарное требование."""
    fact: str  # Факт/Наблюдение
    risk: str  # Описание риска
    criticality: str  # Высокий/Средний/Низкий
    recommendation: str  # Рекомендация
    executors: List[str] = field(default_factory=list)  # Типы исполнителей
    tracing: Dict[str, Any] = field(default_factory=dict)  # Трассировка к источнику
    similar_requirements: List[Dict] = field(default_factory=list)  # Похожие требования из RAG
    architectural_solutions: List[str] = field(default_factory=list)  # Архитектурные решения
    comments: List[str] = field(default_factory=list)  # Комментарии (дубликаты, противоречия)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'fact': self.fact,
            'risk': self.risk,
            'criticality': self.criticality,
            'recommendation': self.recommendation,
            'executors': self.executors,
            'tracing': self.tracing,
            'similar_requirements': self.similar_requirements,
            'architectural_solutions': self.architectural_solutions,
            'comments': self.comments,
        }


@dataclass
class Section:
    """Раздел документа."""
    title: str
    paragraphs: List[str]
    atomic_requirements: List[AtomicRequirement] = field(default_factory=list)


@dataclass
class Chapter:
    """Глава документа."""
    title: str
    sections: List[Section] = field(default_factory=list)


@dataclass
class DecomposedDocument:
    """Декомпозированный документ."""
    title: str
    chapters: List[Chapter] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class Decomposer:
    """Декомпозитор документов на атомарные требования."""
    
    def __init__(self, model_client: BaseModelClient):
        self.model_client = model_client
    
    def decompose(self, parsed_doc: ParsedDocument) -> DecomposedDocument:
        """
        Декомпозиция документа на атомарные требования.
        
        Args:
            parsed_doc: Распарсенный документ
            
        Returns:
            DecomposedDocument: Декомпозированный документ
        """
        decomposed = DecomposedDocument(title=parsed_doc.title, metadata=parsed_doc.metadata)
        
        current_chapter = None
        current_section = None
        
        for element in parsed_doc.elements:
            if element.element_type == 'heading':
                if element.level == 1:
                    # Новая глава
                    if current_chapter:
                        decomposed.chapters.append(current_chapter)
                    current_chapter = Chapter(title=element.content)
                    current_section = None
                elif element.level == 2:
                    # Новый раздел
                    if current_chapter:
                        if current_section:
                            current_chapter.sections.append(current_section)
                        current_section = Section(title=element.content, paragraphs=[])
            elif element.element_type in ['paragraph', 'list_item', 'table']:
                # Абзац или элемент списка
                if current_chapter is None:
                    # Создаем главу по умолчанию
                    current_chapter = Chapter(title="Введение")
                
                if current_section is None:
                    # Создаем раздел по умолчанию
                    current_section = Section(title="Общие положения", paragraphs=[])
                
                current_section.paragraphs.append(element.content)
        
        # Добавляем последние элементы
        if current_section and current_chapter:
            current_chapter.sections.append(current_section)
        if current_chapter:
            decomposed.chapters.append(current_chapter)
        
        # Если глав нет, создаем одну из всех параграфов
        if not decomposed.chapters:
            all_paragraphs = [
                elem.content for elem in parsed_doc.elements 
                if elem.element_type in ['paragraph', 'list_item', 'table']
            ]
            if all_paragraphs:
                decomposed.chapters.append(Chapter(
                    title="Основная часть",
                    sections=[Section(title="Раздел", paragraphs=all_paragraphs)]
                ))
        
        # Декомпозиция каждого раздела на атомарные требования
        for chapter in decomposed.chapters:
            for section in chapter.sections:
                section.atomic_requirements = self._decompose_section(section, chapter.title)
        
        return decomposed
    
    def _decompose_section(self, section: Section, chapter_title: str) -> List[AtomicRequirement]:
        """Декомпозиция раздела на атомарные требования."""
        requirements = []
        
        for para_idx, paragraph in enumerate(section.paragraphs):
            if not paragraph.strip():
                continue
            
            # Используем AI для экстракции атомарных требований
            try:
                requirement = self._extract_atomic_requirement(
                    paragraph=paragraph,
                    section_title=section.title,
                    chapter_title=chapter_title,
                    paragraph_index=para_idx
                )
                requirements.append(requirement)
            except Exception as e:
                # При ошибке создаем требование с unknown значениями (NFR-03)
                requirements.append(AtomicRequirement(
                    fact=paragraph[:200] if len(paragraph) > 200 else paragraph,
                    risk="unknown",
                    criticality="unknown",
                    recommendation="unknown",
                    executors=["unknown"],
                    tracing={
                        'chapter': chapter_title,
                        'section': section.title,
                        'paragraph_index': para_idx,
                        'error': str(e)
                    },
                    comments=[f"Ошибка обработки: {str(e)}"]
                ))
        
        return requirements
    
    def _extract_atomic_requirement(
        self,
        paragraph: str,
        section_title: str,
        chapter_title: str,
        paragraph_index: int
    ) -> AtomicRequirement:
        """Извлечение атомарного требования из абзаца с помощью AI."""
        
        system_prompt = """Ты - экспертный аналитик требований. Твоя задача - извлекать атомарные требования из текста.

Правила:
1. Извлекай один атомарный факт/наблюдение из абзаца
2. Определяй связанные риски и их критичность (Высокий/Средний/Низкий)
3. Формулируй рекомендации по управлению рисками
4. Не выдумывай информацию - если что-то неясно, используй 'unknown'
5. Отвечай строго в формате JSON

Пример ответа:
{
    "fact": "Ключевое утверждение из текста",
    "risk": "Описание потенциальной проблемы",
    "criticality": "Высокий",
    "recommendation": "Предлагаемое действие"
}"""

        prompt = f"""Проанализируй следующий текст и извлеки атомарное требование:

Контекст:
Глава: {chapter_title}
Раздел: {section_title}
Абзац #{paragraph_index + 1}

Текст:
{paragraph}

Извлеки:
1. Факт/Наблюдение - ключевое атомарное утверждение
2. Риск - потенциальная проблема на основе прошлого опыта
3. Критичность - Высокий/Средний/Низкий
4. Рекомендация - предлагаемое действие или изменение

Ответь в формате JSON:"""

        result = self.model_client.generate_structured(prompt, system_prompt)
        
        return AtomicRequirement(
            fact=result.get('fact', 'unknown'),
            risk=result.get('risk', 'unknown'),
            criticality=self._validate_criticality(result.get('criticality', 'unknown')),
            recommendation=result.get('recommendation', 'unknown'),
            tracing={
                'chapter': chapter_title,
                'section': section_title,
                'paragraph_index': paragraph_index,
                'paragraph_preview': paragraph[:100] if len(paragraph) > 100 else paragraph
            }
        )
    
    def _validate_criticality(self, criticality: str) -> str:
        """Валидация уровня критичности."""
        valid_values = ['Высокий', 'Средний', 'Низкий', 'High', 'Medium', 'Low']
        
        if criticality in valid_values:
            return criticality
        
        # Маппинг английских значений на русские
        mapping = {
            'High': 'Высокий',
            'Medium': 'Средний',
            'Low': 'Низкий'
        }
        
        return mapping.get(criticality, 'unknown')
    
    def enrich_with_similarity(
        self, 
        requirement: AtomicRequirement, 
        similar_items: List[Dict],
        threshold: float = 0.5
    ) -> AtomicRequirement:
        """
        Обогащение требования информацией о похожих требованиях из RAG.
        
        Args:
            requirement: Атомарное требование
            similar_items: Список похожих требований из RAG
            threshold: Порог схожести (по умолчанию 0.5 = 50%)
            
        Returns:
            AtomicRequirement: Обогащённое требование
        """
        filtered_similar = [
            item for item in similar_items 
            if item.get('similarity_score', 0) >= threshold
        ]
        
        requirement.similar_requirements = filtered_similar
        
        # Проверка на дубликаты (схожесть > 90%)
        duplicates = [
            item for item in filtered_similar 
            if item.get('similarity_score', 0) >= 0.9
        ]
        
        if duplicates:
            dup_ids = [item.get('id', 'unknown') for item in duplicates]
            requirement.comments.append(f"Возможный дубликат требований: {', '.join(dup_ids)}")
        
        # Проверка на противоречия
        contradictions = [
            item for item in filtered_similar 
            if item.get('is_contradiction', False)
        ]
        
        if contradictions:
            contr_ids = [item.get('id', 'unknown') for item in contradictions]
            requirement.comments.append(f"Противоречие с требованиями: {', '.join(contr_ids)}")
        
        # Извлечение архитектурных решений
        for item in filtered_similar:
            if 'architectural_solution' in item and item['architectural_solution']:
                req_id = item.get('id', 'unknown')
                requirement.architectural_solutions.append(
                    f"{req_id}: {item['architectural_solution']}"
                )
        
        return requirement
