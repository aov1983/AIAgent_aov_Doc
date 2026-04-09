"""
Модуль интеграции с AI моделями.

Поддерживаемые модели:
1. GPT-4 (OpenAI)
2. Claude 3 (Anthropic)
3. Gemini Pro (Google)
4. Llama 3 (через OpenAI-compatible API)
"""

from enum import Enum
from typing import Optional, Dict, Any, List
from abc import ABC, abstractmethod
import os


class ModelProvider(Enum):
    """Провайдеры AI моделей."""
    OPENAI_GPT4 = "openai_gpt4"
    ANTHROPIC_CLAUDE3 = "anthropic_claude3"
    GOOGLE_GEMINI = "google_gemini"
    LLAMA3 = "llama3"


class ModelConfig:
    """Конфигурация AI модели."""
    
    def __init__(
        self,
        provider: ModelProvider,
        api_key: str,
        base_url: Optional[str] = None,
        model_name: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        timeout: int = 60,
    ):
        self.provider = provider
        self.api_key = api_key
        self.base_url = base_url or self._get_default_base_url(provider)
        self.model_name = model_name or self._get_default_model_name(provider)
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
    
    @staticmethod
    def _get_default_base_url(provider: ModelProvider) -> str:
        urls = {
            ModelProvider.OPENAI_GPT4: "https://api.openai.com/v1",
            ModelProvider.ANTHROPIC_CLAUDE3: "https://api.anthropic.com",
            ModelProvider.GOOGLE_GEMINI: "https://generativelanguage.googleapis.com",
            ModelProvider.LLAMA3: "http://localhost:8000/v1",  # Внутренний сервер
        }
        return urls.get(provider, "")
    
    @staticmethod
    def _get_default_model_name(provider: ModelProvider) -> str:
        models = {
            ModelProvider.OPENAI_GPT4: "gpt-4-turbo-preview",
            ModelProvider.ANTHROPIC_CLAUDE3: "claude-3-sonnet-20240229",
            ModelProvider.GOOGLE_GEMINI: "gemini-pro",
            ModelProvider.LLAMA3: "llama-3-70b-instruct",
        }
        return models.get(provider, "")


class BaseModelClient(ABC):
    """Абстрактный базовый класс для клиентов AI моделей."""
    
    @abstractmethod
    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Генерация ответа от модели."""
        pass
    
    @abstractmethod
    def generate_structured(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Генерация структурированного ответа от модели."""
        pass


class OpenAIClient(BaseModelClient):
    """Клиент для OpenAI GPT-4."""
    
    def __init__(self, config: ModelConfig):
        self.config = config
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=self.config.api_key,
                    base_url=self.config.base_url,
                    timeout=self.config.timeout
                )
            except ImportError:
                raise ImportError("Установите openai: pip install openai")
        return self._client
    
    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = self.client.chat.completions.create(
            model=self.config.model_name,
            messages=messages,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens
        )
        return response.choices[0].message.content
    
    def generate_structured(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict] = None
    ) -> Dict[str, Any]:
        import json
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = self.client.chat.completions.create(
            model=self.config.model_name,
            messages=messages,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            response_format=response_format or {"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        return json.loads(content)


class AnthropicClient(BaseModelClient):
    """Клиент для Anthropic Claude 3."""
    
    def __init__(self, config: ModelConfig):
        self.config = config
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            try:
                from anthropic import Anthropic
                self._client = Anthropic(
                    api_key=self.config.api_key,
                    timeout=self.config.timeout
                )
            except ImportError:
                raise ImportError("Установите anthropic: pip install anthropic")
        return self._client
    
    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        response = self.client.messages.create(
            model=self.config.model_name,
            max_tokens=self.config.max_tokens,
            system=system_prompt or "",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    
    def generate_structured(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict] = None
    ) -> Dict[str, Any]:
        import json
        
        full_prompt = f"{prompt}\n\nОтветьте в формате JSON."
        response = self.client.messages.create(
            model=self.config.model_name,
            max_tokens=self.config.max_tokens,
            system=system_prompt or "",
            messages=[{"role": "user", "content": full_prompt}]
        )
        
        content = response.content[0].text
        return json.loads(content)


class GoogleGeminiClient(BaseModelClient):
    """Клиент для Google Gemini Pro."""
    
    def __init__(self, config: ModelConfig):
        self.config = config
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.config.api_key)
                self._client = genai.GenerativeModel(self.config.model_name)
            except ImportError:
                raise ImportError("Установите google-generativeai: pip install google-generativeai")
        return self._client
    
    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        full_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt
        response = self.client.generate_content(full_prompt)
        return response.text
    
    def generate_structured(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict] = None
    ) -> Dict[str, Any]:
        import json
        
        full_prompt = f"{system_prompt}\n\n{prompt}\n\nОтветьте в формате JSON." if system_prompt else f"{prompt}\n\nОтветьте в формате JSON."
        response = self.client.generate_content(full_prompt)
        return json.loads(response.text)


class LlamaClient(BaseModelClient):
    """Клиент для Llama 3 (через OpenAI-compatible API)."""
    
    def __init__(self, config: ModelConfig):
        self.config = config
        self._client = None
    
    @property
    def client(self):
        if self._client is None:
            try:
                from openai import OpenAI
                self._client = OpenAI(
                    api_key=self.config.api_key or "not-needed",
                    base_url=self.config.base_url,
                    timeout=self.config.timeout
                )
            except ImportError:
                raise ImportError("Установите openai: pip install openai")
        return self._client
    
    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = self.client.chat.completions.create(
            model=self.config.model_name,
            messages=messages,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens
        )
        return response.choices[0].message.content
    
    def generate_structured(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        response_format: Optional[Dict] = None
    ) -> Dict[str, Any]:
        import json
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        response = self.client.chat.completions.create(
            model=self.config.model_name,
            messages=messages,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens
        )
        
        content = response.choices[0].message.content
        return json.loads(content)


def get_model_client(config: ModelConfig) -> BaseModelClient:
    """Фабричный метод для получения клиента модели."""
    clients = {
        ModelProvider.OPENAI_GPT4: OpenAIClient,
        ModelProvider.ANTHROPIC_CLAUDE3: AnthropicClient,
        ModelProvider.GOOGLE_GEMINI: GoogleGeminiClient,
        ModelProvider.LLAMA3: LlamaClient,
    }
    
    client_class = clients.get(config.provider)
    if not client_class:
        raise ValueError(f"Неизвестный провайдер: {config.provider}")
    
    return client_class(config)
