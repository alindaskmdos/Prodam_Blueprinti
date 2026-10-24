import { childPath, editableFields, ROOT_PATH, type BlockPath } from './blockEdit';
import { isKnownKind, KIND_META, type Block, type BlockKind } from './kinds';

/**
 * Структурные операции над деревом метода без React (FE-08): вставка в слот, удаление, вверх/вниз.
 * Все функции чистые — исходное дерево не меняется, копируются только блоки на пути к изменению.
 * Стрелок как данных нет: порядок блоков в слотах и есть поток.
 */

/** Место вставки: слот `slot` блока по пути `parent`, позиция `index` (0 — в начало, длина слота — в конец). */
export interface InsertPoint {
  parent: BlockPath;
  slot: string;
  index: number;
}

/** Адрес блока относительно родителя: путь родителя, слот, индекс. У корня — null. */
export function parentOf(path: BlockPath): InsertPoint | null {
  const parts = path.split('/');
  if (parts[0] !== ROOT_PATH || parts.length < 3 || parts.length % 2 !== 1) return null;
  const index = Number(parts[parts.length - 1]);
  const slot = parts[parts.length - 2];
  if (!Number.isInteger(index) || index < 0 || !slot) return null;
  return { parent: parts.slice(0, -2).join('/'), slot, index };
}

function at(root: Block, path: BlockPath): Block | undefined {
  if (path === ROOT_PATH) return root;
  const p = parentOf(path);
  if (!p) return undefined;
  return at(root, p.parent)?.slots?.[p.slot]?.[p.index];
}

/** Иммутабельно заменяет список блоков слота у блока по пути. Нет блока — null. */
function withSlot(root: Block, parent: BlockPath, slot: string, update: (items: Block[]) => Block[]): Block | null {
  const target = at(root, parent);
  if (!target) return null;
  const replaced: Block = { ...target, slots: { ...target.slots, [slot]: update(target.slots?.[slot] ?? []) } };
  const rebuild = (path: BlockPath, block: Block): Block => {
    const p = parentOf(path);
    if (!p) return block;
    const owner = at(root, p.parent);
    if (!owner) return block;
    const items = (owner.slots[p.slot] ?? []).map((item, i) => (i === p.index ? block : item));
    return rebuild(p.parent, { ...owner, slots: { ...owner.slots, [p.slot]: items } });
  };
  return rebuild(parent, replaced);
}

/** Слоты, в которые можно вставлять: известные для kind (контракт: описание Block). Неизвестный kind — никаких. */
export function insertableSlots(block: Pick<Block, 'kind'>): string[] {
  return isKnownKind(block.kind) ? KIND_META[block.kind].slots.map((s) => s.key) : [];
}

/** Вставка блока в слот. Индекс за пределами [0, длина] или чужой слот — null. Возвращает новое дерево и путь блока. */
export function insertBlock(root: Block, point: InsertPoint, block: Block): { root: Block; path: BlockPath } | null {
  const parent = at(root, point.parent);
  if (!parent || !insertableSlots(parent).includes(point.slot)) return null;
  const len = parent.slots?.[point.slot]?.length ?? 0;
  if (!Number.isInteger(point.index) || point.index < 0 || point.index > len) return null;
  const next = withSlot(root, point.parent, point.slot, (items) => [
    ...items.slice(0, point.index),
    block,
    ...items.slice(point.index),
  ]);
  return next ? { root: next, path: childPath(point.parent, point.slot, point.index) } : null;
}

/** Удаление блока вместе с содержимым. Корень (method) и несуществующий путь — дерево без изменений. */
export function removeBlock(root: Block, path: BlockPath): Block {
  const p = parentOf(path);
  if (!p || !at(root, path)) return root;
  return withSlot(root, p.parent, p.slot, (items) => items.filter((_, i) => i !== p.index)) ?? root;
}

/**
 * Пропуск блоков при ↑↓ (FE-06): скрытые на схеме блоки (комментарии при выключенном переключателе)
 * не считаются соседями — блок меняется местами с ближайшим видимым, скрытые остаются на своих местах.
 */
export type MoveSkip = (block: Block) => boolean;

/** Скрытые комментарии (переключатель «Комментарии» выключен). */
export const skipComments: MoveSkip = (block) => block.kind === 'comment';

/** Индекс соседа, с которым меняется блок; нет — null. */
function moveTarget(root: Block, path: BlockPath, delta: -1 | 1, skip?: MoveSkip): number | null {
  const p = parentOf(path);
  if (!p) return null;
  const items = at(root, p.parent)?.slots?.[p.slot];
  if (!items || p.index >= items.length) return null;
  for (let to = p.index + delta; to >= 0 && to < items.length; to += delta) {
    const item = items[to];
    if (item && !skip?.(item)) return to;
  }
  return null;
}

/** Можно ли сдвинуть блок на delta внутри его слота (через границы контейнеров — нельзя). */
export function canMove(root: Block, path: BlockPath, delta: -1 | 1, skip?: MoveSkip): boolean {
  return moveTarget(root, path, delta, skip) !== null;
}

/**
 * Перестановка с соседом в том же слоте (со skip — с ближайшим не пропускаемым; блоки между ними на месте).
 * На границе слота — то же дерево и тот же путь.
 */
export function moveBlock(root: Block, path: BlockPath, delta: -1 | 1, skip?: MoveSkip): { root: Block; path: BlockPath } {
  const p = parentOf(path);
  const to = moveTarget(root, path, delta, skip);
  if (!p || to === null) return { root, path };
  const next = withSlot(root, p.parent, p.slot, (items) => {
    const copy = [...items];
    const a = copy[p.index];
    const b = copy[to];
    if (a && b) {
      copy[p.index] = b;
      copy[to] = a;
    }
    return copy;
  });
  return next ? { root: next, path: childPath(p.parent, p.slot, to) } : { root, path };
}

