import React, { useMemo, useRef, useState } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import type { Core, Stylesheet, ElementDefinition } from 'cytoscape';
import { Box, Popover, Typography, Chip, Divider } from '@mui/material';
import type { GraphData, GraphNode } from '../types';

interface GraphViewProps {
  graph: GraphData;
  height?: number;
}

const NODE_COLORS: Record<string, string> = {
  chapter: '#1976d2',
  section: '#388e3c',
  paragraph: '#f57c00',
  chunk: '#7b1fa2',
  external: '#c2185b',
};

const EDGE_COLORS: Record<string, string> = {
  contains: '#90a4ae',
  similar_to: '#26a69a',
  conflicts_with: '#e53935',
  intersects: '#c2185b',
};

interface PopoverState {
  anchor: { left: number; top: number } | null;
  node: GraphNode | null;
}

export function GraphView({ graph, height = 520 }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [popover, setPopover] = useState<PopoverState>({ anchor: null, node: null });
  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>();
    graph.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [graph.nodes]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const nodes: ElementDefinition[] = graph.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.label?.length > 40 ? n.label.slice(0, 40) + '…' : n.label || n.id,
        type: n.type,
      },
    }));
    const edges: ElementDefinition[] = graph.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, idx) => ({
        data: {
          id: `e${idx}`,
          source: e.source,
          target: e.target,
          type: e.type,
          weight: e.weight,
          label:
            e.type === 'similar_to' || e.type === 'intersects'
              ? e.weight.toFixed(2)
              : '',
        },
      }));
    return [...nodes, ...edges];
  }, [graph]);

  const stylesheet = useMemo<Stylesheet[]>(
    () => [
      {
        selector: 'node',
        style: {
          'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || '#607d8b',
          label: 'data(label)',
          color: '#fff',
          'text-outline-color': '#263238',
          'text-outline-width': 2,
          'font-size': 10,
          'text-valign': 'center',
          'text-halign': 'center',
          width: (ele: any) =>
            ele.data('type') === 'chapter'
              ? 50
              : ele.data('type') === 'section'
                ? 40
                : ele.data('type') === 'external'
                  ? 34
                  : 28,
          height: (ele: any) =>
            ele.data('type') === 'chapter'
              ? 50
              : ele.data('type') === 'section'
                ? 40
                : ele.data('type') === 'external'
                  ? 34
                  : 28,
          shape: (ele: any) => (ele.data('type') === 'external' ? 'diamond' : 'ellipse'),
        },
      },
      {
        selector: 'edge',
        style: {
          width: (ele: any) => Math.max(1, (ele.data('weight') || 1) * 2),
          'line-color': (ele: any) => EDGE_COLORS[ele.data('type')] || '#bdbdbd',
          'target-arrow-color': (ele: any) => EDGE_COLORS[ele.data('type')] || '#bdbdbd',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'line-style': (ele: any) =>
            ele.data('type') === 'similar_to'
              ? 'dashed'
              : ele.data('type') === 'intersects'
                ? 'dotted'
                : 'solid',
          label: 'data(label)',
          'font-size': 8,
          color: '#37474f',
          'text-background-color': '#fff',
          'text-background-opacity': 0.8,
          'text-background-padding': 2,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#ff5722',
        },
      },
    ],
    [],
  );

  const layout = useMemo(
    () => ({
      name: 'cose',
      animate: false,
      nodeRepulsion: 8000,
      idealEdgeLength: 80,
      edgeElasticity: 100,
      gravity: 0.25,
      numIter: 1000,
    }),
    [],
  );

  const handleCyInit = (cy: Core) => {
    cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      const node = nodeMap.get(id);
      if (!node) return;
      const rendered = evt.target.renderedPosition();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopover({
        anchor: { left: rect.left + rendered.x, top: rect.top + rendered.y },
        node,
      });
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setPopover({ anchor: null, node: null });
      }
    });

    const refit = () => {
      cy.resize();
      cy.fit(undefined, 30);
    };
    // Контейнер может быть 0×0 в момент маунта (Dialog, табы) — пересчитываем,
    // когда реальные размеры станут известны.
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      const ro = new ResizeObserver(() => refit());
      ro.observe(containerRef.current);
      cy.once('destroy', () => ro.disconnect());
    }
    setTimeout(refit, 100);
  };

  const closePopover = () => setPopover({ anchor: null, node: null });
  const popoverNode = popover.node;

  return (
    <Box
      ref={containerRef}
      sx={{
        height,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: '#fafafa',
        position: 'relative',
      }}
    >
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        layout={layout}
        style={{ width: '100%', height: '100%' }}
        minZoom={0.1}
        maxZoom={3}
        wheelSensitivity={0.2}
        cy={handleCyInit}
      />

      <Popover
        open={Boolean(popover.anchor && popoverNode)}
        onClose={closePopover}
        anchorReference="anchorPosition"
        anchorPosition={popover.anchor ?? undefined}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxWidth: 420, p: 2 } } }}
      >
        {popoverNode && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Chip
                size="small"
                label={popoverNode.type}
                sx={{
                  bgcolor: NODE_COLORS[popoverNode.type] || '#607d8b',
                  color: '#fff',
                  textTransform: 'capitalize',
                }}
              />
              {typeof popoverNode.level === 'number' && (
                <Chip size="small" variant="outlined" label={`level ${popoverNode.level}`} />
              )}
            </Box>
            <Typography variant="subtitle2" sx={{ mb: 1, wordBreak: 'break-word' }}>
              {popoverNode.label || popoverNode.id}
            </Typography>
            {popoverNode.content && (
              <>
                <Divider sx={{ mb: 1 }} />
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
                  {popoverNode.content}
                </Typography>
              </>
            )}
            {popoverNode.metadata && Object.keys(popoverNode.metadata).length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  metadata
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    fontSize: 11,
                    bgcolor: 'grey.100',
                    p: 1,
                    borderRadius: 0.5,
                    maxHeight: 160,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(popoverNode.metadata, null, 2)}
                </Box>
              </>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1, fontFamily: 'monospace' }}
            >
              id: {popoverNode.id}
            </Typography>
          </Box>
        )}
      </Popover>
    </Box>
  );
}
