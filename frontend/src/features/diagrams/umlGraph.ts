import type { Schemas } from '../api';
import type { LayoutEdge, LayoutNode } from './diagramLayout';

export type UmlClass = Schemas['UmlClass'];
export type UmlMember = Schemas['UmlMember'];
export type UmlRelation = Schemas['UmlRelation'];
export type UmlKind = UmlClass['kind'];
export type RelationKind = UmlRelation['kind'];

/** Видимость члена класса значком UML: + public, − private, # protected, ~ package. */
export type Visibility = 'public' | 'private' | 'protected' | 'package';

export const VISIBILITY_SIGN: Record<Visibility, string> = { public: '+', private: '−', protected: '#', package: '~' };

/** Видимость по модификаторам; без модификатора у членов интерфейса — public (как в Java). */
export function visibilityOf(modifiers: readonly string[], ownerKind: UmlKind = 'class'): Visibility {
  if (modifiers.includes('public')) return 'public';
  if (modifiers.includes('private')) return 'private';
  if (modifiers.includes('protected')) return 'protected';
  return ownerKind === 'interface' ? 'public' : 'package';
}

/** Буква и цвет иконки kind — как в дереве проекта макета Structure.dc.html (значок заменяет стереотип). */
export const KIND_ICON: Record<UmlKind, { letter: string; color: string }> = {
  class: { letter: 'C', color: 'var(--jb-node-var)' },
  interface: { letter: 'I', color: 'var(--jb-severity-medium)' },
  enum: { letter: 'E', color: '#f472b6' },
  record: { letter: 'R', color: 'var(--jb-success)' },
};

/**
 * Уровень подробности карточки: `compact` — только значок, имя и пакет (по умолчанию); `expanded` — ещё
 * не-private поля и методы одной строкой; `all` — и private.
 */
export type CardLevel = 'compact' | 'expanded' | 'all';

/** Строка развёрнутой карточки: поле `name` или метод `name()` (полная сигнатура — в title). */
export interface MemberRow {
  key: string;
  label: string;
  /** Метод (кликабелен → схема метода); у поля — undefined. */
  method?: UmlMember;
  modifiers: readonly string[];
  title: string;
}

export interface CardMembers {
  fields: MemberRow[];
  methods: MemberRow[];
  /** Сколько private-членов скрыто на уровне `expanded` (на `all` — сколько их показано). */
  privateCount: number;
}

/**
 * Члены для развёрнутой карточки, упрощённо: поля `name`, методы `name()`; конструкторы не показываются.
 * private скрыты, кроме уровня `all`; компоненты record (private final поля) видны всегда.
 */
export function cardMembers(cls: UmlClass, level: CardLevel): CardMembers {
  const isPrivate = (m: { modifiers: readonly string[] }) => visibilityOf(m.modifiers, cls.kind) === 'private';
  const keepField = (f: UmlClass['fields'][number]) => cls.kind === 'record' || !isPrivate(f);
  const privateCount = cls.fields.filter((f) => !keepField(f)).length + cls.methods.filter(isPrivate).length;
  const show = <T extends { modifiers: readonly string[] }>(items: readonly T[], keep: (m: T) => boolean) =>
    level === 'all' ? items : items.filter(keep);
  return {
    fields: show(cls.fields, keepField).map((f) => ({
      key: f.name,
      label: f.name,
      modifiers: f.modifiers,
      title: `${f.modifiers.join(' ')} ${f.type} ${f.name}`.trim(),
    })),
    methods: show(cls.methods, (m) => !isPrivate(m)).map((m) => ({
      key: m.id,
      label: `${m.name}()`,
      method: m,
      modifiers: m.modifiers,
      title: `${m.signature} — открыть схему`,
    })),
    privateCount,
  };
}

/** Есть что разворачивать: поля или методы (конструкторы не в счёт). */
export function hasMembers(cls: UmlClass): boolean {
  return cls.fields.length + cls.methods.length > 0;
}

/** Размеры карточки — те же числа, что в Diagrams.module.css (.card*): раскладка ELK и отрисовка совпадают. */
export const CARD = {
  minWidth: 120,
  maxWidth: 320,
  /** Заголовок: рамка 3 px сверху (полоса kind) + 52 px (имя 16 px и пакет 10,5 px) + рамка 1 px снизу. Одна высота у всех свёрнутых. */
  header: 56,
  /** Отступы тела развёрнутой карточки сверху и снизу. */
  bodyPad: 4,
  row: 20,
  /** Разделитель полей и методов. */
  separator: 7,
  /**
   * Предел высоты тела развёрнутой карточки (= max-height .cardBody): отступы + 9 строк. Длинный список
   * прокручивается внутри карточки; в раскладку идёт эта же высота — карточки не перекрываются.
   */
  maxBody: 4 * 2 + 9 * 20,
  /** typeParams и строка члена — JetBrains Mono 12 px, ширина символа с запасом. */
  monoChar: 7.3,
  /** Поля 12 + значок 22 + зазор 8 + шеврон 20 + зазоры 14. */
  headerChrome: 76,
  /** Поля 12 + значок видимости 14 + зазор 7 + запас. */
  rowChrome: 46,
} as const;

