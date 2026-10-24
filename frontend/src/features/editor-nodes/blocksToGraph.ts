import { editableFields } from './blockEdit';
import { blockText } from './blockText';
import { isContainer, isKnownKind, kindMeta, orderedSlots, type Block, type BlockKind, type SlotSpec } from './kinds';

/**
 * Тип ноды на схеме.
 * block — обычная нода (и заголовок контейнера); container — group-нода контейнера;
 * slot — рамка ветки внутри контейнера с несколькими ветками; comment — стикер; raw — пунктирная рамка.
 */
export type GraphNodeType = 'block' | 'container' | 'slot' | 'comment' | 'raw';

export interface GraphNodeData {
  [key: string]: unknown;
  /** kind блока; у slot — kind контейнера-владельца. */
  kind: BlockKind;
  /** id блока из контракта (для slot — id контейнера). */
  blockId: string;
  title: string;
  text: string;
  issues: string[];
  /** Бейдж справа в заголовке (оценка сложности у метода). */
  badge?: string;
  /** Ключ слота — только у slot. */
  slotKey?: string;
  /** Путь блока в дереве (`root/body/1/then/0`, см. blockEdit.ts) — адрес для правки. */
  path: string;
  /** Поля блока (для инлайн-редактора). */
  fields: Record<string, string>;
  /** Можно ли править текст ноды (FE-07). У slot и group-ноды контейнера — нет. */
  editable: boolean;
  /** Ошибка текста ноды (422 PARSE_ERROR): нода красная, правка не применена. */
  error?: string;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  /** id group-ноды (container/slot), внутри которой лежит нода; нет — верхний уровень. */
  parentId?: string;
  data: GraphNodeData;
  /** Размер листовой ноды; размер container/slot считает раскладка. */
  width?: number;
  height?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Группа, в которой лежат оба конца ребра (ELK кладёт ребро в неё); нет — верхний уровень. */
  parentId?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const HEAD_SUFFIX = '#head';
export const SLOT_SUFFIX = '#slot:';

// Оценка размеров по тексту (моноширинный 12.5px). Ноды фиксированного размера — ELK знает их до рендера.
const CHAR_W = 7.8;
const LINE_H = 18;
const HEADER_H = 28;
const BODY_PAD_Y = 18;
const BODY_PAD_X = 26;
const MIN_W = 200;
const MAX_W = 560;
const MAX_W_RAW = 720;

function lines(text: string): string[] {
  return text.length === 0 ? [''] : text.split('\n');
}

export function estimateSize(type: GraphNodeType, title: string, text: string): { width: number; height: number } {
  // Защита от не-строк из рантайма (бэк новее типов): размер считается всегда.
  title = typeof title === 'string' ? title : String(title ?? '');
  const ls = lines(typeof text === 'string' ? text : String(text ?? ''));
  const longest = Math.max(...ls.map((l) => l.length));
  if (type === 'comment') {
    return {
      width: Math.round(Math.min(MAX_W, Math.max(160, longest * CHAR_W + 28))),
      height: ls.length * LINE_H + 20,
    };
  }
  const maxW = type === 'raw' ? MAX_W_RAW : MAX_W;
  const width = Math.min(maxW, Math.max(MIN_W, longest * CHAR_W + BODY_PAD_X, title.length * 7.5 + 70));
  return { width: Math.round(width), height: HEADER_H + ls.length * LINE_H + BODY_PAD_Y };
}

function leafType(kind: BlockKind): GraphNodeType {
  if (kind === 'comment') return 'comment';
  if (kind === 'raw' || !isKnownKind(kind)) return 'raw';
  return 'block';
}

export interface ToGraphOptions {
  /** Бейдж на ноде метода (MethodView.complexity). */
  methodBadge?: string;
  /** Ошибки текста по пути блока: такие ноды красные, с сообщением. */
  errors?: Record<string, string>;
}

// Строка сообщения об ошибке под текстом ноды (Inter 12px).
const ERROR_CHAR_W = 6.6;
const ERROR_LINE_H = 16;

function withErrorSize(size: { width: number; height: number }, error: string): { width: number; height: number } {
  const perLine = Math.max(1, Math.floor((size.width - 24) / ERROR_CHAR_W));
  return { width: size.width, height: size.height + Math.ceil(error.length / perLine) * ERROR_LINE_H + 10 };
}

/**
 * Чистое преобразование дерева блоков метода в ноды и рёбра схемы (без координат).
 * Порядок нод — префиксный обход: родитель всегда раньше детей (требование React Flow).
 * Корень method — нода-заголовок на верхнем уровне, тело — цепочка под ним.
 * Контейнер — group-нода: внутри заголовок и ветки. Одна ветка-цепочка — прямо в контейнере,
 * несколько веток — рамки slot рядом. Параллельные слоты (switch.cases, try.catches) — без цепочки, от заголовка к каждому.
 */
export function blocksToGraph(root: Block, options: ToGraphOptions = {}): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const usedIds = new Set<string>();

