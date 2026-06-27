// Живой деплой ОДНОГО workflow через REST API n8n — без `import:workflow` и без рестарта n8n.
//
// Зачем отдельно от bootstrap.sh: когда в n8n уже идёт долгая обработка (например, разбор крупного
// документа), полный re-import + restart её убьёт. REST create/update + activate регистрирует
// webhook вживую и не трогает выполняющиеся задачи (см. activate_workflows.mjs: рестарт НЕ нужен).
//
// Идемпотентность: ищем workflow по имени — если есть, обновляем (PATCH), иначе создаём (POST).
// Затем активируем через POST /rest/workflows/:id/activate { versionId }.
//
// Запуск (с хоста, n8n проброшен на localhost:5678):
//   N8N_URL=http://localhost:5678 N8N_OWNER_EMAIL=... N8N_OWNER_PASSWORD=... \
//     node deploy_workflow_live.mjs workflows/wf_document_delete.json

import { readFileSync } from 'node:fs';

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const EMAIL = process.env.N8N_OWNER_EMAIL;
const PASSWORD = process.env.N8N_OWNER_PASSWORD;
const FILE = process.argv[2];

if (!EMAIL || !PASSWORD) { console.error('N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD must be set'); process.exit(1); }
if (!FILE) { console.error('usage: node deploy_workflow_live.mjs <workflow.json>'); process.exit(1); }

let cookie = '';
const req = async (path, init = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(N8N_URL + path, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) { const m = setCookie.match(/(n8n-auth=[^;]+)/); if (m) cookie = m[1]; }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`);
  return json;
};
const unwrap = (r) => (r && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r);

const main = async () => {
  const wf = JSON.parse(readFileSync(FILE, 'utf8'));
  const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings || {} };

  await req('/rest/login', { method: 'POST', body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }) });
  console.log('login OK');

  const list = unwrap(await req('/rest/workflows?take=200&skip=0'));
  const rows = list.data || list;
  const existing = rows.find((w) => w.name === wf.name);

  let id;
  if (existing) {
    id = existing.id;
    await req(`/rest/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    console.log(`updated existing workflow ${wf.name} (id=${id})`);
  } else {
    // Передаём id из файла: тогда будущий штатный `import:workflow` сделает upsert по этому id,
    // а не создаст дубль с тем же webhook-путём. Если n8n проигнорит id — будет свой, не критично.
    const created = unwrap(await req('/rest/workflows', { method: 'POST', body: JSON.stringify(wf.id ? { id: wf.id, ...body } : body) }));
    id = created.id;
    console.log(`created workflow ${wf.name} (id=${id})`);
  }

  // versionId обязателен для /activate — берём актуальный после create/update.
  const full = unwrap(await req(`/rest/workflows/${id}`));
  await req(`/rest/workflows/${id}/activate`, { method: 'POST', body: JSON.stringify({ versionId: full.versionId }) });
  console.log(`activated ${wf.name} (id=${id}) — webhook зарегистрирован вживую, рестарт не нужен`);
};

main().catch((e) => { console.error(e.stack || e.message || String(e)); process.exit(1); });
