import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  IconButton,
  CircularProgress,
  Alert,
  MenuItem,
  Chip,
  Stack,
  Divider,
} from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import { chatApi } from '../api';
import type { ChatMessage, ChatSource } from '../types';
import { useProject } from '../hooks/useProject';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

export function ChatPage() {
  // Контекст чата ограничен активным проектом: список документов и режим «по всей базе» — только
  // его документы (передаём их document_ids в RAG как includeDocumentIds).
  const { currentDocuments: documents, currentDocumentIds } = useProject();
  const [documentId, setDocumentId] = useState<string>('');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // При смене проекта сбрасываем выбранный документ, если он больше не в проекте.
  useEffect(() => {
    setDocumentId((prev) => (prev && documents.some((d) => d.document_id === prev) ? prev : ''));
  }, [documents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  const history: ChatMessage[] = useMemo(
    () => turns.map((t) => ({ role: t.role, content: t.content })),
    [turns],
  );

  const handleSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    // Режим «по всей базе» внутри проекта требует непустого набора документов: иначе бэкенд снял бы
    // фильтр и искал по всем проектам. Нет конкретного документа и нет документов в проекте — стоп.
    if (!documentId && currentDocumentIds.length === 0) {
      setError('В проекте нет документов для поиска контекста. Добавьте документы в проект.');
      return;
    }

    setError(null);
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    setLoading(true);

    try {
      const data = await chatApi.ask(
        message,
        documentId || undefined,
        history,
        documentId ? undefined : currentDocumentIds,
      );
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer || '(пустой ответ)', sources: data.sources },
      ]);
    } catch (e: any) {
      console.error('Chat failed:', e);
      setError(e?.response?.data?.detail || 'Не удалось получить ответ');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setTurns([]);
    setError(null);
  };

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', p: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4">Чат по документам</Typography>
        <Chip label="Очистить" onClick={handleClear} variant="outlined" size="small" />
      </Stack>

      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <TextField
          select
          fullWidth
          size="small"
          label="Документ (опционально — иначе по всем документам проекта)"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
        >
          <MenuItem value="">Все документы проекта</MenuItem>
          {documents.map((d) => (
            <MenuItem key={d.document_id} value={d.document_id}>
              {d.title || d.filename || d.document_id}
            </MenuItem>
          ))}
        </TextField>
      </Paper>

      <Paper
        elevation={2}
        sx={{
          flexGrow: 1,
          p: 2,
          overflowY: 'auto',
          bgcolor: 'grey.50',
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {turns.length === 0 && (
          <Typography color="text.secondary" sx={{ m: 'auto', textAlign: 'center' }}>
            Задайте вопрос по содержимому документа.
          </Typography>
        )}

        {turns.map((t, i) => (
          <Box
            key={i}
            sx={{
              alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              bgcolor: t.role === 'user' ? 'primary.main' : 'background.paper',
              color: t.role === 'user' ? 'primary.contrastText' : 'text.primary',
              border: t.role === 'assistant' ? '1px solid' : 'none',
              borderColor: 'divider',
              borderRadius: 2,
              px: 2,
              py: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <Typography variant="body2">{t.content}</Typography>

            {t.role === 'assistant' && t.sources && t.sources.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  Источники:
                </Typography>
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  {t.sources.map((s) => (
                    <Box key={s.chunk_id} sx={{ fontSize: 12 }}>
                      <Chip
                        size="small"
                        label={`${(s.similarity_score * 100).toFixed(0)}%`}
                        sx={{ mr: 1 }}
                      />
                      <span>{(s.content || '').slice(0, 200)}</span>
                    </Box>
                  ))}
                </Stack>
              </>
            )}
          </Box>
        ))}

        {loading && (
          <Box sx={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              Ассистент думает…
            </Typography>
          </Box>
        )}

        <div ref={bottomRef} />
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      <Paper elevation={1} sx={{ p: 1.5, mt: 2, display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Спросите что-нибудь по документу…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={loading}
          multiline
          maxRows={4}
        />
        <IconButton color="primary" onClick={handleSend} disabled={loading || !input.trim()}>
          <SendIcon />
        </IconButton>
      </Paper>
    </Box>
  );
}
