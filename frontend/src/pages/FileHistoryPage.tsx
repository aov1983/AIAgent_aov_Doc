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
  CircularProgress,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Search as SearchIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { documentsApi, graphApi, paragraphsApi, ragApi } from '../api';
import type { DocumentSummary, GraphData, ParagraphRow, RagSearchResult } from '../types';
import { GraphCard } from '../components/GraphCard';

export function FileHistoryPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RagSearchResult[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentSummary | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const data = await documentsApi.list();
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const openDocument = async (doc: DocumentSummary) => {
    setSelectedDoc(doc);
    setGraph(null);
    setParagraphs([]);
    setDetailsLoading(true);
    try {
      const [graphResp, paragraphsResp] = await Promise.all([
        graphApi.getByDocument(doc.document_id).catch(() => null),
        paragraphsApi.getByDocument(doc.document_id).catch(() => [] as ParagraphRow[]),
      ]);
      setGraph(graphResp);
      setParagraphs(paragraphsResp);
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeDocument = () => {
    setSelectedDoc(null);
    setGraph(null);
    setParagraphs([]);
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

  const getSimilarityColor = (score: number) => {
    if (score >= 0.8) return 'error';
    if (score >= 0.6) return 'warning';
    return 'info';
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">История обработанных документов</Typography>
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
              <TableCell>Документ</TableCell>
              <TableCell>Файл</TableCell>
              <TableCell>Сохранён</TableCell>
              <TableCell align="right">Требований</TableCell>
              <TableCell align="right">Узлов</TableCell>
              <TableCell align="right">Связей</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!loading && documents.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary">Пока ни одного документа не сохранено</Typography>
                </TableCell>
              </TableRow>
            )}
            {documents.map((doc) => (
              <TableRow key={doc.document_id} hover>
                <TableCell>{doc.title || doc.document_id}</TableCell>
                <TableCell>{doc.filename}</TableCell>
                <TableCell>{doc.saved_at.replace('T', ' ')}</TableCell>
                <TableCell align="right">{doc.total_requirements}</TableCell>
                <TableCell align="right">{doc.stats.total_nodes}</TableCell>
                <TableCell align="right">{doc.stats.total_edges}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="primary" onClick={() => openDocument(doc)}>
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

      {/* Document Details Dialog with Graph */}
      <Dialog open={!!selectedDoc} onClose={closeDocument} maxWidth="lg" fullWidth>
        <DialogTitle>
          {selectedDoc?.title || selectedDoc?.document_id}
          <IconButton
            aria-label="close"
            onClick={closeDocument}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {detailsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!detailsLoading && selectedDoc && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                <strong>Файл:</strong> {selectedDoc.filename} &nbsp;·&nbsp;
                <strong>document_id:</strong> {selectedDoc.document_id} &nbsp;·&nbsp;
                <strong>Сохранён:</strong> {selectedDoc.saved_at.replace('T', ' ')}
              </Typography>

              {graph && selectedDoc && (
                <GraphCard
                  graph={graph}
                  downloadName={`graph_${selectedDoc.document_id}.json`}
                  title="Граф знаний"
                  height={520}
                  paperVariant="outlined"
                  paperPadding={2}
                  resetKey={selectedDoc.document_id}
                />
              )}

              {!graph && (
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  Граф для этого документа не найден.
                </Typography>
              )}

              {paragraphs.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>
                    Абзацы документа ({paragraphs.length})
                  </Typography>
                  <TableContainer sx={{ maxHeight: 420 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Глава</TableCell>
                          <TableCell>Раздел</TableCell>
                          <TableCell>№</TableCell>
                          <TableCell sx={{ minWidth: 240 }}>Абзац</TableCell>
                          <TableCell>Факт / Риск / Реком.</TableCell>
                          <TableCell>Критичность</TableCell>
                          <TableCell>Исполнители</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paragraphs.map((row, idx) => (
                          <TableRow key={idx} hover>
                            <TableCell>{row.chapter_index}. {row.chapter_title}</TableCell>
                            <TableCell>{row.section_index}. {row.section_title}</TableCell>
                            <TableCell>{row.paragraph_index + 1}</TableCell>
                            <TableCell sx={{ maxWidth: 360 }}>
                              <Typography variant="body2">
                                {row.paragraph_text.length > 260
                                  ? row.paragraph_text.slice(0, 260) + '…'
                                  : row.paragraph_text}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 320 }}>
                              {row.facts.map((fact, i) => (
                                <Box key={i} sx={{ mb: 0.5 }}>
                                  <Typography variant="caption" sx={{ display: 'block' }}>
                                    <strong>Факт:</strong> {fact}
                                  </Typography>
                                  {row.risks[i] && (
                                    <Typography variant="caption" sx={{ display: 'block' }}>
                                      <strong>Риск:</strong> {row.risks[i]}
                                    </Typography>
                                  )}
                                  {row.recommendations[i] && (
                                    <Typography variant="caption" sx={{ display: 'block' }}>
                                      <strong>Реком.:</strong> {row.recommendations[i]}
                                    </Typography>
                                  )}
                                </Box>
                              ))}
                            </TableCell>
                            <TableCell>
                              {row.criticality.map((c, i) => (
                                <Chip key={i} label={c} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
                              ))}
                            </TableCell>
                            <TableCell>
                              {row.executors.map((e, i) => (
                                <Chip key={i} label={e} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
                              ))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDocument}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
