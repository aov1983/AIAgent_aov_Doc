"""
UNIT Тесты для модуля декомпозиции (Decomposer)
"""
import pytest
from agent.decomposer import TextDecomposer

class TestTextDecomposer:
    @pytest.fixture
    def decomposer(self):
        return TextDecomposer()

    def test_decompose_simple_text(self, decomposer):
        """Тест декомпозиции простого текста на абзацы"""
        text = """
# Глава 1. Введение
Это первый абзац введения.

## 1.1 Подраздел
Это текст подраздела. Он содержит важное требование.
"""
        result = decomposer.decompose(text)
        
        assert result is not None
        assert len(result) > 0
        # Проверка наличия иерархии
        assert any(item['type'] == 'chapter' for item in result)
        assert any(item['type'] == 'section' for item in result)
        assert any(item['type'] == 'paragraph' for item in result)

    def test_extract_atoms(self, decomposer):
        """Тест экстракции атомарных требований"""
        paragraph = "Система должна поддерживать аутентификацию пользователей через LDAP."
        
        atoms = decomposer.extract_atoms(paragraph)
        
        assert atoms is not None
        assert len(atoms) > 0
        atom = atoms[0]
        assert 'fact' in atom or 'observation' in atom
        # Проверяем наличие структуры атома
        assert isinstance(atom, dict)

    def test_empty_text_decomposition(self, decomposer):
        """Тест обработки пустого текста"""
        result = decomposer.decompose("")
        assert result == []

    def test_hierarchy_building(self, decomposer):
        """Тест построения иерархии (Глава -> Раздел -> Абзац)"""
        text = """
# Глава 1
Текст главы.

## Раздел 1.1
Текст раздела.

Абзац без заголовка.
"""
        result = decomposer.decompose(text)
        
        # Проверка вложенности
        chapters = [i for i in result if i['type'] == 'chapter']
        assert len(chapters) > 0
        
        chapter = chapters[0]
        assert 'children' in chapter or 'sections' in chapter

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
