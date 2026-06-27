// Идемпотентный bootstrap для прикладных Data Tables вместо sql/schema.sql.
// Запускается контейнером n8n-data-table-init (см. compose.yaml).
//
// Делает:
//   1) login → cookie
//   2) GET /rest/projects/personal → projectId
//   3) GET /rest/projects/:id/data-tables → имена → id
//   4) Для каждой из 4 таблиц: создать, если нет.
//   5) Для каждого из 4 demo-пользователей: upsert в таблицу users.
//   6) Печатает на stdout JSON-map `{ users:<id>, uploads:<id>, jobs:<id>, graphs:<id> }`
//      — workflow-ы ссылаются на таблицы по имени, так что этот вывод нужен только для логов.
//
// Контракт env-переменных (см. compose.yaml::n8n-data-table-init):
//   N8N_URL                  — например http://n8n:5678
//   N8N_OWNER_EMAIL          — kirill.vlasov@develonica.ru
//   N8N_OWNER_PASSWORD       — Admin123
//   APP_DEMO_USERS_JSON      — JSON-строка [{username,password,role}, ...]

const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';
const EMAIL = process.env.N8N_OWNER_EMAIL;
const PASSWORD = process.env.N8N_OWNER_PASSWORD;
const DEMO_USERS = JSON.parse(process.env.APP_DEMO_USERS_JSON || '[]');

if (!EMAIL || !PASSWORD) {
  console.error('N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD must be set');
  process.exit(1);
}

// Cookie jar — n8n auth работает через cookie `n8n-auth`.
let cookie = '';

