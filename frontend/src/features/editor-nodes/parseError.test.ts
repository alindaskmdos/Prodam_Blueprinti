import { describe, expect, it } from 'vitest';
import { explainParseError } from './parseError';

describe('explainParseError', () => {
  it('разбирает «Found "-"», список ожидаемого уходит в details', () => {
    const r = explainParseError('Синтаксическая ошибка: Parse error. Found "-", expected one of "%=" "&=" "*="');
    expect(r.text).toBe('Синтаксическая ошибка: неожиданный «-».');
    expect(r.details).toBe('Ожидалось: "%=" "&=" "*="');
  });

  it('берёт позицию из «(line 1,col 8)»; токен с <ИМЕНЕМ> после кавычек', () => {
    const r = explainParseError('(line 1,col 8) Parse error. Found "-" <MINUS>, expected one of "="');
    expect(r.text).toBe('Синтаксическая ошибка: неожиданный «-» (строка 1, позиция 8).');
  });

  it('конец текста', () => {
    expect(explainParseError('Parse error. Found <EOF>, expected one of ";"').text).toBe(
      'Синтаксическая ошибка: неожиданный конец текста.',
    );
  });

  it('непонятный формат — как есть', () => {
    expect(explainParseError('Синтаксическая ошибка: лишний «==».')).toEqual({ text: 'Синтаксическая ошибка: лишний «==».' });
  });
});
