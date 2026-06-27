"""
Тесты wf_api_login + auth-цепочки на defended-эндпоинтах.

Покрывает шаги 1a/1b/1c из исходного e2e.sh.
"""
from __future__ import annotations

import pytest
import requests

from conftest import HTTP_TIMEOUT, PASSWORD, USERNAME


@pytest.mark.smoke
def test_login_with_bad_credentials_returns_401(base_url: str) -> None:
    r = requests.post(
        f"{base_url}/webhook/auth/login",
        json={"username": "nobody", "password": "wrong"},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 401, f"ожидался 401, получили {r.status_code}: {r.text[:200]}"


@pytest.mark.smoke
def test_login_with_valid_credentials_returns_token(base_url: str) -> None:
    r = requests.post(
        f"{base_url}/webhook/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 200, r.text[:400]
    body = r.json()
    assert body.get("access_token"), f"нет access_token: {body!r}"
    assert body.get("role"), f"нет role: {body!r}"


@pytest.mark.smoke
def test_files_history_without_auth_returns_401(base_url: str) -> None:
    r = requests.get(f"{base_url}/webhook/files/history", timeout=HTTP_TIMEOUT)
    assert r.status_code == 401, f"ожидался 401, получили {r.status_code}: {r.text[:200]}"
