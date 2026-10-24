import { describe, expect, it } from 'vitest';
import { revealForMethod } from './reveal';

const span = { file: 'src/A.java', startLine: 10, endLine: 20 };

describe('revealForMethod', () => {
  it('span файла редактора → строки метода', () => {
    expect(revealForMethod(span, 'src/A.java', 7)).toEqual({ startLine: 10, endLine: 20, seq: 7 });
  });
  it('span другого файла или его отсутствие → null, без фолбэков', () => {
    expect(revealForMethod(span, 'src/B.java', 7)).toBeNull();
    expect(revealForMethod(null, 'src/A.java', 7)).toBeNull();
    expect(revealForMethod(undefined, 'src/A.java', 7)).toBeNull();
  });
});
