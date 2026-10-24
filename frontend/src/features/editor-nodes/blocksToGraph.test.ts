import { describe, expect, it } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { blockText } from './blockText';
import { blocksToGraph, HEAD_SUFFIX, SLOT_SUFFIX, type Graph } from './blocksToGraph';
import { ALL_KINDS, type Block } from './kinds';
import { allKindsMethod, b } from './testTree';

function collect(block: Block, out: Block[] = []): Block[] {
  out.push(block);
  for (const items of Object.values(block.slots ?? {})) for (const c of items) collect(c, out);
  return out;
}

const node = (g: Graph, id: string) => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`нет ноды ${id}`);
  return n;
};
const edgesFrom = (g: Graph, id: string) => g.edges.filter((e) => e.source === id);

describe('blocksToGraph', () => {
  const root = allKindsMethod();
  const g = blocksToGraph(root, { methodBadge: 'O(n)' });
  const body = root.slots.body ?? [];
  const at = (i: number): Block => {
    const blk = body[i];
    if (!blk) throw new Error(`нет блока ${i}`);
    return blk;
  };

  it('тестовое дерево покрывает все kind контракта', () => {
    const kinds = new Set(collect(root).map((x) => x.kind));
    expect([...kinds].sort()).toEqual([...ALL_KINDS].sort());
  });

  it('каждый блок дерева есть на схеме, код не теряется', () => {
    for (const blk of collect(root)) {
      const n = node(g, blk.id);
      expect(n.data.kind).toBe(blk.kind);
      const shown = n.type === 'container' ? node(g, `${blk.id}${HEAD_SUFFIX}`).data.text : n.data.text;
      expect(shown).toBe(blockText(blk));
    }
  });

  it('тип ноды: raw, comment-стикер, контейнеры — group-ноды с заголовком', () => {
    const containers = ['if', 'while', 'dowhile', 'for', 'foreach', 'switch', 'case', 'try', 'catch'];
    for (const blk of collect(root)) {
      const n = node(g, blk.id);
      if (blk.kind === 'raw') expect(n.type).toBe('raw');
      else if (blk.kind === 'comment') expect(n.type).toBe('comment');
      else if (containers.includes(blk.kind)) {
        expect(n.type).toBe('container');
        expect(node(g, `${blk.id}${HEAD_SUFFIX}`).parentId).toBe(blk.id);
      } else expect(n.type).toBe('block');
    }
  });

  it('метод — заголовок с бейджем сложности, тело — цепочка сверху вниз на верхнем уровне', () => {
    expect(node(g, root.id).data.badge).toBe('O(n)');
    const chain = [root, ...body].map((x) => x.id);
    for (let i = 0; i + 1 < chain.length; i++) {
      const e = g.edges.find((x) => x.source === chain[i] && x.target === chain[i + 1]);
      expect(e).toBeDefined();
      expect(e?.parentId).toBeUndefined();
    }
    for (const blk of body) expect(node(g, blk.id).parentId).toBeUndefined();
  });

  it('родитель всегда раньше детей, id уникальны, рёбра ссылаются на существующие ноды в общей группе', () => {
    const seen = new Set<string>();
    for (const n of g.nodes) {
      if (n.parentId) expect(seen.has(n.parentId)).toBe(true);
      expect(seen.has(n.id)).toBe(false);
      seen.add(n.id);
    }
    for (const e of g.edges) {
      expect(node(g, e.source).parentId).toBe(e.parentId);
      expect(node(g, e.target).parentId).toBe(e.parentId);
    }
  });

  it('у листовых нод есть размер, у групп — нет (его считает ELK)', () => {
    for (const n of g.nodes) {
      if (n.type === 'container' || n.type === 'slot') expect(n.width).toBeUndefined();
      else {
        expect(n.width).toBeGreaterThan(0);
        expect(n.height).toBeGreaterThan(0);
      }
    }
  });

  it('if с двумя ветками: рамки slot «да» / «нет», else if вложен в «нет»', () => {
    const iff = at(4);
    const head = `${iff.id}${HEAD_SUFFIX}`;
    expect(edgesFrom(g, head).map((e) => [e.target, e.label])).toEqual([
      [`${iff.id}${SLOT_SUFFIX}then`, 'да'],
      [`${iff.id}${SLOT_SUFFIX}else`, 'нет'],
    ]);
    const thenItem = iff.slots.then?.[0];
    const elseIf = iff.slots.else?.[0];
    expect(thenItem && node(g, thenItem.id).parentId).toBe(`${iff.id}${SLOT_SUFFIX}then`);
    expect(elseIf && node(g, elseIf.id).type).toBe('container');
    expect(elseIf && node(g, elseIf.id).parentId).toBe(`${iff.id}${SLOT_SUFFIX}else`);
  });

  it('if с пустым else: одна ветка прямо в контейнере, стрелка «да» от заголовка', () => {
    const elseIf = at(4).slots.else?.[0] as Block;
    const head = `${elseIf.id}${HEAD_SUFFIX}`;
    const brk = elseIf.slots.then?.[0] as Block;
    expect(edgesFrom(g, head)).toEqual([expect.objectContaining({ target: brk.id, label: 'да', parentId: elseIf.id })]);
    expect(g.nodes.some((n) => n.id === `${elseIf.id}${SLOT_SUFFIX}else`)).toBe(false);
  });

  it('цикл: тело — цепочка внутри контейнера, вложенный цикл — контейнер в контейнере', () => {
    const forB = at(7);
    const foreach = forB.slots.body?.[0] as Block;
    expect(node(g, foreach.id).parentId).toBe(forB.id);
    const inner = foreach.slots.body?.[0] as Block;
    expect(node(g, inner.id).parentId).toBe(foreach.id);
    expect(edgesFrom(g, `${foreach.id}${HEAD_SUFFIX}`).map((e) => e.target)).toEqual([inner.id]);
  });

  it('switch: case — параллельные ветки от заголовка, без цепочки между case', () => {
    const sw = at(8);
    const cases = (sw.slots.cases ?? []).map((c) => c.id);
    expect(edgesFrom(g, `${sw.id}${HEAD_SUFFIX}`).map((e) => e.target)).toEqual(cases);
    expect(g.edges.some((e) => e.source === cases[0] && e.target === cases[1])).toBe(false);
    expect(node(g, `${cases[1]}${HEAD_SUFFIX}`).data.text).toBe('default ->');
  });

  it('try: ветки try / catch / finally, catch внутри — параллельно, пустой catch — только заголовок', () => {
    const tr = at(9);
    const head = `${tr.id}${HEAD_SUFFIX}`;
    expect(node(g, head).data.text).toBe('try (var in = open())');
    expect(edgesFrom(g, head).map((e) => e.label)).toEqual(['try', 'catch', 'finally']);
    const catches = tr.slots.catches ?? [];
    for (const c of catches) expect(node(g, c.id).parentId).toBe(`${tr.id}${SLOT_SUFFIX}catches`);
    const emptyCatch = catches[1] as Block;
    expect(g.nodes.filter((n) => n.parentId === emptyCatch.id).map((n) => n.id)).toEqual([`${emptyCatch.id}${HEAD_SUFFIX}`]);
  });

  it('raw хранит исходный текст как есть (многострочный)', () => {
    const raw = collect(root).find((x) => x.kind === 'raw') as Block;
    const n = node(g, raw.id);
    expect(n.data.text).toBe('label: {\n  foo();\n}');
    expect(n.height).toBeGreaterThan(node(g, at(1).id).height ?? 0);
  });

  it('проблемы блока попадают в data.issues', () => {
    const withIssue = b('method', { signature: 'void m()' }, {
      body: [{ ...b('for', { init: '', cond: '', update: '' }, { body: [] }), issues: ['ISSUE-1'] }],
    });
    const gi = blocksToGraph(withIssue);
    const forId = withIssue.slots.body?.[0]?.id as string;
    expect(node(gi, forId).data.issues).toEqual(['ISSUE-1']);
  });

  it('блоки без id (новые) получают id по пути; дубликаты id не ломают схему', () => {
    const noIds: Block = {
      id: 'm',
      kind: 'method',
      fields: { signature: 'void m()' },
      slots: { body: [{ id: '', kind: 'expr', fields: { text: 'a()' }, slots: {} }, { id: 'dup', kind: 'expr', fields: { text: 'b()' }, slots: {} }, { id: 'dup', kind: 'expr', fields: { text: 'c()' }, slots: {} }] },
    };
    const gn = blocksToGraph(noIds);
    const ids = gn.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('root/body/0');
  });

  it('неизвестный kind не роняет схему: raw-нода с текстом из fields, вложенные блоки сохраняются', () => {
    const unknown = (kind: string, fields: Record<string, string>, slots: Record<string, Block[]> = {}): Block =>
      ({ id: `u/${kind}`, kind: kind as Block['kind'], fields, slots });
    const inner = b('expr', { text: 'inner()' });
    const m = b('method', { signature: 'void m()' }, {
      body: [
        unknown('yield', { text: 'yield 1' }),
        unknown('labeled', { name: 'outer' }),
        unknown('sync', { lock: 'this' }, { body: [inner] }),
      ],
    });
    const gu = blocksToGraph(m);
    const y = node(gu, 'u/yield');
    expect(y.type).toBe('raw');
    expect(y.data.text).toBe('yield 1');
    expect(y.data.title).toContain('yield');
    expect(node(gu, 'u/labeled').data.text).toBe('{"name":"outer"}');
    expect(node(gu, 'u/sync').type).toBe('container');
    expect(node(gu, 'u/sync#head').type).toBe('raw');
    expect(node(gu, inner.id).parentId).toBe('u/sync');
    for (const n of gu.nodes.filter((x) => x.width !== undefined)) {
      expect(Number.isFinite(n.width)).toBe(true);
      expect(Number.isFinite(n.height)).toBe(true);
    }
  });

  it('фикстура method-view.merge: вложенные for → if, then — цепочка из 4 вызовов', () => {
    const view = fixtures.methodViewMerge;
    const gm = blocksToGraph(view.root, { methodBadge: view.complexity });
    expect(gm.nodes.filter((n) => n.type === 'container').map((n) => n.data.kind)).toEqual(['for', 'if', 'for', 'if']);
    const inner = 'com.demo.service.OrderService.merge~0/body/1/body/2/body/1';
    const thenIds = [0, 1, 2, 3].map((i) => `${inner}/then/${i}`);
    for (const id of thenIds) expect(node(gm, id).parentId).toBe(inner);
    expect(edgesFrom(gm, `${inner}${HEAD_SUFFIX}`)).toEqual([expect.objectContaining({ target: thenIds[0], label: 'да' })]);
    expect(node(gm, 'com.demo.service.OrderService.merge~0/body/1/body/2').data.issues).toEqual(['ISSUE-1']);
  });
});

