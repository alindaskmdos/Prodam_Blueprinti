import { editableFields } from './blockEdit';
import { insertableSlots, nestedCount, type InsertPoint } from './blockTree';
import { blockKey, blocksLabel, subtreeIssues } from './collapse';
import { blockText } from './blockText';
import { explainParseError } from './parseError';
import { isContainer, isKnownKind, kindMeta, orderedSlots, type Block, type BlockKind, type SlotSpec } from './kinds';

/**
 * Тип ноды на схеме.
 * block — обычная нода (и заголовок контейнера); container — group-нода контейнера;
 * slot — рамка ветки внутри контейнера с несколькими ветками; comment — стикер; raw — пунктирная рамка.
 */
export type GraphNodeType = 'block' | 'container' | 'slot' | 'comment' | 'raw' | 'insert';

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
  /** Строки блока в файле (Block.span); у вставленного локально блока нет. */
  span?: NonNullable<Block['span']>;
  /** Ошибка текста ноды (422 PARSE_ERROR): нода красная, правка не применена. */
  error?: string;
  /** Только у insert: куда вставит «+» (конец слота или пустой слот). */
  insert?: InsertPoint;
  /**
   * Сворачивание (FE-06): у заголовка развёрнутого контейнера и у свёрнутого контейнера.
   * key — ключ состояния (collapse.ts: blockKey); hidden — число вложенных блоков свёрнутого;
   * locked — свернуть сейчас нельзя (внутри открыт редактор / красная нода / вставка).
   */
  collapse?: { key: string; collapsed: boolean; locked: boolean; hidden?: number };
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
  /** «+» на стрелке: вставка между её концами (FE-08). Только с options.insertable. */
  insert?: InsertPoint;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const HEAD_SUFFIX = '#head';
export const SLOT_SUFFIX = '#slot:';
export const INSERT_SUFFIX = '#add:';
/** Размер ноды «+» в конце слота / в пустом слоте. */
export const INSERT_SIZE = 24;

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
  /**
   * Режим правки структуры (FE-08): «+» на стрелках внутри слотов (insert у ребра), ноды insert в конце
   * каждого слота и в пустых известных слотах (if без else, пустое тело цикла).
   */
  insertable?: boolean;
  /**
   * Пути свёрнутых контейнеров (FE-06, collapse.ts: collapsedPaths): контейнер рисуется одной нодой —
   * заголовок и сводка (число вложенных блоков, бейдж проблем внутри), без детей и мест вставки внутри.
   */
  collapsed?: ReadonlySet<string>;
  /** Пути контейнеров, которые сейчас нельзя свернуть (collapse.ts: lockedPaths). */
  collapseLocked?: ReadonlySet<string>;
  /** Скрыть comment-блоки (переключатель «Комментарии»). Пути остальных блоков не меняются. */
  hideComments?: boolean;
  /** Пути, которые видны всегда (открытый редактор, красная нода): такой комментарий не скрывается. */
  keepVisible?: ReadonlySet<string>;
}

/** Ширина бейджа «N блоков» в заголовке свёрнутого контейнера (для оценки размера). */
const COLLAPSED_EXTRA = '  ▸ 00 блоков ';

// Сообщение об ошибке под текстом ноды (Inter 12px): текст + «В код не попало.» + кнопка «Отменить правку».
const ERROR_CHAR_W = 6.8;
const ERROR_LINE_H = 16;
const ERROR_SUFFIX = ' В код не попало.';

