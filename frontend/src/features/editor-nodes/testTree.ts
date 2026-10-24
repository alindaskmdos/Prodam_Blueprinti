import type { Block, BlockKind } from './kinds';

let seq = 0;

/** Конструктор блока для тестов: id из счётчика, слоты по ключам. */
export function b(kind: BlockKind, fields: Record<string, string> = {}, slots: Record<string, Block[]> = {}): Block {
  seq += 1;
  return { id: `t/${kind}/${seq}`, kind, fields, slots };
}

/** Метод, в котором встречаются все kind контракта, с вложенностью и несколькими ветками. */
export function allKindsMethod(): Block {
  return b('method', { signature: 'int all(List<Order> orders)' }, {
    body: [
      b('comment', { text: '// считаем сумму' }),
      b('var', { type: 'int', name: 'sum', init: '0' }),
      b('assign', { target: 'sum', op: '+=', value: '1' }),
      b('expr', { text: 'log("start")' }),
      b('if', { cond: 'orders.isEmpty()' }, {
        then: [b('return', { value: '0' })],
        else: [b('if', { cond: 'sum > 1' }, { then: [b('break')], else: [] })],
      }),
      b('while', { cond: 'sum < 10' }, { body: [b('continue', { label: 'outer' })] }),
      b('dowhile', { cond: 'sum < 20' }, { body: [b('expr', { text: 'sum++' })] }),
      b('for', { init: 'int i = 0', cond: 'i < n', update: 'i++' }, {
        body: [
          b('foreach', { type: 'Order', var: 'o', iterable: 'orders' }, {
            body: [b('expr', { text: 'o.touch()' })],
          }),
        ],
      }),
      b('switch', { selector: 'sum' }, {
        cases: [
          b('case', { label: '1, 2' }, { body: [b('break')] }),
          b('case', { label: 'default', arrow: 'true' }, { body: [b('throw', { value: 'new IllegalStateException()' })] }),
        ],
      }),
      b('try', { resources: 'var in = open()' }, {
        body: [b('expr', { text: 'in.read()' })],
        catches: [
          b('catch', { type: 'IOException', var: 'e' }, { body: [b('raw', { text: 'label: {\n  foo();\n}' })] }),
          b('catch', { type: 'RuntimeException', var: 'e' }, { body: [] }),
        ],
        finally: [b('expr', { text: 'in.close()' })],
      }),
      b('return', { value: 'sum' }),
    ],
  });
}
