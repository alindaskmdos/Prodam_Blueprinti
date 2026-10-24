import { describe, expect, it } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { blockAtLine, findBlockById, spanOfBlock } from './blockLocate';
import { b } from './testTree';

const root = fixtures.methodViewMerge.root;
const FILE = 'src/com/demo/service/OrderService.java';
const M = 'com.demo.service.OrderService.merge~0';

describe('blockAtLine — строка → самый глубокий блок', () => {
  it.each([
    [37, M],
    [38, `${M}/body/0`],
    [39, `${M}/body/1`],
    [42, `${M}/body/1/body/1/then/0`],
    [44, `${M}/body/1/body/2`],
    [49, `${M}/body/1/body/2/body/1/then/2`],
    [51, `${M}/body/1/body/2/body/1`],
    [53, `${M}/body/1`],
    [55, M],
  ])('строка %i → %s', (line, id) => {
    expect(blockAtLine(root, line)?.id).toBe(id);
    expect(blockAtLine(root, line, FILE)?.id).toBe(id);
  });

  it('строка вне метода и другой файл — null', () => {
    expect(blockAtLine(root, 10)).toBeNull();
    expect(blockAtLine(root, 100)).toBeNull();
    expect(blockAtLine(root, 40, 'src/Other.java')).toBeNull();
  });

  it('блок без span (вставлен локально) пропускается, его дети проверяются', () => {
    const span = (s: number, e: number) => ({ file: 'F.java', startLine: s, endLine: e });
    const tree = b('method', { signature: 'void f()' }, {
      body: [{ ...b('for', { init: '', cond: '', update: '' }, { body: [{ ...b('expr', { text: 'x()' }), id: 'inner', span: span(3, 3) }] }), id: 'nospan' }],
    });
    const rooted = { ...tree, id: 'm', span: span(1, 5) };
    expect(blockAtLine(rooted, 3)?.id).toBe('inner');
    expect(blockAtLine(rooted, 4)?.id).toBe('m');
  });
});

describe('blockId → span', () => {
  it('span блока по id', () => {
    expect(spanOfBlock(root, `${M}/body/1/body/2`)).toEqual({ file: FILE, startLine: 44, endLine: 52 });
    expect(spanOfBlock(root, M)).toEqual({ file: FILE, startLine: 37, endLine: 55 });
    expect(findBlockById(root, `${M}/body/2`)?.kind).toBe('return');
  });

  it('нет блока — null', () => {
    expect(spanOfBlock(root, 'nope')).toBeNull();
    expect(findBlockById(root, 'nope')).toBeNull();
  });
});
