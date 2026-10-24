import type { Schemas } from '../api';
import { ESTIMATE_NOTE, formatOpsEstimate, issueLocation, SEVERITY_LABEL } from './format';
import styles from './AnalysisPanel.module.css';

type Issue = Schemas['Issue'];

const BADGE_CLASS: Record<Schemas['Severity'], string | undefined> = {
  high: styles.badgeHigh,
  medium: styles.badgeMedium,
  low: styles.badgeLow,
};

/** Бейдж: серьёзность (high/medium/low) или «возможно» при confidence low. */
export function SeverityBadge({ issue }: { issue: Issue }) {
  if (issue.confidence === 'low') {
    return <span className={`${styles.badge} ${styles.badgeMaybe}`}>возможно</span>;
  }
  return (
    <span className={`${styles.badge} ${BADGE_CLASS[issue.severity] ?? ''}`} data-severity={issue.severity}>
      {SEVERITY_LABEL[issue.severity]}
    </span>
  );
}

interface IssueCardProps {
  issue: Issue;
  selected: boolean;
  onSelect: (issue: Issue) => void;
  /** Analysis.n — для какого n посчитаны opsBefore/opsAfter. */
  analysisN: number;
  /** «Применить» фикс из Issue.fixes (Quality Gate, FE-13); без обработчика фиксы — только список. */
  onApplyFix?: (issue: Issue, fixId: string) => void;
  /** Причина, по которой фиксы применить нельзя (нет Docker, идёт другой прогон); null — можно. */
  fixDisabledReason?: string | null;
}

/** Карточка проблемы/предупреждения: клик выбирает проблему, у каждого фикса — кнопка «Применить». */
export function IssueCard({ issue, selected, onSelect, analysisN, onApplyFix, fixDisabledReason = null }: IssueCardProps) {
  const { complexity, span } = issue;
  const hasOps = complexity?.opsBefore !== undefined && complexity.opsAfter !== undefined;
  const lines = span.startLine === span.endLine ? `${span.startLine}` : `${span.startLine}–${span.endLine}`;

  return (
    <div
      className={selected ? `${styles.issue} ${styles.issueOn}` : styles.issue}
      data-testid="issue"
      data-issue-id={issue.id}
    >
      <button type="button" className={styles.issueSelect} aria-pressed={selected} onClick={() => onSelect(issue)}>
        <span className={styles.issueHead}>
          <SeverityBadge issue={issue} />
          <span className={styles.rule}>{issue.rule}</span>
          {issue.source && issue.source !== 'blueprints' && <span className={styles.source}>{issue.source}</span>}
          <span className={styles.where} title={`${span.file}, строки ${lines}`}>
            {issueLocation(issue)}
          </span>
        </span>
        <span className={styles.message}>{issue.message}</span>
        {(complexity?.before || complexity?.after) && (
          <span className={styles.bigO}>
            {complexity.before}
            {complexity.before && complexity.after && <span className={styles.arrow}> → </span>}
            {complexity.after && <span className={styles.after}>{complexity.after}</span>}
          </span>
        )}
        {hasOps && (
          <span className={styles.note} data-testid="issue-ops">
            {formatOpsEstimate(complexity.opsBefore ?? 0, complexity.opsAfter ?? 0, analysisN)} · {ESTIMATE_NOTE}
          </span>
        )}
        {issue.recommendation && <span className={styles.note}>{issue.recommendation}</span>}
        {issue.fixes.length === 0 && issue.confidence === 'low' && (
          <span className={styles.note}>Низкая уверенность · без автоисправления</span>
        )}
      </button>
      {issue.fixes.length > 0 && (
        <div className={styles.fixes} role="group" aria-label="Доступные исправления">
          Исправления:
          {issue.fixes.map((f) =>
            onApplyFix ? (
              <button
                key={f}
                type="button"
                className={styles.fixApply}
                disabled={fixDisabledReason !== null}
                title={fixDisabledReason ?? `Применить фикс ${f}: Quality Gate — компиляция и все тесты, иначе откат`}
                onClick={() => onApplyFix(issue, f)}
              >
                <span className={styles.fix}>{f}</span>
                Применить
              </button>
            ) : (
              <span key={f} className={styles.fix}>
                {f}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
