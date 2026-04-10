"""
UNIT Тесты для модуля парсинга документов (Parser)
"""
import pytest
import os
from agent.parser import DocumentParser

class TestDocumentParser:
    @pytest.fixture
    def parser(self):
        return DocumentParser()

    def test_parse_txt_file(self, parser, tmp_path):
        """Тест парсинга простого текстового файла"""
        test_file = tmp_path / "test.txt"
        test_content = "Это тестовый документ.\nВторая строка."
        test_file.write_text(test_content, encoding='utf-8')
        
        result = parser.parse(str(test_file))
        
        assert result is not None
        assert "Это тестовый документ." in result['content']
        assert result['metadata']['filename'] == "test.txt"
        assert result['metadata']['type'] == "text"

    def test_parse_empty_file(self, parser, tmp_path):
        """Тест обработки пустого файла"""
        test_file = tmp_path / "empty.txt"
        test_file.write_text("", encoding='utf-8')
        
        result = parser.parse(str(test_file))
        
        assert result is not None
        assert result['content'] == ""
        assert result['metadata']['size'] == 0

    def test_parse_nonexistent_file(self, parser):
        """Тест обработки несуществующего файла"""
        with pytest.raises(FileNotFoundError):
            parser.parse("/nonexistent/path/file.txt")

    def test_extract_metadata(self, parser, tmp_path):
        """Тест извлечения метаданных"""
        test_file = tmp_path / "meta_test.docx"
        # Эмуляция создания файла
        test_file.touch()
        
        # В реальном сценарии здесь был бы DOCX файл
        # Проверяем базовую логику метаданных
        metadata = parser._extract_metadata(str(test_file))
        
        assert metadata['filename'] == "meta_test.docx"
        assert 'path' in metadata
        assert 'size' in metadata

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
