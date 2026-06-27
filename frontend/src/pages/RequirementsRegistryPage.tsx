import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Button,
} from '@mui/material';
import { Description as DocxIcon } from '@mui/icons-material';
import { requirementsApi } from '../api';
import type { ExtractedRequirement } from '../types';
import { useProject } from '../hooks/useProject';
import { downloadRequirementsDocx } from '../utils/requirementsDocx';

const SERIF = '"Times New Roman", "Liberation Serif", Georgia, serif';
const BORDER = '1px solid #000';

interface SectionProps {
  number: number;
  title: string;
  items: ExtractedRequirement[];
}

function DocSection({ number, title, items }: SectionProps) {
  return (
    <Box sx={{ mb: 5 }}>
      <Typography
        component="h2"
        sx={{
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: '1.4rem',
          color: '#000',
          mb: 2,
        }}
      >
        {number}. {title}
      </Typography>

      {items.length === 0 ? (
        <Typography sx={{ fontFamily: SERIF, color: '#444', fontStyle: 'italic' }}>
          Требований этого типа в документе не выявлено.
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
            '& th, & td': {
              border: BORDER,
              padding: '8px 12px',
              verticalAlign: 'top',
              textAlign: 'left',
            },
            '& th': {
              bgcolor: '#e6e6e6',
              fontWeight: 700,
            },
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ width: '6%' }}>№</Box>
              <Box component="th" sx={{ width: '22%' }}>Наименование</Box>
              <Box component="th" sx={{ width: '34%' }}>Описание</Box>
              <Box component="th" sx={{ width: '26%' }}>Риск</Box>
              <Box component="th" sx={{ width: '12%' }}>Критичность</Box>
            </Box>
          </Box>
          <Box component="tbody">
            {items.map((r, i) => (
              <Box component="tr" key={i}>
                <Box component="td" sx={{ textAlign: 'center', fontWeight: 600 }}>
                  {number}.{i + 1}
                </Box>
                <Box component="td">{r.title || '-'}</Box>
                <Box component="td" sx={{ textAlign: 'justify', lineHeight: 1.3 }}>
                  {r.statement}
                </Box>
                <Box component="td" sx={{ textAlign: 'justify', lineHeight: 1.3 }}>
                  {r.risk || '-'}
                </Box>
                <Box component="td" sx={{ textAlign: 'center' }}>
                  {r.criticality || '-'}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export function RequirementsRegistryPage() {
  // Документы активного проекта (из шапки). Реестр строится только по ним.
  const { currentDocuments: documents, currentProject, documentsLoading: docsLoading } = useProject();
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [requirements, setRequirements] = useState<ExtractedRequirement[]>([]);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [error, setError] = useState('');

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

  const { ft, nft } = useMemo(() => {
    const ft: ExtractedRequirement[] = [];
    const nft: ExtractedRequirement[] = [];
    for (const r of requirements) {
      if (r.type === 'ФТ') ft.push(r);
      else if (r.type === 'НФТ') nft.push(r);
    }
    return { ft, nft };
  }, [requirements]);

  const hasAny = ft.length + nft.length > 0;

  const selectedDoc = documents.find((d) => d.document_id === selectedDocId);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadRequirementsDocx(ft, nft, selectedDoc?.title || selectedDoc?.filename || '');
    } catch {
      setError('Не удалось сформировать DOCX');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <FormControl
          fullWidth
          size="small"
          disabled={docsLoading || documents.length === 0}
        >
          <InputLabel id="reg-doc-select">Документ</InputLabel>
          <Select
            labelId="reg-doc-select"
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

        <Button
          variant="outlined"
          startIcon={<DocxIcon />}
          onClick={handleDownload}
          disabled={!hasAny || downloading || reqsLoading}
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {downloading ? 'Формирование…' : 'Скачать DOCX'}
        </Button>
      </Box>

      {docsLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!docsLoading && documents.length === 0 && (
        <Alert severity="info">
          {currentProject
            ? `В проекте «${currentProject.name}» нет документов. Загрузите документ или привяжите существующий через «Проекты → Добавить документы».`
            : 'Создайте проект и выберите его в шапке, чтобы построить реестр требований.'}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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

      {!reqsLoading && hasAny && (
        <Paper
          elevation={3}
          sx={{
            bgcolor: '#fff',
            color: '#000',
            px: { xs: 5, md: 10 },
            py: { xs: 5, md: 8 },
            border: '1px solid #d0d0d0',
            borderRadius: 0,
          }}
        >
          <DocSection number={1} title="Функциональные требования" items={ft} />
          <DocSection number={2} title="Нефункциональные требования" items={nft} />
        </Paper>
      )}
    </Box>
  );
}
