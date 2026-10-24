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

/** Буква и цвет иконки kind — как в дереве проекта макета Structure.dc.html. */
export const KIND_ICON: Record<UmlKind, { letter: string; color: string; stereotype: string | null }> = {
  class: { letter: 'C', color: 'var(--jb-node-var)', stereotype: null },
  interface: { letter: 'I', color: 'var(--jb-severity-medium)', stereotype: '«interface»' },
  enum: { letter: 'E', color: '#f472b6', stereotype: '«enum»' },
  record: { letter: 'R', color: 'var(--jb-success)', stereotype: '«record»' },
};

/** Стереотип карточки: «interface» / «enum» / «record», у abstract-класса — «abstract»; обычный класс — null. */
export function stereotypeOf(cls: Pick<UmlClass, 'kind' | 'modifiers'>): string | null {
  if (cls.kind === 'class' && cls.modifiers.includes('abstract')) return '«abstract»';
  return KIND_ICON[cls.kind].stereotype;
}

const LEADING_MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'synchronized',
  'native',
  'default',
  'strictfp',
  'transient',
  'volatile',
]);

/** Сигнатура для карточки: без ведущих модификаторов (видимость — значком), аннотации тоже убираются. */
export function memberText(signature: string): string {
  const words = signature.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && (LEADING_MODIFIERS.has(words[i] ?? '') || words[i]?.startsWith('@'))) i++;
  return words.slice(i).join(' ');
}

/** Строка поля: «name: Type» (типы JDK — только текстом, без связей). */
export function fieldText(field: { name: string; type: string }): string {
  return `${field.name}: ${field.type}`;
}

/** Размеры карточки — те же числа, что в Diagrams.module.css (.card*): раскладка ELK и отрисовка совпадают. */
export const CARD = {
  minWidth: 190,
  maxWidth: 420,
  header: 54,
  sectionTitle: 22,
  row: 20,
  bottomPad: 8,
  /** Ширина символа JetBrains Mono 12px и Inter 14px (оценка, с запасом). */
  monoChar: 7.3,
  titleChar: 8.6,
  rowChrome: 46,
  headerChrome: 74,
} as const;

/** Секции карточки с членами: пустые не рисуются. */
export function cardSections(cls: UmlClass): { key: 'fields' | 'constructors' | 'methods'; title: string; count: number }[] {
  const all = [
    { key: 'fields' as const, title: cls.kind === 'record' ? 'Компоненты и поля' : 'Поля', count: cls.fields.length },
    { key: 'constructors' as const, title: 'Конструкторы', count: cls.constructors.length },
    { key: 'methods' as const, title: 'Методы', count: cls.methods.length },
  ];
  return all.filter((s) => s.count > 0);
}

/** Оценка размеров карточки класса по содержимому. */
export function cardSize(cls: UmlClass): { width: number; height: number } {
  const rows = [
    ...cls.fields.map(fieldText),
    ...cls.constructors.map((m) => memberText(m.signature)),
    ...cls.methods.map((m) => memberText(m.signature)),
  ];
  const longestRow = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const title = `${cls.name}${cls.typeParams ?? ''}`;
  const width = Math.round(
    Math.min(
      CARD.maxWidth,
      Math.max(CARD.minWidth, longestRow * CARD.monoChar + CARD.rowChrome, title.length * CARD.titleChar + CARD.headerChrome),
    ),
  );
  const sections = cardSections(cls);
  const height =
    CARD.header + sections.reduce((h, s) => h + CARD.sectionTitle + s.count * CARD.row, 0) + CARD.bottomPad;
  return { width, height };
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
  nodes: (LayoutNode & { cls: UmlClass })[];
  edges: (UmlEdgeModel & LayoutEdge)[];
}

/**
 * Ответ GET uml → ноды (карточки с размерами) и рёбра для раскладки. Связи к классам, которых нет в ответе,
 * отбрасываются (рисуются только связи между классами проекта). Наследование/реализация раскладываются
 * обратным ребром: родитель — выше потомка, как принято в UML.
 */
export function umlToGraph(diagram: Schemas['UmlDiagram']): UmlGraphModel {
  const ids = new Set(diagram.classes.map((c) => c.id));
  const nodes = diagram.classes.map((cls) => ({ id: cls.id, cls, ...cardSize(cls) }));
  const seen = new Set<string>();
  const edges: UmlGraphModel['edges'] = [];
  for (const r of diagram.relations) {
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) continue;
    const id = `${r.from}->${r.to}:${r.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const up = r.kind === 'extends' || r.kind === 'implements';
    edges.push({ id, from: r.from, to: r.to, relation: r, source: up ? r.to : r.from, target: up ? r.from : r.to, reversed: up });
  }
  return { nodes, edges };
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
