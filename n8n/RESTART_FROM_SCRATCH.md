# Полный сброс и развёртывание n8n с нуля

После `docker compose down -v` всё состояние теряется. Чтобы pipeline ожил без ручных шагов в UI — есть `bootstrap.sh`.

## Команды

```bash
cd n8n
docker compose down -v        # удалит postgres_data, qdrant_data, n8n_data
./bootstrap.sh                # генерирует credentials + up + activate + publish + smoke-тест
```

В конце должно вывести:
```
GET /webhook/files/history (no auth)     → 401
GET /webhook/files/history (architect)   → 200
POST /webhook/auth/login             → 200
✓ pipeline жив
```

## Что bootstrap.sh делает

1. **Генерит `credentials/docs-postgres-cred.json`** — шифрует Postgres-credential ключом `N8N_ENCRYPTION_KEY` из `compose.yaml` (одноразово, при первом запуске; если файл уже есть — пропускает).
2. **`docker compose up -d`** — поднимает postgres → qdrant + qdrant-init → n8n-import-credentials → n8n-import → n8n.
3. **Publish + activate** — `n8n publish:workflow` для всех 10 workflow'ов + SQL `UPDATE workflow_entity SET active=true`.
4. **Restart n8n** — нужен, чтобы зарегистрировались webhooks (после publish/UPDATE n8n должен подхватить).
5. **Smoke-тест** — проверяет 401/200 на `/webhook/files/history` и `/webhook/auth/login`.

## Зависимости автоматики

| Файл | Назначение | Когда нужен |
|---|---|---|
| `compose.yaml`                          | Сервисы + пин `N8N_ENCRYPTION_KEY`        | Всегда |
| `sql/00_create_docs_db.sh` + `schema.sql`| Создание БД `docs` + seed 4 юзеров         | На первом старте postgres |
| `credentials/docs-postgres-cred.json`    | Зашифрованный Postgres-credential         | Генерится bootstrap.sh при первом запуске; коммит в репо опционален |
| `workflows/*.json`                      | Все 14 n8n-воркфлоу, ссылка на `docs-postgres-cred` | Импортируются n8n-import |
| `bootstrap.sh`                          | Оркестрация выше                          | Запускается вручную после `compose down -v` |

## Что в compose делается само

- **postgres init** — `00_create_docs_db.sh` создаёт БД `docs`, накатывает `schema.sql`, сидит `users` (`architect`/`analyst`/`admin`/`devops`, пароль `admin`).
- **qdrant-init** — `PUT /collections/docs_chunks` (размерность 384 под `paraphrase-multilingual-MiniLM-L12-v2`). Идемпотентно: если коллекция уже есть, Qdrant вернёт ошибку, мы её игнорируем.
- **n8n-import-credentials** — импортирует все JSON из `credentials/` в `credentials_entity` (с расшифровкой ключом из env).
- **n8n-import** — импортирует все JSON из `workflows/`. Зависит от credentials-импорта (workflow'ы ссылаются на `docs-postgres-cred`).
- **n8n** — стартует с пином `N8N_ENCRYPTION_KEY`, видит уже импортированные credentials и workflow'ы.

## Что НЕ автоматизировано (и почему)

1. **Owner-юзер n8n UI.** При первом заходе на http://localhost:5678 будет экран Setup Owner. Создаётся вручную, один раз на машину. Webhook'и работают и без него.
2. **Ollama / LLM** — если `ACTIVE_MODEL=llama3`, нужен `ollama serve` на хосте с моделью `qwen3:8b`. n8n стучится на `http://host.docker.internal:11434/v1` через `extra_hosts`. (Embeddings больше не нужно поднимать руками — собственный сервис `embeddings` есть в `compose.yaml`.)
3. **uploads/binary data** — пользовательские загрузки, хранятся в n8n_data (бинарь) + Qdrant + jobs/graphs (Postgres). После `down -v` все загрузки уйдут.

## Если что-то пошло не так

- **n8n не стартует, "Mismatching encryption keys"** — значит `N8N_ENCRYPTION_KEY` в compose.yaml не совпадает с тем, что лежит в volume `n8n_data` (файл `/home/node/.n8n/config`). Решение: `docker compose down -v` или вручную править `config` через one-shot контейнер:
  ```
  docker run --rm -v docs-n8n_n8n_data:/data alpine \
    sh -c 'echo {\"encryptionKey\":\"<your-key>\"} > /data/config'
  ```
- **workflow'ы помечены "Credentials missing"** — `credentials/docs-postgres-cred.json` не успел импортироваться. Проверить `docker logs docs-n8n-import-credentials` и SELECT из `credentials_entity`.
- **webhook возвращает 200 с пустым body** — workflow не активен или sub-workflow не опубликован. Перепрогнать bootstrap.sh.
- **/webhook/auth/login возвращает 401 на architect/admin** — таблица `users` пуста, postgres init-скрипт не отработал. Это случается, если `postgres_data` volume остался от старой схемы. `docker compose down -v` решает.

## Сменить ключ шифрования

Если нужно поменять `N8N_ENCRYPTION_KEY`:
1. Поменять в `compose.yaml`.
2. Удалить `credentials/docs-postgres-cred.json` (старый шифр).
3. `docker compose down -v && ./bootstrap.sh` — credential перегенерится с новым ключом.

## Известные грабли (memory)

- `feedback_n8n_subworkflow_auth.md` — typeVersion триггера, publish, alwaysOutputData в If, number-сравнение для `_http_code`.
- `feedback_n8n_query_replacement.md` — `queryReplacement` ненадёжен для JSON.
- `feedback_n8n_binary_mode.md` — `N8N_DEFAULT_BINARY_DATA_MODE=default` обязателен.
