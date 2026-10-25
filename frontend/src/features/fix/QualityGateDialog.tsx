import { useEffect, useMemo } from 'react';
import { ESTIMATE_NOTE, fileName, formatOpsEstimate } from '../analysis-panel/format';
import { useAppStore } from '../../app/store';
import { gateSteps, parseUnifiedDiff, passedSummary, verdictOf, type GateStep } from './gate';
import { isFixRunning, useFixStore, type FixGate } from './fixStore';
import styles from './QualityGate.module.css';

const STEP_ICON: Record<GateStep['status'], string> = { running: '…', ok: '✓', fail: '✕', warn: '!', skip: '–', unknown: '?' };

/** Диалог Quality Gate (docs/design/screens/QualityGate.dc.html): diff фикса, шаги, итог. */
export function QualityGateDialog() {
  const gate = useFixStore((s) => s.gate);
  if (!gate) return null;
  return <GateBody gate={gate} />;
}

function GateBody({ gate }: { gate: FixGate }) {
  const close = useFixStore((s) => s.close);
  const showPanel = useAppStore((s) => s.showPanel);
  const running = isFixRunning(gate);
  const { issue, fixId, result, error } = gate;
  const diff = useMemo(() => parseUnifiedDiff(result?.diff), [result?.diff]);
  const steps = gateSteps(result, fixId);
  const verdict = verdictOf(result);
  const complexity = issue.complexity;
  const hasOps = complexity?.opsBefore !== undefined && complexity.opsAfter !== undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const toTests = () => {
    showPanel('bottom', 'bottom.tests');
    close();
  };

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="jb-gate-title"
        aria-busy={running}
        className={styles.dialog}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <span id="jb-gate-title" className={styles.title}>
              Фикс «{fixId}»
            </span>
            <span className={styles.muted}>
              {issue.rule} · {fileName(issue.span.file)}
            </span>
          </div>
          <button type="button" className={styles.btn} onClick={close} disabled={running}>
            Закрыть
          </button>
        </header>

        <div className={styles.columns}>
          <section className={styles.panel} aria-label="Изменения">
            <div className={styles.ph}>
              <span>{diff.files.length > 0 ? diff.files.map((f) => fileName(f)).join(', ') : fileName(issue.span.file)}</span>
              {diff.lines.length > 0 && (
                <span className={styles.counts}>
                  <span className={styles.countDel}>−{diff.removed}</span>
                  <span className={styles.countAdd}>+{diff.added}</span>
                </span>
              )}
            </div>
            <div className={styles.diff} data-testid="fix-diff">
              {diff.lines.length > 0 ? (
                diff.lines.map((l, i) => (
                  <span
                    key={i}
                    className={`${styles.dl} ${styles[l.kind] ?? ''}`}
                    data-kind={l.kind}
                    style={{ animationDelay: `${Math.min(i, 30) * 25}ms` }}
                  >
                    <span className={styles.ln}>{l.line ?? ''}</span>
                    <span className={styles.sg}>{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                    {l.text}
                  </span>
                ))
              ) : (
                <span className={styles.diffEmpty}>
                  {running
                    ? 'Применяем фикс к копии проекта…'
                    : result && !result.applied
                      ? 'Изменения откатаны — патч не сохранён.'
                      : 'Сервер не вернул diff.'}
                </span>
              )}
            </div>
            {(complexity?.before || hasOps) && (
              <div className={styles.metrics}>
                {complexity?.before && (
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Время</span>
                    <span className={styles.metricValue}>
                      <span className={styles.before}>{complexity.before}</span>
                      {complexity.after && (
                        <>
                          {' → '}
                          <span className={styles.after}>{complexity.after}</span>
                        </>
                      )}
                    </span>
                  </div>
                )}
                {hasOps && (
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Оценка</span>
                    <span className={styles.metricValue} data-testid="fix-ops">
                      {formatOpsEstimate(complexity.opsBefore ?? 0, complexity.opsAfter ?? 0, gate.n)}
                    </span>
                  </div>
                )}
              </div>
            )}
            {hasOps && <span className={styles.note}>{ESTIMATE_NOTE}. «Ускорение в X раз» — только после замера.</span>}
          </section>

          <section className={styles.panel} aria-label="Quality Gate">
            <div className={styles.ph}>
              <span>Quality Gate</span>
              <span className={styles.phNote}>компиляция + все тесты · сеть выключена</span>
            </div>
            <ol className={styles.steps}>
              {steps.map((st, i) => (
                <li
                  key={st.name}
                  className={styles.step}
                  data-status={st.status}
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <span className={styles.dot} aria-hidden="true">
                    {STEP_ICON[st.status]}
                  </span>
                  <div className={styles.stepBody}>
                    <span className={styles.stepName}>{st.name}</span>
                    <span className={styles.stepDetail}>{st.detail}</span>
                    <div className={styles.bar}>
                      <div />
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {running && (
              <div className={styles.progress} role="status">
                <span className={styles.spinner} aria-hidden="true" /> Quality Gate выполняется…
              </div>
            )}

            {error && (
              <div className={`${styles.verdict} ${styles.verdictBad} ${styles.shake}`} role="alert">
                <span className={styles.verdictTitle}>Фикс не применён</span>
                <span className={styles.verdictText}>{error}</span>
              </div>
            )}

            {verdict.kind === 'confirmed' && result && (
              <div className={`${styles.verdict} ${styles.verdictOk}`} role="status" data-testid="fix-verdict">
                <span className={styles.verdictHead}>
                  <span className={`${styles.bigDot} ${styles.bigDotOk}`}>✓</span>
                  <span className={styles.verdictTitle}>Исправление подтверждено</span>
                </span>
                <span className={styles.verdictText}>
                  Код компилируется, {passedSummary(result.verify)}, поведение совпадает с оригиналом. Изменения применены.
                </span>
                <div className={styles.actions}>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={close}>
                    Оставить и вернуться к схеме
                  </button>
                </div>
              </div>
            )}

            {verdict.kind === 'incomplete' && result && (
              <div className={`${styles.verdict} ${styles.verdictWarn}`} role="status" data-testid="fix-verdict">
                <span className={styles.verdictHead}>
                  <span className={`${styles.bigDot} ${styles.bigDotWarn}`}>!</span>
                  <span className={styles.verdictTitle}>Применено, проверка неполная</span>
                </span>
                <span className={styles.verdictText}>
                  <span data-testid="fix-reason">{verdict.reason}</span> Изменения применены.
                </span>
                <div className={styles.actions}>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={close}>
                    Вернуться к схеме
                  </button>
                  {result.verify && result.verify.results.length > 0 && (
                    <button type="button" className={styles.btn} onClick={toTests}>
                      Результаты тестов
                    </button>
                  )}
                </div>
              </div>
            )}

            {verdict.kind === 'rejected' && result && (
              <div
                className={`${styles.verdict} ${styles.verdictBad} ${styles.shake}`}
                role="alert"
                data-testid="fix-verdict"
              >
                <span className={styles.verdictHead}>
                  <span className={`${styles.bigDot} ${styles.bigDotBad}`}>✕</span>
                  <span className={styles.verdictTitle}>Исправление не подтверждено</span>
                </span>
                <span className={styles.verdictText}>
                  <span data-testid="fix-reason">{verdict.reason}</span> Изменения откатаны, код не изменён.
                </span>
                <div className={styles.actions}>
                  {result.verify && result.verify.results.length > 0 && (
                    <button type="button" className={styles.btn} onClick={toTests}>
                      Показать diff вывода
                    </button>
                  )}
                  <button type="button" className={styles.btn} onClick={close}>
                    К схеме
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
