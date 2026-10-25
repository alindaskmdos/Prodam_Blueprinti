import type { ClassCardData, ClassCardNode, CardState } from './ClassCard';
import type { DiagramLayout } from './diagramLayout';
import type { DiagramEdge } from './edges';
import { multiplicitySpot, selfLoopPoints, straightRoute, type Box, type EdgeTone } from './edgeGeometry';
import { alwaysShown, hubSources, nameFit, neighborsOf, RELATION_STYLE, type UmlGraphModel } from './umlGraph';

export interface UmlInteraction {
  /** Наведённый класс: его связи подсвечены, остальное приглушено. */
  hovered: string | null;
  /** Результат поиска (null — фильтра нет): совпавшие выделены, остальные приглушены. */
  matches: Set<string> | null;
  selectedId: string | null;
  flyingId: string | null;
  /** Переключатель «Все связи»: false — зависимости (кроме рёбер циклов) видны только у наведённой карточки. */
  showDependencies: boolean;
  onClassClick: ClassCardData['onClassClick'];
  onMemberClick: ClassCardData['onMemberClick'];
  onLevel: ClassCardData['onLevel'];
}

/**
 * Модель + раскладка + состояние наведения/поиска → ноды и рёбра React Flow. Чистая функция.
 * Зависимости при выключенном `showDependencies` рисуются только у наведённой карточки (прямой, если их нет в
 * раскладке); рёбра циклов видны всегда и красные (`cycle`), как и карточки классов цикла. Кратность — только у
 * связей наведённой или выбранной карточки.
 */
export function umlFlow(model: UmlGraphModel, layout: DiagramLayout, ui: UmlInteraction): { nodes: ClassCardNode[]; edges: DiagramEdge[] } {
  const touches = (e: { from: string; to: string }, id: string | null) => id !== null && (e.from === id || e.to === id);
  const visible = model.edges.filter((e) => ui.showDependencies || alwaysShown(e) || touches(e, ui.hovered));
  const near = ui.hovered ? neighborsOf(visible, ui.hovered) : null;
  const fit = nameFit(model.nodes);
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
    // Размер известен из раскладки: без measured пересозданная нода (наведение, поиск) считается неизмеренной,
    // и Fit View React Flow ждёт замера, которого не будет (размер в DOM не меняется).
    measured: { width: n.width, height: n.height },
    style: { width: n.width, height: n.height },
    draggable: false,
    connectable: false,
    selectable: false,
    data: {
      cls: n.cls,
      state: nodeState(n.id),
      inCycle: n.inCycle,
      level: n.level,
      selected: n.id === ui.selectedId,
      flying: n.id === ui.flyingId,
      nameFit: fit,
      onClassClick: ui.onClassClick,
      onMemberClick: ui.onMemberClick,
      onLevel: ui.onLevel,
    },
  }));
  const boxes: Box[] = model.nodes.map((n) => ({ ...(layout.positions.get(n.id) ?? { x: 0, y: 0 }), width: n.width, height: n.height }));
  const boxOf = new Map(model.nodes.map((n, i) => [n.id, boxes[i] as Box]));
  const hubs = hubSources(model.edges);
  const loopSlot = new Map<string, number>();
  const edges: DiagramEdge[] = visible.map((e) => {
    const style = RELATION_STYLE[e.relation.kind];
    let tone: EdgeTone = 'base';
    if (ui.hovered) tone = e.from === ui.hovered || e.to === ui.hovered ? 'active' : 'dim';
    else if (ui.matches) tone = ui.matches.has(e.from) || ui.matches.has(e.to) ? 'base' : 'dim';
    else if (e.relation.kind === 'dependency' && !e.inCycle && hubs.has(e.from)) tone = 'faint';
    let points = layout.routes.get(e.id) ?? null;
    // Ребра нет в раскладке (скрытая зависимость у наведённой карточки) — прямая, под карточками (zIndex 0).
    const straight = !points && e.from !== e.to;
    if (straight) {
      const a = boxOf.get(e.from);
      const b = boxOf.get(e.to);
      points = a && b ? straightRoute(a, b) : null;
    }
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
      zIndex: (tone === 'active' || (e.inCycle && tone !== 'dim')) && !straight ? 1 : 0,
      data: {
        points,
        dashed: style.dashed,
        end: style.end,
        start: style.start,
        tone,
        ...(e.inCycle ? { cycle: true } : {}),
        ...(e.relation.heuristic ? { heuristic: true } : {}),
        ...(e.relation.multiplicity && (touches(e, ui.hovered) || touches(e, ui.selectedId))
          ? { multiplicity: e.relation.multiplicity, multiplicityAt: points ? multiplicitySpot(points, boxes) : null }
          : {}),
        title: `${style.label}${via}${e.relation.heuristic ? ' — эвристика' : ''}${e.inCycle ? ' — ребро цикла зависимостей' : ''}`,
      },
    };
  });
  return { nodes, edges };
}
