import { describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import type { Schemas } from '../api';
import { fromElk, toElk } from './diagramLayout';
import { badgeSpot, multiplicitySpot, nearEnd, polylineAt, polylineMid, polylinePath, selfLoopPoints } from './edgeGeometry';
import { flyTarget } from './navigation';
import { anchorOnTop } from './startView';
import { umlFlow } from './umlFlow';
import {
  cardSections,
  cardSize,
  CARD,
  hubSources,
  matchClasses,
  memberText,
  neighborsOf,
  semanticScale,
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
      ['A', 'A', 'A', 'A', false],
    ]);
  });

  it('связи одного вида между теми же классами — одно ребро, via объединяются; разные виды остаются', () => {
    const g = umlToGraph({
      version: 1,
      classes: [cls({ id: 'A' }), cls({ id: 'B' })],
      relations: [
        { from: 'A', to: 'B', kind: 'aggregation', heuristic: true, multiplicity: '*', via: 'items' },
        { from: 'A', to: 'B', kind: 'aggregation', heuristic: true, multiplicity: '*', via: 'extras' },
        { from: 'A', to: 'B', kind: 'aggregation', heuristic: true, multiplicity: '*', via: 'items' },
        { from: 'A', to: 'B', kind: 'dependency', heuristic: false },
        { from: 'A', to: 'B', kind: 'dependency', heuristic: false, via: 'run' },
      ],
    });
    expect(g.edges.map((e) => [e.id, e.relation.via])).toEqual([
      ['A->B:aggregation', 'items, extras'],
      ['A->B:dependency', 'run'],
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

describe('umlFlow — петли, хабы, подписи', () => {
  const ui: Parameters<typeof umlFlow>[2] = {
    hovered: null,
    matches: null,
    selectedId: null,
    flyingId: null,
    onClassClick: () => undefined,
    onMemberClick: () => undefined,
  };
  const targets = [...'abcdefg'];
  const diagram: Schemas['UmlDiagram'] = {
    version: 1,
    classes: [cls({ id: 'M' }), ...targets.map((id) => cls({ id }))],
    relations: [
      { from: 'M', to: 'M', kind: 'association', heuristic: false, via: 'next' },
      { from: 'M', to: 'M', kind: 'composition', heuristic: true, multiplicity: '*' },
      ...targets.map((to) => ({ from: 'M', to, kind: 'dependency' as const, heuristic: false })),
    ],
  };
  const model = umlToGraph(diagram);
  const layout = { positions: new Map([['M', { x: 0, y: 0 }]]), routes: new Map() };

  it('самосвязь — петля у карточки; несколько петель одного класса идут одна под другой', () => {
    const { edges } = umlFlow(model, layout, ui);
    const association = edges.find((e) => e.id === 'M->M:association')?.data?.points ?? [];
    const composition = edges.find((e) => e.id === 'M->M:composition')?.data?.points ?? [];
    const card = model.nodes.find((n) => n.id === 'M');
    expect(association).toHaveLength(4);
    expect(association[0]?.x).toBe(card?.width);
    expect(composition[0]?.y).toBeGreaterThan(association[association.length - 1]?.y ?? 0);
  });

  it('слабые связи хаба бледные, пока нет наведения/поиска; наведение их возвращает', () => {
    const tones = (ui2: typeof ui) => umlFlow(model, layout, ui2).edges.filter((e) => e.target !== 'M').map((e) => e.data?.tone);
    expect(tones(ui)).toEqual(Array(7).fill('faint'));
    expect(tones({ ...ui, hovered: 'a' })).toEqual(['active', ...Array(6).fill('dim')]);
    expect(tones({ ...ui, matches: new Set(['M']) })).toEqual(Array(7).fill('base'));
    // Ассоциация и композиция хаба остаются обычными.
    const base = umlFlow(model, layout, ui).edges.filter((e) => e.source === 'M' && e.target === 'M').map((e) => e.data?.tone);
    expect(base).toEqual(['base', 'base']);
  });

  it('подписи рёбер получают место вне карточек', () => {
    const d: Schemas['UmlDiagram'] = {
      version: 1,
      classes: [cls({ id: 'A' }), cls({ id: 'B' })],
      relations: [{ from: 'A', to: 'B', kind: 'aggregation', heuristic: true, multiplicity: '*' }],
    };
    const m = umlToGraph(d);
    const lay = {
      positions: new Map([['A', { x: 0, y: 0 }], ['B', { x: 0, y: 400 }]]),
      routes: new Map([['A->B:aggregation', [{ x: 50, y: 60 }, { x: 50, y: 400 }]]]),
    };
    const data = umlFlow(m, lay, ui).edges[0]?.data;
    expect(data?.badgeAt).not.toBeNull();
    expect(data?.multiplicityAt).not.toBeNull();
    const boxes = m.nodes.map((n) => ({ ...(lay.positions.get(n.id) ?? { x: 0, y: 0 }), width: n.width, height: n.height }));
    for (const p of [data?.badgeAt, data?.multiplicityAt]) {
      expect(boxes.some((b) => (p?.y ?? 0) > b.y && (p?.y ?? 0) < b.y + b.height)).toBe(false);
    }
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
  it('toElk не отдаёт ELK самосвязи (петлю строит umlFlow)', () => {
    const elk = toElk(
      [{ id: 'A', width: 10, height: 10 }],
      [
        { id: 'loop', source: 'A', target: 'A' },
        { id: 'down', source: 'A', target: 'B' },
      ],
    );
    expect(elk.edges?.map((e) => e.id)).toEqual(['down']);
  });

  it('polylineAt: доля длины ломаной', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    expect(polylineAt(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(polylineAt(pts, 0.25)).toEqual({ x: 0, y: 5 });
    expect(polylineAt(pts, 1)).toEqual({ x: 10, y: 10 });
  });

  it('подписи не ложатся на карточки: «эвристика» сдвигается по ребру, нет места — null', () => {
    const line = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
    // Середина (0, 100) под карточкой — берётся другая доля длины.
    const spot = badgeSpot(line, [{ x: -50, y: 80, width: 100, height: 40 }]);
    expect(spot).not.toBeNull();
    expect(Math.abs((spot?.y ?? 100) - 100)).toBeGreaterThan(10);
    expect(badgeSpot(line, [{ x: -50, y: -10, width: 100, height: 220 }])).toBeNull();
    // Кратность: вплотную к концу занято — отходит назад по ребру.
    const near = multiplicitySpot(line, [{ x: -30, y: 170, width: 100, height: 40 }]);
    expect(near).not.toBeNull();
    expect(near?.y).toBeLessThan(160);
  });

  it('петля самосвязи: у правой стороны карточки, разные slot — одна под другой', () => {
    const box = { x: 10, y: 20, width: 100, height: 200 };
    const loop = selfLoopPoints(box);
    expect(loop[0]).toEqual({ x: 110, y: 30 });
    expect(loop[loop.length - 1]?.x).toBe(110);
    expect(Math.max(...loop.map((p) => p.x))).toBeGreaterThan(110);
    expect(selfLoopPoints(box, 1)[0]?.y).toBeGreaterThan(loop[loop.length - 1]?.y ?? 0);
  });

  it('полёт к карточке: невысокая — по центру свободной полосы, высокая — верх под панелью поиска', () => {
    const view = { width: 900, height: 556 };
    const low = flyTarget({ x: 100, y: 200, width: 200, height: 100 }, 1.15, view);
    expect(low.x).toBe(200);
    // Центр карточки на экране: выше центра окна на (BOTTOM − TOP) / 2 — внутри полосы между панелями.
    expect(low.y).toBeCloseTo(250 + (24 - 64) / 2 / 1.15);
    const tall = flyTarget({ x: 0, y: 0, width: 200, height: 900 }, 1.15, view);
    expect(tall.y).toBeCloseTo((278 - 64) / 1.15);
  });

  it('семантический зум: обычная карточка от 0,45, ниже — крупный заголовок', () => {
    expect(semanticScale(1)).toBe(0);
    expect(semanticScale(0.45)).toBe(0);
    expect(semanticScale(0.44)).toBe(2);
    expect(semanticScale(0.25)).toBe(3);
    expect(semanticScale(0.08)).toBe(4);
  });

  it('начальный вид: центр на самом верхнем (при равенстве — левом) узле, под панелью поиска', () => {
    const nodes = [
      { position: { x: 1900, y: 12 }, width: 360 },
      { position: { x: 100, y: 12 }, width: 200 },
      { position: { x: 0, y: 500 }, width: 300 },
    ];
    const v = anchorOnTop({ x: 0, y: 30, zoom: 0.6 }, nodes, 900);
    expect(v.zoom).toBe(0.6);
    expect(v.x).toBeCloseTo(450 - 200 * 0.6);
    expect(v.y).toBeGreaterThan(30);
    expect(anchorOnTop({ x: 7, y: 30, zoom: 0.6 }, nodes, 0).x).toBe(7);
  });

  it('хабы: класс с ≥ 6 исходящими связями; самосвязи не считаются', () => {
    const edges = [...'abcdef'].map((to) => ({ from: 'Main', to }));
    expect(hubSources(edges)).toEqual(new Set(['Main']));
    expect(hubSources([...edges.slice(0, 5), { from: 'Main', to: 'Main' }])).toEqual(new Set());
  });
});
