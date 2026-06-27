import React, { useState } from 'react';
import {
  Container,
  Box,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { LockOutlined, Login as LoginIcon, DnsOutlined } from '@mui/icons-material';
import { useAuth } from '../hooks/useAuth';
import {
  BACKEND_PRESETS,
  CUSTOM_PRESET_ID,
  getBackendBaseUrl,
  setBackendBaseUrl,
  getPresetIdForUrl,
} from '../config/backend';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  // Выбор бэкенда (n8n). presetId — явный стейт (а не производная от baseUrl),
  // иначе при выборе «Свой URL…» список схлопнулся бы обратно на пресет, пока
  // адрес ещё совпадает с ним. Поле адреса показываем только в режиме «Свой URL…».
  const [baseUrl, setBaseUrl] = useState<string>(() => getBackendBaseUrl());
  const [presetId, setPresetId] = useState<string>(() => getPresetIdForUrl(getBackendBaseUrl()));

  // Сохраняем сразу при любом изменении: axios-интерсептор читает localStorage
  // на каждый запрос, поэтому к моменту login() адрес уже актуален.
  const applyBaseUrl = (url: string) => {
    setBaseUrl(url);
    setBackendBaseUrl(url);
  };

  const handlePresetChange = (e: SelectChangeEvent) => {
    const id = e.target.value;
    setPresetId(id);
    if (id === CUSTOM_PRESET_ID) return; // «Свой URL» — поле редактируемое, адрес правит пользователь
    const preset = BACKEND_PRESETS.find((p) => p.id === id);
    if (preset) applyBaseUrl(preset.url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <LockOutlined sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
          <Typography component="h1" variant="h4" sx={{ mb: 3 }}>
            AI Architect Agent
          </Typography>
          <Typography component="h2" variant="h6" sx={{ mb: 3 }}>
            Вход в систему
          </Typography>

          {error && (
            <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%' }}>
            <FormControl fullWidth margin="normal">
              <InputLabel id="backend-select-label">Бэкенд</InputLabel>
              <Select
                labelId="backend-select-label"
                id="backend-select"
                label="Бэкенд"
                value={presetId}
                onChange={handlePresetChange}
                disabled={loading}
                startAdornment={<DnsOutlined sx={{ mr: 1, color: 'action.active' }} />}
              >
                {BACKEND_PRESETS.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
                <MenuItem value={CUSTOM_PRESET_ID}>Свой URL…</MenuItem>
              </Select>
            </FormControl>
            {presetId === CUSTOM_PRESET_ID && (
              <TextField
                margin="dense"
                fullWidth
                id="backend-url"
                label="Адрес бэкенда (base URL)"
                name="backend-url"
                value={baseUrl}
                onChange={(e) => applyBaseUrl(e.target.value)}
                disabled={loading}
              />
            )}
            <Divider sx={{ my: 2 }} />
            <TextField
              margin="normal"
              required
              fullWidth
              id="username"
              label="Логин"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label="Пароль"
              type="password"
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} /> : <LoginIcon />}
              sx={{ mt: 3, mb: 2 }}
              disabled={loading}
            >
              {loading ? 'Вход...' : 'Войти'}
            </Button>

            <Box sx={{ mt: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                Тестовые учетные данные:<br />
                architect / admin (Архитектор)<br />
                analyst / admin (Аналитик)<br />
                admin / admin (Администратор)
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
