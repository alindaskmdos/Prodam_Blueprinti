import { describe, expect, it } from 'vitest';
import { blockAt } from './blockEdit';
import {
  canMove,
  editsOnInsert,
  insertBlock,
  insertOptions,
  moveBlock,
  nestedCount,
  parentOf,
  removeBlock,
  sameShape,
  templateBlock,
  templateFor,
} from './blockTree';
import { ALL_KINDS, type Block } from './kinds';
import { b } from './testTree';

/** method { a; for { x; y }; c } */
function sample(): Block {
  return b('method', { signature: 'void m()' }, {
    body: [
      b('expr', { text: 'a()' }),
      b('for', { init: 'int i = 0', cond: 'i < n', update: 'i++' }, {
        body: [b('expr', { text: 'x()' }), b('expr', { text: 'y()' })],
      }),
      b('expr', { text: 'c()' }),
    ],
  });
}

const texts = (items: Block[] | undefined) => (items ?? []).map((i) => i.fields.text ?? i.kind);
const neu = () => b('expr', { text: 'new()' });

describe('parentOf', () => {
  it('разбирает путь на родителя, слот и индекс; у корня и битого пути — null', () => {
    expect(parentOf('root/body/1/body/0')).toEqual({ parent: 'root/body/1', slot: 'body', index: 0 });
    expect(parentOf('root')).toBeNull();
    expect(parentOf('root/body')).toBeNull();
    expect(parentOf('root/body/x')).toBeNull();
  });
});

describe('insertBlock', () => {
  it('в начало, середину и конец слота; исходное дерево не меняется', () => {
    const root = sample();
    const before = JSON.stringify(root);
    const start = insertBlock(root, { parent: 'root', slot: 'body', index: 0 }, neu());
    expect(texts(start?.root.slots.body)).toEqual(['new()', 'a()', 'for', 'c()']);
    expect(start?.path).toBe('root/body/0');

    const mid = insertBlock(root, { parent: 'root/body/1', slot: 'body', index: 1 }, neu());
    expect(texts(mid?.root.slots.body?.[1]?.slots.body)).toEqual(['x()', 'new()', 'y()']);
    expect(mid?.path).toBe('root/body/1/body/1');

    const end = insertBlock(root, { parent: 'root', slot: 'body', index: 3 }, neu());
    expect(texts(end?.root.slots.body)).toEqual(['a()', 'for', 'c()', 'new()']);
    expect(JSON.stringify(root)).toBe(before);
    // Соседние ветки не копируются — структурное разделение.
    expect(end?.root.slots.body?.[1]).toBe(root.slots.body?.[1]);
  });

  it('в пустой слот и в слот, ключа которого ещё нет (if без else)', () => {
    const root = b('method', {}, { body: [b('if', { cond: 'ok' }, { then: [] })] });
    const then = insertBlock(root, { parent: 'root/body/0', slot: 'then', index: 0 }, neu());
    expect(texts(then?.root.slots.body?.[0]?.slots.then)).toEqual(['new()']);
    const els = insertBlock(root, { parent: 'root/body/0', slot: 'else', index: 0 }, neu());
    expect(blockAt(must(els).root, 'root/body/0/else/0')?.fields.text).toBe('new()');
    expect(els?.root.slots.body?.[0]?.slots.then).toEqual([]);
  });

  it('индекс за пределами, неизвестный слот, лист и неизвестный kind — null', () => {
    const root = sample();
    expect(insertBlock(root, { parent: 'root', slot: 'body', index: 4 }, neu())).toBeNull();
    expect(insertBlock(root, { parent: 'root', slot: 'body', index: -1 }, neu())).toBeNull();
    expect(insertBlock(root, { parent: 'root', slot: 'else', index: 0 }, neu())).toBeNull();
    expect(insertBlock(root, { parent: 'root/body/0', slot: 'body', index: 0 }, neu())).toBeNull();
    expect(insertBlock(root, { parent: 'root/body/9', slot: 'body', index: 0 }, neu())).toBeNull();
    const odd = { ...b('raw'), kind: 'labeled' } as unknown as Block;
    expect(insertBlock({ ...root, slots: { body: [odd] } }, { parent: 'root/body/0', slot: 'body', index: 0 }, neu())).toBeNull();
  });
});

