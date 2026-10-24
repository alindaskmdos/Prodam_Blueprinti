import type { Schemas } from '../api';

type FixResult = Schemas['FixResult'];
type TestResult = Schemas['TestResult'];

/** Строка unified diff для показа. */
export interface DiffLine {
  kind: 'file' | 'hunk' | 'add' | 'del' | 'ctx';
  text: string;
  /** Номер строки в новой версии (add/ctx); у del и заголовков — null. */
  line: number | null;
}

export interface ParsedDiff {
  lines: DiffLine[];
  /** Файлы из заголовков «+++ b/…». */
  files: string[];
  added: number;
  removed: number;
}

/** Разбор unified diff (FixResult.diff): заголовки файлов, ханки, +/−, номера строк новой версии. */
export function parseUnifiedDiff(diff: string | undefined | null): ParsedDiff {
  const result: ParsedDiff = { lines: [], files: [], added: 0, removed: 0 };
  if (!diff) return result;
  const rows = diff.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  let newLine = 0;
  for (const row of rows) {
    if (row.startsWith('--- ')) continue;
    if (row.startsWith('+++ ')) {
      const path = row.slice(4).replace(/^b\//, '').trim();
      result.files.push(path);
      result.lines.push({ kind: 'file', text: path, line: null });
      continue;
    }
    if (row.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
      newLine = m ? Number(m[1]) : 0;
      result.lines.push({ kind: 'hunk', text: row, line: null });
      continue;
    }
    if (row.startsWith('\\')) continue; // «\ No newline at end of file»
    if (row.startsWith('+')) {
      result.added += 1;
      result.lines.push({ kind: 'add', text: row.slice(1), line: newLine++ });
    } else if (row.startsWith('-')) {
      result.removed += 1;
      result.lines.push({ kind: 'del', text: row.slice(1), line: null });
    } else {
      result.lines.push({ kind: 'ctx', text: row.startsWith(' ') ? row.slice(1) : row, line: newLine++ });
    }
  }
  return result;
}

/** unknown — сервер этот шаг не детализировал (показывается нейтрально, без догадок). */
export type StepStatus = 'running' | 'ok' | 'fail' | 'warn' | 'skip' | 'unknown';

/** Подпись шага, о котором бэк ничего не сообщил. */
export const NOT_DETAILED = 'сервер не детализировал шаги';

export interface GateStep {
  name: string;
  detail: string;
  status: StepStatus;
}

/** Итог Quality Gate для плашки. */
export type GateVerdict =
  | { kind: 'running' }
  | { kind: 'confirmed' }
  /** Применено, но проверка неполная: нет тестов, шумный вывод (verify incomplete). */
  | { kind: 'incomplete'; reason: string }
  | { kind: 'rejected'; reason: string };

/**
 * Итог по ответу. Причина (`reason`) — дословно с сервера; «подтверждено» (поведение совпадает) —
 * только при applied и verify.status = green.
 */
export function verdictOf(result: FixResult | null): GateVerdict {
  if (!result) return { kind: 'running' };
  if (!result.applied) return { kind: 'rejected', reason: result.reason || 'Сервер не указал причину.' };
  const v = result.verify;
  if (!v) return { kind: 'incomplete', reason: result.reason || 'Сервер не прислал результат проверки тестами.' };
  if (v.status !== 'green') {
    return {
      kind: 'incomplete',
      reason: result.reason || v.warnings?.join('; ') || `Статус проверки: ${v.status}.`,
    };
  }
  return { kind: 'confirmed' };
}

function countLine(results: TestResult[], empty: string): { text: string; failed: boolean } {
  if (results.length === 0) return { text: empty, failed: false };
  const passed = results.filter((r) => r.status === 'passed').length;
  const bad = results.filter((r) => r.status !== 'passed');
  const names = bad
    .slice(0, 3)
    .map((r) => `${r.name}${r.status === 'compile_error' ? ' — не компилируется' : ''}`)
    .join(', ');
  return {
    text: `${passed} из ${results.length}${names ? ` · ${names}` : ''}`,
    failed: bad.length > 0,
  };
}

/**
 * Шаги Quality Gate по ответу (бэк отвечает одним запросом, шаги — его этапы по ТЗ §9):
 * патч к копии → компиляция → IO-тесты → JUnit. Пока ответа нет — все «выполняются».
 */
export function gateSteps(result: FixResult | null, fixId: string): GateStep[] {
  const names = ['Патч применён к копии', 'Компиляция', 'IO-тесты', 'JUnit'] as const;
  if (!result) {
    return [
      { name: names[0], detail: `фикс ${fixId}`, status: 'running' },
      { name: names[1], detail: 'javac · все файлы проекта', status: 'running' },
      { name: names[2], detail: 'stdout, exit code, исключения', status: 'running' },
      { name: names[3], detail: 'console launcher', status: 'running' },
    ];
  }
  const files = parseUnifiedDiff(result.diff).files.map((f) => f.split('/').pop() ?? f);
  const verify = result.verify;

  if (!verify) {
    if (result.applied) {
      // applied = патч применён и код скомпилирован (ТЗ §9); про тесты ответ ничего не говорит.
      return [
        { name: names[0], detail: files.join(', ') || `фикс ${fixId}`, status: 'ok' },
        { name: names[1], detail: 'код компилируется', status: 'ok' },
        { name: names[2], detail: NOT_DETAILED, status: 'unknown' },
        { name: names[3], detail: NOT_DETAILED, status: 'unknown' },
      ];
    }
    // Отклонено до тестов: на каком шаге — сервер не сообщил, причина показывается дословно в итоге.
    return names.map((name) => ({ name, detail: NOT_DETAILED, status: 'unknown' as const }));
  }

  const io = countLine(
    verify.results.filter((r) => r.type === 'io'),
    'IO-тестов нет',
  );
  const junit = countLine(
    verify.results.filter((r) => r.type === 'junit'),
    'JUnit-тестов нет',
  );
  const empty = verify.results.length === 0;
  const warn = verify.status === 'incomplete' || verify.status === 'blocked';
  const testStatus = (part: { failed: boolean }, none: boolean): StepStatus =>
    part.failed ? 'fail' : none ? 'skip' : warn ? 'warn' : 'ok';
  const ioNone = !verify.results.some((r) => r.type === 'io');
  const junitNone = !verify.results.some((r) => r.type === 'junit');
  return [
    { name: names[0], detail: files.join(', ') || `фикс ${fixId}`, status: 'ok' },
    { name: names[1], detail: 'код компилируется', status: 'ok' },
    {
      name: names[2],
      detail: ioNone && verify.status === 'blocked' ? verify.warnings?.join('; ') || io.text : io.text,
      status: ioNone && (verify.status === 'blocked' || empty) ? 'warn' : testStatus(io, ioNone),
    },
    { name: names[3], detail: junit.text, status: testStatus(junit, junitNone) },
  ];
}

/** «8 из 8 тестов проходят» по VerifyResult. */
export function passedSummary(verify: Schemas['VerifyResult'] | undefined): string {
  if (!verify || verify.results.length === 0) return 'тестов нет';
  const passed = verify.results.filter((r) => r.status === 'passed').length;
  return `${passed} из ${verify.results.length} тестов проходят`;
}
