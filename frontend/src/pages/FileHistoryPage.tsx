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
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Card,
  CardContent,
  CircularProgress,
  Tooltip,
  FormControl,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Replay as ResumeIcon,
  DeleteOutline as DeleteIcon,
  WarningAmber as WarningIcon,
  StopCircleOutlined as CancelIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { documentsApi, fileApi, graphApi, paragraphsApi, projectsApi, ragApi, resumeApi, uploadApi } from '../api';
import type { JobStatus } from '../api';
import type { FileHistoryItem, GraphData, ParagraphRow, RagSearchResult } from '../types';
import { useProject } from '../hooks/useProject';
import { GraphCard } from '../components/GraphCard';
import { ProcessingProgress, parseTs } from '../components/ProcessingProgress';

// Сколько статус может не обновляться, прежде чем считаем обработку прерванной (и предлагаем
// «Возобновить»). Должно быть БОЛЬШЕ нормального разрыва между апдейтами бэкенда: фаза LLM
// шлёт статус раз в 3 фрагмента (~3.5 мин), фазы конвертации/RAG — единичными вехами. 10 мин —
// с запасом, чтобы не было ложного «прервано», но реальный обрыв всё же обнаружился.
const STALE_MS = 10 * 60 * 1000;

// Тарифы облачных LLM, $ за 1M токенов {вход, выход}. Стоимость считаем на фронте — тариф живёт
// в одном месте и правится без передеплоя бэкенда. Сопоставление по префиксу имени модели
// (бэкенд может вернуть полный id, напр. claude-haiku-4-5-20251001). Модель без записи в таблице
// (или локальная Ollama) → стоимость не показываем.
const LLM_PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-opus-4': { in: 15, out: 75 },
  // Yandex Cloud, прайс задан «$ за 1k токенов» (без НДС) → ×1000 к нашему формату «$ за 1M».
  // вход 0.001639344·1k, выход 0.002459016·1k. cached/tool-тарифы у нас не учитываются (нет таких usage-полей).
  'yandex-qwen3.6': { in: 1.639344, out: 2.459016 },
};
const priceFor = (model?: string) => {
  if (!model) return null;
  const m = model.toLowerCase();
  const key = Object.keys(LLM_PRICING).find((k) => m.startsWith(k));
  return key ? LLM_PRICING[key] : null;
};
// Корпоративная LLM Девелоники (Open WebUI): модели dvl-* / dvl-dev/* и агентские коды agXX.
// Не локальная (не на нашей машине) и без публичного $-тарифа → отдельная метка «корпоративная».
const isDevelonicaModel = (model?: string) => {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.startsWith('dvl') || m.startsWith('ag');
};
// LM Studio (локальный OpenAI-совместимый сервер): модели в формате HuggingFace-namespace
// «vendor/model» (google/gemma-4-12b, qwen/qwen3.5-9b). Локальная Ollama использует «name:tag»
// (qwen3:8b) — без слеша; claude/dvl-* тоже без слеша, поэтому слеш = надёжный признак LM Studio.
const isLmStudioModel = (model?: string) => !!model && model.includes('/');
// $ за прогон по фактическому usage. null — тарифа нет (локальная модель) или нет токенов.
const estCostUsd = (doc: FileHistoryItem): number | null => {
  const p = priceFor(doc.model);
  if (!p) return null;
  const inTok = doc.input_tokens || 0;
  const outTok = doc.output_tokens || 0;
  if (inTok === 0 && outTok === 0) return null;
  return (inTok * p.in + outTok * p.out) / 1_000_000;
};
const fmtUsd = (v: number) => (v < 0.01 ? '<$0.01' : '$' + v.toFixed(2));
const fmtTok = (n?: number) => (n || 0).toLocaleString('ru-RU');

