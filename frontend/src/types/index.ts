export interface User {
  username: string;
  role: string;
}

export interface Token {
  access_token: string;
  token_type: string;
  role: string;
  username: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AnalysisResponse {
  job_id: string;
  status: string;
  message: string;
  document_id?: string;
}

export interface RagSearchResult {
  chunk_id: string;
  content: string;
  similarity_score: number;
  source_document: string;
  metadata: Record<string, any>;
}

export interface Project {
  project_id: string;
  name: string;
  description: string;
  created_at: string;
  // Кто создал проект (для аудита). Проекты сейчас общие — по этому полю НЕ фильтруем.
  created_by: string;
  // Сколько документов привязано к проекту (считает бэкенд по graphs.project_id).
  document_count: number;
}

// Сгенерированная LLM архитектура проекта (раздел «Архитектура»). Хранится на бэке в
// Data-Table project_architecture, генерируется по RAG-контексту документов проекта.
export interface ProjectArchitecture {
  project_id: string;
  // none — ещё не генерировалась; empty — нет данных/документов; ready — готово; error — LLM не дал результат.
  status: 'none' | 'empty' | 'ready' | 'error' | string;
  generated_at: string;
  provider: string;
  model: string;
  sources_count: number;
  // Текстовое описание архитектуры (markdown): стек, ключевые решения.
  summary_md: string;
  // Диаграммы Mermaid в нотации C4 (уровни Context и Container).
  c4_context: string;
  c4_container: string;
}

export interface FileHistoryItem {
  document_id: string;
  title: string;
  filename: string;
  saved_at: string;
  total_requirements: number;
  stats: GraphStats;
  // Привязка документа к «Проекту» (M:1). Пусто/отсутствует = документ вне проекта.
  project_id?: string;
  // 'processing' — документ ещё обрабатывается (строка пишется в graphs сразу при загрузке);
  // 'completed' — обработка завершена полностью; 'partial' — завершена, но часть фрагментов не
  // обработана (LLM не ответил), требуется «Возобновить». Старые строки без поля трактуем как completed.
  status?: string;
  // job_id нужен фронту, чтобы поллить /jobs/status и вызывать возобновление обработки.
  job_id?: string;
  // Имя LLM-модели, которой обработан документ (тэг в Истории): qwen3:8b | claude-haiku-4-5 | …
  model?: string;
  // Фактический usage экстракции (только для облачных провайдеров, напр. Claude). Для локальной
  // Ollama токены не тарифицируются → 0/отсутствуют, в Истории показываем «локально».
  input_tokens?: number;
  output_tokens?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'chapter' | 'section' | 'paragraph' | 'chunk' | 'external' | string;
  content: string;
  metadata: Record<string, any>;
  level: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'contains' | 'similar_to' | 'conflicts_with' | 'intersects' | string;
  weight: number;
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  paragraphs: number;
  chunks: number;
  intersections?: number;
  external_docs?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats?: GraphStats;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSource {
  chunk_id: string;
  content: string;
  similarity_score: number;
  document_id?: string;
  source_document?: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

export interface ExtractedRequirement {
  type: 'ФТ' | 'НФТ' | string;
  title: string;
  statement: string;
  fact: string;
  risk: string;
  criticality: string;
  recommendation: string;
}

export interface ParagraphRow {
  chapter_index: number;
  chapter_title: string;
  section_index: number;
  section_title: string;
  paragraph_index: number;
  paragraph_text: string;
  facts: string[];
  risks: string[];
  criticality: string[];
  recommendations: string[];
  executors: string[];
  similar_requirements: {
    id: string;
    score: number;
    content: string;
    document_id?: string;
    source_document?: string;
  }[];
  comments: string[];
}
