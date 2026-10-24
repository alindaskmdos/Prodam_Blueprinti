import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { GraphNodeData } from './blocksToGraph';
import type { InsertPoint } from './blockTree';
import type { LayoutResult } from './layout';

// Цвета — токены tokens.css. Цвет наконечника задаётся в MethodCanvas.module.css (id маркера строится
// из color, а var(...) в id ломает url(#…)), поэтому в markerEnd цвета нет.
const LABEL_FILL: Record<string, string> = { да: 'var(--jb-success)', нет: 'var(--jb-severity-high)' };
const LABEL_FILL_DEFAULT = 'var(--jb-text-secondary)';

/** Ноды без выделения: group-ноды контейнеров и веток, «+» в конце слота. */
const PASSIVE = new Set<string>(['container', 'slot', 'insert']);

/** data ребра схемы: «+» на стрелке (FE-08). */
export interface FlowEdgeData {
  [key: string]: unknown;
  insert?: InsertPoint;
}

/**
 * Разложенный граф → ноды и рёбра React Flow. Пользователь не перетаскивает ноды, не рисует и не удаляет
 * стрелки средствами React Flow — структура меняется только операциями над деревом (blockTree.ts).
 * Рёбра — тип flow (FlowEdge): smoothstep с «+», если у ребра есть место вставки.
 */
export function toFlow(layout: LayoutResult): { nodes: Node<GraphNodeData>[]; edges: Edge<FlowEdgeData>[] } {
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
      selectable: !PASSIVE.has(n.type),
      // Рамки и «+»-ноды не ловят мышь (холст под ними панорамируется); кнопка «+» включает себе события сама.
      ...(PASSIVE.has(n.type) ? { style: { pointerEvents: 'none' as const } } : {}),
    }),
  );
  const edges = layout.edges.map(
    (e): Edge<FlowEdgeData> => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'flow',
      data: e.insert ? { insert: e.insert } : {},
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
