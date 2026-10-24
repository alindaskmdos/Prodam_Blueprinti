import type { Schemas } from '../api';
import { diffLines, firstDiffLine, formatDuration, isKnownStatus, statusText, type AggregateStatus, type DiffRow } from './results';
import styles from './TestsPanel.module.css';

type TestResult = Schemas['TestResult'];
type TestStatus = Schemas['TestStatus'];

const STATUS_ICON: Record<TestStatus, string> = {
  passed: '✓',
  failed: '✕',
  compile_error: '!',
  original_fails: '≠',
};

/** Кружок статуса теста; null — тест ещё не запускался; статус вне контракта — нейтральный «?». */
export function StatusDot({ status }: { status: AggregateStatus | string | null }) {
  if (status === null) {
    return (
      <span className={styles.dot} data-status="none" title="не запускался">
        –
      </span>
    );
  }
  const known = isKnownStatus(status);
  return (
    <span className={styles.dot} data-status={known ? status : 'unknown'} title={statusText(status)}>
      {known ? STATUS_ICON[status] : '?'}
    </span>
  );
}

function DiffSide({ rows, side }: { rows: readonly DiffRow[]; side: 'expected' | 'actual' }) {
  return (
    <div className={styles.diffSide} data-side={side}>
      <span className={styles.diffTitle}>{side === 'expected' ? 'Ожидалось' : 'Получено'}</span>
      {rows.map((r) => {
        const text = side === 'expected' ? r.expected : r.actual;
        const cls =
          r.kind === 'noisy' || r.kind === 'ignored'
            ? styles.lineNoise
            : r.kind === 'diff'
              ? side === 'expected'
                ? styles.lineGood
                : styles.lineBad
              : '';
        return (
          <span
            key={r.line}
            className={`${styles.line} ${cls}`}
            data-kind={r.kind}
            title={r.kind === 'noisy' ? 'шумная строка — не сравнивается' : r.kind === 'ignored' ? 'игнорируется' : undefined}
          >
            <span className={styles.lineNo}>{r.line}</span>
            {text ?? ''}
          </span>
        );
      })}
    </div>
  );
}

export interface OutputDiffProps {
  expected?: string | null;
  actual?: string | null;
  noisyLines?: readonly number[];
  ignoreLines?: readonly number[];
}

/** Построчный diff stdout: ожидаемое слева, полученное справа; шумные и игнорируемые строки — серым. */
export function OutputDiff({ expected, actual, noisyLines = [], ignoreLines = [] }: OutputDiffProps) {
  const rows = diffLines(expected, actual, noisyLines, ignoreLines);
  const first = firstDiffLine(rows);
  // Все строки равны, а текст нет — разница в завершающем переводе строки (шумные строки не в счёт).
  const invisible = rows.every((r) => r.kind === 'same') && (expected ?? '') !== (actual ?? '');
  return (
    <div className={styles.diff} aria-label="Сравнение вывода">
      <div className={styles.diffHead}>
        stdout{' '}
        {first !== null ? (
          <span className={styles.diffBad}>отличается со строки {first}</span>
        ) : invisible ? (
          <span className={styles.diffBad}>отличается в пробелах или переводах строк</span>
        ) : (
          <span className={styles.diffOk}>совпадает</span>
        )}
      </div>
      <div className={styles.diffGrid}>
        <DiffSide rows={rows} side="expected" />
        <DiffSide rows={rows} side="actual" />
      </div>
      {(noisyLines.length > 0 || ignoreLines.length > 0) && (
        <div className={styles.diffNote}>
          <span className={styles.noiseSample}>серые</span> — шумные строки (отличались между двумя прогонами
          оригинала) и игнорируемые; не сравниваются
        </div>
      )}
    </div>
  );
}

/** Один результат: статус, время, пояснение/ошибка, diff вывода. */
export function TestResultView({ result, ignoreLines }: { result: TestResult; ignoreLines?: readonly number[] }) {
  const hasOutput = result.expected !== undefined || result.actual !== undefined;
  const noisy = result.noisyLines ?? [];
  return (
    <div className={styles.result} data-status={result.status}>
      <div className={styles.resultHead}>
        <StatusDot status={result.status} />
        <span className={styles.resultName}>{result.name}</span>
        <span className={styles.resultStatus} data-status={result.status}>
          {statusText(result.status)}
        </span>
        <span className={styles.muted}>{formatDuration(result.durationMs)}</span>
      </div>
      {result.error && (
        // У пройденного теста error — пояснение (напр. пропущенный @Disabled), показываем нейтрально.
        <pre className={result.status === 'passed' ? styles.note : styles.errorText} data-testid="result-error">
          {result.error}
        </pre>
      )}
      {hasOutput && (
        <OutputDiff expected={result.expected} actual={result.actual} noisyLines={noisy} ignoreLines={ignoreLines} />
      )}
      {!hasOutput && noisy.length > 0 && (
        <div className={styles.note}>
          Оригинал запущен дважды: строк{noisy.length === 1 ? 'а' : 'и'} {noisy.join(', ')} отличались — помечены
          шумными и не сравниваются.
        </div>
      )}
    </div>
  );
}