export function FileHistoryPage() {
  const navigate = useNavigate();
  // Активный проект из шапки: история показывает только его документы. projects — для выпадающего
  // списка привязки в колонке «Проект»; reloadDocuments синхронизирует общий список (чат/поиск).
  const { projects, currentProjectId, currentProject, currentDocumentIds, reloadDocuments } = useProject();
  const [documents, setDocuments] = useState<FileHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // document_id, по которым сейчас идёт смена проекта (блокируем select на время запроса).
  const [assigning, setAssigning] = useState<Record<string, boolean>>({});
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RagSearchResult[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<FileHistoryItem | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  // Живой прогресс обрабатываемых документов: job_id -> {stage, percent, updated_at}.
  const [statuses, setStatuses] = useState<Record<string, JobStatus>>({});
  const [resuming, setResuming] = useState<Record<string, boolean>>({});
  // Документы, по которым запрошена отмена (ждём, пока воркер дойдёт до проверки флага и встанет на partial).
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({});
  // Документ, выбранный для удаления (открывает диалог подтверждения); флаг процесса удаления.
  const [deleteTarget, setDeleteTarget] = useState<FileHistoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const data = await fileApi.getHistory();
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  };

  // Привязка/отвязка документа к проекту прямо из Истории. Обновляем строку локально, чтобы
  // select сразу отразил выбор, не дожидаясь перезагрузки всей таблицы.
  const handleAssignProject = async (doc: FileHistoryItem, projectId: string) => {
    setAssigning((p) => ({ ...p, [doc.document_id]: true }));
    try {
      await projectsApi.assign(doc.document_id, projectId);
      setDocuments((prev) =>
        prev.map((d) => (d.document_id === doc.document_id ? { ...d, project_id: projectId } : d)),
      );
      // Синхронизируем общий список документов (его читают чат/поиск/реестр через контекст).
      reloadDocuments().catch(() => {});
    } catch (error) {
      console.error('Assign project failed:', error);
    } finally {
      setAssigning((p) => ({ ...p, [doc.document_id]: false }));
    }
  };

  // История привязана к активному проекту: показываем только его документы (строгая модель —
  // пункта «все проекты» нет). Документы «вне проекта» назначаются через «Проект → Добавить документы».
  const visibleDocuments = currentProjectId
    ? documents.filter((d) => d.project_id === currentProjectId)
    : [];

  // Активно обрабатываемые (строка в graphs пишется сразу при загрузке). Поллим их прогресс по
  // /jobs/status и обновляем список по завершении. 'partial' СЮДА НЕ входит — это завершённое (с
  // потерей фрагментов) состояние: его не поллим, но предлагаем «Возобновить».
  const processingDocs = visibleDocuments.filter((d) => {
    const st = d.status || 'completed';
    return st !== 'completed' && st !== 'partial' && !!d.job_id;
  });
  const processingKey = processingDocs.map((d) => d.job_id).join(',');

  useEffect(() => {
    if (!processingKey) return;
    let cancelled = false;
    const poll = async () => {
      const entries = await Promise.all(
        processingDocs.map(async (d) => {
          try {
            return [d.job_id!, await uploadApi.getStatus(d.job_id!)] as const;
          } catch {
            return [d.job_id!, undefined] as const;
          }
        }),
      );
      if (cancelled) return;
      const anyDone = entries.some(([, s]) => s && s.percent >= 100);
      setStatuses((prev) => {
        const next = { ...prev };
        for (const [jid, s] of entries) if (s) next[jid] = s;
        return next;
      });
      if (anyDone) loadDocuments();
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingKey]);

  const handleResume = async (doc: FileHistoryItem) => {
    if (!doc.job_id) return;
    setResuming((p) => ({ ...p, [doc.job_id!]: true }));
    try {
      await resumeApi.resume(doc.job_id);
    } catch (error) {
      console.error('Resume failed:', error);
    } finally {
      setTimeout(() => setResuming((p) => ({ ...p, [doc.job_id!]: false })), 4000);
    }
  };

  const handleCancel = async (doc: FileHistoryItem) => {
    if (!doc.job_id) return;
    setCancelling((p) => ({ ...p, [doc.job_id!]: true }));
    try {
      await resumeApi.cancel(doc.job_id);
      // Воркер увидит флаг между фрагментами, доработает текущие и встанет на 'partial' —
      // поллинг прогресса (percent>=100) подхватит это и обновит список. Флаг гасим через паузу.
    } catch (error) {
      console.error('Cancel failed:', error);
    } finally {
      setTimeout(() => setCancelling((p) => ({ ...p, [doc.job_id!]: false })), 8000);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await documentsApi.delete(deleteTarget.document_id);
      setDeleteTarget(null);
      await loadDocuments();
      reloadDocuments().catch(() => {});
    } catch (error: any) {
      console.error('Delete failed:', error);
      setDeleteError(error?.response?.data?.detail || error?.message || 'Не удалось удалить документ');
    } finally {
      setDeleting(false);
    }
  };

  const openDocument = async (doc: FileHistoryItem) => {
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
    if (currentDocumentIds.length === 0) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await ragApi.search(searchQuery, 0.5, undefined, currentDocumentIds);
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
    <Box sx={{ maxWidth: 1400, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">История обработанных документов</Typography>
          {currentProject && (
            <Typography color="text.secondary">
              Проект: <strong>{currentProject.name}</strong>
            </Typography>
          )}
        </Box>
        <Button
          variant="contained"
          color="secondary"
          startIcon={<SearchIcon />}
          onClick={() => setSearchDialogOpen(true)}
        >
          Поиск в RAG
        </Button>
      </Box>

      {projects.length === 0 ? (
        <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => navigate('/projects')}>К проектам</Button>}>
          Создайте проект — интерфейс показывает документы выбранного в шапке проекта. Документы без
          проекта можно привязать в разделе «Проекты → Добавить документы».
        </Alert>
      ) : (
      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Документ</TableCell>
              <TableCell>Файл</TableCell>
              <TableCell sx={{ minWidth: 180 }}>Проект</TableCell>
              <TableCell>Сохранён</TableCell>
              <TableCell sx={{ minWidth: 150 }}>Статус</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                Требования /<br />Узлы / Связи
              </TableCell>
              <TableCell>Стоимость</TableCell>
              <TableCell sx={{ width: 170 }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visibleDocuments.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="text.secondary">
                    В проекте «{currentProject?.name}» пока нет документов. Загрузите документ или
                    привяжите существующий через «Проекты → Добавить документы».
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleDocuments.map((doc) => {
              const docStatus = doc.status || 'completed';
              // Три состояния: идёт обработка / завершено с потерями (partial) / готово.
              const isProcessing = docStatus !== 'completed' && docStatus !== 'partial';
              const isPartial = docStatus === 'partial';
              const st = doc.job_id ? statuses[doc.job_id] : undefined;
              const percent = st?.percent ?? 0;
              const stageText = st?.stage ?? 'В очереди';
              // «Завис»: реальная метка АКТИВНОСТИ (st.updated_at) давно не двигалась.
              // Считаем именно по updated_at, НЕ по saved_at — saved_at это время загрузки, и для
              // часовой обработки оно всегда «старое» (давало ложный stale). Пока статуса ещё нет
              // (st === undefined) — не «завис», а «в очереди». Порог STALE_MS заведомо больше
              // нормального разрыва между апдейтами: на фазе LLM бэкенд пишет статус раз в 3
              // фрагмента (~3.5 мин при ~70 с/чанк), плюс запас на фазы конвертации/RAG.
              const lastTouch = st?.updated_at ? parseTs(st.updated_at) : NaN;
              const stale = isProcessing && !Number.isNaN(lastTouch) && Date.now() - lastTouch > STALE_MS;
              const isResuming = doc.job_id ? !!resuming[doc.job_id] : false;
              const isCancelling = doc.job_id ? !!cancelling[doc.job_id] : false;
              return (
                <TableRow key={doc.document_id} hover>
                  <TableCell>
                    <Box>{doc.title || doc.document_id}</Box>
                    {doc.model && (
                      <Chip
                        label={doc.model}
                        size="small"
                        color={doc.model.toLowerCase().startsWith('claude') ? 'secondary' : isDevelonicaModel(doc.model) ? 'success' : isLmStudioModel(doc.model) ? 'warning' : 'info'}
                        sx={{ mt: 0.5, height: 20, fontSize: 11 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>{doc.filename}</TableCell>
                  <TableCell>
                    <FormControl size="small" fullWidth>
                      <Select
                        displayEmpty
                        value={projects.some((p) => p.project_id === doc.project_id) ? doc.project_id : ''}
                        disabled={!!assigning[doc.document_id]}
                        onChange={(e) => handleAssignProject(doc, e.target.value as string)}
                        sx={{ fontSize: 13 }}
                      >
                        <MenuItem value="">
                          <em>— вне проекта —</em>
                        </MenuItem>
                        {projects.map((p) => (
                          <MenuItem key={p.project_id} value={p.project_id}>
                            {p.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{doc.saved_at.replace('T', ' ')}</TableCell>
                  <TableCell>
                    {isProcessing ? (
                      <ProcessingProgress
                        stage={stageText}
                        percent={percent}
                        startedAt={doc.saved_at}
                        stale={stale}
                        compact
                      />
                    ) : isPartial ? (
                      <Tooltip title="Часть фрагментов не обработана (LLM не ответил). Возобновите обработку, чтобы добрать недостающие требования.">
                        <Chip label="Частично" color="warning" size="small" icon={<WarningIcon />} />
                      </Tooltip>
                    ) : (
                      <Chip label="Готово" color="success" size="small" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {isProcessing ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          {st?.requirements ?? 0} требований
                        </Typography>
                        <Typography variant="caption" color="text.disabled">— узлов</Typography>
                        <Typography variant="caption" color="text.disabled">— связей</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" color="text.secondary">
                          {doc.total_requirements} требований
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {doc.stats.total_nodes} узлов
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {doc.stats.total_edges} связей
                        </Typography>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const cost = estCostUsd(doc);
                      if (cost === null) {
                        // Корпоративная LLM (облачная, без публичного тарифа) vs локальная Ollama vs нет данных.
                        if (isDevelonicaModel(doc.model)) {
                          return (
                            <Tooltip
                              title={`Корпоративная LLM Девелоники · вход ${fmtTok(doc.input_tokens)} · выход ${fmtTok(doc.output_tokens)} ток${doc.model ? ' · ' + doc.model : ''}`}
                            >
                              <Typography variant="body2" color="text.secondary" sx={{ cursor: 'help' }}>
                                корпоративная
                              </Typography>
                            </Tooltip>
                          );
                        }
                        const isLocal = !!doc.model && !priceFor(doc.model);
                        if (isLocal) {
                          // Локальная LLM ($-тарифа нет) — вместо цены показываем фактический расход
                          // токенов: сумму прямо в ячейке + разбивку вход/выход в Tooltip, как у
                          // корпоративной/облачной веток.
                          const totalTok = (doc.input_tokens || 0) + (doc.output_tokens || 0);
                          return (
                            <Tooltip
                              title={`Локальная LLM · вход ${fmtTok(doc.input_tokens)} · выход ${fmtTok(doc.output_tokens)} ток${doc.model ? ' · ' + doc.model : ''}`}
                            >
                              <Box sx={{ cursor: 'help' }}>
                                <Typography variant="body2" color="text.secondary">
                                  локально
                                </Typography>
                                {totalTok > 0 && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                                  >
                                    {fmtTok(totalTok)} ток
                                  </Typography>
                                )}
                              </Box>
                            </Tooltip>
                          );
                        }
                        return (
                          <Typography variant="body2" color="text.secondary">
                            —
                          </Typography>
                        );
                      }
                      return (
                        <Tooltip
                          title={`вход ${fmtTok(doc.input_tokens)} · выход ${fmtTok(doc.output_tokens)} ток${doc.model ? ' · ' + doc.model : ''}`}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontVariantNumeric: 'tabular-nums', cursor: 'help', fontWeight: 700 }}
                          >
                            {fmtUsd(cost)}
                          </Typography>
                        </Tooltip>
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={{ width: 170, verticalAlign: 'top' }}>
                    {isProcessing ? (
                      <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5, alignItems: 'stretch' }}>
                        <Tooltip title="Остановить обработку, сохранив уже готовые фрагменты — потом можно «Возобновить»">
                          <span>
                            <Button
                              size="small"
                              color="error"
                              startIcon={<CancelIcon />}
                              disabled={isCancelling || !doc.job_id}
                              onClick={() => handleCancel(doc)}
                              sx={{ justifyContent: 'flex-start' }}
                            >
                              {isCancelling ? 'Отмена…' : 'Отменить'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={stale ? 'Возобновить обработку с последнего сохранённого фрагмента' : 'Идёт обработка…'}>
                          <span>
                            <Button
                              size="small"
                              color="warning"
                              startIcon={<ResumeIcon />}
                              disabled={!stale || isResuming || !doc.job_id}
                              onClick={() => handleResume(doc)}
                              sx={{ justifyContent: 'flex-start' }}
                            >
                              {isResuming ? 'Возобновление…' : 'Возобновить'}
                            </Button>
                          </span>
                        </Tooltip>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5, alignItems: 'stretch' }}>
                        {isPartial && (
                          <Button
                            size="small"
                            color="warning"
                            startIcon={<ResumeIcon />}
                            disabled={isResuming || !doc.job_id}
                            onClick={() => handleResume(doc)}
                            sx={{ justifyContent: 'flex-start' }}
                          >
                            {isResuming ? 'Возобновление…' : 'Возобновить'}
                          </Button>
                        )}
                        <Button
                          size="small"
                          color="primary"
                          startIcon={<ViewIcon />}
                          onClick={() => openDocument(doc)}
                          sx={{ justifyContent: 'flex-start' }}
                        >
                          Просмотр
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => {
                            setDeleteError('');
                            setDeleteTarget(doc);
                          }}
                          sx={{ justifyContent: 'flex-start' }}
                        >
                          Удалить
                        </Button>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="error" />
          Удалить документ?
        </DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ mb: 2 }}>
            Будет безвозвратно удалён документ{' '}
            <strong>{deleteTarget?.title || deleteTarget?.document_id}</strong> и все связанные с ним данные:
          </Typography>
          <Typography component="ul" variant="body2" color="text.secondary" sx={{ pl: 3, mb: 2 }}>
            <li>граф знаний, абзацы и извлечённые требования;</li>
            <li>эмбеддинги (чанки) документа в векторной базе Qdrant;</li>
            <li>служебные записи обработки: чекпойнты, прогресс, сохранённый файл.</li>
          </Typography>
          <Alert severity="warning">Действие необратимо — отменить удаление будет нельзя.</Alert>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Отмена
          </Button>
          <Button
            color="error"
            variant="contained"
            startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Удаление…' : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>

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
