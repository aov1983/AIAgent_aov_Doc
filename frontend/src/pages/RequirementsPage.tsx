import { useEffect, useMemo, useState } from 'react';
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
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { Assignment as AssignmentIcon } from '@mui/icons-material';
import { requirementsApi } from '../api';
import type { ExtractedRequirement } from '../types';
import { useProject } from '../hooks/useProject';

type Filter = 'all' | 'ФТ' | 'НФТ';

const criticalityColor = (c: string): 'error' | 'warning' | 'info' | 'default' => {
  if (c === 'Высокий') return 'error';
  if (c === 'Средний') return 'warning';
  if (c === 'Низкий') return 'info';
  return 'default';
};

const typeColor = (t: string): 'primary' | 'secondary' | 'default' => {
  if (t === 'ФТ') return 'primary';
  if (t === 'НФТ') return 'secondary';
  return 'default';
};

export function RequirementsPage() {
  // Документы активного проекта (из шапки). При смене проекта список и выбор пересобираются.
  const { currentDocuments: documents, currentProject, documentsLoading: docsLoading } = useProject();
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [requirements, setRequirements] = useState<ExtractedRequirement[]>([]);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  // Держим выбранный документ внутри активного проекта: если он выпал из списка (сменили проект) —
  // переключаемся на первый доступный, иначе сбрасываем.
  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocId('');
      return;
    }
    setSelectedDocId((prev) =>
      prev && documents.some((d) => d.document_id === prev) ? prev : documents[0].document_id,
    );
  }, [documents]);

  useEffect(() => {
    if (!selectedDocId) {
      setRequirements([]);
      return;
    }
    setReqsLoading(true);
    setError('');
    requirementsApi
      .getByDocument(selectedDocId)
      .then((rows) => setRequirements(Array.isArray(rows) ? rows : []))
      .catch(() => setError('Не удалось загрузить требования по документу'))
      .finally(() => setReqsLoading(false));
  }, [selectedDocId]);

  const filtered = useMemo(() => {
    if (filter === 'all') return requirements;
    return requirements.filter((r) => r.type === filter);
  }, [requirements, filter]);

  const counts = useMemo(() => {
    const c = { ФТ: 0, НФТ: 0, other: 0 };
    for (const r of requirements) {
      if (r.type === 'ФТ') c.ФТ += 1;
      else if (r.type === 'НФТ') c.НФТ += 1;
      else c.other += 1;
    }
    return c;
  }, [requirements]);

  return (
    <Box sx={{ maxWidth: 1300, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <AssignmentIcon sx={{ mr: 1, color: 'primary.main', fontSize: 32 }} />
        <Typography variant="h4">Требования</Typography>
      </Box>

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <FormControl fullWidth sx={{ mb: 2 }} disabled={docsLoading || documents.length === 0}>
          <InputLabel id="doc-select-label">Документ</InputLabel>
          <Select
            labelId="doc-select-label"
            label="Документ"
            value={selectedDocId}
            onChange={(e) => setSelectedDocId(e.target.value as string)}
          >
            {documents.map((d) => (
              <MenuItem key={d.document_id} value={d.document_id}>
                {d.title || d.document_id} ({d.filename})
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {docsLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {!docsLoading && documents.length === 0 && (
          <Alert severity="info">
            {currentProject
              ? `В проекте «${currentProject.name}» нет документов. Загрузите документ или привяжите существующий через «Проекты → Добавить документы».`
              : 'Создайте проект и выберите его в шапке, чтобы работать с требованиями.'}
          </Alert>
        )}

        {requirements.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              value={filter}
              exclusive
              size="small"
              onChange={(_, v) => v && setFilter(v)}
            >
              <ToggleButton value="all">Все ({requirements.length})</ToggleButton>
              <ToggleButton value="ФТ">ФТ ({counts.ФТ})</ToggleButton>
              <ToggleButton value="НФТ">НФТ ({counts.НФТ})</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {reqsLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!reqsLoading && selectedDocId && requirements.length === 0 && !error && (
        <Alert severity="info">
          Для выбранного документа извлечённых требований нет. Возможно, документ был обработан до добавления этого шага -
          загрузите его повторно.
        </Alert>
      )}

      {!reqsLoading && filtered.length > 0 && (
        <Paper elevation={2}>
          <TableContainer sx={{ maxHeight: 720 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 80 }}>Тип</TableCell>
                  <TableCell sx={{ minWidth: 200 }}>Название</TableCell>
                  <TableCell sx={{ minWidth: 280 }}>Формулировка</TableCell>
                  <TableCell sx={{ minWidth: 260 }}>Факт</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>Риск</TableCell>
                  <TableCell sx={{ width: 110 }}>Критичность</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((r, i) => (
                  <TableRow key={i} hover>
                    <TableCell>
                      <Chip label={r.type} size="small" color={typeColor(r.type) as any} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {r.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{r.statement}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{r.fact}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {r.risk}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={r.criticality}
                        size="small"
                        color={criticalityColor(r.criticality) as any}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