  const uniqueId = (block: Block, path: string): string => {
    let id = block.id || path;
    if (usedIds.has(id)) id = `${id}@${path}`;
    usedIds.add(id);
    return id;
  };

  const addEdge = (source: string, target: string, parentId: string | undefined, label?: string) => {
    edges.push({
      id: `e:${source}->${target}`,
      source,
      target,
      ...(label ? { label } : {}),
      ...(parentId ? { parentId } : {}),
    });
  };

  const errors = options.errors ?? {};

  const dataOf = (block: Block, id: string, path: string): GraphNodeData => {
    const error = errors[path];
    return {
      kind: block.kind,
      blockId: block.id || id,
      title: kindMeta(block.kind).title,
      text: blockText(block),
      issues: block.issues ?? [],
      path,
      fields: block.fields ?? {},
      editable: block.kind !== 'method' && editableFields(block).length > 0,
      ...(error !== undefined ? { error } : {}),
    };
  };

  const pushLeaf = (
    block: Block,
    id: string,
    path: string,
    parentId: string | undefined,
    type: GraphNodeType,
    badge?: string,
  ) => {
    const data = dataOf(block, id, path);
    if (badge) data.badge = badge;
    const size = estimateSize(type, data.title, data.text);
    nodes.push({
      id,
      type,
      ...(parentId ? { parentId } : {}),
      data,
      ...(data.error !== undefined ? withErrorSize(size, data.error) : size),
    });
  };

  /** Добавляет блок; возвращает id ноды, к которой подводятся/от которой выходят стрелки. */
  const visit = (block: Block, path: string, parentId: string | undefined): string => {
    const id = uniqueId(block, path);
    if (!isContainer(block)) {
      pushLeaf(block, id, path, parentId, leafType(block.kind));
      return id;
    }

    nodes.push({
      id,
      type: 'container',
      ...(parentId ? { parentId } : {}),
      data: { ...dataOf(block, id, path), editable: false },
    });
    const headId = `${id}${HEAD_SUFFIX}`;
    pushLeaf(block, headId, path, id, isKnownKind(block.kind) ? 'block' : 'raw');

    const slots = orderedSlots(block);
    const only = slots[0];
    if (slots.length === 1 && only) {
      layoutSlot(only.spec, only.items, `${path}/${only.spec.key}`, id, headId);
    } else {
      for (const { spec, items } of slots) {
        const slotId = `${id}${SLOT_SUFFIX}${spec.key}`;
        nodes.push({
          id: slotId,
          type: 'slot',
          parentId: id,
          data: {
            ...dataOf(block, id, path),
            title: spec.label ?? spec.key,
            text: '',
            issues: [],
            slotKey: spec.key,
            editable: false,
            error: undefined,
          },
        });
        addEdge(headId, slotId, id, spec.label);
        layoutSlot({ ...spec, label: undefined }, items, `${path}/${spec.key}`, slotId, undefined);
      }
    }
    return id;
  };

  /** Элементы слота внутри группы parentId; from — нода, от которой идёт первая стрелка (заголовок). */
  const layoutSlot = (spec: SlotSpec, items: Block[], path: string, parentId: string, from: string | undefined) => {
    if (spec.mode === 'parallel') {
      items.forEach((item, i) => {
        const itemId = visit(item, `${path}/${i}`, parentId);
        if (from) addEdge(from, itemId, parentId, spec.label);
      });
      return;
    }
    let prev = from;
    items.forEach((item, i) => {
      const itemId = visit(item, `${path}/${i}`, parentId);
      if (prev) addEdge(prev, itemId, parentId, i === 0 ? spec.label : undefined);
      prev = itemId;
    });
  };

  if (root.kind === 'method') {
    const rootId = uniqueId(root, 'root');
    pushLeaf(root, rootId, 'root', undefined, 'block', options.methodBadge);
    let prev = rootId;
    (root.slots?.body ?? []).forEach((item, i) => {
      const itemId = visit(item, `root/body/${i}`, undefined);
      addEdge(prev, itemId, undefined);
      prev = itemId;
    });
  } else {
    visit(root, 'root', undefined);
  }

  return { nodes, edges };
}
