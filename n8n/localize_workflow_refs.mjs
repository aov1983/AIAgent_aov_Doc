// Локализация ссылок executeWorkflow под конкретный стенд (для случая «только UI-импорт»).
//
// Проблема: UI-импорт n8n НЕ сохраняет id из JSON — он присваивает воркфлоу новый случайный id.
// А ноды executeWorkflow ссылаются на под-воркфлоу по стабильным строковым id (wf-auth, wf-rag).
// После UI-импорта эти ссылки повисают, и в каждой ноде приходится переуказывать цель руками.
//
// Что делает скрипт: берёт реальные id под-воркфлоу, которые стенд присвоил (их видно в URL
// браузера при открытии воркфлоу: /workflow/<ID>), и переписывает в КОПИЯХ файлов все
// workflowId.value на эти id. Локализованные файлы кладутся в workflows_localized/.
// Импортируете уже их — ссылки резолвятся сами.
//
// Один раз: импортируйте wf_auth.json и wf_rag.json через UI, откройте каждый, скопируйте id из URL.
// Потом:
//   node localize_workflow_refs.mjs wf-auth=<AUTH_ID> wf-rag=<RAG_ID>
//   # импортируйте файлы из workflows_localized/ через UI
//
// Повторяемо: пока wf_auth/wf_rag не удаляются, их id не меняются — локализованные файлы
// остаются валидными при всех будущих переимпортах роутеров.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_DIR = join(import.meta.dirname, 'workflows');
const OUT_DIR = join(import.meta.dirname, 'workflows_localized');

// Разбор аргументов вида wf-auth=<id> wf-rag=<id>
const map = {};
for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  if (eq === -1) { console.error(`не понял аргумент: "${arg}" (ожидаю wf-auth=<id>)`); process.exit(1); }
  map[arg.slice(0, eq).trim()] = arg.slice(eq + 1).trim();
}
if (Object.keys(map).length === 0) {
  console.error('usage: node localize_workflow_refs.mjs wf-auth=<id> wf-rag=<id> [wf-...=<id>]');
  process.exit(1);
}

// Рекурсивно ищем resourceLocator-ы workflowId ({ __rl:true, value, mode:"id" }) и подменяем value.
let replaced = 0;
const walk = (node) => {
  if (Array.isArray(node)) { node.forEach(walk); return; }
  if (node && typeof node === 'object') {
    const v = node.value;
    if (node.__rl === true && typeof v === 'string' && Object.prototype.hasOwnProperty.call(map, v)) {
      node.value = map[v];
      if (node.cachedResultName) node.cachedResultName = map[v]; // чтобы UI не показывал старое имя-id
      replaced++;
    }
    for (const key of Object.keys(node)) walk(node[key]);
  }
};

mkdirSync(OUT_DIR, { recursive: true });
const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const wf = JSON.parse(readFileSync(join(SRC_DIR, f), 'utf8'));
  const before = replaced;
  walk(wf);
  writeFileSync(join(OUT_DIR, f), JSON.stringify(wf, null, 2));
  const n = replaced - before;
  if (n) console.log(`${f}: переписано ссылок ${n}`);
}
console.log(`\nГотово: ${replaced} ссылок локализовано → ${OUT_DIR}/`);
console.log('Импортируйте файлы из workflows_localized/ через UI.');
