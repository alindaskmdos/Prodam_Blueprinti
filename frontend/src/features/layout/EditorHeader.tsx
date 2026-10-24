import { AREA_TITLE, useLayoutStore, type LayoutArea } from './layoutStore';
import styles from './layout.module.css';

const TOGGLES: { area: LayoutArea; keys: string; fill: [number, number, number, number] }[] = [
  { area: 'left', keys: 'Ctrl+B', fill: [3, 4, 5, 16] },
  { area: 'bottom', keys: 'Ctrl+J', fill: [8, 14, 8, 6] },
  { area: 'right', keys: 'Ctrl+Alt+B', fill: [16, 4, 5, 16] },
];

/** Кнопки показа/скрытия панелей в шапке (подсвечены, когда панель открыта) + «Только схема». */
function PanelToggles() {
  const collapsed = useLayoutStore((s) => s.collapsed);
  const toggle = useLayoutStore((s) => s.toggle);
  const canvasOnly = useLayoutStore((s) => s.stash !== null);
  const toggleCanvasOnly = useLayoutStore((s) => s.toggleCanvasOnly);
  return (
    <div className={styles.toggles} role="group" aria-label="Панели">
      {TOGGLES.map(({ area, keys, fill: [x, y, w, h] }) => {
        const on = !collapsed[area];
        return (
          <button
            key={area}
            type="button"
            className={on ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
            aria-pressed={on}
            aria-label={`Панель: ${AREA_TITLE[area]}`}
            title={`${on ? 'Свернуть' : 'Показать'}: ${AREA_TITLE[area]} (${keys})`}
            onClick={() => toggle(area)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <rect x={x} y={y} width={w} height={h} fill={on ? 'currentColor' : 'none'} stroke="none" />
            </svg>
          </button>
        );
      })}
      <button
        type="button"
        className={canvasOnly ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
        aria-pressed={canvasOnly}
        aria-label="Только схема"
        title="Только схема: свернуть все панели / вернуть (Ctrl+\)"
        onClick={toggleCanvasOnly}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      </button>
    </div>
  );
}

interface EditorHeaderProps {
  /** Название проекта (имя загруженной папки/архива) или id, если имя неизвестно. */
  projectName: string;
  /** id проекта: показывается в подсказке, если projectName — имя. */
  projectId?: string;
  /** Версия проекта: в шапке не показывается, только в data-version (для e2e). */
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

/** Шапка редактора: проект, загрузка/экспорт, запуск и проверка поведения. */
export function EditorHeader({
  projectName,
  projectId,
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
          <span
            className={styles.muted}
            data-testid="project-label"
            data-version={version ?? undefined}
            title={projectId ? `id: ${projectId}` : undefined}
          >
            {projectName}
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
      <PanelToggles />
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