/**
 * Оценка ширины текста имени (Inter 700 16 px) сверху: ширины символов замерены в Chromium и округлены вверх
 * по группам, плюс 6 % запаса — имя не обрезается многоточием (DOM-замера в раскладке нет: она чистая).
 */
export function titleWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch);
  return w * 1.06;
}

function charWidth(ch: string): number {
  if ('iIjl.,:;!|\''.includes(ch)) return 5;
  if ('frt()[]/-'.includes(ch)) return 7;
  if (ch === 'W' || ch === 'w') return 17;
  if (ch === 'M' || ch === 'm') return 15;
  if (ch >= 'A' && ch <= 'Z') return 12;
  if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) return 10;
  return 12;
}

/** Части имени, между которыми можно перенести строку: границы camelCase и точки вложенного класса. */
export function nameSegments(name: string): string[] {
  return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=\.)/).filter(Boolean);
}

/** Ширина самой длинной части имени (16 px): при отдалении строка переносится только между частями. */
function longestSegment(name: string): number {
  return nameSegments(name).reduce((n, seg) => Math.max(n, titleWidth(seg)), 0);
}

/** Минимальный экранный размер имени при отдалении (px). */
export const READABLE_NAME_PX = 12;
/** Базовый размер шрифта имени (= .className в CSS). */
const NAME_PX = 16;
/** Поля 12 + значок 22 + зазор 8 + правое поле 8 + рамка 2: ширина вокруг имени, когда пакет и шеврон скрыты. */
export const SCALED_TEXT_CHROME = 52;
/**
 * Во сколько раз имя должно уметь вырасти в своей карточке: ширина карточки в раскладке — не меньше, чем нужно
 * самой длинной части имени при таком увеличении. Тогда при общем «Fit View» (масштаб ~0,3) имя всех карточек
 * одного экранного размера ≥ 11 px без многоточия, а не упирается в ширину короткой карточки.
 */
export const FAR_NAME_SCALE = 2.3;

/** Размеры карточки: свёрнутая — от длины имени, высота общая; развёрнутая — плюс строки членов (не выше CARD.maxBody). */
export function cardSize(cls: UmlClass, level: CardLevel = 'compact'): { width: number; height: number } {
  const headerWidth = titleWidth(cls.name) + (cls.typeParams?.length ?? 0) * CARD.monoChar + CARD.headerChrome;
  const farWidth = SCALED_TEXT_CHROME + longestSegment(cls.name) * FAR_NAME_SCALE;
  const base = Math.max(headerWidth, farWidth);
  if (level === 'compact' || !hasMembers(cls)) {
    return { width: clampWidth(base), height: CARD.header };
  }
  const { fields, methods, privateCount } = cardMembers(cls, level);
  const rows = [...fields, ...methods];
  const longest = rows.reduce((n, r) => Math.max(n, r.label.length), 0);
  const lines = rows.length + (privateCount > 0 ? 1 : 0);
  const body = 2 * CARD.bodyPad + lines * CARD.row + (fields.length > 0 && methods.length > 0 ? CARD.separator : 0);
  const height = CARD.header + Math.min(body, CARD.maxBody);
  return { width: clampWidth(Math.max(base, longest * CARD.monoChar + CARD.rowChrome)), height };
}

function clampWidth(w: number): number {
  return Math.round(Math.min(CARD.maxWidth, Math.max(CARD.minWidth, w)));
}

/**
 * Насколько можно увеличить имя, чтобы оно поместилось во все карточки диаграммы (самая длинная часть имени —
 * в строку). Одна величина на диаграмму: имена всех карточек растут одинаково, экранный размер у всех один.
 */
export function nameFit(nodes: readonly { cls: Pick<UmlClass, 'name'>; width: number }[]): number {
  let fit = Infinity;
  for (const n of nodes) {
    const seg = longestSegment(n.cls.name);
    if (seg > 0) fit = Math.min(fit, (n.width - SCALED_TEXT_CHROME) / seg);
  }
  return Number.isFinite(fit) ? Math.max(1, fit) : 1;
}

/** Ниже этого масштаба развёрнутая карточка тоже показывает только крупное имя (члены всё равно не читаются). */
export const EXPANDED_SCALE_ZOOM = 0.3;

/**
 * Увеличение имени при отдалении (1 — как есть): имя растёт обратно масштабу, пока на экране оно меньше
 * READABLE_NAME_PX, но не больше общего для диаграммы `fit` (`nameFit`) — у всех карточек одно значение.
 * Развёрнутая карточка (`open`) — только ниже EXPANDED_SCALE_ZOOM. Шаг 0,05 — меньше перерисовок.
 */
export function nameScale(zoom: number, fit: number, open = false): number {
  if (open && zoom >= EXPANDED_SCALE_ZOOM) return 1;
  const want = READABLE_NAME_PX / (NAME_PX * zoom);
  if (want <= 1) return 1;
  return Math.max(1, Math.floor(Math.min(want, fit) * 20) / 20);
}

