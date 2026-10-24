import type { Schemas } from '../api';

type TestCase = Schemas['TestCase'];
type TestResult = Schemas['TestResult'];
type TestStatus = Schemas['TestStatus'];

export const STATUS_TEXT: Record<TestStatus, string> = {
  passed: 'пройден',
  failed: 'не пройден',
  compile_error: 'не компилируется',
  original_fails: 'оригинал тоже не проходит этот тест',
};

/** Строки вывода без завершающей пустой строки после последнего `\n`. */
export function splitLines(text: string | undefined | null): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Строка построчного сравнения: номер с 1, ожидаемая и полученная строка (null — строки нет). */
export interface DiffRow {
  line: number;
  expected: string | null;
  actual: string | null;
  /**
   * same — совпадает; diff — отличается; noisy — шумная (различалась между двумя прогонами оригинала, не сравнивается);
   * ignored — помечена пользователем в ignoreLines.
   */
  kind: 'same' | 'diff' | 'noisy' | 'ignored';
}

/** Построчный diff ожидаемого и фактического вывода (ТЗ §10.3–10.4). Номера noisy/ignore — с 1. */
export function diffLines(
  expected: string | undefined | null,
  actual: string | undefined | null,
  noisyLines: readonly number[] = [],
  ignoreLines: readonly number[] = [],
): DiffRow[] {
  const exp = splitLines(expected);
  const act = splitLines(actual);
  const noisy = new Set(noisyLines);
  const ignored = new Set(ignoreLines);
  const rows: DiffRow[] = [];
  for (let i = 0; i < Math.max(exp.length, act.length); i++) {
    const line = i + 1;
    const e = exp[i] ?? null;
    const a = act[i] ?? null;
    const kind: DiffRow['kind'] = noisy.has(line) ? 'noisy' : ignored.has(line) ? 'ignored' : e === a ? 'same' : 'diff';
    rows.push({ line, expected: e, actual: a, kind });
  }
  return rows;
}

/** Номер первой отличающейся строки или null. */
export function firstDiffLine(rows: readonly DiffRow[]): number | null {
  return rows.find((r) => r.kind === 'diff')?.line ?? null;
}

/** Класс JUnit-результата `pkg.Class.method` совпадает с тестом: `Class`, а для `Outer$Inner` — `Outer` или `Outer$Inner`. */
function junitClassMatches(cls: string, testName: string): boolean {
  return cls === testName || cls.split('$')[0] === testName;
}

/**
 * Результаты, относящиеся к тесту. IO — точно по имени. JUnit — имя равно имени теста (так в фикстурах,
 * напр. compile_error) или имеет вид `pkg.Class.method` (BE-11) и класс (предпоследний сегмент) — этот тест.
 * Совпадение с сегментом пакета или именем метода не считается.
 */
export function resultsFor(test: Pick<TestCase, 'name' | 'type'>, results: readonly TestResult[]): TestResult[] {
  return results.filter((r) => {
    if (r.type !== test.type) return false;
    if (r.name === test.name) return true;
    if (test.type !== 'junit') return false;
    const parts = r.name.split('.');
    const cls = parts.length >= 2 ? parts[parts.length - 2] : undefined;
    return cls !== undefined && junitClassMatches(cls, test.name);
  });
}

/** Статус группы, включая «неизвестно» для статуса, которого нет в контракте. */
export type AggregateStatus = TestStatus | 'unknown';

const KNOWN_STATUSES: readonly string[] = ['passed', 'failed', 'compile_error', 'original_fails'];

/** Итоговый статус группы результатов: худший из них; неизвестный статус → 'unknown'; нет результатов — null. */
export function aggregateStatus(results: readonly TestResult[]): AggregateStatus | null {
  if (results.length === 0) return null;
  const order: TestStatus[] = ['compile_error', 'failed', 'original_fails'];
  for (const s of order) if (results.some((r) => r.status === s)) return s;
  return results.every((r) => r.status === 'passed') ? 'passed' : 'unknown';
}

/** Подпись статуса; статус вне контракта — «неизвестно». */
export function statusText(status: string): string {
  return KNOWN_STATUSES.includes(status) ? STATUS_TEXT[status as TestStatus] : 'неизвестно';
}

export function isKnownStatus(status: string): status is TestStatus {
  return KNOWN_STATUSES.includes(status);
}

/** Результаты, которым нет теста в списке (напр. тест удалён после прогона). */
export function orphanResults(tests: readonly TestCase[], results: readonly TestResult[]): TestResult[] {
  const matched = new Set<TestResult>();
  for (const t of tests) resultsFor(t, results).forEach((r) => matched.add(r));
  return results.filter((r) => !matched.has(r));
}

/** «1, 3, 5» → [1, 3, 5]; нечисла и ≤ 0 отбрасываются, дубли убираются, порядок по возрастанию. */
export function parseLineList(text: string): number[] {
  const nums = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`;
}

/** Заготовка нового теста по типу. */
export function newTest(type: TestCase['type'], taken: readonly string[]): TestCase {
  const base = type === 'io' ? 'new-test' : 'NewTest';
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}${type === 'io' ? '-' : ''}${i}`;
  if (type === 'io') return { name, type, stdin: '', mode: 'original', expected: null, ignoreLines: [] };
  return {
    name,
    type,
    source: [
      'import static org.junit.jupiter.api.Assertions.assertEquals;',
      '',
      'import org.junit.jupiter.api.Test;',
      '',
      `class ${name} {`,
      '    @Test',
      '    void works() {',
      '        assertEquals(1, 1);',
      '    }',
      '}',
      '',
    ].join('\n'),
  };
}

/** Текст правки для копирования (черновик, не сохранённый из-за 409). */
export function draftText(test: TestCase): string {
  if (test.type === 'junit') return test.source ?? '';
  const parts = [`# ${test.name}`, '# stdin', test.stdin ?? ''];
  if (test.mode === 'manual') parts.push('# ожидаемый stdout', test.expected ?? '');
  if (test.ignoreLines?.length) parts.push(`# игнорируемые строки: ${test.ignoreLines.join(', ')}`);
  return parts.join('\n');
}