const VERIFY_TITLE: Record<string, string> = {
  green: 'Поведение совпадает',
  red: 'Поведение отличается',
  incomplete: 'Программа недетерминирована, проверка неполная',
  blocked: 'Добавьте тест со входными данными',
};

export interface VerifySummaryProps {
  verify: Schemas['VerifyResult'];
  /** Результаты получены на другой версии проекта. */
  staleVersion?: number | null;
  /** «Создать заготовку» при status=blocked. */
  onCreateStub?: () => void;
}

/** Плашка итога проверки поведения: статус, счётчики, полоса, предупреждения. */
export function VerifySummary({ verify, staleVersion, onCreateStub }: VerifySummaryProps) {
  const total = verify.results.length;
  const passed = verify.results.filter((r) => r.status === 'passed').length;
  const broken = verify.results.filter((r) => r.status === 'failed' || r.status === 'compile_error').length;
  const known = Object.prototype.hasOwnProperty.call(VERIFY_TITLE, verify.status);
  const title = !known
    ? `Статус проверки неизвестен (${String(verify.status)})`
    : verify.status === 'red' && total > 0
      ? `${VERIFY_TITLE.red} — ${broken} из ${total} тестов`
      : VERIFY_TITLE[verify.status];
  return (
    <div className={styles.verify} data-status={known ? verify.status : 'unknown'} role="status">
      <span className={styles.verifyIcon} aria-hidden="true">
        {verify.status === 'green' ? '✓' : verify.status === 'red' ? '✕' : known ? '!' : '?'}
      </span>
      <div className={styles.verifyBody}>
        <span className={styles.verifyTitle}>{title}</span>
        {verify.status === 'blocked' && (
          <span className={styles.verifyText}>
            Программа читает System.in — зелёный статус возможен только с тестами со входными данными.
          </span>
        )}
        {verify.warnings?.map((w) => (
          <span key={w} className={styles.verifyText}>
            {w}
          </span>
        ))}
        {staleVersion != null && (
          <span className={styles.verifyText}>Результаты получены на версии {staleVersion}, проект с тех пор изменён.</span>
        )}
      </div>
      {total > 0 && (
        <div className={styles.verifyBar} aria-label={`${passed} пройдено из ${total}`}>
          <div className={styles.verifyCounts}>
            <span>{passed} пройдено</span>
            {broken > 0 && <span>{broken} не пройдено</span>}
          </div>
          <div className={styles.bar}>
            <div className={styles.barOk} style={{ width: `${(passed / total) * 100}%` }} />
            <div className={styles.barBad} style={{ width: `${(broken / total) * 100}%` }} />
          </div>
        </div>
      )}
      {verify.status === 'blocked' && onCreateStub && (
        <button type="button" className={styles.btn} onClick={onCreateStub}>
          Создать заготовку
        </button>
      )}
    </div>
  );
}

/** Результат запуска программы: exit code, время, stdout/stderr, ошибки компиляции. */
export function RunOutput({ run }: { run: Schemas['RunResult'] }) {
  return (
    <div className={styles.result} aria-label="Результат запуска">
      <div className={styles.resultHead}>
        <span className={styles.resultName}>Запуск</span>
        <span className={styles.muted}>
          exit code {run.exitCode} · {formatDuration(run.durationMs)}
        </span>
        {run.timedOut && <span className={styles.errorInline}>превышен таймаут</span>}
      </div>
      {run.compileErrors && run.compileErrors.length > 0 && (
        <ul className={styles.compileErrors}>
          {run.compileErrors.map((c) => (
            <li key={`${c.file}:${c.line}:${c.message}`}>
              {c.file}:{c.line} — {c.message}
            </li>
          ))}
        </ul>
      )}
      <span className={styles.label}>stdout</span>
      <pre className={styles.output}>{run.stdout || '(пусто)'}</pre>
      {run.stderr && (
        <>
          <span className={styles.label}>stderr</span>
          <pre className={`${styles.output} ${styles.stderr}`}>{run.stderr}</pre>
        </>
      )}
    </div>
  );
}
