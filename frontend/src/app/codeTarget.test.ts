import { describe, expect, it } from 'vitest';
import { codeTarget } from './codeTarget';

const span = (file: string) => ({ file, startLine: 5, endLine: 40 });

describe('codeTarget — какой файл открыть во вкладке «Код Java»', () => {
  const structure = { path: 'src/A.java', span: span('src/A.java') };

  it('проблема без метода (CyclicDependency, без blockId) → файл её span, даже при выбранном методе', () => {
    expect(
      codeTarget({ methodPath: 'src/M.java', selectedMethodId: 'm~0', structure: null, issue: { span: span('src/Cart.java') } }),
    ).toEqual({ kind: 'issue', path: 'src/Cart.java' });
  });

  it('выбранный класс/поле (новее метода) → файл класса со span; иначе метод', () => {
    expect(codeTarget({ methodPath: 'src/M.java', selectedMethodId: 'm~0', structure, issue: null })).toEqual({
      kind: 'class',
      path: 'src/A.java',
      span: structure.span,
    });
    expect(
      codeTarget({
        methodPath: 'src/M.java',
        selectedMethodId: 'm~0',
        structure: null,
        issue: { methodId: 'm~0', span: span('src/M.java') },
      }),
    ).toEqual({ kind: 'method', path: 'src/M.java' });
    expect(codeTarget({ methodPath: null, selectedMethodId: 'm~0', structure: null, issue: null })).toEqual({
      kind: 'method',
      path: null,
    });
  });

  it('ничего не выбрано → none', () => {
    expect(codeTarget({ methodPath: null, selectedMethodId: null, structure: null, issue: null })).toEqual({ kind: 'none' });
  });
});
