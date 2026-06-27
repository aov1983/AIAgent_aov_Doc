import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  Chip,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  Description as DocIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  FolderOpen as FolderIcon,
  TableChart as TableIcon,
} from '@mui/icons-material';
import { uploadApi, graphApi, paragraphsApi, requirementsApi } from '../api';
import type { AnalysisResponse, RagSearchResult, GraphData, ParagraphRow, ExtractedRequirement } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProject } from '../hooks/useProject';
import { GraphCard } from '../components/GraphCard';
import { ProcessingProgress } from '../components/ProcessingProgress';

interface FileUploadPageProps {
  userRole: string;
}

export function FileUploadPage({ userRole }: FileUploadPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  // Момент старта обработки — для таймера «прошло» в индикаторе прогресса.
  const [startedAt, setStartedAt] = useState('');
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState('');
  const [similarResults, setSimilarResults] = useState<RagSearchResult[]>([]);
  const [reportContent, setReportContent] = useState('');
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphRow[]>([]);
  // Проект, к которому привязать загружаемый документ. По умолчанию — активный проект из шапки
  // (можно переопределить вручную). reloadDocuments обновит общий список после загрузки.
  const { projects, currentProjectId, reloadDocuments } = useProject();
  const [projectId, setProjectId] = useState('');

  // Подставляем активный проект, как только контекст его узнал (пока пользователь не выбрал другой).
  useEffect(() => {
    setProjectId((prev) => prev || currentProjectId);
  }, [currentProjectId]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setError('');
      setResult(null);
      setSimilarResults([]);
      setGraph(null);
      setParagraphs([]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setProgress(0);
    setStage('Загрузка файла');
    setStartedAt(new Date().toISOString());
    setError('');

    // Async-обработка: /upload отвечает сразу {job_id, document_id, status:'processing'},
    // документ молотится в фоне. Прогресс И ЗАВЕРШЕНИЕ ловим по GET /jobs/status (percent=100),
    // не держа HTTP-соединение на всё время обработки (большие docs идут 10-20 мин).
    // document_id генерим на клиенте — бэкенд (Parse) использует его, и мы знаем его сразу.
    const jobId = uploadApi.newJobId();
    const documentId = uploadApi.newDocumentId();

    let finished = false;
    const done = new Promise<void>((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const s = await uploadApi.getStatus(jobId);
          // прогресс только растёт — не даём ему скакать назад между опросами
          setProgress((prev) => (s.percent > prev ? s.percent : prev));
          if (s.stage) setStage(s.stage);
          if (s.percent >= 100) {
            finished = true;
            clearInterval(iv);
            resolve();
          }
        } catch {
          /* строка статуса ещё не создана — игнорируем */
        }
      }, 1500);
      // страховка: не ждём вечно, если обработка зависла
      setTimeout(() => {
        if (!finished) {
          clearInterval(iv);
          reject(new Error('Обработка превысила лимит времени (30 мин)'));
        }
      }, 30 * 60 * 1000);
    });

    try {
      // мгновенный ответ — обработка продолжается в фоне. project_id передаём прямо в /upload —
      // бэк привязывает документ к проекту атомарно при создании pending-строки graphs
      // ([upload] Parse + Generate IDs → Persist Graph Pending). Отдельный /projects/assign не нужен:
      // он срабатывал раньше создания строки (гонка) и привязка терялась.
      await uploadApi.uploadDocument(file, jobId, documentId, projectId);
      // ждём завершения по статусу (percent=100)
      await done;
      setProgress(100);
      setStage('Готово');
      // Обновляем общий список документов: новый документ появится в Истории/реестрах проекта.
      reloadDocuments().catch(() => {});

      // Финальные данные грузим по job_id / document_id
      const [graphResp, paragraphsResp, reqs] = await Promise.all([
        graphApi.get(jobId).catch(() => null),
        paragraphsApi.get(jobId).catch(() => [] as ParagraphRow[]),
        requirementsApi.get(jobId).catch(() => [] as ExtractedRequirement[]),
      ]);
      setResult({
        job_id: jobId,
        document_id: documentId,
        status: 'completed',
        total_requirements: reqs.length,
        message: '',
      } as AnalysisResponse);
      setReportContent('');
      setGraph(graphResp);
      setParagraphs(paragraphsResp);

      // Search for similar requirements in RAG
      const currentDocId = documentId;
      const dedup = new Map<string, RagSearchResult>();
      for (const row of paragraphsResp) {
        for (const sim of row.similar_requirements ?? []) {
          if (sim.document_id && currentDocId && sim.document_id === currentDocId) {
            continue;
          }
          const prev = dedup.get(sim.id);
          if (!prev || sim.score > prev.similarity_score) {
            dedup.set(sim.id, {
              chunk_id: sim.id,
              content: sim.content,
              similarity_score: sim.score,
              source_document: sim.source_document || sim.document_id || 'unknown',
              metadata: {
                matched_in_section: row.section_title,
                matched_paragraph_index: row.paragraph_index,
                ...(sim.document_id ? { source_document_id: sim.document_id } : {}),
              },
            });
          }
        }
      }
      setSimilarResults(
        Array.from(dedup.values()).sort((a, b) => b.similarity_score - a.similarity_score),
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Ошибка загрузки файла');
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
          <FormControl fullWidth size="small" sx={{ mt: 2 }} disabled={uploading}>
            <InputLabel id="upload-project-select">Проект (необязательно)</InputLabel>
            <Select
              labelId="upload-project-select"
              label="Проект (необязательно)"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value as string)}
              displayEmpty
            >
              <MenuItem value="">
                <em>— без проекта —</em>
              </MenuItem>
              {projects.map((p) => (
                <MenuItem key={p.project_id} value={p.project_id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

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
            <ProcessingProgress stage={stage} percent={progress} startedAt={startedAt} />
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

          {/* Собственный граф знаний (не Qdrant) */}
          {graph && (
            <GraphCard
              graph={graph}
              downloadName={`graph_${result.job_id}.json`}
              height={560}
              resetKey={result.job_id}
            />
          )}

          {/* Таблица результата LLM с метаданными по абзацам */}
          {paragraphs.length > 0 && (
            <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TableIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="h6">Результат LLM по абзацам</Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 520 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Глава</TableCell>
                      <TableCell>Раздел</TableCell>
                      <TableCell>№ абзаца</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>Абзац</TableCell>
                      <TableCell>Факт / Риск / Рекомендация</TableCell>
                      <TableCell>Критичность</TableCell>
                      <TableCell>Исполнители</TableCell>
                      <TableCell>Похожие (RAG)</TableCell>
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
                        <TableCell sx={{ maxWidth: 360 }}>
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
                          {row.comments.length > 0 && (
                            <Typography variant="caption" color="warning.main">
                              {row.comments.join(' | ')}
                            </Typography>
                          )}
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
                        <TableCell sx={{ maxWidth: 240 }}>
                          {row.similar_requirements.slice(0, 3).map((s, i) => (
                            <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                              {s.id} ({(s.score * 100).toFixed(0)}%)
                            </Typography>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

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
