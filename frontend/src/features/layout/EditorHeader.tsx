import styles from './layout.module.css';

interface EditorHeaderProps {
  /** Название / id проекта. */
  projectName: string;
  version: number | null;
  /** Точка входа, напр. «Main.main»; null — main не найден. */
  entryPoint: string | null;
  /** «Загрузить проект»; без обработчика кнопка неактивна. */
  onUpload?: () => void;
  /** «Экспорт»; без обработчика кнопка неактивна. */
  onExport?: () => void;
  /** «▶ Запуск»; без обработчика кнопка неактивна. */
  onRun?: () => void;
  /** «Проверить поведение»; без обработчика кнопка неактивна. */
  onVerify?: () => void;
  /** Что выполняется в песочнице: кнопки запуска/проверки заблокированы, у активной — индикатор. */
  busy?: 'run' | 'verify' | 'fix' | null;
  /** Песочница недоступна (нет Docker, 503): кнопки неактивны, причина — в подсказке и рядом. */
  sandboxDisabledReason?: string | null;
  /** «Проверить снова» у плашки «Песочница недоступна» (повторный GET /health). */
  onSandboxRecheck?: () => void;
}

const BUSY_LABEL = { run: 'Запуск…', verify: 'Проверка…', fix: 'Quality Gate…' } as const;

/** Шапка редактора: проект и версия, загрузка/экспорт, запуск и проверка поведения. */
export function EditorHeader({
  projectName,
  version,
  entryPoint,
  onUpload,
  onExport,
  onRun,
  onVerify,
  busy = null,
  sandboxDisabledReason = null,
  onSandboxRecheck,
}: EditorHeaderProps) {
  const blocked = busy !== null || sandboxDisabledReason !== null;
  const title = sandboxDisabledReason ?? (busy ? `Выполняется: ${BUSY_LABEL[busy]}` : undefined);
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.logo} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0E13" strokeWidth="2.2">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
            <path d="M10 6.5h4a2.5 2.5 0 0 1 2.5 2.5v5" />
          </svg>
        </div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>Java Blueprints</span>
          <span className={styles.muted} data-testid="project-label">
            {projectName}
            {version !== null && ` · версия ${version}`}
          </span>
        </div>
      </div>
      <button type="button" className={styles.btn} disabled={!onUpload} onClick={onUpload}>
        Загрузить проект
      </button>
      <button type="button" className={styles.btn} disabled={!onExport} onClick={onExport} aria-haspopup="dialog">
        Экспорт ▾
      </button>
      <div className={styles.spacer} />
      {entryPoint && (
        <span className={styles.muted}>
          Точка входа: <span className={styles.mono}>{entryPoint}</span>
        </span>
      )}
      {sandboxDisabledReason && (
        <span className={styles.sandboxOff} role="status" title={sandboxDisabledReason}>
          Песочница недоступна
          {onSandboxRecheck && (
            <button type="button" className={styles.recheck} onClick={onSandboxRecheck}>
              Проверить снова
            </button>
          )}
        </span>
      )}
      {busy && (
        <span className={styles.busy} role="status">
          <span className={styles.spinner} aria-hidden="true" /> {BUSY_LABEL[busy]}
        </span>
      )}
      <button
        type="button"
        className={`${styles.btn} ${styles.btnOk}`}
        disabled={!onRun || blocked}
        title={title ?? 'Запустить программу в песочнице (stdin, выбор main)'}
        onClick={onRun}
        aria-haspopup="dialog"
      >
        ▶ Запуск
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={!onVerify || blocked}
        title={title ?? 'Прогнать все тесты: поведение совпадает с оригиналом?'}
        onClick={onVerify}
      >
        Проверить поведение
      </button>
    </header>
  );
}
