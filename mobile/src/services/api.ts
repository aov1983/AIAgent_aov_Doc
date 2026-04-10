import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor для добавления токена авторизации
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export interface LoginCredentials {
  username: string;
  password: string;
  role?: string;
}

export interface UploadDocumentResponse {
  documentId: string;
  status: string;
  message: string;
}

export interface AnalysisResult {
  documentId: string;
  report: any;
  similarities: Array<{
    id: string;
    similarity: number;
    source: string;
  }>;
  contradictions: Array<{
    id: string;
    description: string;
  }>;
}

export interface DocumentHistoryItem {
  id: string;
  filename: string;
  uploadDate: string;
  status: string;
  similarityScore?: number;
}

export const authService = {
  login: async (credentials: LoginCredentials) => {
    const response = await api.post('/auth/login', credentials);
    if (response.data.token) {
      await AsyncStorage.setItem('authToken', response.data.token);
      await AsyncStorage.setItem('userRole', response.data.role || 'architect');
    }
    return response.data;
  },

  logout: async () => {
    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('userRole');
  },

  getToken: async () => {
    return await AsyncStorage.getItem('authToken');
  },

  getUserRole: async () => {
    return await AsyncStorage.getItem('userRole');
  },
};

export const documentService = {
  uploadDocument: async (fileUri: string, filename: string): Promise<UploadDocumentResponse> => {
    const formData = new FormData();
    formData.append('file', {
      uri: fileUri,
      name: filename,
      type: 'application/octet-stream',
    } as any);

    const response = await api.post('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getAnalysisResults: async (documentId: string): Promise<AnalysisResult> => {
    const response = await api.get(`/documents/${documentId}/analysis`);
    return response.data;
  },

  getHistory: async (): Promise<DocumentHistoryItem[]> => {
    const response = await api.get('/documents/history');
    return response.data;
  },

  searchSimilar: async (query: string, threshold: number = 0.5) => {
    const response = await api.post('/rag/search', { query, threshold });
    return response.data;
  },
};

export default api;
