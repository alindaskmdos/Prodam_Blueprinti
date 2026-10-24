import { useSandboxStore } from './sandboxStore';
import styles from './Sandbox.module.css';

/** Тост ошибок запуска/проверки (503, 422, сеть). При недоступной песочнице — «Проверить снова» (GET /health). */
export function SandboxNotice() {
  const notice = useSandboxStore((s) => s.notice);
  const unavailable = useSandboxStore((s) => s.unavailable);
  const dismiss = useSandboxStore((s) => s.dismissNotice);
  const checkHealth = useSandboxStore((s) => s.checkHealth);
  if (!notice) return null;
  return (
    <div key={notice.seq} className={styles.toast} role="alert" data-kind={notice.kind}>
      <span className={styles.toastIcon} aria-hidden="true">
        !
      </span>
      <div className={styles.toastBody}>
        <span className={styles.toastTitle}>{notice.title}</span>
        <span className={styles.toastText}>{notice.text}</span>
        {unavailable && (
          <div className={styles.toastActions}>
            <button type="button" className={styles.btn} onClick={() => void checkHealth()}>
              Проверить снова
            </button>
          </div>
        )}
      </div>
      <button type="button" className={styles.toastClose} aria-label="Закрыть" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
