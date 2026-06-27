# Бэкап и восстановление состояния

Логический бэкап n8n-стека: позволяет полностью сбросить систему (`docker compose down -v`),
пересоздать её и накатить состояние обратно.

## TL;DR

```bash
cd n8n
./backup.sh                       # снять бэкап → n8n/backups/<timestamp>/
./restore.sh latest --verify      # ПРОВЕРИТЬ восстановимость, НЕ трогая прод
./restore.sh latest               # ПОЛНОЕ восстановление (down -v + накат), спросит 'yes'
```

## Что входит в бэкап

Каждый бэкап — это каталог `n8n/backups/<YYYYMMDD-HHMMSS>[_label]/` с тремя файлами:

| Файл | Что | Источник |
|---|---|---|
| `postgres-n8n.dump` | Дамп БД `n8n` в custom-формате pg_dump | вся БД, **кроме данных истории прогонов** |
| `qdrant-docs_chunks.snapshot` | Snapshot векторной коллекции | Qdrant snapshot API |
| `manifest.json` | Версии образов, git-commit, checksums, counts для сверки | — |

**Постгрес-дамп содержит почти всё прикладное состояние**, потому что после миграции на n8n
Data Tables оно лежит в одной БД `n8n`:
- системные таблицы n8n: `workflow_entity` (включая live-патчи), `credentials_entity`
  (зашифрованы фиксированным `N8N_ENCRYPTION_KEY`), owner/user/project, `settings`, `webhook_entity`;
- прикладные Data Tables (физические `data_table_user_*`): `users / uploads / jobs / graphs /
  job_status / job_chunks / job_files / config` — **в `job_files.file_b64` лежат сами загруженные
  docx в base64**.

**Не входит** (сознательно):
- `execution_*` / `insights_*` — история прогонов n8n (1.9 ГБ из 2 ГБ БД, раздута инлайном бинаря).
  Схема таблиц сохраняется, строки — нет. После restore вкладка Executions в UI будет пустой;
  на прикладные данные (документы, графы, реестр) это не влияет.
- `n8n_data` volume — при `N8N_DEFAULT_BINARY_DATA_MODE=default` бинарь инлайнится в Postgres,
  а ключ шифрования регенерируется из env. Уникального состояния там нет.

## Авто-restore при bootstrap (свежий стек)

`bootstrap.sh` умеет наливать состояние из бэкапа сам. Если стек поднимается **с нуля**
(нет тома `docs-n8n_postgres_data` — данных ещё нет) **и** в `backups/` есть бэкап, bootstrap
делегирует в `restore.sh latest --yes --no-safety-backup` вместо чистого импорта воркфлоу из
файлов. То есть после полного сброса достаточно одной команды:

```bash
cd n8n && ./bootstrap.sh     # свежий том + есть бэкап → восстановит данные из бэкапа
```

- Детект свежести идёт по **тому**, а не по контейнерам: `docker compose down` (без `-v`)
  убирает контейнеры, но данные в томе остаются — bootstrap их **не** затирает.
- Если том данных уже существует (данные на месте) — авто-restore **пропускается**, bootstrap
  идёт обычным путём. Восстановить поверх существующих данных можно только вручную: `./restore.sh latest`.
- Отключить авто-restore (получить чистый стек даже при наличии бэкапа):
  ```bash
  BOOTSTRAP_RESTORE=off ./bootstrap.sh
  ```

## Восстановление

`restore.sh` принимает имя папки внутри `backups/`, абсолютный путь, или `latest`.

### Безопасная проверка (рекомендуется перед боевым restore)

```bash
./restore.sh latest --verify
```
Разворачивает дамп во **временную** БД `n8n_verify_<pid>` и snapshot в коллекцию-двойник,
сверяет counts с `manifest.json`, прибирает за собой. **Прод не трогает.** Доказывает, что
бэкап восстановим.

### Полное восстановление (деструктивно)

```bash
./restore.sh latest            # спросит подтверждение 'yes'
./restore.sh latest --yes      # без вопроса
```
Последовательность:
1. **safety-backup** текущего состояния (метка `pre-restore`; отключается `--no-safety-backup`);
2. `docker compose down -v` — сносит `postgres_data`, `qdrant_data`, `n8n_data`;
3. поднимает только `postgres` + `qdrant`, ждёт health;
4. `pg_restore` дампа (атомарно, `--single-transaction`);
5. Qdrant `recover` из snapshot (fallback — multipart upload);
6. поднимает рантайм (`embeddings`, `docling`, `n8n`) **без** init-сервисов import/activate;
7. `publish:workflow` всех воркфлоу **из восстановленной БД** + restart + smoke-тест (401/200/200).

Перед накатом сверяется версия n8n из манифеста с `compose.yaml` (несовпадение → abort: риск
TypeORM-миграций) и версия Qdrant (несовпадение → предупреждение: snapshot версионно-чувствителен).

## Ограничения

- **Версионная привязка.** Restore рассчитан на ту же версию n8n (`2.22.2`) и тот же мажор Qdrant.
  Поэтому Qdrant запинён в `compose.yaml` (`qdrant/qdrant:1.17.1`). Версии хранятся в манифесте.
- **Нет истории прогонов** (см. выше).
- **`restore.sh` ≠ обычный путь `bootstrap.sh`.** Обычным путём `bootstrap.sh` импортирует воркфлоу
  **из файлов** `workflows/*.json`. `restore.sh` восстанавливает авторитетное состояние **из дампа БД**
  (с live-патчами). Авто-restore при bootstrap срабатывает только на **свежем** томе; если том данных
  уже есть (например, сразу после restore), повторный `bootstrap.sh` пойдёт обычным путём и его
  `n8n-import` **откатит live-патченные воркфлоу к файловым версиям**. Поэтому **после restore не
  запускайте `bootstrap.sh` на том же томе** — данные уже на месте, повторный bootstrap не нужен.

## Если smoke после restore не прошёл

- `401` отдаёт всё подряд / `200` не приходит на architect → webhook'и не зарегистрировались.
  Ремонт (НЕ `n8n-import`!):
  ```bash
  docker compose -f compose.yaml up n8n-activate
  ```
- Логи: `docker logs docs-n8n`.

## Переменные окружения (необязательно)

Скрипты читают дефолты из имён контейнеров текущего compose. Переопределяются env'ом:
`PG_CONTAINER`, `QDRANT_CONTAINER`, `N8N_CONTAINER`, `QDRANT_URL`, `N8N_URL`,
`QDRANT_COLLECTION_NAME`, `PG_USER`, `PG_DB`.