/** Вид ребра в UML-нотации. */
export interface RelationStyle {
  dashed: boolean;
  /** Маркер на конце `to`. */
  end: 'triangle' | 'arrow' | null;
  /** Маркер на конце `from` (целое у агрегации/композиции). */
  start: 'diamond' | 'diamondFilled' | null;
  /** Подпись для легенды / title. */
  label: string;
}

export const RELATION_STYLE: Record<RelationKind, RelationStyle> = {
  extends: { dashed: false, end: 'triangle', start: null, label: 'наследование' },
  implements: { dashed: true, end: 'triangle', start: null, label: 'реализация' },
  association: { dashed: false, end: 'arrow', start: null, label: 'ассоциация' },
  dependency: { dashed: true, end: 'arrow', start: null, label: 'зависимость' },
  aggregation: { dashed: false, end: null, start: 'diamond', label: 'агрегация' },
  composition: { dashed: false, end: null, start: 'diamondFilled', label: 'композиция' },
};

export interface UmlEdgeModel {
  id: string;
  from: string;
  to: string;
  relation: UmlRelation;
}

export interface UmlGraphModel {
  nodes: (LayoutNode & { cls: UmlClass; level: CardLevel })[];
  edges: (UmlEdgeModel & LayoutEdge)[];
}

/**
 * Ответ GET uml → ноды (карточки с размерами) и рёбра для раскладки. Связи к классам, которых нет в ответе,
 * отбрасываются (рисуются только связи между классами проекта). Наследование/реализация раскладываются
 * обратным ребром: родитель — выше потомка, как принято в UML. Связи одного вида между теми же классами
 * (from->to:kind) — одно ребро, поля `via` объединяются; from === to — самосвязь (рисуется петлёй).
 * `levels` — развёрнутые карточки (нет в карте — свёрнута): от уровня зависит размер карточки в раскладке.
 */
export function umlToGraph(diagram: Schemas['UmlDiagram'], levels: ReadonlyMap<string, CardLevel> = new Map()): UmlGraphModel {
  const ids = new Set(diagram.classes.map((c) => c.id));
  const nodes = diagram.classes.map((cls) => {
    const level = levels.get(cls.id) ?? 'compact';
    return { id: cls.id, cls, level, ...cardSize(cls, level) };
  });
  const byId = new Map<string, UmlGraphModel['edges'][number]>();
  for (const r of diagram.relations) {
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    const id = `${r.from}->${r.to}:${r.kind}`;
    const seen = byId.get(id);
    if (seen) {
      const via = [...new Set([...(seen.relation.via?.split(', ') ?? []), ...(r.via ? [r.via] : [])])].join(', ');
      if (via) seen.relation = { ...seen.relation, via };
      continue;
    }
    const up = r.kind === 'extends' || r.kind === 'implements';
    byId.set(id, { id, from: r.from, to: r.to, relation: r, source: up ? r.to : r.from, target: up ? r.from : r.to, reversed: up });
  }
  return { nodes, edges: [...byId.values()] };
}

/** Структурные связи: видны всегда. Зависимости (`dependency`) — по переключателю или у наведённой карточки. */
export function isStructural(kind: RelationKind): boolean {
  return kind !== 'dependency';
}

/**
 * Модель для раскладки ELK: без зависимостей, если они скрыты, — скрытые рёбра не раздувают раскладку
 * (зависимость наведённой карточки рисуется прямой между карточками). `full` — вся модель для отрисовки.
 */
export function layoutModel(
  model: UmlGraphModel,
  showDependencies: boolean,
): UmlGraphModel & { full: UmlGraphModel; showDependencies: boolean } {
  const edges = showDependencies ? model.edges : model.edges.filter((e) => isStructural(e.relation.kind));
  return { nodes: model.nodes, edges, full: model, showDependencies };
}

/** Сколько исходящих связей делает класс «хабом» (напр. Main): его слабые связи рисуются бледнее, пока не наведены. */
export const HUB_DEGREE = 6;

/** Классы-хабы: у них не меньше HUB_DEGREE исходящих связей (самосвязи не в счёт). */
export function hubSources(edges: readonly { from: string; to: string }[], min = HUB_DEGREE): Set<string> {
  const out = new Map<string, number>();
  for (const e of edges) if (e.from !== e.to) out.set(e.from, (out.get(e.from) ?? 0) + 1);
  return new Set([...out].filter(([, n]) => n >= min).map(([id]) => id));
}

/** Соседи класса по рёбрам (для подсветки связей при наведении). */
export function neighborsOf(edges: readonly { from: string; to: string }[], id: string): Set<string> {
  const result = new Set<string>([id]);
  for (const e of edges) {
    if (e.from === id) result.add(e.to);
    if (e.to === id) result.add(e.from);
  }
  return result;
}

/** Поиск класса: подстрока имени или FQN без учёта регистра; пустой запрос — null (фильтра нет). */
export function matchClasses(classes: readonly { id: string; name: string }[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return new Set(classes.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)).map((c) => c.id));
}
