import React, { useState, useEffect } from 'react';
import { Box, Paper, Grid, Chip, Typography, Button } from '@mui/material';
import { AccountTree as GraphIcon } from '@mui/icons-material';
import type { GraphData } from '../types';
import { GraphView } from './GraphView';

interface GraphCardProps {
  graph: GraphData;
  downloadName: string;
  title?: string;
  height?: number;
  paperVariant?: 'elevation' | 'outlined';
  paperElevation?: number;
  paperPadding?: number;
  /** Сбрасывать ли видимость графа при смене graph (например, при открытии нового документа). */
  resetKey?: string;
}

export function GraphCard({
  graph,
  downloadName,
  title = 'Граф знаний документа',
  height = 540,
  paperVariant = 'elevation',
  paperElevation = 2,
  paperPadding = 3,
  resetKey,
}: GraphCardProps) {
  const [showGraph, setShowGraph] = useState(false);

  useEffect(() => {
    setShowGraph(false);
  }, [resetKey]);

  if (!graph?.stats) return null;

  const similarEdges = graph.edges.filter((e) => e.type === 'similar_to');
  const intersectEdges = graph.edges.filter((e) => e.type === 'intersects');
  const externalNodesById = new Map(
    graph.nodes.filter((n) => n.type === 'external').map((n) => [n.id, n]),
  );
  const intersectionsCount =
    graph.stats.intersections ?? intersectEdges.length;
  const externalDocsCount =
    graph.stats.external_docs ?? externalNodesById.size;

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Paper
      variant={paperVariant}
      elevation={paperVariant === 'elevation' ? paperElevation : undefined}
      sx={{ p: paperPadding, mb: paperPadding === 3 ? 3 : 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <GraphIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        <Button size="small" variant="outlined" onClick={() => setShowGraph((v) => !v)}>
          {showGraph ? 'Скрыть граф' : 'Показать граф'}
        </Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={6} sm={2}>
          <Chip label={`Узлов: ${graph.stats.total_nodes}`} variant="outlined" />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Chip label={`Связей: ${graph.stats.total_edges}`} variant="outlined" />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Chip label={`Абзацев: ${graph.stats.paragraphs}`} variant="outlined" />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Chip label={`Чанков: ${graph.stats.chunks}`} variant="outlined" />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Chip
            label={`Пересечений: ${intersectionsCount}`}
            variant="outlined"
            sx={{ borderColor: '#c2185b', color: '#c2185b' }}
          />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Chip
            label={`Документов: ${externalDocsCount}`}
            variant="outlined"
            sx={{ borderColor: '#c2185b', color: '#c2185b' }}
          />
        </Grid>
      </Grid>

      {showGraph && (
        <Box sx={{ mb: 2 }}>
          <GraphView graph={graph} height={height} />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            <Chip size="small" label="Глава" sx={{ bgcolor: '#1976d2', color: '#fff' }} />
            <Chip size="small" label="Раздел" sx={{ bgcolor: '#388e3c', color: '#fff' }} />
            <Chip size="small" label="Абзац" sx={{ bgcolor: '#f57c00', color: '#fff' }} />
            <Chip size="small" label="Чанк" sx={{ bgcolor: '#7b1fa2', color: '#fff' }} />
            <Chip size="small" label="Пересечение" sx={{ bgcolor: '#c2185b', color: '#fff' }} />
            <Chip size="small" label="contains" variant="outlined" sx={{ borderColor: '#90a4ae' }} />
            <Chip size="small" label="similar_to" variant="outlined" sx={{ borderColor: '#26a69a' }} />
            <Chip size="small" label="intersects" variant="outlined" sx={{ borderColor: '#c2185b' }} />
            <Chip size="small" label="conflicts_with" variant="outlined" sx={{ borderColor: '#e53935' }} />
          </Box>
        </Box>
      )}

      {similarEdges.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Семантические связи (similar_to) — топ 10
          </Typography>
          {similarEdges.slice(0, 10).map((edge, idx) => (
            <Typography key={idx} variant="caption" sx={{ display: 'block' }}>
              {edge.source} → {edge.target} (score {edge.weight.toFixed(2)})
            </Typography>
          ))}
        </Box>
      )}

      {intersectEdges.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom sx={{ color: '#c2185b' }}>
            Пересечения с другими документами (intersects) — топ 10
          </Typography>
          {intersectEdges
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 10)
            .map((edge, idx) => {
              const ext = externalNodesById.get(edge.target);
              const src =
                (ext?.metadata?.source_document as string | undefined) ||
                (ext?.metadata?.document_id as string | undefined) ||
                edge.target;
              const preview = (ext?.content || '').slice(0, 120);
              return (
                <Typography
                  key={idx}
                  variant="caption"
                  sx={{ display: 'block', wordBreak: 'break-word' }}
                >
                  {edge.source} ⇢ <b>{src}</b> (score {edge.weight.toFixed(2)})
                  {preview && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {' — '}
                      {preview}
                      {preview.length >= 120 ? '…' : ''}
                    </Box>
                  )}
                </Typography>
              );
            })}
        </Box>
      )}

      <Button size="small" variant="outlined" onClick={handleDownload}>
        Скачать граф (JSON)
      </Button>
    </Paper>
  );
}
