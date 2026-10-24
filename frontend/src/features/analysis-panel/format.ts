import type { Schemas } from '../api';
import { shortMethodName } from '../layout';

type Issue = Schemas['Issue'];
type Severity = Schemas['Severity'];

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'высокая', medium: 'средняя', low: 'низкая' };

/** Сортировка по серьёзности (high → medium → low), затем по файлу и строке. Исходный массив не меняется. */
export function sortBySeverity(issues: readonly Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.span.file.localeCompare(b.span.file) ||
      a.span.startLine - b.span.startLine,
  );
}

/** Вкладка «Проблемы» — confidence high, «Предупреждения» — confidence low (контракт, Analysis.issues). */
export function splitIssues(issues: readonly Issue[]): { problems: Issue[]; warnings: Issue[] } {
  return {
    problems: sortBySeverity(issues.filter((i) => i.confidence === 'high')),
    warnings: sortBySeverity(issues.filter((i) => i.confidence === 'low')),
  };
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => (d === '-' ? '⁻' : (SUPERSCRIPT[Number(d)] ?? d)))
    .join('');
}

/**
 * Порядок числа операций из контракта (opsBefore/opsAfter): 100000000 → «≈10⁸», 20000 → «≈2·10⁴», 350 → «≈350».
 * Только форматирование готового числа, ничего не досчитывается.
 */
export function formatOps(ops: number): string {
  if (!Number.isFinite(ops) || ops < 0) return '—';
  if (ops < 1000) return `≈${Math.round(ops)}`;
  let exp = Math.floor(Math.log10(ops));
  let mantissa = Math.round(ops / 10 ** exp);
  if (mantissa >= 10) {
    mantissa = 1;
    exp += 1;
  }
  return mantissa === 1 ? `≈10${superscript(exp)}` : `≈${mantissa}·10${superscript(exp)}`;
}

/** «10000» → «10 000» для подписи n. */
export function formatInt(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Подпись единиц оценки: «операций при n = 10 000». */
export function opsUnit(n: number): string {
  return `операций при n = ${formatInt(n)}`;
}

/** Подпись под любой оценкой «≈ операций» (ТЗ §8.4, frontend/CLAUDE.md). */
export const ESTIMATE_NOTE = 'асимптотическая оценка, не замер';

/** «≈10⁸ → ≈10⁴ операций при n = 10 000» из готовых opsBefore/opsAfter и Analysis.n. */
export function formatOpsEstimate(opsBefore: number, opsAfter: number, n: number): string {
  return `${formatOps(opsBefore)} → ${formatOps(opsAfter)} ${opsUnit(n)}`;
}

/** Разбор поля n: целое ≥ 1, пробелы-разделители допускаются; иначе null. */
export function parseN(text: string): number | null {
  const clean = text.replace(/[\s_]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Имя файла без пути: «src/com/demo/OrderService.java» → «OrderService.java». */
export function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** «OrderService.merge:44» (или «OrderService.java:44», если methodId нет). */
export function issueLocation(issue: Issue): string {
  const where = issue.methodId ? shortMethodName(issue.methodId) : fileName(issue.span.file);
  return `${where}:${issue.span.startLine}`;
}

const RULE_TITLES: Record<string, string> = {
  DeadCode: 'Мёртвый код',
  DeepNesting: 'Глубокая вложенность',
  ExpensiveCallInLoop: 'Дорогой вызов в цикле',
  LinearSearchInLoop: 'Линейный поиск в цикле',
  LongMethod: 'Слишком длинный метод',
  NestedLoopSameCollection: 'Вложенный цикл по одной коллекции',
  StringConcatInLoop: 'Конкатенация строк в цикле',
  CyclicDependency: 'Циклическая зависимость классов',
};

/** Понятное название правила по id; неизвестный id (PMD и др.) — как есть. */
export function ruleTitle(rule: string): string {
  return RULE_TITLES[rule] ?? rule;
}

/** Русское склонение: plural(12, 'проблема', 'проблемы', 'проблем') → «проблем». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Строка-пояснение над списком вкладки: счётчик и чем вкладка отличается от соседней. */
export function issuesSummary(pick: 'problems' | 'warnings', issues: readonly Issue[]): string {
  if (pick === 'warnings') {
    return `${issues.length} ${plural(issues.length, 'предупреждение', 'предупреждения', 'предупреждений')} · низкая уверенность, без автоисправления`;
  }
  const fixable = issues.filter((i) => i.fixes.length > 0).length;
  return `${issues.length} ${plural(issues.length, 'проблема', 'проблемы', 'проблем')} · можно исправить автоматически: ${fixable}`;
}