describe('blocksToGraph — места вставки (FE-08)', () => {
  const root = b('method', { signature: 'void m()' }, {
    body: [
      b('expr', { text: 'a()' }),
      b('if', { cond: 'ok' }, { then: [b('expr', { text: 'x()' })] }),
      b('while', { cond: 'go' }, { body: [] }),
    ],
  });
  const ids = (root.slots.body ?? []).map((x) => x.id);
  const [aId, ifId, whileId] = ids as [string, string, string];
  const g = blocksToGraph(root, { insertable: true });
  const inserts = g.nodes.filter((n) => n.type === 'insert');

  it('без insertable — ни «+», ни нод вставки', () => {
    const plain = blocksToGraph(root);
    expect(plain.nodes.some((n) => n.type === 'insert')).toBe(false);
    expect(plain.edges.some((e) => e.insert)).toBe(false);
  });

  it('«+» на стрелках между соседями и от заголовка — индекс вставки в слоте', () => {
    expect(g.edges.find((e) => e.source === root.id && e.target === aId)?.insert).toEqual({ parent: 'root', slot: 'body', index: 0 });
    expect(g.edges.find((e) => e.source === aId && e.target === ifId)?.insert).toEqual({ parent: 'root', slot: 'body', index: 1 });
    const thenEdge = g.edges.find((e) => e.source === `${ifId}${HEAD_SUFFIX}` && e.label === 'да');
    expect(thenEdge?.insert).toEqual({ parent: 'root/body/1', slot: 'then', index: 0 });
  });

  it('«+» в конце слота и в пустом слоте (else, пустое тело)', () => {
    const points = inserts.map((n) => n.data.insert);
    expect(points).toContainEqual({ parent: 'root', slot: 'body', index: 3 });
    expect(points).toContainEqual({ parent: 'root/body/1', slot: 'then', index: 1 });
    expect(points).toContainEqual({ parent: 'root/body/1', slot: 'else', index: 0 });
    expect(points).toContainEqual({ parent: 'root/body/2', slot: 'body', index: 0 });
    // Пустой else — от заголовка if с подписью «нет».
    const elseNode = inserts.find((n) => n.data.insert?.slot === 'else');
    expect(elseNode?.parentId).toBe(ifId);
    expect(g.edges.find((e) => e.target === elseNode?.id)).toMatchObject({ source: `${ifId}${HEAD_SUFFIX}`, label: 'нет' });
    expect(inserts.find((n) => n.data.insert?.parent === 'root/body/2')?.parentId).toBe(whileId);
    // На стрелке к ноде «+» своего «+» нет — не дублируется.
    for (const n of inserts) expect(g.edges.find((e) => e.target === n.id)?.insert).toBeUndefined();
  });

  it('в switch.cases и try.catches — «+» для новых веток; в неизвестный kind — нет', () => {
    const all = blocksToGraph(allKindsMethod(), { insertable: true });
    const slots = all.nodes.filter((n) => n.type === 'insert').map((n) => n.data.insert?.slot);
    expect(slots).toContain('cases');
    expect(slots).toContain('catches');
    expect(slots).toContain('finally');
    const odd = { ...b('raw'), kind: 'labeled', slots: { body: [b('expr', { text: 'x()' })] } } as unknown as Block;
    const gu = blocksToGraph(b('method', {}, { body: [odd] }), { insertable: true });
    expect(gu.nodes.filter((n) => n.type === 'insert').map((n) => n.data.insert?.parent)).toEqual(['root']);
  });
});
