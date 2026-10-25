import type { Schemas } from '../api';

export type DepGraph = Schemas['DependencyGraph'];
export type DepCycle = DepGraph['cycles'][number];

/** Циклы зависимостей для UML: классы циклов и рёбра «from->to» внутри циклов (`inCycle`). */
export interface CycleInfo {
  classes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

export const NO_CYCLES: CycleInfo = { classes: new Set(), edges: new Set() };

/** Ключ ребра графа зависимостей (без вида связи): совпадает у UML-связи и ребра GET dependencies. */
export function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** GET dependencies → классы и рёбра циклов (петли не в счёт). Нет графа — циклов нет. Чистая функция. */
export function cycleInfo(graph: DepGraph | null): CycleInfo {
  if (!graph || graph.cycles.length === 0) return NO_CYCLES;
  return {
    classes: new Set(graph.cycles.flatMap((c) => c.classes)),
    edges: new Set(graph.edges.filter((e) => e.inCycle && e.from !== e.to).map((e) => pairKey(e.from, e.to))),
  };
}

/** Подпись цикла: «Cart → Pricing → Cart» (короткие имена классов; нет класса — хвост FQN). */
export function cycleLabel(cycle: DepCycle, classes: readonly { id: string; name: string }[]): string {
  const names = new Map(classes.map((n) => [n.id, n.name]));
  const list = cycle.classes.map((id) => names.get(id) ?? id.split('.').pop() ?? id);
  return [...list, list[0] ?? ''].join(' → ');
}
