import { describe, expect, it } from 'vitest';
import methodViewJson from '@contract/fixtures/method-view.merge.json';
import type { Schemas } from '../api';
import {
  blockAt,
  draftOf,
  editableFields,
  findPathById,
  mergeFields,
  sameFields,
  updateBlockAt,
  withFields,
} from './blockEdit';
import { blocksToGraph } from './blocksToGraph';
import { ALL_KINDS } from './kinds';
import { allKindsMethod, b } from './testTree';

const view = methodViewJson as unknown as Schemas['MethodView'];

describe('blockEdit', () => {
  it('редактируемые поля — по контракту; method и неизвестный kind не правятся', () => {
    expect(editableFields({ kind: 'method' })).toEqual([]);
    expect(editableFields({ kind: 'yield' as never })).toEqual([]);
    expect(editableFields({ kind: 'var' }).map((f) => f.key)).toEqual(['type', 'name', 'init']);
    expect(editableFields({ kind: 'case' }).map((f) => f.key)).toEqual(['label']);
    for (const kind of ALL_KINDS.filter((k) => k !== 'method')) expect(editableFields({ kind }).length).toBeGreaterThan(0);
  });

  it('пути совпадают с data.path в blocksToGraph', () => {
    const root = allKindsMethod();
    const g = blocksToGraph(root);
    for (const n of g.nodes) {
      if (n.type === 'slot') continue;
      expect(blockAt(root, n.data.path)?.id).toBe(n.data.blockId);
      expect(findPathById(root, n.data.blockId)).toBe(n.data.path);
    }
    expect(blockAt(root, 'root/body/99')).toBeUndefined();
    expect(blockAt(root, 'garbage')).toBeUndefined();
  });

  it('withFields — иммутабельная замена: исходное дерево не меняется, вне пути — те же объекты', () => {
    const root = view.root;
    const before = JSON.stringify(root);
    const path = findPathById(root, 'com.demo.service.OrderService.merge~0/body/1/body/0') ?? '';
    expect(path).toBe('root/body/1/body/0');
    const next = withFields(root, path, { init: 'orders.get(i + 1)' });

    expect(JSON.stringify(root)).toBe(before);
    expect(blockAt(next, path)?.fields).toEqual({ type: 'Order', name: 'a', init: 'orders.get(i + 1)' });
    expect(next).not.toBe(root);
    expect(next.slots.body?.[0]).toBe(root.slots.body?.[0]);
    expect(next.slots.body?.[1]?.slots.body?.[1]).toBe(root.slots.body?.[1]?.slots.body?.[1]);
    // Остальное дерево (id, span, issues, слоты) без изменений.
    expect({ ...blockAt(next, path), fields: null }).toEqual({ ...blockAt(root, path), fields: null });
  });

  it('пустое необязательное поле удаляется, обязательное — остаётся; прочие ключи (arrow) сохраняются', () => {
    expect(mergeFields(b('var', { type: 'int', name: 'x', init: '0' }), { init: '  ' })).toEqual({ type: 'int', name: 'x' });
    expect(mergeFields(b('return', {}), { value: 'x' })).toEqual({ value: 'x' });
    expect(mergeFields(b('throw', { value: 'e' }), { value: '' })).toEqual({ value: '' });
    expect(mergeFields(b('case', { label: '1', arrow: 'true' }), { label: '2' })).toEqual({ label: '2', arrow: 'true' });
  });

  it('draftOf: отсутствующее поле — пустая строка; sameFields сравнивает ключи и значения', () => {
    expect(draftOf(b('return'))).toEqual({ value: '' });
    expect(sameFields({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameFields({ a: '1' }, { a: '1', b: '' })).toBe(false);
  });

  it('updateBlockAt с неверным путём возвращает исходное дерево', () => {
    const root = allKindsMethod();
    expect(updateBlockAt(root, 'root/body/42', (x) => x)).toBe(root);
  });
});
