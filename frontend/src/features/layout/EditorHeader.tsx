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
}

/** Шапка редактора. Запуск и проверка — заглушки до FE-13. */
export function EditorHeader({ projectName, version, entryPoint, onUpload, onExport }: EditorHeaderProps) {
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
      <button type="button" className={`${styles.btn} ${styles.btnOk}`} disabled title="Появится в FE-13">
        ▶ Запуск
      </button>
      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled title="Появится в FE-13">
        Проверить поведение
      </button>
    </header>
  );
}
