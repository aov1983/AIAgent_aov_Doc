"""
Модуль классификации исполнителей.

Реализует FR-04: Классификация исполнителей
- Классификация по типу исполнителя (аналитик, архитектор, разработчик, тестировщик, DevOps)
"""

from typing import List, Dict, Any
from .decomposer import DecomposedDocument, AtomicRequirement


class ExecutorClassifier:
    """Классификатор типов исполнителей для требований."""
    
    # Ключевые слова для каждого типа исполнителя
    EXECUTOR_KEYWORDS = {
        'Аналитик': [
            'требования', 'анализ', 'бизнес-процесс', 'пользовательская история',
            'use case', 'сценарий', 'функциональность', 'описание', 'спецификация',
            'интервью', 'опрос', 'моделирование', ' bpmn', 'диаграмма',
            'бэклог', 'приоритизация', 'критерии приемки', 'acceptance criteria'
        ],
        'Архитектор': [
            'архитектура', 'архитектурный', 'компонент', 'микросервис', 'сервис',
            'интеграция', 'api', 'протокол', 'шаблон', 'pattern', 'декомпозиция',
            'масштабируемость', 'надежность', 'отказоустойчивость', 'high availability',
            'системная архитектура', 'enterprise architecture', 'toa', 'технический стек'
        ],
        'Разработчик': [
            'код', 'разработка', 'реализация', 'программирование', 'алгоритм',
            'функция', 'метод', 'класс', 'модуль', 'библиотека', 'фреймворк',
            'git', 'merge', 'pull request', 'code review', 'рефакторинг',
            'unit test', 'mock', 'dependency', 'имплементация', 'develop'
        ],
        'Тестировщик': [
            'тест', 'тестирование', 'qa', 'quality assurance', 'валидация',
            'верификация', 'баг', 'ошибка', 'defect', 'test case', 'чек-лист',
            'автоматизация тестов', 'regression', 'smoke', 'integration test',
            'e2e', 'end-to-end', 'coverage', 'покрытие тестами', 'test plan'
        ],
        'DevOps': [
            'devops', 'ci/cd', 'pipeline', 'деплой', 'deploy', 'контейнер',
            'docker', 'kubernetes', 'k8s', 'оркестрация', 'инфраструктура',
            'monitoring', 'мониторинг', 'logging', 'логирование', 'prometheus',
            'grafana', 'jenkins', 'gitlab ci', 'terraform', 'ansible', 'helm',
            'cloud', 'облако', 'aws', 'azure', 'gcp', 'виртуализация'
        ]
    }
    
    def __init__(self):
        pass
    
    def classify(self, decomposed_doc: DecomposedDocument) -> DecomposedDocument:
        """
        Классификация всех требований в документе по типам исполнителей.
        
        Args:
            decomposed_doc: Декомпозированный документ
            
        Returns:
            DecomposedDocument: Документ с классифицированными требованиями
        """
        for chapter in decomposed_doc.chapters:
            for section in chapter.sections:
                for requirement in section.atomic_requirements:
                    requirement.executors = self._classify_requirement(requirement)
        
        return decomposed_doc
    
    def _classify_requirement(self, requirement: AtomicRequirement) -> List[str]:
        """
        Классификация одного требования по типам исполнителей.
        
        Args:
            requirement: Атомарное требование
            
        Returns:
            List[str]: Список типов исполнителей
        """
        executors = set()
        
        # Собираем весь текст для анализа
        text_parts = [
            requirement.fact.lower(),
            requirement.risk.lower(),
            requirement.recommendation.lower()
        ]
        full_text = ' '.join(text_parts)
        
        # Проверяем каждое ключевое слово
        for executor_type, keywords in self.EXECUTOR_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in full_text:
                    executors.add(executor_type)
                    break  # Достаточно одного совпадения для типа исполнителя
        
        # Если ничего не найдено, назначаем по умолчанию
        if not executors:
            # Пытаемся определить по контексту
            if any(word in full_text for word in ['что', 'как', 'почему', 'зачем']):
                executors.add('Аналитик')
            elif any(word in full_text for word in ['должен', 'необходимо', 'требуется']):
                executors.add('Архитектор')
            else:
                executors.add('Аналитик')  # По умолчанию
        
        return list(executors)
    
    def classify_single(self, text: str) -> List[str]:
        """
        Классификация произвольного текста по типам исполнителей.
        
        Args:
            text: Текст для классификации
            
        Returns:
            List[str]: Список типов исполнителей
        """
        # Создаем временное требование
        temp_req = AtomicRequirement(
            fact=text,
            risk="unknown",
            criticality="unknown",
            recommendation="unknown"
        )
        return self._classify_requirement(temp_req)
    
    def get_statistics(self, decomposed_doc: DecomposedDocument) -> Dict[str, int]:
        """
        Получение статистики распределения требований по исполнителям.
        
        Args:
            decomposed_doc: Декомпозированный документ
            
        Returns:
            Dict[str, int]: Статистика по исполнителям
        """
        stats = {executor: 0 for executor in self.EXECUTOR_KEYWORDS.keys()}
        stats['Не определено'] = 0
        
        for chapter in decomposed_doc.chapters:
            for section in chapter.sections:
                for requirement in section.atomic_requirements:
                    if requirement.executors:
                        for executor in requirement.executors:
                            if executor in stats:
                                stats[executor] += 1
                            else:
                                stats['Не определено'] += 1
                    else:
                        stats['Не определено'] += 1
        
        return stats
