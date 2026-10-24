import { describe, expect, it } from 'vitest';
import { blocksToGraph } from './blocksToGraph';
import {
  blocksLabel,
  collapsedPaths,
  containerEntries,
  lockedPaths,
  revealKeys,
  subtreeIssues,
} from './collapse';
import type { Block } from './kinds';

const blk = (id: string, kind: Block['kind'], slots: Record<string, Block[]> = {}, extra: Partial<Block> = {}): Block => ({
  id,
  kind,
  fields: kind === 'comment' ? { text: `// ${id}` } : kind === 'expr' ? { text: `${id}()` } : { cond: 'x' },
  slots,
  ...extra,
});

/** for(1) → if(2) → while(3) → for(4) → expr; плюс комментарий и return на верхнем уровне. */
function deep(extra: Partial<Block> = {}): Block {
  return blk('m', 'method', {
    body: [
      blk('c', 'comment'),
      blk('f1', 'for', {
        body: [
          blk('i2', 'if', {
            then: [blk('w3', 'while', { body: [blk('f4', 'for', { body: [blk('e5', 'expr', {}, { issues: ['I-9'] })] })] })],
          }),
        ],
      }, extra),
      blk('r', 'return'),
    ],
  }, { fields: { signature: 'void m()' } });
}

describe('collapse — состояние сворачивания (FE-06)', () => {
  it('глубина контейнеров: в теле метода — 1, вложенный — +1', () => {
    expect(containerEntries(deep()).map((c) => [c.key, c.depth])).toEqual([
      ['f1', 1],
      ['i2', 2],
      ['w3', 3],
      ['f4', 4],
    ]);
  });

  it('по умолчанию свёрнуты контейнеры глубже 3', () => {
    expect([...collapsedPaths(deep(), {})]).toEqual(['root/body/1/body/0/then/0/body/0']);
  });

  it('Block.collapsed = true из контракта — свёрнут; false (дефолт бэка) не отменяет правило глубины', () => {
    const tree = deep({ collapsed: true });
    expect(collapsedPaths(tree, {}).has('root/body/1')).toBe(true);
    const withDefaults = JSON.parse(JSON.stringify(deep()), (_k, v: unknown) =>
      v && typeof v === 'object' && 'kind' in v ? { ...v, collapsed: false } : v,
    ) as Block;
    expect([...collapsedPaths(withDefaults, {})]).toEqual(['root/body/1/body/0/then/0/body/0']);
  });

  it('переопределение пользователя важнее начального значения', () => {
    const c = collapsedPaths(deep({ collapsed: true }), { f1: false, f4: false, i2: true });
    expect([...c]).toEqual(['root/body/1/body/0']);
  });

  it('предки открытого редактора / красной ноды не сворачиваются и заблокированы', () => {
    const forced = ['root/body/1/body/0/then/0/body/0/body/0'];
    expect(collapsedPaths(deep(), { f1: true }, forced).size).toBe(0);
    expect([...lockedPaths(deep(), forced)]).toEqual([
      'root/body/1',
      'root/body/1/body/0',
      'root/body/1/body/0/then/0',
      'root/body/1/body/0/then/0/body/0',
    ]);
  });

  it('revealKeys — свёрнутые предки блока (сам свёрнутый контейнер не разворачивается)', () => {
    const tree = deep();
    const c = collapsedPaths(tree, { f1: true });
    expect(revealKeys(tree, 'e5', c)).toEqual(['f1', 'f4']);
    expect(revealKeys(tree, 'f4', c)).toEqual(['f1']);
    expect(revealKeys(tree, 'r', c)).toEqual([]);
    expect(revealKeys(tree, 'нет такого', c)).toEqual([]);
  });

  it('subtreeIssues и подпись числа блоков', () => {
    expect(subtreeIssues(deep())).toEqual(['I-9']);
    expect([1, 2, 5, 11, 21, 22, 112].map(blocksLabel)).toEqual([
      '1 блок',
      '2 блока',
      '5 блоков',
      '11 блоков',
      '21 блок',
      '22 блока',
      '112 блоков',
    ]);
  });
});

describe('blocksToGraph — свёрнутые контейнеры и скрытие комментариев (FE-06)', () => {
  it('свёрнутый контейнер — одна нода с числом вложенных и проблемами внутри, без детей и «+» внутри', () => {
    const tree = deep();
    const g = blocksToGraph(tree, { insertable: true, collapsed: collapsedPaths(tree, { f1: true }) });
    const f1 = g.nodes.find((n) => n.id === 'f1');
    expect(f1?.type).toBe('block');
    expect(f1?.data.collapse).toEqual({ key: 'f1', collapsed: true, locked: false, hidden: 4 });
    expect(f1?.data.issues).toEqual(['I-9']);
    expect(g.nodes.some((n) => ['i2', 'w3', 'f4', 'e5'].includes(n.data.blockId))).toBe(false);
    expect(g.nodes.some((n) => n.parentId === 'f1')).toBe(false);
    // Стрелки снаружи остаются (вставка до/после свёрнутого).
    expect(g.edges.some((e) => e.target === 'f1' && e.insert)).toBe(true);
    expect(g.edges.some((e) => e.source === 'f1')).toBe(true);
  });

  it('у развёрнутого контейнера шеврон на заголовке', () => {
    const tree = deep();
    const g = blocksToGraph(tree, { collapsed: collapsedPaths(tree, {}) });
    expect(g.nodes.find((n) => n.id === 'f1#head')?.data.collapse).toEqual({ key: 'f1', collapsed: false, locked: false });
    expect(g.nodes.find((n) => n.id === 'f4')?.data.collapse?.collapsed).toBe(true);
  });

  it('hideComments: комментариев нет, пути и места вставки остальных — по исходным индексам', () => {
    const tree = deep();
    const g = blocksToGraph(tree, { insertable: true, hideComments: true });
    expect(g.nodes.some((n) => n.type === 'comment')).toBe(false);
    expect(g.nodes.find((n) => n.id === 'f1')?.data.path).toBe('root/body/1');
    expect(g.edges.find((e) => e.source === 'm' && e.target === 'f1')?.insert).toEqual({ parent: 'root', slot: 'body', index: 1 });
    // Дерево не меняется — фильтр только в графе.
    expect(tree.slots.body?.[0]?.kind).toBe('comment');
  });

  it('hideComments не скрывает комментарий из keepVisible (открыт редактор / красная нода)', () => {
    const g = blocksToGraph(deep(), { hideComments: true, keepVisible: new Set(['root/body/0']) });
    expect(g.nodes.some((n) => n.type === 'comment')).toBe(true);
  });

  it('ветка только из комментариев при скрытии не рисуется', () => {
    const tree = blk('m', 'method', {
      body: [blk('i', 'if', { then: [blk('e', 'expr')], else: [blk('c2', 'comment')] })],
    }, { fields: { signature: 'void m()' } });
    const g = blocksToGraph(tree, { hideComments: true });
    expect(g.nodes.some((n) => n.id === 'i#slot:else')).toBe(false);
  });
});
