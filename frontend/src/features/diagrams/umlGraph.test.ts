import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import cycleJson from '@contract/fixtures/dependencies.cycle.json';
import { cycleUml } from '../../mocks/handlers';
import type { Schemas } from '../api';
import { cycleInfo, cycleLabel } from './cycles';
import { fromElk, layoutDiagram, toElk } from './diagramLayout';
import { markerId, multiplicitySpot, nearEnd, polylinePath, selfLoopPoints, straightRoute } from './edgeGeometry';
import { flyTarget } from './navigation';
import { anchorOnTop } from './startView';
import { umlFlow } from './umlFlow';
import {
  cardMembers,
  cardSize,
  CARD,
  EXPANDED_SCALE_ZOOM,
  FAR_NAME_SCALE,
  hubSources,
  layoutModel,
  matchClasses,
  nameFit,
  nameScale,
  nameSegments,
  neighborsOf,
  READABLE_NAME_PX,
  SCALED_TEXT_CHROME,
  titleWidth,
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

  it('свёрнутые карточки одной высоты, ширина — от длины имени (пакет её не задаёт)', () => {
    const g = umlToGraph(uml);
    expect(new Set(g.nodes.map((n) => n.height))).toEqual(new Set([CARD.header]));
    expect(g.nodes.every((n) => n.level === 'compact')).toBe(true);
    const short = cardSize(cls({ id: 'A', package: 'com.example.very.long.package.name' }));
    expect(short.width).toBe(CARD.minWidth);
    const long = cardSize(cls({ id: 'InventoryService' }));
    expect(long.width).toBeGreaterThanOrEqual(Math.round(titleWidth('InventoryService') + CARD.headerChrome));
    expect(cardSize(cls({ id: 'X'.repeat(80) })).width).toBe(CARD.maxWidth);
  });

  it('размеры CARD совпадают с CSS (border-box): заголовок + рамки карточки = CARD.header, max-height списка = CARD.maxBody', () => {
    // Исходник CSS (не модуль: vitest отдаёт вместо него прокси классов).
    const diagramsCss = readFileSync(`${__dirname}/Diagrams.module.css`, 'utf8');
    const rule = (sel: string) => new RegExp(`\\n\\${sel} \\{([^}]*)\\}`).exec(diagramsCss)?.[1] ?? '';
    const px = (block: string, prop: string) => Number(new RegExp(`(?:^|\\s)${prop}:\\s*(?:0 0 )?([\\d.]+)px`).exec(block)?.[1]);
    const card = rule('.card');
    const header = px(rule('.cardHeader'), 'flex');
    expect(px(card, 'border-top') + header + px(card, 'border')).toBe(CARD.header);
    expect(px(rule('.cardBody'), 'max-height')).toBe(CARD.maxBody);
    expect(px(rule('.row'), 'height')).toBe(CARD.row);
    expect(px(rule('.separator'), 'flex')).toBe(CARD.separator);
  });

  it('оценка ширины имени не меньше замера Inter 700 16 px в Chromium (имя не обрезается)', () => {
    // Замер canvas.measureText в Chromium: «Command» 81 px, «Validator.» 74 px, «Summary» 76 px, «WWW» 51 px.
    expect(titleWidth('Command')).toBeGreaterThanOrEqual(81);
    expect(titleWidth('Validator.')).toBeGreaterThanOrEqual(74);
    expect(titleWidth('Summary')).toBeGreaterThanOrEqual(76);
    expect(titleWidth('WWW')).toBeGreaterThanOrEqual(51);
  });

  it('ширина свёрнутой карточки — с запасом под крупное имя при отдалении: короткие имена не упираются в ширину', () => {
    for (const name of ['Order', 'Main', 'Texts', 'Validator', 'CommandLine']) {
      const { width } = cardSize(cls({ id: name }));
      const longest = Math.max(...nameSegments(name).map(titleWidth));
      expect(width - SCALED_TEXT_CHROME).toBeGreaterThanOrEqual(longest * FAR_NAME_SCALE - 1);
    }
  });

  it('развёрнутая карточка: поля `name`, методы `name()`, без конструкторов; private — по уровню all', () => {
    const c = cls({
      id: 'F',
      fields: [
        { name: 'x', type: 'int', modifiers: ['private'] },
        { name: 'LIMIT', type: 'int', modifiers: ['public', 'static', 'final'] },
      ],
      constructors: [{ id: 'F.<init>~0', name: 'F', signature: 'public F(int x)', modifiers: ['public'] }],
      methods: [
        { id: 'F.run~0', name: 'run', signature: 'public void run(List<String> args)', modifiers: ['public'] },
        { id: 'F.help~0', name: 'help', signature: 'private int help()', modifiers: ['private'] },
      ],
    });
    const open = cardMembers(c, 'expanded');
    expect(open.fields.map((r) => r.label)).toEqual(['LIMIT']);
    expect(open.methods.map((r) => [r.label, r.method?.id])).toEqual([['run()', 'F.run~0']]);
    expect(open.methods[0]?.title).toContain('public void run(List<String> args)');
    expect(open.privateCount).toBe(2);
    const all = cardMembers(c, 'all');
    expect(all.fields.map((r) => r.label)).toEqual(['x', 'LIMIT']);
    expect(all.methods.map((r) => r.label)).toEqual(['run()', 'help()']);
    // Размер = заголовок + отступы + строки (поля, разделитель, методы, строка «ещё N private»).
    expect(cardSize(c, 'expanded').height).toBe(CARD.header + 2 * CARD.bodyPad + 3 * CARD.row + CARD.separator);
    expect(cardSize(c, 'all').height).toBe(CARD.header + 2 * CARD.bodyPad + 5 * CARD.row + CARD.separator);
    expect(cardSize(c, 'compact').height).toBe(CARD.header);
    // Длинный список: высота не больше CARD.maxBody (внутри — прокрутка), раскладка получает ту же высоту.
    const big = cls({
      id: 'Big',
      methods: Array.from({ length: 30 }, (_, i) => ({ id: `Big.m${i}~0`, name: `m${i}`, signature: `public void m${i}()`, modifiers: ['public'] })),
    });
    expect(cardSize(big, 'expanded').height).toBe(CARD.header + CARD.maxBody);
    // Только конструкторы — разворачивать нечего, карточка остаётся свёрнутой.
    const ctorOnly = cls({ id: 'K', constructors: c.constructors });
    expect(cardSize(ctorOnly, 'expanded')).toEqual(cardSize(ctorOnly));
    // Компоненты record (private final) видны и без уровня all.
    const rec = cls({ id: 'R', kind: 'record', fields: [{ name: 'id', type: 'int', modifiers: ['private', 'final'] }] });
    expect(cardMembers(rec, 'expanded')).toMatchObject({ fields: [{ label: 'id' }], privateCount: 0 });
  });

  it('umlToGraph: уровень карточки из levels меняет её размер', () => {
    const main = uml.classes.find((c) => c.id === 'com.demo.Main');
    if (!main) throw new Error('нет Main');
    const g = umlToGraph(uml, new Map([['com.demo.Main', 'expanded']]));
    const node = g.nodes.find((n) => n.id === main.id);
    expect(node?.level).toBe('expanded');
    expect(node?.height).toBeGreaterThan(CARD.header);
    expect(g.nodes.filter((n) => n.height === CARD.header)).toHaveLength(uml.classes.length - 1);
  });

  it('видимость значком', () => {
    expect(visibilityOf(['public', 'static'])).toBe('public');
    expect(visibilityOf(['private', 'final'])).toBe('private');
    expect(visibilityOf(['protected'])).toBe('protected');
    expect(visibilityOf([])).toBe('package');
    expect(visibilityOf([], 'interface')).toBe('public');
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
  const ui: Parameters<typeof umlFlow>[2] = {
    hovered: null,
    matches: null,
    selectedId: null,
    flyingId: null,
    showDependencies: false,
    onClassClick: () => undefined,
    onMemberClick: () => undefined,
    onLevel: () => undefined,
  };

  it('UML-нотация по kind: треугольник, ромб у целого, пунктир; эвристика — стилем, без подписи на ребре', () => {
    const { nodes, edges } = umlFlow(model, layout, { ...ui, showDependencies: true });
    expect(nodes.map((n) => [n.id, n.position])).toEqual([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 0, y: 200 }],
      ['C', { x: 300, y: 0 }],
    ]);
    const byId = new Map(edges.map((e) => [e.id, e.data]));
    expect(byId.get('B->A:extends')).toMatchObject({ end: 'triangle', start: null, dashed: false, tone: 'base' });
    expect(byId.get('B->A:extends')?.points).toEqual([{ x: 10, y: 200 }, { x: 10, y: 60 }]);
    expect(byId.get('A->C:aggregation')).toMatchObject({ start: 'diamond', end: null, heuristic: true });
    expect(byId.get('A->C:aggregation')).not.toHaveProperty('badge');
    expect(edges.find((e) => e.id === 'A->C:aggregation')?.data?.title).toContain('эвристика');
    // Ребра нет в раскладке — прямая между карточками, от границы до границы.
    expect(byId.get('B->C:dependency')).toMatchObject({ end: 'arrow', dashed: true });
    expect(byId.get('B->C:dependency')?.points).toHaveLength(2);
    expect(byId.get('B->C:dependency')?.heuristic).toBeUndefined();
  });

  it('зависимости по умолчанию скрыты; видны у наведённой карточки и по переключателю', () => {
    const ids = (u: typeof ui) => umlFlow(model, layout, u).edges.map((e) => e.id);
    expect(ids(ui)).toEqual(['B->A:extends', 'A->C:aggregation']);
    expect(ids({ ...ui, hovered: 'B' })).toContain('B->C:dependency');
    expect(ids({ ...ui, hovered: 'A' })).not.toContain('B->C:dependency');
    expect(ids({ ...ui, showDependencies: true })).toContain('B->C:dependency');
    // Прямая зависимость наведённой карточки — под карточками.
    expect(umlFlow(model, layout, { ...ui, hovered: 'B' }).edges.find((e) => e.id === 'B->C:dependency')?.zIndex).toBe(0);
  });

  it('кратность — только у связей наведённой или выбранной карточки', () => {
    const mult = (u: typeof ui) => umlFlow(model, layout, u).edges.find((e) => e.id === 'A->C:aggregation')?.data?.multiplicity;
    expect(mult(ui)).toBeUndefined();
    expect(mult({ ...ui, hovered: 'B' })).toBeUndefined();
    expect(mult({ ...ui, hovered: 'C' })).toBe('*');
    expect(mult({ ...ui, selectedId: 'A' })).toBe('*');
  });

  it('раскладка без скрытых зависимостей: ELK получает только структурные связи', () => {
    expect(layoutModel(model, false).edges.map((e) => e.id)).toEqual(['B->A:extends', 'A->C:aggregation']);
    expect(layoutModel(model, true).edges).toHaveLength(3);
    expect(layoutModel(model, false).full).toBe(model);
  });

  it('наведение: связи класса подсвечены, остальное приглушено; поиск приглушает несовпавшие', () => {
    const hovered = umlFlow(model, layout, { ...ui, showDependencies: true, hovered: 'A' });
    expect(Object.fromEntries(hovered.nodes.map((n) => [n.id, n.data.state]))).toEqual({ A: 'active', B: 'normal', C: 'normal' });
    expect(Object.fromEntries(hovered.edges.map((e) => [e.id, e.data?.tone]))).toEqual({
      'B->A:extends': 'active',
      'A->C:aggregation': 'active',
      'B->C:dependency': 'dim',
    });
    const searched = umlFlow(model, layout, { ...ui, matches: new Set(['C']) });
    expect(Object.fromEntries(searched.nodes.map((n) => [n.id, n.data.state]))).toEqual({ A: 'dim', B: 'dim', C: 'match' });
    const selected = umlFlow(model, layout, { ...ui, selectedId: 'B', flyingId: 'B' });
    expect(selected.nodes.find((n) => n.id === 'B')?.data).toMatchObject({ selected: true, flying: true, level: 'compact' });
  });
});

