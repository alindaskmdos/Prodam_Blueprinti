import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import { getElk } from '../editor-nodes';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  /** Концы для ELK (сверху — source). */
  source: string;
  target: string;
  /** true — ребро нарисовано от target к source (наследование: потомок → родитель, родитель выше). */
  reversed?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface DiagramLayout {
  /** Левый верхний угол ноды. */
  positions: Map<string, Point>;
  /** Ломаная ребра в направлении рисования (с учётом `reversed`); нет — прямая между нодами. */
  routes: Map<string, Point[]>;
}

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  // Ломаные без ортогональных «шин»: у хаба вроде Main рёбра расходятся веером, а не стопкой общих линий.
  'elk.edgeRouting': 'POLYLINE',
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'elk.spacing.edgeEdge': '10',
  'elk.spacing.componentComponent': '40',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.compaction.postCompaction.strategy': 'LEFT_RIGHT_CONSTRAINT_LOCKING',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

/** ELK-граф диаграммы: плоский (без групп), ноды с размерами. Чистая функция. */
export function toElk(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], options: Record<string, string> = {}): ElkNode {
  return {
    id: '__diagram__',
    layoutOptions: { ...OPTIONS, ...options },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    // Самосвязи (петли) в раскладку не идут — их ломаную строит umlFlow по позиции карточки.
    edges: edges.filter((e) => e.source !== e.target).map<ElkExtendedEdge>((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
}

/** Результат ELK → позиции нод и ломаные рёбер (развёрнутые для `reversed`). Чистая функция. */
export function fromElk(result: ElkNode, edges: readonly LayoutEdge[]): DiagramLayout {
  const positions = new Map<string, Point>();
  for (const c of result.children ?? []) positions.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  const reversed = new Map(edges.map((e) => [e.id, e.reversed === true]));
  const routes = new Map<string, Point[]>();
  for (const e of (result.edges ?? []) as ElkExtendedEdge[]) {
    const section = e.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x, y: p.y }));
    routes.set(e.id, reversed.get(e.id) ? points.reverse() : points);
  }
  return { positions, routes };
}

/** Раскладка ELK (в браузере — в web worker, общий экземпляр с editor-nodes). */
export async function layoutDiagram(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: Record<string, string> = {},
): Promise<DiagramLayout> {
  const elk = await getElk();
  const result = await elk.layout(toElk(nodes, edges, options));
  return fromElk(result, edges);
}
