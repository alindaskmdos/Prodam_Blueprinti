import { describe, expect, it } from 'vitest';
import { blockText } from './blockText';
import { highlightJava } from './highlightJava';
import { b } from './testTree';

describe('blockText', () => {
  it.each([
    [b('method', { signature: 'public int merge()' }), 'public int merge()'],
    [b('var', { type: 'int', name: 'x', init: '0' }), 'int x = 0'],
    [b('var', { type: 'int', name: 'x' }), 'int x'],
    [b('assign', { target: 'x', op: '+=', value: '2' }), 'x += 2'],
    [b('expr', { text: 'a.b()' }), 'a.b()'],
    [b('if', { cond: 'a > b' }), 'a > b'],
    [b('while', { cond: 'it.hasNext()' }), 'while (it.hasNext())'],
    [b('dowhile', { cond: 'x' }), 'do … while (x)'],
    [b('for', { init: 'int i = 0', cond: 'i < n', update: 'i++' }), 'for (int i = 0; i < n; i++)'],
    [b('foreach', { type: 'Order', var: 'o', iterable: 'orders' }), 'for (Order o : orders)'],
    [b('switch', { selector: 's' }), 'switch (s)'],
    [b('case', { label: '1, 2' }), 'case 1, 2:'],
    [b('case', { label: 'Circle c when c.r() > 0', arrow: 'true' }), 'case Circle c when c.r() > 0 ->'],
    [b('case', { label: 'default' }), 'default:'],
    [b('try'), 'try'],
    [b('catch', { type: 'IOException', var: 'e' }), 'catch (IOException e)'],
    [b('return'), 'return'],
    [b('return', { value: 'x' }), 'return x'],
    [b('throw', { value: 'new E()' }), 'throw new E()'],
    [b('break'), 'break'],
    [b('continue', { label: 'outer' }), 'continue outer'],
    [b('comment', { text: '// hi' }), '// hi'],
    [b('raw', { text: 'label: { x(); }' }), 'label: { x(); }'],
  ])('%#: %j', (block, expected) => {
    expect(blockText(block)).toBe(expected);
  });
});

describe('blockText: неизвестный kind', () => {
  it('fields.text, иначе JSON полей — всегда строка', () => {
    const unknown = (fields: Record<string, string>) => ({ id: 'u', kind: 'yield' as never, fields, slots: {} });
    expect(blockText(unknown({ text: 'yield x' }))).toBe('yield x');
    expect(blockText(unknown({ a: '1' }))).toBe('{"a":"1"}');
    expect(blockText({ id: 'u', kind: 'nope' as never, fields: undefined as never, slots: {} })).toBe('{}');
  });
});

describe('highlightJava', () => {
  it('выделяет ключевые слова, строки, числа и комментарии без потери текста', () => {
    const text = 'for (int i = 0; s != null; i++) log("a\\"b") // x';
    const tokens = highlightJava(text);
    expect(tokens.map((t) => t.text).join('')).toBe(text);
    const of = (type: string) => tokens.filter((t) => t.type === type).map((t) => t.text);
    expect(of('keyword')).toEqual(['for', 'int', 'null']);
    expect(of('number')).toEqual(['0']);
    expect(of('string')).toEqual(['"a\\"b"']);
    expect(of('comment')).toEqual(['// x']);
  });

  it('пустая строка — без токенов', () => {
    expect(highlightJava('')).toEqual([]);
  });
});
