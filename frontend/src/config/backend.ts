// Выбор бэкенда (n8n) на лету: фронт может ходить либо на локальный n8n,
// либо на удалённый стенд. Базовый URL хранится в localStorage и подставляется
// в axios через request-interceptor (см. api/index.ts), поэтому переключение
// действует без пересборки. Меняется ВЕСЬ base URL целиком, включая префикс
// webhook / webhook-test — у локального и удалённого n8n он разный.

const STORAGE_KEY = 'backend_base_url';

export interface BackendPreset {
  id: string;
  label: string;
  url: string;
}

// Локальный дефолт совпадает со старым поведением (VITE_API_URL || localhost).
const LOCAL_DEFAULT = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:5678/webhook';

export const BACKEND_PRESETS: BackendPreset[] = [
  { id: 'local', label: 'Локальный', url: LOCAL_DEFAULT },
  {
    id: 'remote',
    label: 'n8n-test.develonica.group',
    // Тестовый префикс n8n: /webhook-test срабатывает только когда воркфлоу
    // открыт в редакторе («Listen for test event»). Для постоянной работы
    // впишите /webhook в поле URL.
    url: 'https://n8n-test.develonica.group/webhook',
  },
];

// Спец-id для произвольного адреса, не совпадающего ни с одним пресетом.
export const CUSTOM_PRESET_ID = 'custom';

// Убираем хвостовой слэш, чтобы не плодить двойной // при склейке с путём ('/auth/login').
const normalize = (url: string): string => url.trim().replace(/\/+$/, '');

export function getBackendBaseUrl(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return normalize(stored && stored.trim() ? stored : LOCAL_DEFAULT);
}

export function setBackendBaseUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalize(url));
}

// Какому пресету соответствует текущий URL (для подсветки в селекторе);
// CUSTOM_PRESET_ID — если адрес правили вручную.
export function getPresetIdForUrl(url: string): string {
  const n = normalize(url);
  const hit = BACKEND_PRESETS.find((p) => normalize(p.url) === n);
  return hit ? hit.id : CUSTOM_PRESET_ID;
}
