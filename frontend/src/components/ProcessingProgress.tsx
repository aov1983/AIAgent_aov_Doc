import { useEffect, useRef, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';

// Богатый индикатор обработки документа. Заменяет «голый» LinearProgress.
// Что показывает:
//  • фазу pipeline (Конвертация → Анализ фрагментов → ФТ/НФТ → RAG+граф → Готово),
//  • счётчик фрагментов «N / M», вытащенный из текста стадии,
//  • живой таймер «сколько идёт» и оценку «сколько осталось» (ETA по скорости фрагментов),
//  • анимированную «бегущую» заливку — чтобы было видно, что работа идёт, даже когда
//    процент стоит на месте (бэкенд обновляет статус раз в 3 фрагмента).
// Стадии и проценты задаёт бэкенд (wf_api_documents): 10 Конвертация, 35 разбор,
// 35→64 фрагменты (N/M), 65 ФТ/НФТ, 90 RAG, 100 Готово.

export interface ProcessingProgressProps {
  stage: string;
  percent: number;
  // ISO-метка старта обработки (для таймера «прошло»). В Истории — saved_at, на Загрузке — момент старта.
  startedAt?: string;
  // true — обработка прервана (статус давно не обновлялся): гасим анимацию, красим в warning.
  stale?: boolean;
  // Компактный режим для строки таблицы (без полноразмерного степпера фаз).
  compact?: boolean;
}

interface Phase {
  label: string;
  emoji: string;
  // верхняя граница процента (исключительно): фаза активна, пока percent < upto.
  upto: number;
}

const PHASES: Phase[] = [
  { label: 'Конвертация', emoji: '📄', upto: 35 },
  { label: 'Анализ фрагментов', emoji: '🧠', upto: 65 },
  { label: 'ФТ / НФТ', emoji: '🏷️', upto: 90 },
  { label: 'RAG + граф', emoji: '🕸️', upto: 100 },
  { label: 'Готово', emoji: '✅', upto: 101 },
];

const phaseIndex = (percent: number): number => {
  if (percent >= 100) return PHASES.length - 1;
  for (let i = 0; i < PHASES.length; i++) if (percent < PHASES[i].upto) return i;
  return PHASES.length - 1;
};

// Бэкенд (n8n) пишет время в UTC, но saved_at в /files/history приходит БЕЗ суффикса таймзоны
// («2026-05-31T13:30:24»). Браузер в зоне ≠ UTC распарсил бы это как локальное время и таймер
// «прошло» уехал бы на часы. Если в строке нет ни 'Z', ни смещения ±чч:мм — трактуем как UTC.
export const parseTs = (iso?: string): number => {
  if (!iso) return NaN;
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  return Date.parse(hasTz ? iso : iso + 'Z');
};

const fmtDur = (sec: number): string => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} с`;
  return `${s} с`;
};

// «бегущие» диагональные полосы поверх заливки — ощущение живого процесса
const stripes = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.25) 0 10px, rgba(255,255,255,0) 10px 20px)';

export function ProcessingProgress({ stage, percent, startedAt, stale, compact }: ProcessingProgressProps) {
  const done = percent >= 100;
  const value = Math.max(0, Math.min(100, percent));

  // Парсим «(N/M)» из текста стадии (фаза обработки фрагментов).
  const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(stage || '');
  const n = m ? Number(m[1]) : null;
  const total = m ? Number(m[2]) : null;

  // Тикаем раз в секунду — двигаем таймер «прошло» и пересчёт ETA.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (done || stale) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [done, stale]);

  // Сэмплер скорости фрагментов: средняя скорость с первого наблюдения (устойчивее мгновенной).
  // Сбрасываемся, если N пошёл назад (новый прогон / возобновление).
  const sample = useRef<{ firstN: number; firstT: number; lastN: number; lastT: number } | null>(null);
  useEffect(() => {
    if (n == null) return;
    const t = Date.now();
    const s = sample.current;
    if (!s || n < s.lastN) sample.current = { firstN: n, firstT: t, lastN: n, lastT: t };
    else if (n > s.lastN) sample.current = { ...s, lastN: n, lastT: t };
  }, [n]);

  let etaSec: number | null = null;
  const s = sample.current;
  if (!stale && !done && n != null && total != null && s && s.lastN > s.firstN && s.lastT > s.firstT) {
    const rate = (s.lastN - s.firstN) / ((s.lastT - s.firstT) / 1000); // фрагментов/с
    if (rate > 0) etaSec = (total - n) / rate;
  }

  const startMs = parseTs(startedAt);
  let elapsedSec: number | null = Number.isNaN(startMs) ? null : (now - startMs) / 1000;
  // Защита от мусорных меток времени: отрицательное или >24ч — не показываем.
  if (elapsedSec != null && (elapsedSec < 0 || elapsedSec > 86400)) elapsedSec = null;
  const active = phaseIndex(value);
  const phase = PHASES[active];

  const barColor = stale ? 'warning.main' : done ? 'success.main' : undefined;
  const headline = stale
    ? '⚠️ Обработка прервана'
    : `${phase.emoji} ${phase.label}${n != null && total != null ? ` · фрагмент ${n} из ${total}` : ''}`;

  const captionParts: string[] = [];
  if (elapsedSec != null && !done) captionParts.push(`прошло ${fmtDur(elapsedSec)}`);
  if (etaSec != null) captionParts.push(`осталось ~${fmtDur(etaSec)}`);
  else if (!stale && !done && total != null) captionParts.push('оценка времени…');
  if (stale) captionParts.push('можно возобновить');

  return (
    <Box sx={{ minWidth: compact ? 150 : '100%' }}>
      {/* Степпер фаз — только в полном режиме */}
      {!compact && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          {PHASES.map((p, i) => {
            const state = i < active ? 'done' : i === active && !stale ? 'active' : 'idle';
            return (
              <Box
                key={p.label}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 1,
                  py: 0.25,
                  borderRadius: 4,
                  fontSize: 12,
                  border: 1,
                  borderColor: state === 'idle' ? 'divider' : 'transparent',
                  bgcolor:
                    state === 'done' ? 'success.light' : state === 'active' ? 'primary.light' : 'transparent',
                  color: state === 'idle' ? 'text.disabled' : '#fff',
                  opacity: state === 'idle' ? 0.7 : 1,
                  transition: 'all .3s',
                }}
              >
                <span>{i < active ? '✓' : p.emoji}</span>
                <span>{p.label}</span>
              </Box>
            );
          })}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 500, color: stale ? 'warning.main' : 'text.primary' }}>
          {headline}
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {value}%
        </Typography>
      </Box>

      <LinearProgress
        variant="determinate"
        value={value}
        sx={{
          height: compact ? 8 : 12,
          borderRadius: 6,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': {
            borderRadius: 6,
            transition: 'transform .8s cubic-bezier(.4,0,.2,1)',
            backgroundColor: barColor,
            // фирменный градиент (фиолетовый → бирюза) + бегущие полосы поверх
            backgroundImage: barColor
              ? 'none'
              : `${stripes}, linear-gradient(90deg, #673ab7, #009688)`,
            backgroundSize: '28px 28px, 100% 100%',
            animation: stale || done ? 'none' : 'pp-stripes 1s linear infinite',
          },
          '@keyframes pp-stripes': {
            from: { backgroundPosition: '0 0, 0 0' },
            to: { backgroundPosition: '28px 0, 0 0' },
          },
        }}
      />

      {captionParts.length > 0 && (
        <Box sx={{ mt: 0.5 }}>
          {captionParts.map((part, i) => (
            <Typography
              key={i}
              variant="caption"
              color={stale ? 'warning.main' : 'text.secondary'}
              sx={{ display: 'block', lineHeight: 1.4 }}
            >
              {part}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
