import { useEffect, useRef, useState } from 'react';
import { Box, Alert, CircularProgress } from '@mui/material';

// Рендер Mermaid-кода (в т.ч. диаграмм C4) в SVG. Mermaid C4 капризен к синтаксису, а код
// приходит от LLM — поэтому СНАЧАЛА валидируем через mermaid.parse (не трогает DOM), и только
// при успехе рендерим. На ошибке показываем исходник C4, а не «белое пятно».
//
// Mermaid грузим ДИНАМИЧЕСКИ (import()) — это тяжёлая библиотека, а вкладка «Архитектура» не
// стартовая; так mermaid выносится в отдельный чанк и не утяжеляет начальную загрузку SPA.
let mermaidMod: any = null;
let mermaidPromise: Promise<any> | null = null;
function getMermaid(): Promise<any> {
  if (mermaidMod) return Promise.resolve(mermaidMod);
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mm = m.default;
      mm.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'loose', // C4-макросы используют html-подписи; контент — от нашего бэка
        fontFamily: 'inherit',
      });
      mermaidMod = mm;
      return mm;
    });
  }
  return mermaidPromise;
}

let seq = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const idRef = useRef(`mmd-${(seq += 1)}`);

  useEffect(() => {
    let cancelled = false;
    if (!code || !code.trim()) {
      setSvg('');
      setError(null);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const mermaid = await getMermaid();
        await mermaid.parse(code); // бросит при невалидном синтаксисе, не оставляя orphan-узлов
        const { svg: out } = await mermaid.render(idRef.current, code);
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setSvg('');
          setError(String((e && e.message) || e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!code || !code.trim()) {
    return null;
  }

  if (loading && !svg && !error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 1 }}>
          Не удалось отрисовать диаграмму C4. Ниже — исходный код (можно вставить в любой Mermaid-редактор).
        </Alert>
        <Box
          component="pre"
          sx={{
            p: 2,
            m: 0,
            bgcolor: '#f5f5f5',
            border: '1px solid #e0e0e0',
            borderRadius: 1,
            overflow: 'auto',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {code}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        overflow: 'auto',
        textAlign: 'center',
        '& svg': { maxWidth: '100%', height: 'auto' },
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