describe('removeBlock', () => {
  it('удаляет лист', () => {
    const root = sample();
    expect(texts(removeBlock(root, 'root/body/1/body/0').slots.body?.[1]?.slots.body)).toEqual(['y()']);
    expect(texts(removeBlock(root, 'root/body/2').slots.body)).toEqual(['a()', 'for']);
  });

  it('удаляет контейнер вместе с содержимым', () => {
    const root = sample();
    expect(nestedCount(must(root.slots.body?.[1]))).toBe(2);
    expect(texts(removeBlock(root, 'root/body/1').slots.body)).toEqual(['a()', 'c()']);
  });

  it('корень и несуществующий путь — то же дерево', () => {
    const root = sample();
    expect(removeBlock(root, 'root')).toBe(root);
    expect(removeBlock(root, 'root/body/7')).toBe(root);
  });
});

describe('moveBlock', () => {
  it('вверх и вниз внутри слота', () => {
    const root = sample();
    const up = moveBlock(root, 'root/body/2', -1);
    expect(texts(up.root.slots.body)).toEqual(['a()', 'c()', 'for']);
    expect(up.path).toBe('root/body/1');
    const down = moveBlock(root, 'root/body/1/body/0', 1);
    expect(texts(down.root.slots.body?.[1]?.slots.body)).toEqual(['y()', 'x()']);
    expect(down.path).toBe('root/body/1/body/1');
  });

  it('на границах слота — no-op (не выходит из контейнера)', () => {
    const root = sample();
    expect(moveBlock(root, 'root/body/0', -1)).toEqual({ root, path: 'root/body/0' });
    expect(moveBlock(root, 'root/body/2', 1).root).toBe(root);
    expect(moveBlock(root, 'root/body/1/body/0', -1).root).toBe(root);
    expect(moveBlock(root, 'root/body/1/body/1', 1).root).toBe(root);
    expect(moveBlock(root, 'root', 1).root).toBe(root);
    expect(canMove(root, 'root/body/1/body/1', 1)).toBe(false);
    expect(canMove(root, 'root/body/1/body/1', -1)).toBe(true);
  });
});

describe('шаблоны и меню вставки', () => {
  it('у каждого kind — пустой id, слоты объектом, необязательных ключей нет', () => {
    for (const kind of ALL_KINDS) {
      const t = templateBlock(kind);
      expect(t.id).toBe('');
      expect(t.kind).toBe(kind);
      expect(typeof t.slots).toBe('object');
      expect(Object.values(t.fields).every((v) => typeof v === 'string')).toBe(true);
    }
    expect(templateBlock('var').fields).toEqual({ type: '', name: '' });
    expect(templateBlock('return').fields).toEqual({});
    expect(templateBlock('try').slots.catches?.[0]?.kind).toBe('catch');
  });

  it('в switch.cases — только case, в try.catches — только catch, в лист — ничего', () => {
    expect(insertOptions({ kind: 'switch' }, 'cases').map((o) => o.kind)).toEqual(['case']);
    expect(insertOptions({ kind: 'try' }, 'catches').map((o) => o.kind)).toEqual(['catch']);
    const body = insertOptions({ kind: 'method' }, 'body').map((o) => o.kind);
    expect(body).toContain('if');
    expect(body).not.toContain('case');
    expect(body).not.toContain('method');
    expect(insertOptions({ kind: 'expr' }, 'body')).toEqual([]);
  });

  it('редактор сразу — когда есть что вводить; break/continue/try уходят сразу', () => {
    expect(editsOnInsert(templateBlock('expr'))).toBe(true);
    expect(editsOnInsert(templateBlock('return'))).toBe(true);
    expect(editsOnInsert(templateBlock('break'))).toBe(false);
    expect(editsOnInsert(templateBlock('try'))).toBe(false);
  });
});

describe('templateFor и sameShape', () => {
  it('новый case берёт форму у соседних case; без соседей — `case X:` (ключа arrow нет)', () => {
    const arrows = b('switch', { selector: 'x' }, { cases: [b('case', { label: '1', arrow: 'true' }, { body: [] })] });
    expect(templateFor(arrows, 'cases', 'case').fields).toEqual({ label: '', arrow: 'true' });
    const classic = b('switch', { selector: 'x' }, { cases: [b('case', { label: '1' }, { body: [] })] });
    expect(templateFor(classic, 'cases', 'case').fields).toEqual({ label: '' });
    const empty = b('switch', { selector: 'x' }, { cases: [] });
    expect(templateFor(empty, 'cases', 'case').fields).toEqual({ label: '' });
    expect(templateFor(sample(), 'body', 'expr')).toEqual(templateBlock('expr'));
  });

  it('sameShape: поля не важны, ids/kind/порядок — важны', () => {
    const root = sample();
    expect(sameShape(root, { ...root, fields: { signature: 'other' } })).toBe(true);
    expect(sameShape(root, moveBlock(root, 'root/body/1', 1).root)).toBe(false);
    expect(sameShape(root, removeBlock(root, 'root/body/0'))).toBe(false);
  });
});

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('ожидалось значение');
  return v;
}