function withErrorSize(size: { width: number; height: number }, error: string): { width: number; height: number } {
  const perLine = Math.max(1, Math.floor((size.width - 24) / ERROR_CHAR_W));
  const lines = Math.ceil((explainParseError(error).text.length + ERROR_SUFFIX.length) / perLine) + 1;
  return { width: size.width, height: size.height + lines * ERROR_LINE_H + 14 };
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

  const insertable = options.insertable === true;

  const addEdge = (
    source: string,
    target: string,
    parentId: string | undefined,
    label?: string,
    insert?: InsertPoint,
  ) => {
    edges.push({
      id: `e:${source}->${target}`,
      source,
      target,
      ...(label ? { label } : {}),
      ...(parentId ? { parentId } : {}),
      ...(insert && insertable ? { insert } : {}),
    });
  };

  /** Нода «+» в конце слота (или в пустом слоте) владельца ownerPath; возвращает её id. */
  const pushInsert = (owner: Block, ownerId: string, ownerPath: string, slot: string, index: number, parentId: string | undefined) => {
    const id = `${ownerId}${INSERT_SUFFIX}${slot}`;
    nodes.push({
      id,
      type: 'insert',
      ...(parentId ? { parentId } : {}),
      data: {
        kind: owner.kind as BlockKind,
        blockId: owner.id || ownerId,
        title: '',
        text: '',
        issues: [],
        path: ownerPath,
        fields: {},
        editable: false,
        slotKey: slot,
        insert: { parent: ownerPath, slot, index },
      },
      width: INSERT_SIZE,
      height: INSERT_SIZE,
    });
    return id;
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
      ...(block.span ? { span: block.span } : {}),
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

  const collapsed = options.collapsed;
  const locked = options.collapseLocked;
  const hideComments = options.hideComments === true;
  const keep = options.keepVisible;
  /** Видимые элементы слота slotPath с исходными индексами (пути и места вставки — по исходным). */
  const visible = (items: Block[], slotPath: string): { item: Block; index: number }[] =>
    items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => !(hideComments && item.kind === 'comment' && !keep?.has(`${slotPath}/${index}`)));

  /** Добавляет блок; возвращает id ноды, к которой подводятся/от которой выходят стрелки. */
  const visit = (block: Block, path: string, parentId: string | undefined): string => {
    const id = uniqueId(block, path);
    if (!isContainer(block)) {
      pushLeaf(block, id, path, parentId, leafType(block.kind));
      return id;
    }
    const key = blockKey(block, path);
    if (collapsed?.has(path)) {
      // Свёрнутый контейнер — одна нода: заголовок и сводка; дети и «+» внутри не рисуются.
      const type = isKnownKind(block.kind) ? 'block' : 'raw';
      const data = dataOf(block, id, path);
      const hidden = nestedCount(block);
      data.issues = subtreeIssues(block);
      data.collapse = { key, collapsed: true, locked: false, hidden };
      const size = estimateSize(type, `${data.title}${COLLAPSED_EXTRA}${blocksLabel(hidden)}`, data.text);
      nodes.push({
        id,
        type,
        ...(parentId ? { parentId } : {}),
        data,
        ...(data.error !== undefined ? withErrorSize(size, data.error) : size),
      });
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
    const head = nodes[nodes.length - 1];
    if (head) {
      head.data.collapse = { key, collapsed: false, locked: locked?.has(path) === true };
      head.width = Math.max(head.width ?? 0, estimateSize('block', `${head.data.title}  ▾ `, '').width);
    }

    // Ветки, где после скрытия комментариев ничего не осталось, не рисуются (как пустые).
    const slots = orderedSlots(block).filter((s) => visible(s.items, `${path}/${s.spec.key}`).length > 0);
    const only = slots[0];
    if (slots.length === 1 && only) {
      layoutSlot(only.spec, only.items, path, id, headId, block, id);
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
        addEdge(headId, slotId, id, spec.label, { parent: path, slot: spec.key, index: 0 });
        layoutSlot({ ...spec, label: undefined }, items, path, slotId, undefined, block, slotId);
      }
    }
    if (insertable) {
      // Пустые известные слоты (if без else, пустое тело) — «+» от заголовка с подписью ветки.
      const shown = new Set(slots.map((s) => s.spec.key));
      for (const spec of kindMeta(block.kind).slots) {
        if (shown.has(spec.key) || !insertableSlots(block).includes(spec.key)) continue;
        const addId = pushInsert(block, `${id}${SLOT_SUFFIX}${spec.key}`, path, spec.key, 0, id);
        addEdge(headId, addId, id, spec.label);
      }
    }
    return id;
  };

  /**
   * Элементы слота spec.key блока owner (путь ownerPath) внутри группы parentId; from — нода, от которой
   * идёт первая стрелка (заголовок). keyId — основа id ноды «+» в конце слота.
   */
  const layoutSlot = (
    spec: SlotSpec,
    items: Block[],
    ownerPath: string,
    parentId: string,
    from: string | undefined,
    owner: Block,
    keyId: string,
  ) => {
    const path = `${ownerPath}/${spec.key}`;
    const canInsert = insertable && insertableSlots(owner).includes(spec.key);
    const at = (index: number): InsertPoint => ({ parent: ownerPath, slot: spec.key, index });
    const shown = visible(items, path);
    if (spec.mode === 'parallel') {
      shown.forEach(({ item, index: i }) => {
        const itemId = visit(item, `${path}/${i}`, parentId);
        if (from) addEdge(from, itemId, parentId, spec.label, at(i));
      });
      if (canInsert) {
        const addId = pushInsert(owner, keyId, ownerPath, spec.key, items.length, parentId);
        if (from) addEdge(from, addId, parentId);
      }
      return;
    }
    let prev = from;
    shown.forEach(({ item, index: i }, n) => {
      const itemId = visit(item, `${path}/${i}`, parentId);
      if (prev) addEdge(prev, itemId, parentId, n === 0 ? spec.label : undefined, at(i));
      prev = itemId;
    });
    if (canInsert) {
      const addId = pushInsert(owner, keyId, ownerPath, spec.key, items.length, parentId);
      if (prev) addEdge(prev, addId, parentId);
    }
  };

  if (root.kind === 'method') {
    const rootId = uniqueId(root, 'root');
    pushLeaf(root, rootId, 'root', undefined, 'block', options.methodBadge);
    let prev = rootId;
    const body = root.slots?.body ?? [];
    visible(body, 'root/body').forEach(({ item, index: i }) => {
      const itemId = visit(item, `root/body/${i}`, undefined);
      addEdge(prev, itemId, undefined, undefined, { parent: 'root', slot: 'body', index: i });
      prev = itemId;
    });
    if (insertable) addEdge(prev, pushInsert(root, rootId, 'root', 'body', body.length, undefined), undefined);
  } else {
    visit(root, 'root', undefined);
  }

  return { nodes, edges };
}
