import type { Node } from '@xyflow/react';
import type { Schemas } from '../api';
import type { DiagramLayout, LayoutEdge, LayoutNode } from './diagramLayout';
import type { DiagramEdge } from './edges';
import type { EdgeTone } from './edgeGeometry';
import { neighborsOf } from './umlGraph';

export type DepGraph = Schemas['DependencyGraph'];
export type DepNodeInfo = DepGraph['nodes'][number];
export type DepCycle = DepGraph['cycles'][number];

export interface DepsModel {
  nodes: (LayoutNode & { info: DepNodeInfo; inCycle: boolean })[];
  edges: (LayoutEdge & { from: string; to: string; inCycle: boolean })[];
}

const NODE_HEIGHT = 52;
const MIN_WIDTH = 150;
const MAX_WIDTH = 320;

/** Ширина узла по имени и пакету (Inter 13px / JetBrains Mono 11px). */
function nodeWidth(info: DepNodeInfo): number {
  const text = Math.max(info.name.length * 8, info.package.length * 6.8);
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, text + 66)));
}

/**
 * Ответ GET dependencies → узлы (классы) и рёбра «использует». Узел в цикле — если он в каком-либо
 * `cycles[].classes`; рёбра к неизвестным узлам и петли отбрасываются. Чистая функция.
 */
export function depsToGraph(graph: DepGraph): DepsModel {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const cycleIds = new Set(graph.cycles.flatMap((c) => c.classes));
  const nodes = graph.nodes.map((info) => ({ id: info.id, info, inCycle: cycleIds.has(info.id), width: nodeWidth(info), height: NODE_HEIGHT }));
  const seen = new Set<string>();
  const edges: DepsModel['edges'] = [];
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const id = `${e.from}->${e.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, from: e.from, to: e.to, source: e.from, target: e.to, inCycle: e.inCycle });
  }
  return { nodes, edges };
}

/** Подпись цикла: «Cart → Pricing → Cart» (короткие имена из узлов). */
export function cycleLabel(cycle: DepCycle, nodes: readonly DepNodeInfo[]): string {
  const names = new Map(nodes.map((n) => [n.id, n.name]));
  const list = cycle.classes.map((id) => names.get(id) ?? id.split('.').pop() ?? id);
  return [...list, list[0] ?? ''].join(' → ');
}

export const SEVERITY_LABEL: Record<DepCycle['severity'], string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };

export interface DepNodeData extends Record<string, unknown> {
  info: DepNodeInfo;
  inCycle: boolean;
  state: 'normal' | 'dim' | 'active' | 'match';
  selected: boolean;
  flying: boolean;
  onClick: (info: DepNodeInfo) => void;
}

export type DepFlowNode = Node<DepNodeData, 'dep'>;

export interface DepsInteraction {
  hovered: string | null;
  /** Поиск или наведённый цикл: выделенные классы (null — фильтра нет). */
  matches: Set<string> | null;
  selectedId: string | null;
  flyingId: string | null;
  onClick: (info: DepNodeInfo) => void;
}

/** Модель + раскладка + наведение → ноды и рёбра React Flow; рёбра цикла красные (тон `cycle`). */
export function depsFlow(model: DepsModel, layout: DiagramLayout, ui: DepsInteraction): { nodes: DepFlowNode[]; edges: DiagramEdge[] } {
  const near = ui.hovered ? neighborsOf(model.edges, ui.hovered) : null;
  const nodes: DepFlowNode[] = model.nodes.map((n) => {
    let state: DepNodeData['state'] = 'normal';
    if (near) state = n.id === ui.hovered ? 'active' : near.has(n.id) ? 'normal' : 'dim';
    else if (ui.matches) state = ui.matches.has(n.id) ? 'match' : 'dim';
    return {
      id: n.id,
      type: 'dep',
      position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
      width: n.width,
      height: n.height,
      style: { width: n.width, height: n.height },
      draggable: false,
      connectable: false,
      selectable: false,
      data: { info: n.info, inCycle: n.inCycle, state, selected: n.id === ui.selectedId, flying: n.id === ui.flyingId, onClick: ui.onClick },
    };
  });
  const edges: DiagramEdge[] = model.edges.map((e) => {
    let tone: EdgeTone = e.inCycle ? 'cycle' : 'base';
    if (ui.hovered) {
      const touches = e.from === ui.hovered || e.to === ui.hovered;
      tone = touches ? (e.inCycle ? 'cycle' : 'active') : 'dim';
    } else if (ui.matches && !(ui.matches.has(e.from) && ui.matches.has(e.to))) {
      tone = 'dim';
    }
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'diagram',
      selectable: false,
      focusable: false,
      zIndex: e.inCycle ? 1 : 0,
      data: {
        points: layout.routes.get(e.id) ?? null,
        dashed: false,
        end: 'arrow',
        start: null,
        tone,
        title: e.inCycle ? 'использует — ребро цикла зависимостей' : 'использует',
      },
    };
  });
  return { nodes, edges };
}
