import { describe, expect, it } from 'vitest';
import { codeTarget } from './codeTarget';

const span = (file: string) => ({ file, startLine: 5, endLine: 40 });

describe('codeTarget — какой файл открыть во вкладке «Код Java»', () => {
  const cls = { id: 'a.A', path: 'src/A.java', span: span('src/A.java') };

  it('проблема без метода (CyclicDependency, без blockId) → файл её span, даже при выбранном методе', () => {
    expect(
      codeTarget({ methodPath: 'src/M.java', selectedMethodId: 'm~0', selectedClass: null, issue: { span: span('src/Cart.java') } }),
    ).toEqual({ kind: 'issue', path: 'src/Cart.java' });
  });

  it('проблема с методом → файл метода; метод приоритетнее класса', () => {
    expect(
      codeTarget({
        methodPath: 'src/M.java',
        selectedMethodId: 'm~0',
        selectedClass: cls,
        issue: { methodId: 'm~0', span: span('src/M.java') },
      }),
    ).toEqual({ kind: 'method', path: 'src/M.java' });
    expect(codeTarget({ methodPath: null, selectedMethodId: 'm~0', selectedClass: null, issue: null })).toEqual({
      kind: 'method',
      path: null,
    });
  });

  it('только класс → файл класса со span; ничего не выбрано → none', () => {
    expect(codeTarget({ methodPath: null, selectedMethodId: null, selectedClass: cls, issue: null })).toEqual({
      kind: 'class',
      path: 'src/A.java',
      span: cls.span,
    });
    expect(codeTarget({ methodPath: null, selectedMethodId: null, selectedClass: null, issue: null })).toEqual({ kind: 'none' });
  });
});