describe('umlFlow — петли, хабы, подписи', () => {
  const ui: Parameters<typeof umlFlow>[2] = {
    hovered: null,
    matches: null,
    selectedId: null,
    flyingId: null,
    showDependencies: false,
    onClassClick: () => undefined,
    onMemberClick: () => undefined,
    onLevel: () => undefined,
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

  it('слабые связи хаба (при показанных зависимостях) бледные, пока нет наведения/поиска; наведение их возвращает', () => {
    const tones = (ui2: typeof ui) => umlFlow(model, layout, ui2).edges.filter((e) => e.target !== 'M').map((e) => e.data?.tone);
    const deps = { ...ui, showDependencies: true };
    expect(tones(deps)).toEqual(Array(7).fill('faint'));
    expect(tones({ ...deps, hovered: 'a' })).toEqual(['active', ...Array(6).fill('dim')]);
    expect(tones({ ...deps, matches: new Set(['M']) })).toEqual(Array(7).fill('base'));
    // Зависимости скрыты: у наведённого хаба видны все его зависимости.
    expect(tones({ ...ui, hovered: 'M' })).toEqual(Array(7).fill('active'));
    // Ассоциация и композиция хаба остаются обычными.
    const base = umlFlow(model, layout, ui).edges.filter((e) => e.source === 'M' && e.target === 'M').map((e) => e.data?.tone);
    expect(base).toEqual(['base', 'base']);
  });

  it('кратность получает место вне карточек', () => {
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
    const data = umlFlow(m, lay, { ...ui, hovered: 'A' }).edges[0]?.data;
    expect(data?.multiplicityAt).not.toBeNull();
    const boxes = m.nodes.map((n) => ({ ...(lay.positions.get(n.id) ?? { x: 0, y: 0 }), width: n.width, height: n.height }));
    const p = data?.multiplicityAt;
    expect(boxes.some((b) => (p?.y ?? 0) > b.y && (p?.y ?? 0) < b.y + b.height)).toBe(false);
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

  it('путь и точка у конца ломаной', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    expect(polylinePath(pts)).toBe('M 0 0 L 0 10 L 10 10');
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

  it('прямая между карточками — от границы до границы; перекрытые карточки — null', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    expect(straightRoute(a, { x: 0, y: 200, width: 100, height: 50 })).toEqual([{ x: 50, y: 50 }, { x: 50, y: 200 }]);
    expect(straightRoute(a, { x: 300, y: 0, width: 100, height: 50 })).toEqual([{ x: 100, y: 25 }, { x: 300, y: 25 }]);
    expect(straightRoute(a, { x: 10, y: 10, width: 100, height: 50 })).toBeNull();
  });

  it('кратность не ложится на карточки', () => {
    const line = [{ x: 0, y: 0 }, { x: 0, y: 200 }];
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

  it('имя при отдалении: переносы по camelCase и точке, один размер на экране у всех карточек', () => {
    expect(nameSegments('InventoryService')).toEqual(['Inventory', 'Service']);
    expect(nameSegments('PricingService.Rule')).toEqual(['Pricing', 'Service.', 'Rule']);
    expect(nameSegments('Main')).toEqual(['Main']);
    const g = umlToGraph(uml);
    const fit = nameFit(g.nodes);
    // Самая длинная часть имени каждой карточки при общем увеличении помещается в её ширину.
    expect(fit).toBeGreaterThanOrEqual(FAR_NAME_SCALE - 0.05);
    for (const n of g.nodes) {
      const longest = Math.max(...nameSegments(n.cls.name).map(titleWidth));
      expect(longest * fit).toBeLessThanOrEqual(n.width - SCALED_TEXT_CHROME + 0.01);
    }
    expect(nameScale(1, fit)).toBe(1);
    expect(nameScale(READABLE_NAME_PX / 16, fit)).toBe(1);
    // Масштаб «Fit View» ~0,33: имя на экране не меньше 11 px (READABLE_NAME_PX с шагом 0,05).
    for (const zoom of [0.6, 0.45, 0.33]) expect(16 * nameScale(zoom, fit) * zoom).toBeGreaterThanOrEqual(11);
    // Сильнее отдалено — рост упирается в общий предел, а не в ширину отдельной карточки.
    expect(nameScale(0.1, fit)).toBeLessThanOrEqual(fit);
    expect(nameScale(0.1, 0.5)).toBe(1);
    // Развёрнутая карточка увеличивает имя только ниже EXPANDED_SCALE_ZOOM (иначе видны члены).
    expect(nameScale(EXPANDED_SCALE_ZOOM + 0.05, fit, true)).toBe(1);
    expect(nameScale(EXPANDED_SCALE_ZOOM - 0.05, fit, true)).toBeGreaterThan(1);
  });

  it('несколько развёрнутых соседних карточек не перекрываются (раскладка по фактическому размеру)', async () => {
    const levels = new Map<string, 'expanded' | 'all'>([
      ['com.demo.service.OrderService', 'all'],
      ['com.demo.service.InventoryService', 'expanded'],
      ['com.demo.service.Catalog', 'expanded'],
    ]);
    const g = layoutModel(umlToGraph(uml, levels), false);
    const layout = await layoutDiagram(g.nodes, g.edges);
    const boxes = g.nodes.map((n) => ({ ...n, ...(layout.positions.get(n.id) ?? { x: NaN, y: NaN }) }));
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
    }
  }, 15_000);

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

describe('циклы зависимостей в UML (GET dependencies, FE-48)', () => {
  const graph = cycleJson as unknown as Schemas['DependencyGraph'];
  const CART = 'com.shop.Cart';
  const PRICING = 'com.shop.Pricing';
  const ITEM = 'com.shop.Item';
  const diagram = cycleUml();
  const cycles = cycleInfo(graph);
  const model = umlToGraph(diagram, new Map(), cycles);
  const ui: Parameters<typeof umlFlow>[2] = {
    hovered: null,
    matches: null,
    selectedId: null,
    flyingId: null,
    showDependencies: false,
    onClassClick: () => undefined,
    onMemberClick: () => undefined,
    onLevel: () => undefined,
  };
  const layout = {
    positions: new Map([
      [CART, { x: 0, y: 0 }],
      [PRICING, { x: 0, y: 200 }],
      [ITEM, { x: 300, y: 0 }],
    ]),
    routes: new Map<string, { x: number; y: number }[]>(),
  };

  it('cycleInfo: классы и рёбра циклов; нет графа или циклов — пусто; подпись цикла', () => {
    expect([...cycles.classes]).toEqual([CART, PRICING]);
    expect([...cycles.edges]).toEqual([`${CART}->${PRICING}`, `${PRICING}->${CART}`]);
    expect(cycleInfo(null).classes.size).toBe(0);
    expect(cycleInfo({ ...graph, cycles: [] }).edges.size).toBe(0);
    const c = graph.cycles[0];
    if (!c) throw new Error('нет цикла');
    expect(cycleLabel(c, diagram.classes)).toBe('Cart → Pricing → Cart');
    expect(cycleLabel(c, [])).toBe('Cart → Pricing → Cart');
  });

  it('классы и связи цикла помечены; без циклов — ничего не помечено', () => {
    expect(model.nodes.map((n) => [n.id, n.inCycle])).toEqual([
      [CART, true],
      [PRICING, true],
      [ITEM, false],
    ]);
    expect(Object.fromEntries(model.edges.map((e) => [e.id, e.inCycle]))).toEqual({
      [`${CART}->${PRICING}:association`]: true,
      [`${PRICING}->${CART}:dependency`]: true,
      [`${CART}->${ITEM}:aggregation`]: false,
    });
    const plain = umlToGraph(diagram);
    expect(plain.nodes.some((n) => n.inCycle) || plain.edges.some((e) => e.inCycle)).toBe(false);
  });

  it('ребро-зависимость цикла видно и идёт в раскладку ELK при выключенных «Все связи»', () => {
    const ids = layoutModel(model, false).edges.map((e) => e.id);
    expect(ids).toContain(`${PRICING}->${CART}:dependency`);
    expect(ids).toHaveLength(3);
    // Без цикла та же зависимость скрыта и в раскладку не входит.
    expect(layoutModel(umlToGraph(diagram), false).edges.map((e) => e.id)).not.toContain(`${PRICING}->${CART}:dependency`);
    expect(umlFlow(model, layout, ui).edges.map((e) => e.id)).toContain(`${PRICING}->${CART}:dependency`);
  });

  it('рёбра цикла красные (cycle) при любом тоне, маркер цикла; карточки цикла — inCycle', () => {
    const flow = umlFlow(model, layout, ui);
    const byId = new Map(flow.edges.map((e) => [e.id, e]));
    const assoc = byId.get(`${CART}->${PRICING}:association`);
    expect(assoc?.data).toMatchObject({ cycle: true, tone: 'base', end: 'arrow', dashed: false });
    expect(assoc?.data?.title).toContain('цикла зависимостей');
    expect(byId.get(`${PRICING}->${CART}:dependency`)?.data).toMatchObject({ cycle: true, dashed: true });
    expect(byId.get(`${CART}->${ITEM}:aggregation`)?.data?.cycle).toBeUndefined();
    expect(flow.nodes.map((n) => n.data.inCycle)).toEqual([true, true, false]);
    expect(markerId('arrow', 'dim', true)).toBe('jb-dg-arrow-cycle');
    expect(markerId('arrow', 'dim')).toBe('jb-dg-arrow-base');
    // Наведение на Item: рёбра цикла приглушены, но остаются красными.
    const hovered = umlFlow(model, layout, { ...ui, hovered: ITEM });
    expect(hovered.edges.find((e) => e.id === `${PRICING}->${CART}:dependency`)?.data).toMatchObject({ cycle: true, tone: 'dim' });
  });

  it('ребро цикла без UML-связи → добавленная зависимость; к классу вне UML — нет', () => {
    const noDep = { ...diagram, relations: diagram.relations.filter((r) => r.kind !== 'dependency') };
    const g = umlToGraph(noDep, new Map(), cycles);
    const added = g.edges.find((e) => e.id === `${PRICING}->${CART}:dependency`);
    expect(added).toMatchObject({ from: PRICING, to: CART, inCycle: true, relation: { kind: 'dependency', heuristic: false } });
    expect(g.edges).toHaveLength(3);
    const foreign = umlToGraph(diagram, new Map(), { classes: new Set(), edges: new Set([`${CART}->com.x.Nope`]) });
    expect(foreign.edges).toHaveLength(3);
  });
});
