import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Card,
  CardContent,
} from '@mui/material';
import {
  FolderOpen as FolderIcon,
  Visibility as ViewIcon,
  Search as SearchIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { fileApi, ragApi } from '../api';
import type { FileHistoryItem, RagSearchResult } from '../types';

export function FileHistoryPage() {
  const [files, setFiles] = useState<FileHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RagSearchResult[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileHistoryItem | null>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const data = await fileApi.getHistory();
      setFiles(data);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      const results = await ragApi.search(searchQuery, 0.5);
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
        return 'warning';
      case 'failed':
        return 'error';
      default:
        return 'default';
    }
  };

  const getSimilarityColor = (score: number) => {
    if (score >= 0.8) return 'error';
    if (score >= 0.6) return 'warning';
    return 'info';
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">История обработанных файлов</Typography>
        <Button
          variant="contained"
          color="secondary"
          startIcon={<SearchIcon />}
          onClick={() => setSearchDialogOpen(true)}
        >
          Поиск в RAG
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Имя файла</TableCell>
              <TableCell>Дата обработки</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
                <TableCell>{file.id}</TableCell>
                <TableCell>{file.filename}</TableCell>
                <TableCell>{file.date}</TableCell>
                <TableCell>
                  <Chip label={file.status} color={getStatusColor(file.status) as any} size="small" />
                </TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => setSelectedFile(file)}
                  >
                    <ViewIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Search Dialog */}
      <Dialog open={searchDialogOpen} onClose={() => setSearchDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Поиск похожих требований в RAG
          <IconButton
            aria-label="close"
            onClick={() => setSearchDialogOpen(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              fullWidth
              placeholder="Введите запрос для поиска..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button variant="contained" onClick={handleSearch}>
              Найти
            </Button>
          </Box>

          {searchResults.length > 0 && (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {searchResults.map((result, index) => (
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
                      <Typography variant="body2">{result.content}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {searchQuery && searchResults.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', mt: 3 }}>
              Ничего не найдено
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearchDialogOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* File Details Dialog */}
      <Dialog
        open={!!selectedFile}
        onClose={() => setSelectedFile(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Детали файла
          <IconButton
            aria-label="close"
            onClick={() => setSelectedFile(null)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {selectedFile && (
            <Box>
              <Typography variant="body1" paragraph>
                <strong>Имя:</strong> {selectedFile.filename}
              </Typography>
              <Typography variant="body1" paragraph>
                <strong>ID:</strong> {selectedFile.id}
              </Typography>
              <Typography variant="body1" paragraph>
                <strong>Дата:</strong> {selectedFile.date}
              </Typography>
              <Typography variant="body1">
                <strong>Статус:</strong>{' '}
                <Chip label={selectedFile.status} color={getStatusColor(selectedFile.status) as any} size="small" />
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedFile(null)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