/** Сколько блоков вложено (без самого блока) — для подтверждения удаления контейнера. */
export function nestedCount(block: Block): number {
  return Object.values(block.slots ?? {}).reduce(
    (sum, items) => sum + items.reduce((s, item) => s + 1 + nestedCount(item), 0),
    0,
  );
}

/** Пункт меню вставки. */
export interface InsertOption {
  kind: BlockKind;
  label: string;
}

/** Операторы для обычного слота (тело метода, цикла, ветки if, case, catch, try, finally). */
export const STATEMENT_OPTIONS: InsertOption[] = [
  { kind: 'var', label: 'Переменная' },
  { kind: 'assign', label: 'Операция (присваивание)' },
  { kind: 'expr', label: 'Вызов метода' },
  { kind: 'if', label: 'Условие if' },
  { kind: 'for', label: 'Цикл for' },
  { kind: 'foreach', label: 'Цикл for-each' },
  { kind: 'while', label: 'Цикл while' },
  { kind: 'dowhile', label: 'Цикл do-while' },
  { kind: 'switch', label: 'switch' },
  { kind: 'try', label: 'try / catch' },
  { kind: 'return', label: 'Возврат' },
  { kind: 'throw', label: 'throw' },
  { kind: 'break', label: 'break' },
  { kind: 'continue', label: 'continue' },
  { kind: 'comment', label: 'Комментарий' },
  { kind: 'raw', label: 'Java-код как есть' },
];

/** Что можно вставить в слот: в switch.cases — только case, в try.catches — только catch, иначе операторы. */
export function insertOptions(owner: Pick<Block, 'kind'>, slot: string): InsertOption[] {
  if (owner.kind === 'switch' && slot === 'cases') return [{ kind: 'case', label: 'case' }];
  if (owner.kind === 'try' && slot === 'catches') return [{ kind: 'catch', label: 'catch' }];
  return insertableSlots(owner).includes(slot) ? STATEMENT_OPTIONS : [];
}

const leaf = (kind: BlockKind, fields: Record<string, string>): Block => ({ id: '', kind, fields, slots: {} });

/**
 * Новый блок kind с пустыми обязательными полями (контракт: необязательных ключей нет) и пустыми слотами.
 * id пустой — контракт разрешает для новых нод во входе PUT blocks, бэк пересчитает.
 * Шаблоны: assign — оператор «=», try — с одним catch (Exception e), иначе Java не соберёт try без catch/finally.
 */
export function templateBlock(kind: BlockKind): Block {
  switch (kind) {
    case 'var':
      return leaf(kind, { type: '', name: '' });
    case 'assign':
      return leaf(kind, { target: '', op: '=', value: '' });
    case 'expr':
    case 'comment':
    case 'raw':
      return leaf(kind, { text: '' });
    case 'if':
      return { ...leaf(kind, { cond: '' }), slots: { then: [] } };
    case 'while':
    case 'dowhile':
      return { ...leaf(kind, { cond: '' }), slots: { body: [] } };
    case 'for':
      return { ...leaf(kind, { init: '', cond: '', update: '' }), slots: { body: [] } };
    case 'foreach':
      return { ...leaf(kind, { type: '', var: '', iterable: '' }), slots: { body: [] } };
    case 'switch':
      return { ...leaf(kind, { selector: '' }), slots: { cases: [] } };
    case 'case':
      return { ...leaf(kind, { label: '' }), slots: { body: [] } };
    case 'catch':
      return { ...leaf(kind, { type: 'Exception', var: 'e' }), slots: { body: [] } };
    case 'try':
      return { ...leaf(kind, {}), slots: { body: [], catches: [templateBlock('catch')] } };
    case 'throw':
      return leaf(kind, { value: '' });
    case 'return':
    case 'break':
    case 'continue':
      return leaf(kind, {});
    case 'method':
      return { ...leaf(kind, { signature: '' }), slots: { body: [] } };
  }
}

/**
 * Шаблон с учётом места вставки. case берёт форму (case.arrow) у соседних case того же switch — в одном
 * switch все case одной формы (контракт); соседей нет — форма по умолчанию `case X:` (ключа arrow нет).
 */
export function templateFor(owner: Block, slot: string, kind: BlockKind): Block {
  const block = templateBlock(kind);
  if (kind !== 'case' || owner.kind !== 'switch' || slot !== 'cases') return block;
  const arrow = (owner.slots?.cases ?? []).some((c) => c.kind === 'case' && c.fields?.arrow === 'true');
  return arrow ? { ...block, fields: { ...block.fields, arrow: 'true' } } : block;
}

/**
 * Та же структура: те же id и kind на тех же местах (поля могут отличаться). Пути одного дерева
 * указывают на те же блоки в другом.
 */
export function sameShape(a: Block, b: Block): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.kind !== b.kind) return false;
  const ka = Object.keys(a.slots ?? {});
  const kb = Object.keys(b.slots ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = a.slots[k] ?? [];
    const y = b.slots?.[k];
    return y !== undefined && x.length === y.length && x.every((item, i) => sameShape(item, y[i] as Block));
  });
}

/** Kind, который после вставки сразу уходит на сервер (нечего вводить): break, continue, try. */
const SEND_AT_ONCE = new Set<BlockKind>(['break', 'continue', 'try']);

/** Открыть ли инлайн-редактор новой ноды сразу после вставки (иначе блок сразу отправляется). */
export function editsOnInsert(block: Block): boolean {
  return !SEND_AT_ONCE.has(block.kind) && editableFields(block).length > 0;
}
