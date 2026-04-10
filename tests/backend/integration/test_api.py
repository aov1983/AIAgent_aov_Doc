"""
Integration Тесты для API (FastAPI Backend)
"""
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

class TestAuthAPI:
    """Тесты модуля авторизации и аутентификации"""

    def test_login_success(self):
        """Тест успешного входа"""
        response = client.post("/api/auth/login", json={
            "username": "architect",
            "password": "admin"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_invalid_credentials(self):
        """Тест входа с неверными данными"""
        response = client.post("/api/auth/login", json={
            "username": "invalid_user",
            "password": "wrong_password"
        })
        
        assert response.status_code == 401

    def test_login_unauthorized_role(self):
        """Тест входа с запрещенной ролью"""
        # Если роль не входит в список разрешенных
        response = client.post("/api/auth/login", json={
            "username": "guest",
            "password": "guest"
        })
        
        # Ожидаем 403 или 401 в зависимости от реализации
        assert response.status_code in [401, 403]

class TestDocumentAPI:
    """Тесты модуля работы с документами"""

    @pytest.fixture
    def auth_token(self):
        """Получение токена для авторизованных запросов"""
        response = client.post("/api/auth/login", json={
            "username": "architect",
            "password": "admin"
        })
        return response.json()["access_token"]

    def test_upload_document(self, auth_token):
        """Тест загрузки документа"""
        # Создаем тестовый файл
        test_content = b"Test document content for integration testing."
        files = {"file": ("test.txt", test_content, "text/plain")}
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = client.post("/api/documents/upload", files=files, headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "document_id" in data
        assert "status" in data

    def test_upload_without_auth(self):
        """Тест загрузки без авторизации"""
        files = {"file": ("test.txt", b"content", "text/plain")}
        
        response = client.post("/api/documents/upload", files=files)
        
        assert response.status_code == 401

    def test_get_document_list(self, auth_token):
        """Тест получения списка документов"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = client.get("/api/documents", headers=headers)
        
        assert response.status_code == 200
        assert isinstance(response.json(), list)

class TestAnalysisAPI:
    """Тесты модуля анализа документов"""

    @pytest.fixture
    def auth_token(self):
        response = client.post("/api/auth/login", json={
            "username": "architect",
            "password": "admin"
        })
        return response.json()["access_token"]

    def test_analyze_document(self, auth_token):
        """Тест запуска анализа документа"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Сначала загрузим документ
        files = {"file": ("test_analysis.txt", b"Requirement: System must be secure.", "text/plain")}
        upload_response = client.post("/api/documents/upload", files=files, headers=headers)
        doc_id = upload_response.json()["document_id"]
        
        # Запустим анализ
        analyze_response = client.post(f"/api/analysis/{doc_id}", headers=headers)
        
        assert analyze_response.status_code in [200, 202]  # 202 если асинхронно

    def test_get_analysis_results(self, auth_token):
        """Тест получения результатов анализа"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        # Получаем результаты (можно использовать несуществующий ID для проверки обработки ошибок)
        response = client.get("/api/analysis/nonexistent-id", headers=headers)
        
        # Ожидаем 404 или пустой результат
        assert response.status_code in [200, 404]

class TestRagAPI:
    """Тесты модуля RAG поиска"""

    @pytest.fixture
    def auth_token(self):
        response = client.post("/api/auth/login", json={
            "username": "architect",
            "password": "admin"
        })
        return response.json()["access_token"]

    def test_search_similar(self, auth_token):
        """Тест поиска похожих требований"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        response = client.get("/api/rag/search?q=аутентификация", headers=headers)
        
        assert response.status_code == 200
        data = response.json()
        assert "results" in data or isinstance(data, list)

    def test_search_with_filters(self, auth_token):
        """Тест поиска с фильтрами"""
        headers = {"Authorization": f"Bearer {auth_token}"}
        
        params = {"q": "требование", "threshold": 0.7, "limit": 5}
        response = client.get("/api/rag/search", params=params, headers=headers)
        
        assert response.status_code == 200

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
