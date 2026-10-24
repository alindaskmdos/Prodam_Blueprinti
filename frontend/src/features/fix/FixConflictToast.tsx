import { useFixStore } from './fixStore';
import styles from './QualityGate.module.css';

/** Тост 409 при применении фикса: проект изменён, фикс не применён, состояние перезагружено. */
export function FixConflictToast() {
  const conflict = useFixStore((s) => s.conflict);
  const dismiss = useFixStore((s) => s.dismissConflict);
  if (!conflict) return null;
  return (
    <div key={conflict.seq} className={styles.toast} role="alert" data-testid="fix-conflict">
      <span className={styles.toastIcon} aria-hidden="true">
        !
      </span>
      <div className={styles.toastBody}>
        <span className={styles.toastTitle}>Проект изменён</span>
        <span className={styles.toastText}>{conflict.message}</span>
      </div>
      <button type="button" className={styles.toastClose} aria-label="Закрыть" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
