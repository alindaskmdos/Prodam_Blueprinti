import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { GraphNodeData } from './blocksToGraph';
import type { LayoutResult } from './layout';

// Цвета — токены tokens.css. Цвет наконечника задаётся в MethodCanvas.module.css (id маркера строится
// из color, а var(...) в id ломает url(#…)), поэтому в markerEnd цвета нет.
const LABEL_FILL: Record<string, string> = { да: 'var(--jb-success)', нет: 'var(--jb-severity-high)' };
const LABEL_FILL_DEFAULT = 'var(--jb-text-secondary)';

/** Разложенный граф → ноды и рёбра React Flow (только просмотр: без перетаскивания, соединения, удаления). */
export function toFlow(layout: LayoutResult): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const nodes = layout.nodes.map(
    (n): Node<GraphNodeData> => ({
      id: n.id,
      type: n.type,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      data: n.data,
      draggable: false,
      connectable: false,
      deletable: false,
      selectable: n.type !== 'container' && n.type !== 'slot',
    }),
  );
  const edges = layout.edges.map(
    (e): Edge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: true,
      deletable: false,
      reconnectable: false,
      focusable: false,
      selectable: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      ...(e.label
        ? { label: e.label, labelStyle: { fill: LABEL_FILL[e.label] ?? LABEL_FILL_DEFAULT }, labelBgPadding: [4, 2] as [number, number] }
        : {}),
    }),
  );
  return { nodes, edges };
}
