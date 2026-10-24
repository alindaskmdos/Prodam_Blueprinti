import type { Schemas } from '../api';

export type Block = Schemas['Block'];
export type BlockKind = Schemas['BlockKind'];

/** Как раскладываются элементы слота: цепочкой сверху вниз или параллельными ветками (case, catch). */
export type SlotMode = 'sequence' | 'parallel';

export interface SlotSpec {
  key: string;
  /** Подпись на стрелке от заголовка контейнера к ветке. */
  label?: string;
  mode: SlotMode;
}

export interface KindMeta {
  /** Заголовок ноды (по-русски, как в Kit.dc.html). */
  title: string;
  /** CSS-переменная цвета заголовка из tokens.css. */
  color: string;
  /** Известные слоты в порядке отображения. Слоты, которых нет в списке, идут после, в порядке ключей. */
  slots: SlotSpec[];
}

const body: SlotSpec[] = [{ key: 'body', mode: 'sequence' }];

/** Все kind из контракта (BlockKind). Record гарантирует полноту на этапе typecheck. */
export const KIND_META: Record<BlockKind, KindMeta> = {
  method: { title: 'Метод', color: 'var(--jb-node-method)', slots: body },
  var: { title: 'Переменная', color: 'var(--jb-node-var)', slots: [] },
  assign: { title: 'Присваивание', color: 'var(--jb-node-assign)', slots: [] },
  expr: { title: 'Вызов', color: 'var(--jb-node-expr)', slots: [] },
  if: {
    title: 'Условие',
    color: 'var(--jb-node-if)',
    slots: [
      { key: 'then', label: 'да', mode: 'sequence' },
      { key: 'else', label: 'нет', mode: 'sequence' },
    ],
  },
  while: { title: 'Цикл while', color: 'var(--jb-node-while)', slots: body },
  dowhile: { title: 'Цикл do-while', color: 'var(--jb-node-dowhile)', slots: body },
  for: { title: 'Цикл for', color: 'var(--jb-node-for)', slots: body },
  foreach: { title: 'Цикл for-each', color: 'var(--jb-node-foreach)', slots: body },
  switch: { title: 'Выбор switch', color: 'var(--jb-node-switch)', slots: [{ key: 'cases', mode: 'parallel' }] },
  case: { title: 'case', color: 'var(--jb-node-case)', slots: body },
  try: {
    title: 'try',
    color: 'var(--jb-node-try)',
    slots: [
      { key: 'body', label: 'try', mode: 'sequence' },
      { key: 'catches', label: 'catch', mode: 'parallel' },
      { key: 'finally', label: 'finally', mode: 'sequence' },
    ],
  },
  catch: { title: 'catch', color: 'var(--jb-node-catch)', slots: body },
  return: { title: 'Возврат', color: 'var(--jb-node-return)', slots: [] },
  throw: { title: 'throw', color: 'var(--jb-node-throw)', slots: [] },
  break: { title: 'break', color: 'var(--jb-node-break)', slots: [] },
  continue: { title: 'continue', color: 'var(--jb-node-continue)', slots: [] },
  comment: { title: 'Комментарий', color: 'var(--jb-node-comment)', slots: [] },
  raw: { title: 'raw · как есть', color: 'var(--jb-node-raw)', slots: [] },
};

/** Мета неизвестного kind (нет в контракте фронта): рисуется как raw, слоты — все ключи по порядку. */
const UNKNOWN_META: KindMeta = { title: 'raw · как есть', color: 'var(--jb-node-raw)', slots: [] };

/** Известен ли kind фронту (бэк мог прислать kind новее сгенерированных типов). */
export function isKnownKind(kind: string): kind is BlockKind {
  return Object.prototype.hasOwnProperty.call(KIND_META, kind);
}

/** Мета kind с фолбэком для неизвестного — схема не падает. */
export function kindMeta(kind: string): KindMeta {
  return isKnownKind(kind) ? KIND_META[kind] : { ...UNKNOWN_META, title: `${kind} · как есть` };
}

/** Все kind контракта — для тестов полноты. */
export const ALL_KINDS = Object.keys(KIND_META) as BlockKind[];

/**
 * Контейнер — kind со слотами (кроме method: корень рисуется заголовком и цепочкой на верхнем уровне).
 * Неизвестный kind — контейнер, только если у него есть непустые слоты (чтобы вложенный код не потерялся).
 */
export function isContainer(block: Block): boolean {
  if (block.kind === 'method') return false;
  if (isKnownKind(block.kind)) return KIND_META[block.kind].slots.length > 0;
  return Object.values(block.slots ?? {}).some((items) => items.length > 0);
}

/** Непустые слоты блока в порядке отображения: сначала известные для kind, затем прочие ключи. */
export function orderedSlots(block: Block): { spec: SlotSpec; items: Block[] }[] {
  const known = kindMeta(block.kind).slots;
  const keys = Object.keys(block.slots ?? {});
  const specs: SlotSpec[] = [
    ...known.filter((s) => keys.includes(s.key)),
    ...keys.filter((k) => !known.some((s) => s.key === k)).map((k): SlotSpec => ({ key: k, label: k, mode: 'sequence' })),
  ];
  return specs
    .map((spec) => ({ spec, items: block.slots[spec.key] ?? [] }))
    .filter((s) => s.items.length > 0);
}
