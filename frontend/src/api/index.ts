import axios from 'axios';
import { getBackendBaseUrl } from '../config/backend';
import type {
  Token,
  LoginRequest,
  AnalysisResponse,
  RagSearchResult,
  FileHistoryItem,
  GraphData,
  ParagraphRow,
  ChatMessage,
  ChatResponse,
  ExtractedRequirement,
  Project,
  ProjectArchitecture,
} from '../types';

const apiClient = axios.create({
  // baseURL выставляется в request-interceptor'е из getBackendBaseUrl() на каждый
  // запрос — так переключение бэкенда на странице входа действует сразу, без
  // пересоздания клиента. Здесь задаём начальное значение как fallback.
  baseURL: getBackendBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: подставляем актуальный базовый URL (выбранный бэкенд) и auth-токен.
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getBackendBaseUrl();
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export const authApi = {
  login: async (credentials: LoginRequest): Promise<Token> => {
    const response = await apiClient.post('/auth/login', credentials);
    return response.data;
  },
};

// Генерим job_id на клиенте, чтобы сразу опрашивать прогресс обработки,
// не дожидаясь ответа /upload. Бэкенд использует этот id (см. Parse + Generate IDs).
const genJobId = (): string =>
  (globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

export interface JobStatus {
  stage: string;
  percent: number;
  updated_at?: string;
  // Живой счётчик извлечённых ФТ/НФТ во время обработки (растёт по мере готовности чанков).
  requirements?: number;
}

export const uploadApi = {
  newJobId: genJobId,
  newDocumentId: genJobId,

  // Async: /upload отвечает сразу {job_id, document_id, status:'processing'} и обрабатывает
  // документ в фоне. document_id генерим на клиенте (как job_id), чтобы знать его сразу —
  // бэкенд (Parse + Generate IDs) использует переданный id. Завершение ловим по /jobs/status (percent=100).
  uploadDocument: async (
    file: File,
    jobId?: string,
    documentId?: string,
    projectId?: string,
  ): Promise<AnalysisResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    if (jobId) formData.append('job_id', jobId);
    if (documentId) formData.append('document_id', documentId);
    // Привязка к проекту АТОМАРНО в момент создания pending-строки graphs (бэк: Parse + Generate IDs →
    // Persist Graph Pending). Так документ принадлежит проекту с первой же строки — без гонки с
    // отдельным /projects/assign (он срабатывал раньше создания строки и терялся).
    if (projectId) formData.append('project_id', projectId);

    const response = await apiClient.post('/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getStatus: async (jobId: string): Promise<JobStatus> => {
    const response = await apiClient.get('/jobs/status', { params: { job_id: jobId } });
    return response.data;
  },
};

export const ragApi = {
  search: async (
    query: string,
    threshold: number = 0.5,
    excludeDocumentId?: string,
    // Ограничить поиск документами активного проекта. Передаётся как CSV-строка document_ids
    // (GET — массивы в query-параметрах сериализуются неоднозначно), бэкенд делает split(',').
    includeDocumentIds?: string[],
  ): Promise<RagSearchResult[]> => {
    const response = await apiClient.get('/rag/search', {
      params: {
        query,
        threshold,
        ...(excludeDocumentId ? { exclude_document_id: excludeDocumentId } : {}),
        ...(includeDocumentIds && includeDocumentIds.length
          ? { document_ids: includeDocumentIds.join(',') }
          : {}),
      },
    });
    return response.data;
  },
};

export const fileApi = {
  getHistory: async (): Promise<FileHistoryItem[]> => {
    const response = await apiClient.get('/files/history');
    return response.data;
  },
};

export const resumeApi = {
  // Возобновляет обработку зависшего документа: бэкенд читает сохранённый файл (job_files)
  // и повторно запускает /upload с тем же job_id — pipeline доделывает недостающие чанки.
  resume: async (jobId: string): Promise<{ status: string; job_id: string; document_id: string }> => {
    const response = await apiClient.post('/resume', { job_id: jobId });
    return response.data;
  },
  // Кооперативная отмена: ставит флаг, который воркер обработки опрашивает между фрагментами и
  // выходит раньше. Документ НЕ удаляется — уже обработанные фрагменты сохранены, статус станет
  // 'partial', и обработку можно «Возобновить».
  cancel: async (jobId: string): Promise<{ ok: boolean }> => {
    const response = await apiClient.post('/job-cancel', { job_id: jobId });
    return response.data;
  },
};

export const documentsApi = {
  // Полное удаление документа: бэкенд (wf_document_delete) каскадно сносит всё связанное —
  // строки graphs/jobs/uploads/job_files/job_status/job_chunks и эмбеддинги в Qdrant.
  delete: async (
    documentId: string,
  ): Promise<{ status: string; document_id: string; jobs_cleared: number; qdrant_deleted: boolean }> => {
    const response = await apiClient.post('/documents/delete', { document_id: documentId });
    return response.data;
  },
};

export const graphApi = {
  get: async (jobId: string): Promise<GraphData> => {
    const response = await apiClient.get('/graph', { params: { job_id: jobId } });
    return response.data;
  },
  getByDocument: async (documentId: string): Promise<GraphData> => {
    const response = await apiClient.get('/graph/by-document', { params: { document_id: documentId } });
    return response.data;
  },
};

export const paragraphsApi = {
  get: async (jobId: string): Promise<ParagraphRow[]> => {
    const response = await apiClient.get('/paragraphs', { params: { job_id: jobId } });
    return response.data;
  },
  getByDocument: async (documentId: string): Promise<ParagraphRow[]> => {
    const response = await apiClient.get('/paragraphs/by-document', { params: { document_id: documentId } });
    return response.data;
  },
};

export const requirementsApi = {
  get: async (jobId: string): Promise<ExtractedRequirement[]> => {
    const response = await apiClient.get('/requirements', { params: { job_id: jobId } });
    return response.data;
  },
  getByDocument: async (documentId: string): Promise<ExtractedRequirement[]> => {
    const response = await apiClient.get('/requirements/by-document', {
      params: { document_id: documentId },
    });
    return response.data;
  },
};

export const projectsApi = {
  list: async (): Promise<Project[]> => {
    const response = await apiClient.get('/projects');
    return response.data;
  },
  // project_id генерим на клиенте (как job_id/document_id) — бэкенд только пишет строку.
  create: async (
    name: string,
    description = '',
  ): Promise<{ project_id: string; name: string; description: string }> => {
    const project_id = genJobId();
    const response = await apiClient.post('/projects', { project_id, name, description });
    return response.data;
  },
  update: async (project_id: string, name: string, description = ''): Promise<{ ok: boolean }> => {
    const response = await apiClient.post('/projects/update', { project_id, name, description });
    return response.data;
  },
  // Удаляет только сам проект. Документы перед удалением отвязывает вызывающий код (assign('')).
  delete: async (project_id: string): Promise<{ ok: boolean }> => {
    const response = await apiClient.post('/projects/delete', { project_id });
    return response.data;
  },
  // Привязать документ к проекту; project_id='' отвязывает (документ остаётся, граф цел).
  assign: async (documentId: string, projectId: string): Promise<{ ok: boolean }> => {
    const response = await apiClient.post('/projects/assign', {
      document_id: documentId,
      project_id: projectId,
    });
    return response.data;
  },
};

export const architectureApi = {
  // Отдаёт сохранённую архитектуру проекта (или {status:'none'}, если ещё не генерировалась).
  get: async (projectId: string): Promise<ProjectArchitecture> => {
    const response = await apiClient.get('/projects/architecture', {
      params: { project_id: projectId },
    });
    return response.data;
  },
  // Запускает LLM-генерацию архитектуры по RAG-контексту документов проекта. Синхронный вызов:
  // держит соединение до конца генерации (локальная Ollama — до нескольких минут), поэтому
  // увеличенный таймаут. Результат уже сохранён на бэке; повторный вызов = «Обновить».
  generate: async (projectId: string): Promise<ProjectArchitecture> => {
    const response = await apiClient.post(
      '/projects/architecture/generate',
      { project_id: projectId },
      { timeout: 600000 },
    );
    return response.data;
  },
};

export const chatApi = {
  ask: async (
    message: string,
    documentId?: string,
    history: ChatMessage[] = [],
    // Набор документов активного проекта: когда документ не выбран явно («по всей базе»),
    // поиск контекста всё равно ограничивается проектом. document_id (один) имеет приоритет.
    documentIds?: string[],
  ): Promise<ChatResponse> => {
    const response = await apiClient.post('/chat/ask', {
      message,
      document_id: documentId,
      document_ids: documentIds && documentIds.length ? documentIds : undefined,
      history,
    });
    return response.data;
  },
};

export default apiClient;
