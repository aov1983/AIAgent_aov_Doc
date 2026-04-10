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
