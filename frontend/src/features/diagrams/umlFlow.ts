import type { ClassCardData, ClassCardNode, CardState } from './ClassCard';
import type { DiagramLayout } from './diagramLayout';
import type { DiagramEdge } from './edges';
import type { EdgeTone } from './edgeGeometry';
import { neighborsOf, RELATION_STYLE, type UmlGraphModel } from './umlGraph';

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
  const edges: DiagramEdge[] = model.edges.map((e) => {
    const style = RELATION_STYLE[e.relation.kind];
    let tone: EdgeTone = 'base';
    if (ui.hovered) tone = e.from === ui.hovered || e.to === ui.hovered ? 'active' : 'dim';
    else if (ui.matches) tone = ui.matches.has(e.from) || ui.matches.has(e.to) ? 'base' : 'dim';
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
        points: layout.routes.get(e.id) ?? null,
        dashed: style.dashed,
        end: style.end,
        start: style.start,
        tone,
        ...(e.relation.multiplicity ? { multiplicity: e.relation.multiplicity } : {}),
        ...(e.relation.heuristic ? { badge: 'эвристика' } : {}),
        title: `${style.label}${via}${e.relation.heuristic ? ' — эвристика' : ''}`,
      },
    };
  });
  return { nodes, edges };
}
