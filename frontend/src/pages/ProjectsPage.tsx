import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Button,
  IconButton,
  Chip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tooltip,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  DeleteOutline as DeleteIcon,
  OpenInNew as OpenIcon,
  WarningAmber as WarningIcon,
  Workspaces as ProjectIcon,
  FolderOff as UnassignedIcon,
  DriveFileMoveOutlined as AssignIcon,
  ArrowDropDown as ArrowDownIcon,
} from '@mui/icons-material';
import { fileApi, projectsApi } from '../api';
import type { FileHistoryItem, Project } from '../types';
import { useProject } from '../hooks/useProject';

export function ProjectsPage() {
  const navigate = useNavigate();
  // Любое изменение состава проектов синхронизируем с глобальным селектором в шапке.
  // documents — общий список из контекста: по нему вычисляем «документы вне проектов»
  // (project_id пуст/отсутствует), которые иначе не видны ни в одном списке интерфейса.
  const { reloadProjects, documents, documentsLoading, reloadDocuments } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Назначение проекта бесхозному документу (меню по кнопке «Назначить проект»).
  const [assignAnchor, setAssignAnchor] = useState<null | HTMLElement>(null);
  const [assignDoc, setAssignDoc] = useState<FileHistoryItem | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Диалог создания/редактирования. editTarget=null → создание, иначе редактирование.
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Диалог удаления.
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = async () => {
    try {
      const data = await projectsApi.list();
      setProjects(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditTarget(null);
    setName('');
    setDescription('');
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditTarget(p);
    setName(p.name);
    setDescription(p.description || '');
    setFormError('');
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setFormError('Введите название проекта');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editTarget) {
        await projectsApi.update(editTarget.project_id, name.trim(), description.trim());
      } else {
        await projectsApi.create(name.trim(), description.trim());
      }
      setFormOpen(false);
      await load();
      reloadProjects().catch(() => {});
    } catch (e) {
      console.error('Save project failed:', e);
      setFormError('Не удалось сохранить проект');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      // Сначала отвязываем все документы проекта (бэкенд удаляет только саму запись проекта),
      // чтобы в graphs не осталось висячего project_id. Документы при этом сохраняются.
      const docs = await fileApi.getHistory();
      const mine = docs.filter((d) => d.project_id === deleteTarget.project_id);
      await Promise.all(mine.map((d) => projectsApi.assign(d.document_id, '')));
      await projectsApi.delete(deleteTarget.project_id);
      setDeleteTarget(null);
      await load();
      // Обновляем шапку (активный проект мог быть удалён) и общий список документов (часть отвязана).
      reloadProjects().catch(() => {});
      reloadDocuments().catch(() => {});
    } catch (e) {
      console.error('Delete project failed:', e);
      setDeleteError('Не удалось удалить проект');
    } finally {
      setDeleting(false);
    }
  };

  // Документы «вне проектов»: project_id пуст/отсутствует. Попадают сюда после «Убрать из
  // проекта» (ProjectDetailPage) или удаления проекта — это единственное место, где их видно.
  const unassigned = documents.filter((d) => !d.project_id);

  const openAssignMenu = (e: React.MouseEvent<HTMLElement>, doc: FileHistoryItem) => {
    setAssignAnchor(e.currentTarget);
    setAssignDoc(doc);
  };
  const closeAssignMenu = () => {
    setAssignAnchor(null);
    setAssignDoc(null);
  };

  const handleAssign = async (projectId: string) => {
    if (!assignDoc) return;
    const docId = assignDoc.document_id;
    setAssigningId(docId);
    closeAssignMenu();
    try {
      await projectsApi.assign(docId, projectId);
      await load(); // обновляем document_count проектов
      reloadProjects().catch(() => {}); // и счётчик в шапке
      await reloadDocuments(); // пересчитываем список бесхозных
    } catch (e) {
      console.error('Assign project failed:', e);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Проекты</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Новый проект
        </Button>
      </Box>

      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Проект объединяет обработанные документы в одну группу — для сводного реестра требований и
        общего графа знаний.
      </Typography>

      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Проект</TableCell>
              <TableCell>Описание</TableCell>
              <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>Документов</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>Создан</TableCell>
              <TableCell>Создал</TableCell>
              <TableCell sx={{ width: 160 }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            )}
            {!loading && projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="text.secondary">
                    Пока нет ни одного проекта. Создайте первый кнопкой «Новый проект».
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {projects.map((p) => (
              <TableRow key={p.project_id} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ProjectIcon fontSize="small" color="action" />
                    <Typography sx={{ fontWeight: 600 }}>{p.name}</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ maxWidth: 360, color: 'text.secondary' }}>
                  {p.description || '—'}
                </TableCell>
                <TableCell align="center">
                  <Chip label={p.document_count} size="small" color={p.document_count ? 'primary' : 'default'} />
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {(p.created_at || '').replace('T', ' ')}
                </TableCell>
                <TableCell>{p.created_by || '—'}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Открыть проект">
                      <IconButton size="small" color="primary" onClick={() => navigate(`/projects/${p.project_id}`)}>
                        <OpenIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Переименовать / изменить описание">
                      <IconButton size="small" onClick={() => openEdit(p)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Удалить проект">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(p);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Документы вне проектов — «спасательный» список: иначе после «Убрать из проекта»
          (или удаления проекта) документ не виден ни в одном фильтруемом по проекту списке. */}
      {!documentsLoading && unassigned.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <UnassignedIcon fontSize="small" color="action" />
            <Typography variant="h6">Документы вне проектов ({unassigned.length})</Typography>
          </Box>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Эти документы не привязаны ни к одному проекту и не видны в Истории/реестре (они
            фильтруются по активному проекту). Назначьте им проект, чтобы вернуть в работу.
          </Typography>
          <TableContainer component={Paper} elevation={2}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Документ</TableCell>
                  <TableCell>Файл</TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>Требований</TableCell>
                  <TableCell sx={{ width: 200 }}>Действия</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {unassigned.map((d) => (
                  <TableRow key={d.document_id} hover>
                    <TableCell>{d.title || d.document_id}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{d.filename}</TableCell>
                    <TableCell align="center">{d.total_requirements}</TableCell>
                    <TableCell>
                      <Tooltip title={projects.length === 0 ? 'Сначала создайте проект' : 'Назначить проект'}>
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AssignIcon />}
                            endIcon={<ArrowDownIcon />}
                            disabled={projects.length === 0 || assigningId === d.document_id}
                            onClick={(e) => openAssignMenu(e, d)}
                          >
                            {assigningId === d.document_id ? 'Назначение…' : 'Назначить проект'}
                          </Button>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Меню выбора проекта для бесхозного документа */}
      <Menu anchorEl={assignAnchor} open={!!assignAnchor} onClose={closeAssignMenu}>
        {projects.map((p) => (
          <MenuItem key={p.project_id} onClick={() => handleAssign(p.project_id)}>
            <ProjectIcon fontSize="small" color="action" sx={{ mr: 1 }} />
            {p.name}
          </MenuItem>
        ))}
      </Menu>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editTarget ? 'Редактирование проекта' : 'Новый проект'}</DialogTitle>
        <DialogContent dividers>
          <TextField
            autoFocus
            fullWidth
            label="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            fullWidth
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
          {formError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {formError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>
            Отмена
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="error" />
          Удалить проект?
        </DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ mb: 2 }}>
            Будет удалён проект <strong>{deleteTarget?.name}</strong>.
          </Typography>
          <Alert severity="info">
            Документы проекта НЕ удаляются — они лишь отвязываются от проекта и остаются в Истории.
          </Alert>
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
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Удаление…' : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
