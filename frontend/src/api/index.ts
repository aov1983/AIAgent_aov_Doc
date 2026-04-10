import axios from 'axios';
import type { Token, LoginRequest, AnalysisResponse, RagSearchResult, FileHistoryItem, Report } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
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
    const response = await apiClient.post('/api/auth/login', credentials);
    return response.data;
  },
};

export const uploadApi = {
  uploadDocument: async (file: File): Promise<AnalysisResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await apiClient.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};

export const reportApi = {
  getReport: async (jobId: string): Promise<Report> => {
    const response = await apiClient.get(`/api/reports/${jobId}`);
    return response.data;
  },
};

export const ragApi = {
  search: async (query: string, threshold: number = 0.5): Promise<RagSearchResult[]> => {
    const response = await apiClient.get('/api/rag/search', {
      params: { query, threshold },
    });
    return response.data;
  },
};

export const fileApi = {
  getHistory: async (): Promise<FileHistoryItem[]> => {
    const response = await apiClient.get('/api/files/history');
    return response.data;
  },
};

export default apiClient;
