import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  LinearProgress,
  Alert,
  Chip,
  Divider,
  Grid,
  Card,
  CardContent,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Description as DocIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  FolderOpen as FolderIcon,
} from '@mui/icons-material';
import { uploadApi, ragApi } from '../api';
import type { AnalysisResponse, RagSearchResult } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FileUploadPageProps {
  userRole: string;
}

export function FileUploadPage({ userRole }: FileUploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState('');
  const [similarResults, setSimilarResults] = useState<RagSearchResult[]>([]);
  const [reportContent, setReportContent] = useState('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setError('');
      setResult(null);
      setSimilarResults([]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setError('');

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 300);

    try {
      const response = await uploadApi.uploadDocument(file);
      clearInterval(progressInterval);
      setProgress(100);
      setResult(response);
      setReportContent(response.message);

      // Search for similar requirements in RAG
      const searchQuery = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
      const similar = await ragApi.search(searchQuery, 0.5);
      setSimilarResults(similar);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка загрузки файла');
    } finally {
      setUploading(false);
    }
  };

  const getCriticalityColor = (score: number) => {
    if (score >= 0.8) return 'error';
    if (score >= 0.6) return 'warning';
    return 'info';
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
        Загрузка и анализ документа
      </Typography>

      {/* Upload Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <UploadIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6">Загрузка файла</Typography>
        </Box>

        <Box
          sx={{
            border: 2,
            borderColor: 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            bgcolor: 'background.default',
          }}
        >
          <input
            accept=".docx,.doc,.txt,.pdf,.md"
            style={{ display: 'none' }}
            id="file-upload"
            type="file"
            onChange={handleFileChange}
          />
          <label htmlFor="file-upload">
            <Button variant="contained" component="span" startIcon={<FolderIcon />}>
              Выбрать файл
            </Button>
          </label>
          {file && (
            <Typography sx={{ mt: 2, color: 'text.secondary' }}>
              Выбран файл: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(2)} KB)
            </Typography>
          )}
        </Box>

        {file && !result && (
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            onClick={handleUpload}
            disabled={uploading}
            sx={{ mt: 2 }}
            startIcon={<UploadIcon />}
          >
            {uploading ? 'Анализ...' : 'Загрузить и проанализировать'}
          </Button>
        )}

        {uploading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress variant="determinate" value={progress} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Обработка документа... {progress}%
            </Typography>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {/* Results Section */}
      {result && (
        <>
          <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CheckIcon sx={{ mr: 1, color: 'success.main' }} />
              <Typography variant="h6">Результаты анализа</Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Chip label={`ID задачи: ${result.job_id}`} color="primary" />
              </Grid>
              <Grid item xs={12} sm={6}>
                <Chip label={`Статус: ${result.status}`} color="success" />
              </Grid>
            </Grid>

            {reportContent && (
              <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {reportContent}
                </ReactMarkdown>
              </Box>
            )}
          </Paper>

          {/* RAG Similar Results */}
          {similarResults.length > 0 && (
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <SearchIcon sx={{ mr: 1, color: 'secondary.main' }} />
                <Typography variant="h6">Найденные похожие требования в RAG</Typography>
              </Box>

              <Grid container spacing={2}>
                {similarResults.map((item, index) => (
                  <Grid item xs={12} key={index}>
                    <Card variant="outlined">
                      <CardContent>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="subtitle2" color="text.secondary">
                            Источник: {item.source_document}
                          </Typography>
                          <Chip
                            label={`${(item.similarity_score * 100).toFixed(0)}% совпадение`}
                            color={getCriticalityColor(item.similarity_score) as any}
                            size="small"
                          />
                        </Box>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          {item.content.substring(0, 200)}...
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          {Object.entries(item.metadata).map(([key, value]) => (
                            <Chip key={key} label={`${key}: ${value}`} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Paper>
          )}

          {similarResults.length === 0 && result && (
            <Alert severity="info" sx={{ mb: 3 }}>
              Похожие решения в базе знаний не найдены. Это новое уникальное требование.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
