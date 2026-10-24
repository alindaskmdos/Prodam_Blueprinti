import { useState, type FormEvent } from 'react';
import type { Schemas } from '../api';
import { shortMethodName } from '../layout';
import { useAnalysisStore } from './analysisStore';
import { ESTIMATE_NOTE, formatInt, formatOps, opsUnit, parseN } from './format';
import styles from './AnalysisPanel.module.css';

interface OpsEstimateProps {
  /** Проблема, для которой показать оценку (выбранная или первая с opsBefore/opsAfter). */
  issue: Schemas['Issue'] | undefined;
  /** Analysis.n — для какого n бэк посчитал opsBefore/opsAfter. */
  analysisN: number;
}

/**
 * Карточка «≈10⁸ → ≈10⁴ операций при n = …» (ТЗ §8.4). Числа — готовые opsBefore/opsAfter из контракта;
 * смена n — новый запрос GET analysis?n=…. Это асимптотическая оценка, не замер.
 */
export function OpsEstimate({ issue, analysisN }: OpsEstimateProps) {
  const n = useAnalysisStore((s) => s.n);
  const setN = useAnalysisStore((s) => s.setN);
  const [draft, setDraft] = useState(() => formatInt(n));
  const parsed = parseN(draft);

  const commit = () => {
    if (parsed === null) return;
    setDraft(formatInt(parsed));
    if (parsed !== n) setN(parsed);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    commit();
  };

  const c = issue?.complexity;
  const hasOps = c?.opsBefore !== undefined && c.opsAfter !== undefined;
  const title = issue?.methodId ? `Сложность ${shortMethodName(issue.methodId).split('.').pop() ?? ''}` : 'Сложность';

  return (
    <section className={styles.estimate} aria-label="Оценка числа операций" data-testid="ops-estimate">
      <span className={styles.estimateTitle}>{title}</span>
      {hasOps ? (
        <div className={styles.ops} data-testid="ops">
          <span className={styles.opsBefore}>{formatOps(c.opsBefore ?? 0)}</span>{' '}
          <span className={styles.arrow}>→</span> <span className={styles.after}>{formatOps(c.opsAfter ?? 0)}</span>{' '}
          <span className={styles.opsUnit}>{opsUnit(analysisN)}</span>
        </div>
      ) : (
        <span className={styles.note}>Для этих проблем нет оценки числа операций</span>
      )}
      <form className={styles.nForm} onSubmit={onSubmit}>
        <label className={styles.nForm}>
          при n =
          <input
            className={styles.nInput}
            type="text"
            inputMode="numeric"
            aria-label="n"
            aria-invalid={parsed === null}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        </label>
        {parsed === null && <span className={styles.stateError}>целое число ≥ 1</span>}
      </form>
      <span className={styles.note}>{ESTIMATE_NOTE}</span>
    </section>
  );
}
