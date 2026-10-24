import { isKnownKind, type Block, type BlockKind } from './kinds';

/**
 * Правка текста в ноде без React: какие поля fields правятся у каждого kind,
 * адрес блока в дереве (путь) и иммутабельная замена полей.
 */

export interface FieldSpec {
  /** Ключ в Block.fields (контракт: описание схемы Block). */
  key: string;
  /** Короткая подпись поля в редакторе (если полей несколько). */
  label: string;
  /** Необязательное поле: пустое значение → ключа нет в fields. */
  optional?: boolean;
  /** Многострочный текст (comment, raw): Enter — применить, Shift+Enter — перенос строки. */
  multiline?: boolean;
  /** Подсвечивать как Java (комментарий — обычный текст). */
  java: boolean;
}

const j = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, java: true, ...extra });

/**
 * Редактируемые поля по kind. method (сигнатура — форма метода, FE-10) и case.arrow (форма switch) не правятся.
 * Kind без записи — правка текста недоступна.
 */
export const EDITABLE_FIELDS: Partial<Record<BlockKind, FieldSpec[]>> = {
  var: [j('type', 'тип'), j('name', 'имя'), j('init', '=', { optional: true })],
  assign: [j('target', 'куда'), j('op', 'оператор'), j('value', 'значение')],
  expr: [j('text', 'выражение')],
  if: [j('cond', 'условие')],
  while: [j('cond', 'условие')],
  dowhile: [j('cond', 'условие')],
  for: [j('init', 'инициализация'), j('cond', 'условие'), j('update', 'шаг')],
  foreach: [j('type', 'тип'), j('var', 'переменная'), j('iterable', 'коллекция')],
  switch: [j('selector', 'выражение')],
  case: [j('label', 'метка')],
  try: [j('resources', 'ресурсы', { optional: true })],
  catch: [j('type', 'тип'), j('var', 'переменная')],
  return: [j('value', 'значение', { optional: true })],
  throw: [j('value', 'исключение')],
  break: [j('label', 'метка', { optional: true })],
  continue: [j('label', 'метка', { optional: true })],
  comment: [{ key: 'text', label: 'комментарий', multiline: true, java: false }],
  raw: [j('text', 'исходный текст', { multiline: true })],
};

/** Поля, которые можно править у блока; пусто — нода только для просмотра. */
export function editableFields(block: Pick<Block, 'kind'>): FieldSpec[] {
  return isKnownKind(block.kind) ? (EDITABLE_FIELDS[block.kind] ?? []) : [];
}

/** Значения редактируемых полей для редактора: отсутствующее поле — пустая строка. */
export function draftOf(block: Block): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const spec of editableFields(block)) draft[spec.key] = block.fields?.[spec.key] ?? '';
  return draft;
}

/**
 * Новые fields блока: правятся только редактируемые ключи, остальные (case.arrow и т.п.) сохраняются.
 * Пустое необязательное поле удаляется (контракт: «при отсутствии — ключа нет»).
 */
export function mergeFields(block: Block, draft: Record<string, string>): Record<string, string> {
  const specs = new Map(editableFields(block).map((s) => [s.key, s]));
  const removed = new Set(
    [...specs.values()].filter((s) => s.optional && (draft[s.key] ?? '').trim() === '' && draft[s.key] !== undefined).map((s) => s.key),
  );
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(block.fields ?? {})) {
    if (!removed.has(key)) next[key] = specs.has(key) ? (draft[key] ?? value) : value;
  }
  for (const key of specs.keys()) {
    const value = draft[key];
    if (value !== undefined && !removed.has(key) && !(key in next)) next[key] = value;
  }
  return next;
}

export function sameFields(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/**
 * Путь блока в дереве — тот же, что строит blocksToGraph: `root`, `root/body/0`, `root/body/1/then/0`…
 * (после `root` пары «слот/индекс»).
 */
export type BlockPath = string;

export const ROOT_PATH: BlockPath = 'root';

export function childPath(path: BlockPath, slot: string, index: number): BlockPath {
  return `${path}/${slot}/${index}`;
}

function segments(path: BlockPath): { slot: string; index: number }[] | null {
  const parts = path.split('/');
  if (parts[0] !== ROOT_PATH || parts.length % 2 !== 1) return null;
  const out: { slot: string; index: number }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const index = Number(parts[i + 1]);
    if (!Number.isInteger(index) || index < 0) return null;
    out.push({ slot: parts[i] ?? '', index });
  }
  return out;
}

/** Блок по пути; нет такого — undefined. */
export function blockAt(root: Block, path: BlockPath): Block | undefined {
  const segs = segments(path);
  if (!segs) return undefined;
  let cur: Block | undefined = root;
  for (const { slot, index } of segs) {
    cur = cur?.slots?.[slot]?.[index];
    if (!cur) return undefined;
  }
  return cur;
}

/** Иммутабельно заменяет блок по пути (копируются только блоки на пути к нему). Нет пути — исходное дерево. */
export function updateBlockAt(root: Block, path: BlockPath, update: (block: Block) => Block): Block {
  const segs = segments(path);
  if (!segs || !blockAt(root, path)) return root;
  const go = (block: Block, depth: number): Block => {
    const seg = segs[depth];
    if (!seg) return update(block);
    const items = block.slots[seg.slot] ?? [];
    const nextItems = items.map((item, i) => (i === seg.index ? go(item, depth + 1) : item));
    return { ...block, slots: { ...block.slots, [seg.slot]: nextItems } };
  };
  return go(root, 0);
}

/** Новое полное дерево метода с правкой полей блока по пути. */
export function withFields(root: Block, path: BlockPath, draft: Record<string, string>): Block {
  return updateBlockAt(root, path, (block) => ({ ...block, fields: mergeFields(block, draft) }));
}

/** Путь блока с данным id (обход в порядке дерева); не найден — undefined. */
export function findPathById(root: Block, id: string): BlockPath | undefined {
  const go = (block: Block, path: BlockPath): BlockPath | undefined => {
    if (block.id === id) return path;
    for (const [slot, items] of Object.entries(block.slots ?? {})) {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;
        const found = go(item, childPath(path, slot, i));
        if (found) return found;
      }
    }
    return undefined;
  };
  return go(root, ROOT_PATH);
}
