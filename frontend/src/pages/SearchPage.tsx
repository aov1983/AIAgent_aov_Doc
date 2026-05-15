import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ragApi } from '../api';
import type { RagSearchResult } from '../types';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RagSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const data = await ragApi.search(query, 0.5);
      setResults(data);
      setSearched(true);
    } catch (e: any) {
      console.error('Search failed:', e);
      setError(e?.response?.data?.detail || 'Не удалось выполнить поиск');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const getSimilarityColor = (score: number) => {
    if (score >= 0.8) return 'error';
    if (score >= 0.6) return 'warning';
    return 'info';
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Поиск похожих требований в RAG
      </Typography>

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            placeholder="Введите запрос для поиска..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            disabled={loading}
          />
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            Найти
          </Button>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {results.length > 0 && (
        <Grid container spacing={2}>
          {results.map((result, index) => (
            <Grid item xs={12} key={index}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      {result.source_document}
                    </Typography>
                    <Chip
                      label={`${(result.similarity_score * 100).toFixed(0)}%`}
                      color={getSimilarityColor(result.similarity_score) as any}
                      size="small"
                    />
                  </Box>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                    {result.content
                      .replace(/\s*Риск:\s*/g, '\n\nРиск: ')
                      .replace(/\s*Рекомендация:\s*/g, '\n\nРекомендация: ')
                      .trim()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 3 }}>
          Ничего не найдено
        </Typography>
      )}
    </Box>
  );
}
