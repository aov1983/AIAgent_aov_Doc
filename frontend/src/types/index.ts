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
  report_url?: string;
}

export interface RagSearchResult {
  chunk_id: string;
  content: string;
  similarity_score: number;
  source_document: string;
  metadata: Record<string, any>;
}

export interface FileHistoryItem {
  id: string;
  filename: string;
  date: string;
  status: string;
}

export interface ReportChunk {
  chapter: string;
  section: string;
  paragraph: string;
  fact: string;
  risk: string;
  criticality: 'Высокий' | 'Средний' | 'Низкий';
  recommendation: string;
  executor_type: string[];
  similar_requirements: RagSearchResult[];
  architectural_solutions: string[];
  comments: string;
  traceability: {
    page?: number;
    paragraph_number?: number;
    section_title?: string;
  };
}

export interface Report {
  job_id: string;
  content: string;
  chunks: ReportChunk[];
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'chapter' | 'section' | 'paragraph' | 'chunk' | string;
  content: string;
  metadata: Record<string, any>;
  level: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'contains' | 'similar_to' | 'conflicts_with' | string;
  weight: number;
}

export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  paragraphs: number;
  chunks: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats?: GraphStats;
}

export interface DocumentSummary {
  document_id: string;
  title: string;
  filename: string;
  saved_at: string;
  total_requirements: number;
  stats: GraphStats;
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
  similar_requirements: { id: string; score: number; content: string }[];
  comments: string[];
}
