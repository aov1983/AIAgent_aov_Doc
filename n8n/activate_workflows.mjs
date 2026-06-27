// Активация (publish) всех workflow-ов после импорта.
//
// Зачем: `n8n import:workflow` (сервис n8n-import) деактивирует ВСЕ workflow-ы при каждом
// запуске — даже без изменений. Без повторной активации production-webhook-и (/upload,
// /jobs/status, /set-status, /auth/login, ...) не регистрируются и приложение не работает.
//
// В n8n 2.x активация идёт через версионирование: POST /rest/workflows/:id/activate { versionId }.
// Этот вызов регистрирует триггеры/webhook-и вживую — рестарт n8n НЕ нужен.
//
// Контракт env (см. compose.yaml::n8n-activate):
//   N8N_URL             — http://n8n:5678
//   N8N_OWNER_EMAIL     — kirill.vlasov@develonica.ru
//   N8N_OWNER_PASSWORD  — Admin123

const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';
const EMAIL = process.env.N8N_OWNER_EMAIL;
const PASSWORD = process.env.N8N_OWNER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD must be set');
  process.exit(1);
}

let cookie = '';

const req = async (path, init = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(N8N_URL + path, { ...init, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const m = setCookie.match(/(n8n-auth=[^;]+)/);
    if (m) cookie = m[1];
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* not json */ }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
};

const unwrap = (r) => (r && Object.prototype.hasOwnProperty.call(r, 'data') ? r.data : r);

const login = async () => {
  await req('/rest/login', {
    method: 'POST',
    body: JSON.stringify({ emailOrLdapLoginId: EMAIL, password: PASSWORD }),
  });
};

const listWorkflows = async () => {
  const r = unwrap(await req('/rest/workflows?take=200&skip=0'));
  const rows = r.data || r;
  return rows.map((w) => ({ id: w.id, name: w.name, active: w.active }));
};

const activate = async (id) => {
  // versionId обязателен для /activate — берём текущую версию workflow.
  const wf = unwrap(await req(`/rest/workflows/${id}`));
  const versionId = wf.versionId;
  if (!versionId) throw new Error(`no versionId for ${id}`);
  await req(`/rest/workflows/${id}/activate`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
};

const main = async () => {
  await login();
  console.log('login OK');

  // Родительский workflow нельзя опубликовать, пока не опубликованы суб-workflow-ы,
  // которые он вызывает через Execute Workflow (иначе 400 "references workflow ... not published").
  // Порядок в списке произвольный, поэтому идём проходами: повторяем неудачи, пока есть прогресс.
  // Это устойчиво к любой глубине зависимостей без хардкода имён.
  let pending = await listWorkflows();
  let lastErr = '';
  for (let pass = 1; pending.length; pass++) {
    const failed = [];
    for (const w of pending) {
      try {
        await activate(w.id);
        console.log(`activated: ${w.name} (${w.id})`);
      } catch (e) {
        lastErr = e.message;
        failed.push(w);
      }
    }
    if (failed.length === pending.length) {
      // Проход без единого успеха — дальше прогресса не будет, выходим с отчётом.
      console.error(`stuck after pass ${pass}: ${failed.map((w) => w.name).join(', ')}`);
      console.error(`last error: ${lastErr}`);
      pending = failed;
      break;
    }
    pending = failed;
  }
  console.log(pending.length ? `done with ${pending.length} unresolved` : 'done: all workflows active');
  // Не валим compose из-за частичной неудачи — лучше поднять что получилось.
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
