"""
Основной модуль агента для анализа требований.

Реализует полный цикл обработки документов:
1. Загрузка и парсинг (FR-02)
2. Атомарная декомпозиция (FR-03)
3. Классификация исполнителей (FR-04)
4. Поиск в RAG (FR-05)
5. Сохранение в RAG (FR-06)
6. Формирование отчета (FR-07)
7. Трассировка (FR-08)
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime
import json

from .models import ModelConfig, ModelProvider, get_model_client, BaseModelClient
from .parser import DocumentParser, ParsedDocument
from .decomposer import Decomposer, DecomposedDocument, AtomicRequirement
from .classifier import ExecutorClassifier
from .rag_client import RAGClient, MockRAGClient
from .rag_storage import qdrant_db, Chunk
from .rag_search import rag_searcher


# Роли пользователей с доступом к агенту (FR-01, NFR-02)
ALLOWED_ROLES = ['Архитектор', 'Администратор', 'Аналитик DevOps РП']


@dataclass
class ProcessingResult:
    """Результат обработки документа."""
    document_id: str
    title: str
    report: str
    total_requirements: int
    saved_to_rag: bool
    processing_time: float
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class RequirementsAgent:
    """
    AI Агент для анализа требований.
    
    Специализированный агент для автоматизации анализа неформализованных 
    документов, декомпозиции их на атомарные единицы знаний и сохранения 
    в базу знаний (RAG/Graph).
    """
    
    def __init__(
        self,
        model_configs: Optional[List[ModelConfig]] = None,
        rag_client: Optional[RAGClient] = None,
        use_mock_rag: bool = True,
    ):
        """
        Инициализация агента.
        
        Args:
            model_configs: Конфигурации AI моделей (по умолчанию GPT-4)
            rag_client: Клиент для работы с RAG
            use_mock_rag: Использовать mock-RAG для демонстрации
        """
        # Инициализация AI моделей
        if model_configs is None:
            # Модель по умолчанию - GPT-4
            model_configs = [
                ModelConfig(
                    provider=ModelProvider.OPENAI_GPT4,
                    api_key="your-api-key-here"  # Заменить на реальный ключ
                )
            ]
        
        self.model_clients: List[BaseModelClient] = []
        for config in model_configs:
            try:
                client = get_model_client(config)
                self.model_clients.append(client)
            except Exception as e:
                print(f"Предупреждение: Не удалось инициализировать модель {config.provider}: {e}")
        
        if not self.model_clients:
            raise ValueError("Не удалось инициализировать ни одну AI модель")
        
        # Основной клиент модели (первый в списке)
        self.primary_model = self.model_clients[0]
        
        # Инициализация компонентов
        self.parser = DocumentParser()
        self.decomposer = Decomposer(self.primary_model)
        self.classifier = ExecutorClassifier()
        
        # Инициализация RAG клиента
        if rag_client:
            self.rag_client = rag_client
        elif use_mock_rag:
            self.rag_client = MockRAGClient()
        else:
            self.rag_client = RAGClient()
    
    def check_access(self, user_role: str) -> bool:
        """
        Проверка доступа пользователя (FR-01).
        
        Args:
            user_role: Роль пользователя
            
        Returns:
            bool: True если доступ разрешён
        """
        return user_role in ALLOWED_ROLES
    
    def process_document(
        self,
        file_path: str,
        user_role: str = 'Архитектор',
        save_to_rag: bool = True
    ) -> ProcessingResult:
        """
        Обработка документа: парсинг, декомпозиция, анализ, сохранение в RAG.
        
        Args:
            file_path: Путь к файлу документа
            user_role: Роль пользователя
            save_to_rag: Сохранять ли в RAG
            
        Returns:
            ProcessingResult: Результат обработки
        """
        start_time = datetime.now()
        errors = []
        warnings = []
        
        # FR-01: Проверка доступа
        if not self.check_access(user_role):
            return ProcessingResult(
                document_id='unknown',
                title='unknown',
                report='Ошибка доступа: Недостаточно прав для выполнения операции.',
                total_requirements=0,
                saved_to_rag=False,
                processing_time=0,
                errors=['Доступ запрещён для роли: ' + user_role]
            )
        
        try:
            # FR-02: Загрузка и парсинг
            parsed_doc = self.parser.parse(file_path)
            
            # Сохранение исходного документа в хранилище
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                raw_content = f.read()
            document_id = self.rag_client.save_document(
                title=parsed_doc.title,
                content=raw_content[:10000],  # Ограничиваем размер
                metadata={'source_path': file_path, 'parsed_at': str(datetime.now())}
            )
            
            # FR-03: Атомарная декомпозиция
            decomposed_doc = self.decomposer.decompose(parsed_doc)
            
            # FR-04: Классификация исполнителей
            decomposed_doc = self.classifier.classify(decomposed_doc)
            
            # FR-05: Поиск похожих требований в RAG
            decomposed_doc = self._enrich_with_rag_search(decomposed_doc)
            
            # FR-07: Формирование отчета
            report = self._generate_report(decomposed_doc)
            
            # Подсчёт требований
            total_requirements = sum(
                len(section.atomic_requirements)
                for chapter in decomposed_doc.chapters
                for section in chapter.sections
            )
            
            # FR-06: Сохранение в RAG
            saved_to_rag = False
            if save_to_rag:
                try:
                    self._save_to_rag(decomposed_doc, document_id)
                    saved_to_rag = True
                except Exception as e:
                    warnings.append(f'Ошибка сохранения в RAG: {str(e)}')
            
            processing_time = (datetime.now() - start_time).total_seconds()
            
            return ProcessingResult(
                document_id=document_id,
                title=parsed_doc.title,
                report=report,
                total_requirements=total_requirements,
                saved_to_rag=saved_to_rag,
                processing_time=processing_time,
                errors=errors,
                warnings=warnings,
                metadata={
                    'chapters_count': len(decomposed_doc.chapters),
                    'executor_stats': self.classifier.get_statistics(decomposed_doc)
                }
            )
            
        except FileNotFoundError as e:
            errors.append(f'Файл не найден: {str(e)}')
            return ProcessingResult(
                document_id='unknown',
                title='unknown',
                report='Ошибка: Файл не найден.',
                total_requirements=0,
                saved_to_rag=False,
                processing_time=0,
                errors=errors
            )
        except Exception as e:
            errors.append(f'Ошибка обработки: {str(e)}')
            return ProcessingResult(
                document_id='unknown',
                title='unknown',
                report=f'Ошибка обработки документа: {str(e)}',
                total_requirements=0,
                saved_to_rag=False,
                processing_time=0,
                errors=errors
            )
    
    def process_content(
        self,
        content: str,
        title: str = "Документ",
        user_role: str = 'Архитектор',
        save_to_rag: bool = True
    ) -> ProcessingResult:
        """
        Обработка текстового контента.
        
        Args:
            content: Текстовое содержимое
            title: Заголовок документа
            user_role: Роль пользователя
            save_to_rag: Сохранять ли в RAG
            
        Returns:
            ProcessingResult: Результат обработки
        """
        start_time = datetime.now()
        errors = []
        warnings = []
        
        # FR-01: Проверка доступа
        if not self.check_access(user_role):
            return ProcessingResult(
                document_id='unknown',
                title=title,
                report='Ошибка доступа: Недостаточно прав для выполнения операции.',
                total_requirements=0,
                saved_to_rag=False,
                processing_time=0,
                errors=['Доступ запрещён для роли: ' + user_role]
            )
        
        try:
            # FR-02: Парсинг контента
            parsed_doc = self.parser.parse_content(content, title)
            
            # Сохранение в хранилище
            document_id = self.rag_client.save_document(
                title=title,
                content=content[:10000],
                metadata={'parsed_at': str(datetime.now())}
            )
            
            # FR-03: Атомарная декомпозиция
            decomposed_doc = self.decomposer.decompose(parsed_doc)
            
            # FR-04: Классификация исполнителей
            decomposed_doc = self.classifier.classify(decomposed_doc)
            
            # FR-05: Поиск похожих требований в RAG
            decomposed_doc = self._enrich_with_rag_search(decomposed_doc)
            
            # FR-07: Формирование отчета
            report = self._generate_report(decomposed_doc)
            
            # Подсчёт требований
            total_requirements = sum(
                len(section.atomic_requirements)
                for chapter in decomposed_doc.chapters
                for section in chapter.sections
            )
            
            # FR-06: Сохранение в RAG
            saved_to_rag = False
            if save_to_rag:
                try:
                    self._save_to_rag(decomposed_doc, document_id)
                    saved_to_rag = True
                except Exception as e:
                    warnings.append(f'Ошибка сохранения в RAG: {str(e)}')
            
            processing_time = (datetime.now() - start_time).total_seconds()
            
            return ProcessingResult(
                document_id=document_id,
                title=title,
                report=report,
                total_requirements=total_requirements,
                saved_to_rag=saved_to_rag,
                processing_time=processing_time,
                errors=errors,
                warnings=warnings,
                metadata={
                    'chapters_count': len(decomposed_doc.chapters),
                    'executor_stats': self.classifier.get_statistics(decomposed_doc)
                }
            )
            
        except Exception as e:
            errors.append(f'Ошибка обработки: {str(e)}')
            return ProcessingResult(
                document_id='unknown',
                title=title,
                report=f'Ошибка обработки документа: {str(e)}',
                total_requirements=0,
                saved_to_rag=False,
                processing_time=0,
                errors=errors
            )
    
    def _enrich_with_rag_search(self, decomposed_doc: DecomposedDocument) -> DecomposedDocument:
        """Обогащение требований данными из RAG (FR-05) с использованием нового модуля поиска."""
        for chapter in decomposed_doc.chapters:
            for section in chapter.sections:
                for requirement in section.atomic_requirements:
                    # Поиск похожих требований через новый модуль rag_search
                    similar_results = rag_searcher.search(
                        query=requirement.fact,
                        top_k=5,
                        threshold=0.5
                    )
                    
                    # Поиск дубликатов
                    duplicates = rag_searcher.find_duplicates(
                        text=requirement.fact,
                        threshold=0.85
                    )
                    
                    # Поиск противоречий
                    contradictions = rag_searcher.find_contradictions(
                        requirement_text=requirement.fact,
                        risk_level=requirement.criticality
                    )
                    
                    # Формирование enriched данных
                    similar_items = []
                    comments = []
                    
                    for res in similar_results:
                        similar_items.append({
                            'id': res['chunk_id'],
                            'similarity_score': res['similarity_score'],
                            'content': res['content'],
                            'document_id': res.get('document_id', 'unknown')
                        })
                    
                    # Добавление информации о дубликатах в комментарии
                    if duplicates:
                        dup_ids = [d['chunk_id'] for d in duplicates]
                        comments.append(f"ВНИМАНИЕ: Найдены дубликаты требований: {', '.join(dup_ids[:3])}")
                    
                    # Добавление информации о противоречиях в комментарии
                    if contradictions:
                        contr_ids = [c['chunk_id'] for c in contradictions]
                        comments.append(f"ВНИМАНИЕ: Возможные противоречия с требованиями: {', '.join(contr_ids[:3])}")
                    
                    # Обогащение требования через декомposer
                    requirement = self.decomposer.enrich_with_similarity(
                        requirement=requirement,
                        similar_items=similar_items,
                        threshold=0.5
                    )
                    
                    # Сохранение комментариев о дубликатах и противоречиях
                    if comments:
                        existing_comment = requirement.comments or ""
                        requirement.comments = f"{existing_comment}\n{' | '.join(comments)}".strip()
        
        return decomposed_doc
    
    def _save_to_rag(self, decomposed_doc: DecomposedDocument, document_id: str):
        """Сохранение требований в RAG (FR-06) с использованием нового модуля векторной БД."""
        all_chunks = []
        
        for chapter in decomposed_doc.chapters:
            for section in chapter.sections:
                for requirement in section.atomic_requirements:
                    # Формируем текстовое представление требования для чанкинга
                    req_text = f"{requirement.fact}. Риск: {requirement.risk}. Рекомендация: {requirement.recommendation}."
                    
                    # Сохраняем как чанк в векторную БД через новый модуль
                    chunk_metadata = {
                        'document_id': document_id,
                        'chapter_title': chapter.title,
                        'section_title': section.title,
                        'requirement_type': 'atomic',
                        'executors': requirement.executors,
                        'risk_level': requirement.criticality,
                        'tracing': requirement.tracing
                    }
                    
                    # Используем qdrant_db для сохранения чанков
                    chunks = qdrant_db.save_chunks(
                        document_id=document_id,
                        text=req_text,
                        metadata=chunk_metadata
                    )
                    all_chunks.extend(chunks)
        
        # Также сохраняем структурированные данные в старый RAG клиент для совместимости
        all_requirements = []
        for chapter in decomposed_doc.chapters:
            for section in chapter.sections:
                for requirement in section.atomic_requirements:
                    req_data = requirement.to_dict()
                    req_data['architectural_solution'] = '; '.join(requirement.architectural_solutions)
                    all_requirements.append(req_data)
        
        self.rag_client.batch_save_requirements(all_requirements, document_id)
        
        return len(all_chunks)
    
    def _generate_report(self, decomposed_doc: DecomposedDocument) -> str:
        """
        Генерация отчёта в формате Markdown (FR-07).
        
        Структура отчёта соответствует требованиям FR-07.
        """
        lines = []
        lines.append(f"# Отчёт по анализу документа: {decomposed_doc.title}\n")
        lines.append(f"**Дата обработки:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        lines.append(f"**Всего глав:** {len(decomposed_doc.chapters)}\n")
        
        total_reqs = sum(
            len(section.atomic_requirements)
            for chapter in decomposed_doc.chapters
            for section in chapter.sections
        )
        lines.append(f"**Всего атомарных требований:** {total_reqs}\n")
        lines.append("---\n")
        
        for chapter_idx, chapter in enumerate(decomposed_doc.chapters, 1):
            lines.append(f"# {chapter_idx}. {chapter.title}\n")
            
            for section_idx, section in enumerate(chapter.sections, 1):
                lines.append(f"## {chapter_idx}.{section_idx} {section.title}\n")
                
                for req_idx, requirement in enumerate(section.atomic_requirements, 1):
                    tracing = requirement.tracing
                    
                    # FR-08: Трассировка
                    para_ref = f"Абзац #{tracing.get('paragraph_index', 'unknown') + 1}"
                    lines.append(f"**{para_ref}**: {requirement.fact[:100]}{'...' if len(requirement.fact) > 100 else ''}\n")
                    
                    lines.append(f"* **Факт/Наблюдение:** {requirement.fact}\n")
                    lines.append(f"* **Риск:** {requirement.risk}\n")
                    lines.append(f"* **Критичность:** {requirement.criticality}\n")
                    lines.append(f"* **Рекомендация:** {requirement.recommendation}\n")
                    
                    # FR-04: Тип исполнителя
                    executors_str = ', '.join(requirement.executors) if requirement.executors else 'unknown'
                    lines.append(f"* **Тип исполнителя:** {executors_str}\n")
                    
                    # FR-05: Найденные похожие требования
                    if requirement.similar_requirements:
                        similar_ids = [
                            f"{req['id']} ({req['similarity_score']:.0%})"
                            for req in requirement.similar_requirements[:3]
                        ]
                        lines.append(f"* **Найденные похожие требования:** {', '.join(similar_ids)}\n")
                    else:
                        lines.append("* **Найденные похожие требования:** Не найдено\n")
                    
                    # Архитектурные решения
                    if requirement.architectural_solutions:
                        solutions_str = '; '.join(requirement.architectural_solutions[:3])
                        lines.append(f"* **Использованные архитектурные решения:** {solutions_str}\n")
                    
                    # Комментарии (дубликаты, противоречия)
                    if requirement.comments:
                        comments_str = '; '.join(requirement.comments)
                        lines.append(f"* **Комментарий при обработке:** {comments_str}\n")
                    
                    lines.append("\n")
        
        return '\n'.join(lines)
    
    def search_in_rag(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Поиск в базе знаний RAG.
        
        Args:
            query: Поисковый запрос
            limit: Максимальное количество результатов
            
        Returns:
            List[Dict]: Результаты поиска
        """
        return self.rag_client.search_similar(query, limit=limit)
    
    def get_rag_statistics(self) -> Dict[str, Any]:
        """Получение статистики по базе знаний RAG."""
        return self.rag_client.get_statistics()
