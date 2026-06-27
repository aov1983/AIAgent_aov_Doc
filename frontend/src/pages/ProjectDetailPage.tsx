import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Button,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  PlaylistAdd as AddDocsIcon,
  LinkOff as UnlinkIcon,
  Description as DocxIcon,
  Architecture as ArchIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { architectureApi, fileApi, graphApi, projectsApi, requirementsApi } from '../api';
import type {
  ExtractedRequirement,
  FileHistoryItem,
  GraphData,
  Project,
  ProjectArchitecture,
} from '../types';
import { GraphCard } from '../components/GraphCard';
import { MermaidDiagram } from '../components/MermaidDiagram';
import { useProject } from '../hooks/useProject';
import { downloadRequirementsDocx } from '../utils/requirementsDocx';

const SERIF = '"Times New Roman", "Liberation Serif", Georgia, serif';
const BORDER = '1px solid #000';

type ReqWithSource = ExtractedRequirement & { __doc: string };

// Таблица требований одного типа со столбцом «Документ» (сводный реестр проекта).
function ProjectReqSection({ number, title, items }: { number: number; title: string; items: ReqWithSource[] }) {
  return (
    <Box sx={{ mb: 5 }}>
      <Typography component="h2" sx={{ fontFamily: SERIF, fontWeight: 700, fontSize: '1.4rem', color: '#000', mb: 2 }}>
        {number}. {title}
      </Typography>
      {items.length === 0 ? (
        <Typography sx={{ fontFamily: SERIF, color: '#444', fontStyle: 'italic' }}>
          Требований этого типа в документах проекта не выявлено.
        </Typography>
      ) : (
        <Box
          component="table"
          sx={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: SERIF,
            fontSize: '1.05rem',
            color: '#000',
            '& th, & td': { border: BORDER, padding: '8px 12px', verticalAlign: 'top', textAlign: 'left' },
            '& th': { bgcolor: '#e6e6e6', fontWeight: 700 },
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ width: '5%' }}>№</Box>
              <Box component="th" sx={{ width: '18%' }}>Наименование</Box>
              <Box component="th" sx={{ width: '30%' }}>Описание</Box>
              <Box component="th" sx={{ width: '22%' }}>Риск</Box>
              <Box component="th" sx={{ width: '10%' }}>Критичность</Box>
              <Box component="th" sx={{ width: '15%' }}>Документ</Box>
            </Box>
          </Box>
          <Box component="tbody">
            {items.map((r, i) => (
              <Box component="tr" key={i}>
                <Box component="td" sx={{ textAlign: 'center', fontWeight: 600 }}>{number}.{i + 1}</Box>
                <Box component="td">{r.title || '-'}</Box>
                <Box component="td" sx={{ textAlign: 'justify', lineHeight: 1.3 }}>{r.statement}</Box>
                <Box component="td" sx={{ textAlign: 'justify', lineHeight: 1.3 }}>{r.risk || '-'}</Box>
                <Box component="td" sx={{ textAlign: 'center' }}>{r.criticality || '-'}</Box>
                <Box component="td" sx={{ color: '#555', fontSize: '0.9rem' }}>{r.__doc}</Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  // Открытие проекта делает его активным в шапке + синхронизирует общий список после привязок.
  const { setCurrentProjectId, reloadProjects, reloadDocuments } = useProject();

  const [project, setProject] = useState<Project | null>(null);
  const [allDocs, setAllDocs] = useState<FileHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);

  // Привязка документов.
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [linking, setLinking] = useState(false);

  // Сводный реестр требований (ленивая загрузка при первом открытии вкладки).
  const [reqs, setReqs] = useState<ReqWithSource[] | null>(null);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Сводный граф (ленивая загрузка).
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Архитектура проекта (LLM + C4): ленивая загрузка сохранённой + генерация по кнопке.
  const [arch, setArch] = useState<ProjectArchitecture | null>(null);
  const [archLoading, setArchLoading] = useState(false);
  const [archGenerating, setArchGenerating] = useState(false);

  const docsInProject = useMemo(
    () => allDocs.filter((d) => d.project_id === projectId),
    [allDocs, projectId],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [projects, docs] = await Promise.all([projectsApi.list(), fileApi.getHistory()]);
      setProject(projects.find((p) => p.project_id === projectId) || null);
      setAllDocs(Array.isArray(docs) ? docs : []);
    } catch (e) {
      console.error('Failed to load project:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (projectId) setCurrentProjectId(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Любое изменение состава документов проекта инвалидирует сводные представления.
  const invalidateAggregates = () => {
    setReqs(null);
    setGraph(null);
    // Сохранённая архитектура устарела при смене состава — перечитаем при следующем открытии вкладки.
    setArch(null);
  };

  const handleLinkPicked = async () => {
    const ids = Object.keys(picked).filter((id) => picked[id]);
    if (ids.length === 0) {
      setAddOpen(false);
      return;
    }
    setLinking(true);
    try {
      await Promise.all(ids.map((id) => projectsApi.assign(id, projectId)));
      setAddOpen(false);
      setPicked({});
      invalidateAggregates();
      await load();
      reloadDocuments().catch(() => {});
      reloadProjects().catch(() => {});
    } catch (e) {
      console.error('Link documents failed:', e);
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (doc: FileHistoryItem) => {
    try {
      await projectsApi.assign(doc.document_id, '');
      invalidateAggregates();
      await load();
      reloadDocuments().catch(() => {});
      reloadProjects().catch(() => {});
    } catch (e) {
      console.error('Unlink failed:', e);
    }
  };

  // Сводный реестр: собираем требования по всем документам проекта, помечаем источником.
  const loadRequirements = async () => {
    setReqsLoading(true);
    try {
      const lists = await Promise.all(
        docsInProject.map(async (d) => {
          const rows = await requirementsApi.getByDocument(d.document_id).catch(() => [] as ExtractedRequirement[]);
          const label = d.title || d.filename || d.document_id;
          return (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, __doc: label } as ReqWithSource));
        }),
      );
      setReqs(lists.flat());
    } finally {
      setReqsLoading(false);
    }
  };

  // Сводный граф: объединяем графы документов (узлы dedupe по id, рёбра конкатенируем).
  const loadGraph = async () => {
    setGraphLoading(true);
    try {
      const graphs = await Promise.all(
        docsInProject.map((d) => graphApi.getByDocument(d.document_id).catch(() => null)),
      );
      const nodeMap = new Map<string, GraphData['nodes'][number]>();
      const edges: GraphData['edges'] = [];
      let paragraphs = 0;
      let chunks = 0;
      for (const g of graphs) {
        if (!g) continue;
        for (const n of g.nodes || []) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
        for (const e of g.edges || []) edges.push(e);
        paragraphs += g.stats?.paragraphs || 0;
        chunks += g.stats?.chunks || 0;
      }
      const nodes = [...nodeMap.values()];
      setGraph({
        nodes,
        edges,
        stats: {
          total_nodes: nodes.length,
          total_edges: edges.length,
          paragraphs,
          chunks,
          intersections: edges.filter((e) => e.type === 'intersects').length,
          external_docs: nodes.filter((n) => n.type === 'external').length,
        },
      });
    } finally {
      setGraphLoading(false);
    }
  };

  // Архитектура: подгрузка сохранённой версии.
  const loadArch = async () => {
    setArchLoading(true);
    try {
      setArch(await architectureApi.get(projectId));
    } catch (e) {
      console.error('Failed to load architecture:', e);
      setArch(null);
    } finally {
      setArchLoading(false);
    }
  };

  // Архитектура: запуск LLM-генерации (вывод архитектуры решения из требований проекта).
  const generateArch = async () => {
    setArchGenerating(true);
    try {
      setArch(await architectureApi.generate(projectId));
    } catch (e) {
      console.error('Generate architecture failed:', e);
    } finally {
      setArchGenerating(false);
    }
  };

  const { ft, nft } = useMemo(() => {
    const ft: ReqWithSource[] = [];
    const nft: ReqWithSource[] = [];
    for (const r of reqs || []) {
      if (r.type === 'ФТ') ft.push(r);
      else if (r.type === 'НФТ') nft.push(r);
    }
    return { ft, nft };
  }, [reqs]);

  const handleTabChange = (next: number) => {
    setTab(next);
    if (next === 1 && reqs === null && !reqsLoading) loadRequirements();
    if (next === 2 && graph === null && !graphLoading) loadGraph();
    if (next === 3 && arch === null && !archLoading && !archGenerating) loadArch();
  };

  const handleDownloadDocx = async () => {
    setDownloading(true);
    try {
      await downloadRequirementsDocx(ft, nft, project?.name || 'Проект');
    } finally {
      setDownloading(false);
    }
  };

  const candidates = allDocs.filter((d) => d.project_id !== projectId);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!project) {
    return (
      <Box sx={{ maxWidth: 1000, mx: 'auto', p: 3 }}>
        <Button startIcon={<BackIcon />} onClick={() => navigate('/projects')} sx={{ mb: 2 }}>
          К списку проектов
        </Button>
        <Alert severity="warning">Проект не найден. Возможно, он был удалён.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Button startIcon={<BackIcon />} onClick={() => navigate('/projects')} sx={{ mb: 2 }}>
        К списку проектов
      </Button>
      <Typography variant="h4" sx={{ mb: 0.5 }}>{project.name}</Typography>
      {project.description && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>{project.description}</Typography>
      )}

      <Tabs value={tab} onChange={(_, v) => handleTabChange(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={`Документы (${docsInProject.length})`} />
        <Tab label="Сводный реестр требований" />
        <Tab label="Сводный граф" />
        <Tab label="Архитектура" />
      </Tabs>

      {/* TAB 0: документы проекта */}
      {tab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddDocsIcon />} onClick={() => { setPicked({}); setAddOpen(true); }}>
              Добавить документы
            </Button>
          </Box>
          <TableContainer component={Paper} elevation={2}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Документ</TableCell>
                  <TableCell>Файл</TableCell>
                  <TableCell align="right">Требований</TableCell>
                  <TableCell sx={{ width: 120 }}>Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {docsInProject.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography color="text.secondary">
                        В проекте пока нет документов. Добавьте их кнопкой «Добавить документы».
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {docsInProject.map((d) => (
                  <TableRow key={d.document_id} hover>
                    <TableCell>{d.title || d.document_id}</TableCell>
                    <TableCell>{d.filename}</TableCell>
                    <TableCell align="right">{d.total_requirements}</TableCell>
                    <TableCell>
                      <Tooltip title="Убрать из проекта (документ останется в Истории)">
                        <IconButton size="small" color="warning" onClick={() => handleUnlink(d)}>
                          <UnlinkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* TAB 1: сводный реестр требований */}
      {tab === 1 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="outlined"
              startIcon={<DocxIcon />}
              onClick={handleDownloadDocx}
              disabled={downloading || reqsLoading || ft.length + nft.length === 0}
            >
              {downloading ? 'Формирование…' : 'Скачать DOCX'}
            </Button>
          </Box>
          {reqsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!reqsLoading && docsInProject.length === 0 && (
            <Alert severity="info">Добавьте документы в проект, чтобы увидеть сводный реестр.</Alert>
          )}
          {!reqsLoading && docsInProject.length > 0 && ft.length + nft.length === 0 && (
            <Alert severity="info">В документах проекта извлечённых требований нет.</Alert>
          )}
          {!reqsLoading && ft.length + nft.length > 0 && (
            <Paper
              elevation={3}
              sx={{ bgcolor: '#fff', color: '#000', px: { xs: 4, md: 8 }, py: { xs: 4, md: 6 }, border: '1px solid #d0d0d0', borderRadius: 0 }}
            >
              <ProjectReqSection number={1} title="Функциональные требования" items={ft} />
              <ProjectReqSection number={2} title="Нефункциональные требования" items={nft} />
            </Paper>
          )}
        </Box>
      )}

      {/* TAB 2: сводный граф */}
      {tab === 2 && (
        <Box>
          {graphLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          )}
          {!graphLoading && docsInProject.length === 0 && (
            <Alert severity="info">Добавьте документы в проект, чтобы построить сводный граф.</Alert>
          )}
          {!graphLoading && graph && graph.nodes.length > 0 && (
            <GraphCard
              graph={graph}
              downloadName={`project_graph_${project.project_id}.json`}
              title={`Сводный граф знаний проекта «${project.name}»`}
              resetKey={project.project_id}
              paperVariant="outlined"
            />
          )}
          {!graphLoading && graph && graph.nodes.length === 0 && docsInProject.length > 0 && (
            <Alert severity="info">Для документов проекта графы не найдены.</Alert>
          )}
        </Box>
      )}

      {/* TAB 3: архитектура проекта (LLM выводит архитектуру решения + диаграммы C4) */}
      {tab === 3 && (
        <Box>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              mb: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {arch?.status === 'ready' && arch.generated_at && (
                <Typography variant="body2" color="text.secondary">
                  Сгенерировано: {new Date(arch.generated_at).toLocaleString('ru-RU')}
                </Typography>
              )}
              {arch?.status === 'ready' && arch.model && (
                <Chip size="small" variant="outlined" label={arch.model} />
              )}
            </Box>
            <Button
              variant="contained"
              startIcon={<ArchIcon />}
              onClick={generateArch}
              disabled={archGenerating || archLoading || docsInProject.length === 0}
            >
              {archGenerating
                ? 'Генерация…'
                : arch?.status === 'ready'
                  ? 'Обновить'
                  : 'Сгенерировать архитектуру'}
            </Button>
          </Box>

          {docsInProject.length === 0 && (
            <Alert severity="info">
              Добавьте документы в проект, чтобы вывести архитектуру решения из их требований.
            </Alert>
          )}

          {docsInProject.length > 0 && (archLoading || archGenerating) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, p: 4 }}>
              <CircularProgress />
              {archGenerating && (
                <Typography color="text.secondary" sx={{ textAlign: 'center' }}>
                  LLM анализирует требования проекта и выводит архитектуру. Это может занять 1–3 минуты…
                </Typography>
              )}
            </Box>
          )}

          {docsInProject.length > 0 &&
            !archLoading &&
            !archGenerating &&
            (!arch || arch.status === 'none') && (
              <Alert severity="info">
                Архитектура ещё не сгенерирована. Нажмите «Сгенерировать архитектуру» — LLM выведет
                технологический стек, ключевые решения и диаграммы C4 (Context + Container) на основе
                требований документов проекта.
              </Alert>
            )}

          {docsInProject.length > 0 &&
            !archLoading &&
            !archGenerating &&
            arch &&
            arch.status === 'empty' && (
              <Alert severity="warning">
                {(arch.summary_md || '').replace(/^>\s*/, '') ||
                  'Недостаточно данных для генерации архитектуры.'}
              </Alert>
            )}

          {!archLoading &&
            !archGenerating &&
            arch &&
            (arch.status === 'ready' || arch.status === 'error') && (
              <Box>
                {arch.summary_md && (
                  <Paper elevation={2} sx={{ p: { xs: 2, md: 4 }, mb: 3 }}>
                    <Box sx={{ '& h2': { mt: 0 }, '& h3': { mt: 2 }, '& ul': { pl: 3 } }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{arch.summary_md}</ReactMarkdown>
                    </Box>
                  </Paper>
                )}
                {arch.c4_context && (
                  <Paper elevation={2} sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      C4 — Контекст системы
                    </Typography>
                    <MermaidDiagram code={arch.c4_context} />
                  </Paper>
                )}
                {arch.c4_container && (
                  <Paper elevation={2} sx={{ p: { xs: 2, md: 3 } }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      C4 — Контейнеры
                    </Typography>
                    <MermaidDiagram code={arch.c4_container} />
                  </Paper>
                )}
              </Box>
            )}
        </Box>
      )}

      {/* Диалог добавления документов */}
      <Dialog open={addOpen} onClose={() => !linking && setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Добавить документы в проект</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {candidates.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Typography color="text.secondary">
                Все документы уже привязаны к этому проекту или других документов нет.
              </Typography>
            </Box>
          ) : (
            <List dense>
              {candidates.map((d) => (
                <ListItem key={d.document_id} disablePadding>
                  <ListItemButton onClick={() => setPicked((p) => ({ ...p, [d.document_id]: !p[d.document_id] }))}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Checkbox edge="start" checked={!!picked[d.document_id]} tabIndex={-1} disableRipple />
                    </ListItemIcon>
                    <ListItemText
                      primary={d.title || d.document_id}
                      secondary={
                        <>
                          {d.filename}
                          {d.project_id ? (
                            <Chip label="в другом проекте" size="small" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                          ) : null}
                        </>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)} disabled={linking}>
            Отмена
          </Button>
          <Button variant="contained" onClick={handleLinkPicked} disabled={linking || candidates.length === 0}>
            {linking ? 'Добавление…' : 'Добавить выбранные'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
