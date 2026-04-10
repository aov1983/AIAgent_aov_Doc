"""
UNIT Тесты для модуля классификации исполнителей (Classifier)
"""
import pytest
from agent.classifier import RoleClassifier

class TestRoleClassifier:
    @pytest.fixture
    def classifier(self):
        return RoleClassifier()

    def test_classify_architect_requirement(self, classifier):
        """Тест классификации требования для архитектора"""
        text = "Необходимо разработать высокоуровневую архитектуру системы с использованием микросервисов."
        roles = classifier.classify(text)
        
        assert 'architect' in roles
        assert len(roles) > 0

    def test_classify_developer_requirement(self, classifier):
        """Тест классификации требования для разработчика"""
        text = "Реализовать REST API эндпоинт для получения списка пользователей."
        roles = classifier.classify(text)
        
        assert 'developer' in roles

    def test_classify_devops_requirement(self, classifier):
        """Тест классификации требования для DevOps"""
        text = "Настроить CI/CD пайплайн в GitLab и развернуть приложение в Kubernetes."
        roles = classifier.classify(text)
        
        assert 'devops' in roles

    def test_classify_tester_requirement(self, classifier):
        """Тест классификации требования для тестировщика"""
        text = "Разработать набор автотестов для проверки функционала авторизации."
        roles = classifier.classify(text)
        
        assert 'tester' in roles

    def test_classify_analyst_requirement(self, classifier):
        """Тест классификации требования для аналитика"""
        text = "Собрать требования у заказчика и формализовать их в виде пользовательских историй."
        roles = classifier.classify(text)
        
        assert 'analyst' in roles

    def test_multi_role_classification(self, classifier):
        """Тест классификации требования для нескольких ролей"""
        text = "Разработать архитектуру и реализовать прототип системы для демонстрации заказчику."
        roles = classifier.classify(text)
        
        assert 'architect' in roles
        assert 'developer' in roles
        assert len(roles) >= 2

    def test_empty_text_classification(self, classifier):
        """Тест обработки пустого текста"""
        roles = classifier.classify("")
        assert roles == [] or roles is None

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
