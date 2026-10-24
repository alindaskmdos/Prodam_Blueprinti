import type { ClassCardData, ClassCardNode, CardState } from './ClassCard';
import type { DiagramLayout } from './diagramLayout';
import type { DiagramEdge } from './edges';
import { badgeSpot, multiplicitySpot, selfLoopPoints, type Box, type EdgeTone } from './edgeGeometry';
import { hubSources, neighborsOf, RELATION_STYLE, type UmlGraphModel } from './umlGraph';

export interface UmlInteraction {
  /** Наведённый класс: его связи подсвечены, остальное приглушено. */
  hovered: string | null;
  /** Результат поиска (null — фильтра нет): совпавшие выделены, остальные приглушены. */
  matches: Set<string> | null;
  selectedId: string | null;
  flyingId: string | null;
  onClassClick: ClassCardData['onClassClick'];
  onMemberClick: ClassCardData['onMemberClick'];
}

/** Модель + раскладка + состояние наведения/поиска → ноды и рёбра React Flow. Чистая функция. */
export function umlFlow(model: UmlGraphModel, layout: DiagramLayout, ui: UmlInteraction): { nodes: ClassCardNode[]; edges: DiagramEdge[] } {
  const near = ui.hovered ? neighborsOf(model.edges, ui.hovered) : null;
  const nodeState = (id: string): CardState => {
    if (near) return id === ui.hovered ? 'active' : near.has(id) ? 'normal' : 'dim';
    if (ui.matches) return ui.matches.has(id) ? 'match' : 'dim';
    return 'normal';
  };
  const nodes: ClassCardNode[] = model.nodes.map((n) => ({
    id: n.id,
    type: 'umlClass',
    position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
    width: n.width,
    height: n.height,
    style: { width: n.width, height: n.height },
    draggable: false,
    connectable: false,
    selectable: false,
    data: {
      cls: n.cls,
      state: nodeState(n.id),
      selected: n.id === ui.selectedId,
      flying: n.id === ui.flyingId,
      onClassClick: ui.onClassClick,
      onMemberClick: ui.onMemberClick,
    },
  }));
  const boxes: Box[] = model.nodes.map((n) => ({ ...(layout.positions.get(n.id) ?? { x: 0, y: 0 }), width: n.width, height: n.height }));
  const boxOf = new Map(model.nodes.map((n, i) => [n.id, boxes[i] as Box]));
  const hubs = hubSources(model.edges);
  const loopSlot = new Map<string, number>();
  const edges: DiagramEdge[] = model.edges.map((e) => {
    const style = RELATION_STYLE[e.relation.kind];
    let tone: EdgeTone = 'base';
    if (ui.hovered) tone = e.from === ui.hovered || e.to === ui.hovered ? 'active' : 'dim';
    else if (ui.matches) tone = ui.matches.has(e.from) || ui.matches.has(e.to) ? 'base' : 'dim';
    else if (e.relation.kind === 'dependency' && hubs.has(e.from)) tone = 'faint';
    let points = layout.routes.get(e.id) ?? null;
    if (e.from === e.to) {
      const slot = loopSlot.get(e.from) ?? 0;
      loopSlot.set(e.from, slot + 1);
      const box = boxOf.get(e.from);
      points = box ? selfLoopPoints(box, slot) : null;
    }
    const via = e.relation.via ? ` (${e.relation.via})` : '';
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'diagram',
      selectable: false,
      focusable: false,
      zIndex: tone === 'active' ? 1 : 0,
      data: {
        points,
        dashed: style.dashed,
        end: style.end,
        start: style.start,
        tone,
        ...(e.relation.multiplicity ? { multiplicity: e.relation.multiplicity, multiplicityAt: points ? multiplicitySpot(points, boxes) : null } : {}),
        ...(e.relation.heuristic ? { badge: 'эвристика', badgeAt: points ? badgeSpot(points, boxes) : null } : {}),
        title: `${style.label}${via}${e.relation.heuristic ? ' — эвристика' : ''}`,
      },
    };
  });
  return { nodes, edges };
}