const req = async (path, init = {}) => {
  const url = N8N_URL + path;
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/(n8n-auth=[^;]+)/);
    if (m) cookie = m[1];
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 500)}`);
  }
  return json;
};

// n8n REST в 2.x оборачивает payload-объекты как { data: ... }
const unwrap = (r) => (r && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r);

const login = async () => {
  await req('/rest/login', {
    method: 'POST',
    body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }),
  });
};

const getPersonalProjectId = async () => {
  const r = unwrap(await req('/rest/projects/personal'));
  return r.id;
};

const listDataTables = async (projectId) => {
  const r = unwrap(await req(`/rest/projects/${projectId}/data-tables?take=200&skip=0`));
  // По коду контроллера это `{ count, data: [...] }`.
  const rows = r.data || r;
  const out = {};
  for (const dt of rows) out[dt.name] = dt.id;
  return out;
};

const createDataTable = async (projectId, name, columns) => {
  const r = unwrap(await req(`/rest/projects/${projectId}/data-tables`, {
    method: 'POST',
    body: JSON.stringify({ name, columns }),
  }));
  return r.id;
};

// Идемпотентно добавляет недостающие колонки в СУЩЕСТВУЮЩУЮ таблицу — чтобы расширение
// схемы (напр. graphs.status/job_id) не требовало `docker compose down -v`. Best-effort:
// REST-эндпоинт columns может отличаться между минорными версиями n8n, поэтому ошибки лишь
// логируем (свежесозданная таблица и так получит все колонки из TABLES при создании).
const listColumns = async (projectId, tableId) => {
  try {
    const r = unwrap(await req(`/rest/projects/${projectId}/data-tables/${tableId}/columns`));
    const rows = Array.isArray(r) ? r : (r && r.data) || [];
    return rows.map((c) => c.name);
  } catch (e) {
    console.log(`  (listColumns ${tableId} failed: ${String(e.message || e).slice(0, 120)})`);
    return null; // null = не смогли узнать — не рискуем добавлять вслепую
  }
};

const addColumn = async (projectId, tableId, col) => {
  await req(`/rest/projects/${projectId}/data-tables/${tableId}/columns`, {
    method: 'POST',
    body: JSON.stringify({ name: col.name, type: col.type }),
  });
};

const syncColumns = async (projectId, name, tableId, wantColumns) => {
  const existing = await listColumns(projectId, tableId);
  if (existing === null) return;
  for (const col of wantColumns) {
    if (existing.includes(col.name)) continue;
    try {
      await addColumn(projectId, tableId, col);
      console.log(`  + ${name}.${col.name} (${col.type}) — добавлена недостающая колонка`);
    } catch (e) {
      console.log(`  (addColumn ${name}.${col.name} failed: ${String(e.message || e).slice(0, 120)})`);
    }
  }
};

const upsertRow = async (projectId, tableId, filter, data) => {
  await req(`/rest/projects/${projectId}/data-tables/${tableId}/upsert`, {
    method: 'POST',
    body: JSON.stringify({
      filter: { type: 'and', filters: filter },
      data,
      returnData: false,
      dryRun: false,
    }),
  });
};

const TABLES = {
  // username — лучше первой колонкой, чтоб удобно фильтровалось в UI.
  users: [
    { name: 'username', type: 'string' },
    { name: 'password', type: 'string' },
    { name: 'role', type: 'string' },
  ],
  uploads: [
    // ВАЖНО: `id` — зарезервированное системное имя в Data Tables (auto-number).
    // Поэтому исходный uploads.id (UUID документа) храним как upload_id.
    { name: 'upload_id', type: 'string' },
    { name: 'filename', type: 'string' },
    { name: 'storage_key', type: 'string' },
    { name: 'uploaded_by', type: 'string' },
    { name: 'uploaded_at', type: 'date' },
    { name: 'status', type: 'string' },
  ],
  jobs: [
    { name: 'job_id', type: 'string' },
    { name: 'document_id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'report', type: 'string' },
    { name: 'total_requirements', type: 'number' },
    { name: 'errors_json', type: 'string' },
    { name: 'warnings_json', type: 'string' },
    { name: 'payload_json', type: 'string' },
    { name: 'created_at', type: 'date' },
  ],
  graphs: [
    { name: 'document_id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'filename', type: 'string' },
    { name: 'total_requirements', type: 'number' },
    { name: 'graph_json', type: 'string' },
    { name: 'paragraphs_json', type: 'string' },
    { name: 'saved_at', type: 'date' },
    // Документ появляется в Истории СРАЗУ (нода [upload] Persist Graph Pending) со
    // status='processing' и пустым graph_json; в конце Persist Graph перезаписывает на
    // status='completed'. job_id нужен фронту для поллинга /jobs/status и кнопки «Возобновить».
    { name: 'status', type: 'string' },
    { name: 'job_id', type: 'string' },
    // Имя LLM-модели, которой обработан документ (для тэга в Истории): qwen3:8b | claude-haiku-4-5 | …
    { name: 'model', type: 'string' },
    // Привязка документа к «Проекту» (M:1): project_id из таблицы projects, пусто = вне проекта.
    // Заполняется через POST /projects/assign (wf_api_projects), отвязка = пустая строка.
    { name: 'project_id', type: 'string' },
  ],
  // Прогресс обработки /upload по этапам. job_id приходит с фронта (он его генерит),
  // обработка по ходу upsert'ит сюда stage+percent, фронт поллит GET /jobs/status.
  job_status: [
    { name: 'job_id', type: 'string' },
    { name: 'stage', type: 'string' },
    { name: 'percent', type: 'number' },
    { name: 'updated_at', type: 'date' },
  ],
  // Чекпойнт выходов LLM по чанкам — чтобы дорогие (10-20 мин) результаты не терялись при
  // падении n8n. [upload] Merge Chunks сохраняет сюда сырой ответ Ollama после каждого готового
  // чанка (через wf_job_store /chunk-save) и при возобновлении пропускает уже готовые (/chunk-list).
  job_chunks: [
    { name: 'job_id', type: 'string' },
    { name: 'chunk_index', type: 'number' },
    { name: 'output', type: 'string' },
    { name: 'updated_at', type: 'date' },
  ],
  // Сам загруженный файл в base64 — чтобы возобновить обработку без участия клиента (после
  // перезагрузки браузера File потерян). wf_resume читает строку по job_id и повторно POST'ит
  // файл на /upload с тем же job_id/document_id — pipeline доделывает только недостающие чанки.
  job_files: [
    { name: 'job_id', type: 'string' },
    { name: 'document_id', type: 'string' },
    { name: 'filename', type: 'string' },
    { name: 'mime', type: 'string' },
    { name: 'file_b64', type: 'string' },
    { name: 'uploaded_by', type: 'string' },
    { name: 'created_at', type: 'date' },
  ],
  // «Проекты» — объект, группирующий обработанные документы (см. wf_api_projects). Связь
  // проект↔документ хранится в graphs.project_id (M:1). Сама таблица projects — только метаданные
  // проекта. `id` зарезервирован Data Tables (auto-number) → собственный ключ зовём project_id.
  projects: [
    { name: 'project_id', type: 'string' },
    { name: 'name', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'created_at', type: 'date' },
    // Кто создал — для аудита/будущей приватности. Сейчас проекты общие (без фильтрации по владельцу).
    { name: 'created_by', type: 'string' },
  ],
  // Рантайм-конфиг приложения (key/value-строки). Сейчас: провайдер LLM-экстракции —
  // тумблер ollama|claude|develonica|lmstudio БЕЗ рестарта (читается напрямую нодами dataTable:
  // [upload] Docling Config, [chat] Get LLM Config, [gen] Get LLM Config — без self-HTTP).
  config: [
    { name: 'key', type: 'string' },
    { name: 'provider', type: 'string' },
    { name: 'model', type: 'string' },
    { name: 'conc', type: 'number' },
    // api_key — секрет активного провайдера для LLM-нод. Канал в обход $env:
    // на «чужих» стендах с N8N_BLOCK_ENV_ACCESS_IN_NODE=true обращение к $env валит ноду,
    // а dataTable читается без $env. syncColumns дольёт колонку в существующую таблицу.
    { name: 'api_key', type: 'string' },
    // base_url — адрес LLM активного провайдера (develonica/lmstudio) для обхода $env. Стенд
    // указывает свой контур (напр. https://ai-test.develonica.group); пусто → in-code прод-дефолт.
    { name: 'base_url', type: 'string' },
    // docling_url — адрес сервиса Docling (конвертация pdf/docx → markdown) для обхода $env.
    // Хранится на строке llm_extraction; читаётся напрямую нодой dataTable [upload] Docling Config.
    // Можно указать полный URL (…/v1/convert/file) или только хост (путь допишется). Пусто → localhost-дефолт.
    { name: 'docling_url', type: 'string' },
  ],
};

const main = async () => {
  await login();
  console.log('login OK');
  const projectId = await getPersonalProjectId();
  console.log('personalProject', projectId);

  const existing = await listDataTables(projectId);
  console.log('existing data tables:', Object.keys(existing));

  const ids = {};
  for (const [name, columns] of Object.entries(TABLES)) {
    if (existing[name]) {
      ids[name] = existing[name];
      console.log(`= ${name} (exists, id=${existing[name]})`);
      // Существующая таблица могла быть создана по старой схеме — дольём недостающие колонки.
      await syncColumns(projectId, name, ids[name], columns);
    } else {
      ids[name] = await createDataTable(projectId, name, columns);
      console.log(`+ ${name} (created, id=${ids[name]})`);
    }
  }

  // Seed users (idempotent through upsert).
  for (const u of DEMO_USERS) {
    if (!u.username) continue;
    await upsertRow(
      projectId,
      ids.users,
      [{ columnName: 'username', condition: 'eq', value: u.username }],
      { username: u.username, password: u.password || '', role: u.role || '' },
    );
    console.log(`upsert user ${u.username} (${u.role})`);
  }

  // Seed config (insert-if-absent — чтобы повторный bootstrap НЕ затирал тумблер провайдера).
  try {
    const filter = encodeURIComponent(JSON.stringify({ type: 'and', filters: [{ columnName: 'key', condition: 'eq', value: 'llm_extraction' }] }));
    const cur = unwrap(await req(`/rest/projects/${projectId}/data-tables/${ids.config}/rows?filter=${filter}&take=1&skip=0`));
    const count = (cur && cur.count !== undefined) ? cur.count : (cur && cur.data ? cur.data.length : 0);
    if (!count) {
      await upsertRow(projectId, ids.config, [{ columnName: 'key', condition: 'eq', value: 'llm_extraction' }], { key: 'llm_extraction', provider: 'ollama', model: 'claude-haiku-4-5', conc: 3, docling_url: 'http://docling:5001/v1/convert/file' });
      console.log('seed config llm_extraction=ollama (default)');
    } else {
      console.log('config llm_extraction already set — keep');
    }
  } catch (e) { console.log('config seed skipped: ' + String(e.message || e).slice(0, 120)); }

  // Seed config rag_backend (insert-if-absent). Тумблер бэкенда RAG для wf_rag (search+upsert):
  //   provider='local'      → локальный стек: Qdrant docs_chunks + эмбеддер MiniLM (всё в compose);
  //   provider='develonica' → удалённый тест-стенд: Qdrant arch-docs-rag + Cloud-bge-m3
  //                           (нужны секреты в credentials «Qdrant/Embeddings Develonica» — их в репо нет).
  // Дефолт local: рабочее «из коробки», без внешних секретов. Флип = UPDATE строки в UI n8n → со след. вызова.
  // Значение бэкенда кладём в колонку provider. Для develonica адрес и ключ Qdrant (для дедупа в
  // Dedup Document Points, в обход $env) кладутся в колонки base_url/api_key ЭТОЙ ЖЕ строки rag_backend.
  try {
    const filter = encodeURIComponent(JSON.stringify({ type: 'and', filters: [{ columnName: 'key', condition: 'eq', value: 'rag_backend' }] }));
    const cur = unwrap(await req(`/rest/projects/${projectId}/data-tables/${ids.config}/rows?filter=${filter}&take=1&skip=0`));
    const count = (cur && cur.count !== undefined) ? cur.count : (cur && cur.data ? cur.data.length : 0);
    if (!count) {
      await upsertRow(projectId, ids.config, [{ columnName: 'key', condition: 'eq', value: 'rag_backend' }], { key: 'rag_backend', provider: 'local', model: '', conc: 0 });
      console.log('seed config rag_backend=local (default)');
    } else {
      console.log('config rag_backend already set — keep');
    }
  } catch (e) { console.log('rag_backend seed skipped: ' + String(e.message || e).slice(0, 120)); }

  console.log('DATA_TABLE_IDS=' + JSON.stringify(ids));
};

main().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
