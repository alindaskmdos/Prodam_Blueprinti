import { describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import type { Schemas } from '../api';
import { fromElk, toElk } from './diagramLayout';
import { nearEnd, polylineMid, polylinePath } from './edgeGeometry';
import { umlFlow } from './umlFlow';
import {
  cardSections,
  cardSize,
  CARD,
  matchClasses,
  memberText,
  neighborsOf,
  stereotypeOf,
  umlToGraph,
  visibilityOf,
  type UmlClass,
} from './umlGraph';

const uml = umlJson as unknown as Schemas['UmlDiagram'];

function cls(partial: Partial<UmlClass> & { id: string }): UmlClass {
  return {
    name: partial.id.split('.').pop() ?? partial.id,
    kind: 'class',
    package: 'p',
    path: `src/p/${partial.id}.java`,
    span: { file: `src/p/${partial.id}.java`, startLine: 1, endLine: 9 },
    modifiers: ['public'],
    fields: [],
    constructors: [],
    methods: [],
    ...partial,
  };
}

describe('umlToGraph — ответ GET uml → ноды и рёбра', () => {
  it('фикстура: карточка на каждый класс, связи только между классами проекта', () => {
    const g = umlToGraph(uml);
    expect(g.nodes.map((n) => n.id)).toEqual(uml.classes.map((c) => c.id));
    expect(g.edges).toHaveLength(uml.relations.length);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const n of g.nodes) {
      expect(n.width).toBeGreaterThanOrEqual(CARD.minWidth);
      expect(n.width).toBeLessThanOrEqual(CARD.maxWidth);
    }
  });

  it('наследование/реализация раскладываются обратным ребром (родитель выше), остальные — как есть', () => {
    const g = umlToGraph({
      version: 1,
      classes: [cls({ id: 'A' }), cls({ id: 'B' }), cls({ id: 'I', kind: 'interface' })],
      relations: [
        { from: 'B', to: 'A', kind: 'extends', heuristic: false },
        { from: 'B', to: 'I', kind: 'implements', heuristic: false },
        { from: 'A', to: 'B', kind: 'composition', heuristic: true, multiplicity: '1' },
        { from: 'A', to: 'java.util.List', kind: 'dependency', heuristic: false },
        { from: 'A', to: 'A', kind: 'dependency', heuristic: false },
      ],
    });
    expect(g.edges.map((e) => [e.from, e.to, e.source, e.target, e.reversed])).toEqual([
      ['B', 'A', 'A', 'B', true],
      ['B', 'I', 'I', 'B', true],
      ['A', 'B', 'A', 'B', false],
    ]);
  });

  it('размер карточки растёт с числом членов и длиной сигнатур', () => {
    const empty = cardSize(cls({ id: 'E' }));
    expect(empty.height).toBe(CARD.header + CARD.bottomPad);
    const full = cls({
      id: 'F',
      fields: [{ name: 'x', type: 'int', modifiers: ['private'] }],
      methods: [{ id: 'F.m~0', name: 'm', signature: 'public void m()', modifiers: ['public'] }],
    });
    expect(cardSize(full).height).toBe(CARD.header + 2 * CARD.sectionTitle + 2 * CARD.row + CARD.bottomPad);
    expect(cardSections(full).map((s) => s.key)).toEqual(['fields', 'methods']);
    const wide = cls({
      id: 'W',
      methods: [{ id: 'W.m~0', name: 'm', signature: `public void m(${'int a, '.repeat(10)}int z)`, modifiers: ['public'] }],
    });
    expect(cardSize(wide).width).toBeGreaterThan(empty.width);
  });

  it('видимость значком, стереотип и текст члена', () => {
    expect(visibilityOf(['public', 'static'])).toBe('public');
    expect(visibilityOf(['private', 'final'])).toBe('private');
    expect(visibilityOf(['protected'])).toBe('protected');
    expect(visibilityOf([])).toBe('package');
    expect(visibilityOf([], 'interface')).toBe('public');
    expect(stereotypeOf({ kind: 'interface', modifiers: [] })).toBe('«interface»');
    expect(stereotypeOf({ kind: 'class', modifiers: ['public', 'abstract'] })).toBe('«abstract»');
    expect(stereotypeOf({ kind: 'class', modifiers: ['public'] })).toBeNull();
    expect(memberText('public static void main(String[] args) throws IOException')).toBe(
      'void main(String[] args) throws IOException',
    );
    expect(memberText('@Override public String toString()')).toBe('String toString()');
  });

  it('поиск и соседи', () => {
    const classes = [{ id: 'com.a.Order', name: 'Order' }, { id: 'com.a.OrderLine', name: 'OrderLine' }, { id: 'com.b.Cart', name: 'Cart' }];
    expect(matchClasses(classes, '  ')).toBeNull();
    expect([...(matchClasses(classes, 'order') ?? [])]).toEqual(['com.a.Order', 'com.a.OrderLine']);
    expect([...(matchClasses(classes, 'com.b') ?? [])]).toEqual(['com.b.Cart']);
    expect([...neighborsOf([{ from: 'A', to: 'B' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }], 'A')].sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('umlFlow — ноды/рёбра React Flow', () => {
  const diagram: Schemas['UmlDiagram'] = {
    version: 1,
    classes: [cls({ id: 'A' }), cls({ id: 'B' }), cls({ id: 'C' })],
    relations: [
      { from: 'B', to: 'A', kind: 'extends', heuristic: false },
      { from: 'A', to: 'C', kind: 'aggregation', heuristic: true, multiplicity: '*', via: 'items' },
      { from: 'B', to: 'C', kind: 'dependency', heuristic: false, via: 'run' },
    ],
  };
  const model = umlToGraph(diagram);
  const layout = {
    positions: new Map([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 0, y: 200 }],
      ['C', { x: 300, y: 0 }],
    ]),
    routes: new Map([['B->A:extends', [{ x: 10, y: 200 }, { x: 10, y: 60 }]]]),
  };
  const ui = { hovered: null, matches: null, selectedId: null, flyingId: null, onClassClick: () => undefined, onMemberClick: () => undefined };

  it('UML-нотация по kind: треугольник, ромб у целого, пунктир, кратность и «эвристика»', () => {
    const { nodes, edges } = umlFlow(model, layout, ui);
    expect(nodes.map((n) => [n.id, n.position])).toEqual([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 0, y: 200 }],
      ['C', { x: 300, y: 0 }],
    ]);
    const byId = new Map(edges.map((e) => [e.id, e.data]));
    expect(byId.get('B->A:extends')).toMatchObject({ end: 'triangle', start: null, dashed: false, tone: 'base' });
    expect(byId.get('B->A:extends')?.points).toEqual([{ x: 10, y: 200 }, { x: 10, y: 60 }]);
    expect(byId.get('A->C:aggregation')).toMatchObject({ start: 'diamond', end: null, multiplicity: '*', badge: 'эвристика' });
    expect(byId.get('B->C:dependency')).toMatchObject({ end: 'arrow', dashed: true, points: null });
    expect(byId.get('B->C:dependency')?.badge).toBeUndefined();
  });

  it('наведение: связи класса подсвечены, остальное приглушено; поиск приглушает несовпавшие', () => {
    const hovered = umlFlow(model, layout, { ...ui, hovered: 'A' });
    expect(Object.fromEntries(hovered.nodes.map((n) => [n.id, n.data.state]))).toEqual({ A: 'active', B: 'normal', C: 'normal' });
    expect(Object.fromEntries(hovered.edges.map((e) => [e.id, e.data?.tone]))).toEqual({
      'B->A:extends': 'active',
      'A->C:aggregation': 'active',
      'B->C:dependency': 'dim',
    });
    const searched = umlFlow(model, layout, { ...ui, matches: new Set(['C']) });
    expect(Object.fromEntries(searched.nodes.map((n) => [n.id, n.data.state]))).toEqual({ A: 'dim', B: 'dim', C: 'match' });
    const selected = umlFlow(model, layout, { ...ui, selectedId: 'B', flyingId: 'B' });
    expect(selected.nodes.find((n) => n.id === 'B')?.data).toMatchObject({ selected: true, flying: true });
  });
});

describe('раскладка и геометрия рёбер', () => {
  it('toElk / fromElk: позиции нод, ломаные; обратное ребро разворачивается', () => {
    const edges = [
      { id: 'up', source: 'A', target: 'B', reversed: true },
      { id: 'down', source: 'A', target: 'C' },
    ];
    const elk = toElk([{ id: 'A', width: 10, height: 10 }], edges);
    expect(elk.children).toEqual([{ id: 'A', width: 10, height: 10 }]);
    expect(elk.edges?.map((e) => [e.sources, e.targets])).toEqual([[['A'], ['B']], [['A'], ['C']]]);
    const sec = (id: string) => ({
      id,
      sources: ['A'],
      targets: ['B'],
      sections: [{ id: `${id}-s`, startPoint: { x: 0, y: 0 }, bendPoints: [{ x: 0, y: 5 }], endPoint: { x: 5, y: 5 } }],
    });
    const out = fromElk({ id: 'r', children: [{ id: 'A', x: 3, y: 4 }], edges: [sec('up'), sec('down')] }, edges);
    expect(out.positions.get('A')).toEqual({ x: 3, y: 4 });
    expect(out.routes.get('down')).toEqual([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }]);
    expect(out.routes.get('up')).toEqual([{ x: 5, y: 5 }, { x: 0, y: 5 }, { x: 0, y: 0 }]);
  });

  it('путь, середина и точка у конца ломаной', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    expect(polylinePath(pts)).toBe('M 0 0 L 0 10 L 10 10');
    expect(polylineMid(pts)).toEqual({ x: 0, y: 10 });
    expect(nearEnd([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20, 10)).toEqual({ x: 80, y: 10 });
  });
});
