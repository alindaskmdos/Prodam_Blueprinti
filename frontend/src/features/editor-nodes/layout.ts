import type { ELK, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { Graph, GraphNode, GraphNodeType } from './blocksToGraph';

export interface Positioned extends GraphNode {
  /** Координаты относительно родительской группы (как ждёт React Flow при parentId). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  nodes: Positioned[];
  edges: Graph['edges'];
}

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '34',
  'elk.spacing.nodeNode': '28',
  'elk.spacing.componentComponent': '28',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.edgeRouting': 'ORTHOGONAL',
};

const GROUP_PADDING: Partial<Record<GraphNodeType, string>> = {
  container: '[top=14,left=18,bottom=18,right=18]',
  slot: '[top=14,left=14,bottom=14,right=14]',
};

/** Контейнер с числом параллельных веток (switch.cases, try.catches) от порога раскладывается столбцом, а не одной строкой; «+»-нода ветку не считается. */
export const WIDE_SLOTS_THRESHOLD = 4;

let elkPromise: Promise<ELK> | undefined;

/**
 * ELK в web worker (браузер); в окружении без Worker (тесты, jsdom) — bundled-версия в основном потоке.
 * Экземпляр один на приложение.
 */
export function getElk(): Promise<ELK> {
  elkPromise ??= createElk().catch((e: unknown) => {
    // Неудача не кэшируется: следующая раскладка попробует снова.
    elkPromise = undefined;
    throw e;
  });
  return elkPromise;
}

async function createBundled(): Promise<ELK> {
  const { default: ElkBundled } = await import('elkjs/lib/elk.bundled.js');
  return new ElkBundled();
}

async function createElk(): Promise<ELK> {
  if (typeof Worker === 'undefined') return createBundled();
  try {
    const [{ default: ElkApi }, { default: workerUrl }] = await Promise.all([
      import('elkjs/lib/elk-api.js'),
      import('elkjs/lib/elk-worker.min.js?url'),
    ]);
    // Воркер создаётся сразу: если он не поднимается (CSP и т.п.), уходим на bundled в основном потоке.
    const worker = new Worker(workerUrl);
    return new ElkApi({ workerFactory: () => worker });
  } catch {
    return createBundled();
  }
}

/** Только для тестов: сбросить кэш экземпляра ELK. */
export function resetElkForTests(): void {
  elkPromise = undefined;
}

/** Строит ELK-граф из нод/рёбер: иерархия по parentId, рёбра — в общей группе концов. */
export function toElkGraph(graph: Graph): ElkNode {
  const root: ElkNode = { id: '__root__', layoutOptions: ROOT_OPTIONS, children: [], edges: [] };
  const byId = new Map<string, ElkNode>();
  // Широкий веер внутри группы: рёбра из одного источника (заголовок switch → case; «+» не считается) или
  // несвязанные ветки в рамке slot (try.catches). Считается число параллельных веток.
  const fanOut = new Map<string, number>();
  const nodeType = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const perSource = new Map<string, number>();
  const hasIncoming = new Set<string>();
  for (const e of graph.edges) {
    hasIncoming.add(e.target);
    if (!e.parentId || nodeType.get(e.target) === 'insert') continue;
    const key = `${e.parentId}\u0000${e.source}`;
    const count = (perSource.get(key) ?? 0) + 1;
    perSource.set(key, count);
    fanOut.set(e.parentId, Math.max(fanOut.get(e.parentId) ?? 0, count));
  }
  const loose = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.type === 'insert' || !n.parentId || nodeType.get(n.parentId) !== 'slot' || hasIncoming.has(n.id)) continue;
    loose.set(n.parentId, (loose.get(n.parentId) ?? 0) + 1);
  }
  for (const [id, count] of loose) fanOut.set(id, Math.max(fanOut.get(id) ?? 0, count));
  for (const n of graph.nodes) {
    const padding = GROUP_PADDING[n.type];
    const elkNode: ElkNode = padding
      ? { id: n.id, children: [], edges: [], layoutOptions: {
          ...ROOT_OPTIONS,
          // Заголовок слева, ветки столбцом справа: 16 case не растягивают схему в ширину.
          ...((fanOut.get(n.id) ?? 0) >= WIDE_SLOTS_THRESHOLD ? { 'elk.direction': 'RIGHT', 'elk.separateConnectedComponents': 'false' } : {}),
          'elk.padding': padding,
        },
      }
      : { id: n.id, width: n.width ?? 0, height: n.height ?? 0 };
    byId.set(n.id, elkNode);
    const parent = n.parentId ? byId.get(n.parentId) : root;
    if (!parent) throw new Error(`Родитель ${n.parentId ?? ''} ноды ${n.id} не найден (порядок нод нарушен)`);
    (parent.children ??= []).push(elkNode);
  }
  for (const e of graph.edges) {
    const owner = e.parentId ? byId.get(e.parentId) : root;
    if (!owner) throw new Error(`Группа ${e.parentId ?? ''} ребра ${e.id} не найдена`);
    const edge: ElkExtendedEdge = { id: e.id, sources: [e.source], targets: [e.target] };
    (owner.edges ??= []).push(edge);
  }
  return root;
}

/** Раскладка ELK сверху вниз. Ноды возвращаются в исходном порядке (родитель раньше детей). */
export async function layoutGraph(graph: Graph, elk?: ELK): Promise<LayoutResult> {
  const engine = elk ?? (await getElk());
  const laid = await engine.layout(toElkGraph(graph));
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
      walk(c);
    }
  };
  walk(laid);
  return {
    nodes: graph.nodes.map((n) => ({ ...n, ...(boxes.get(n.id) ?? { x: 0, y: 0, width: 0, height: 0 }) })),
    edges: graph.edges,
  };
}
