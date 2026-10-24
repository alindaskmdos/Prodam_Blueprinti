import { AREA_TITLE, useLayoutStore, type LayoutArea } from './layoutStore';
import styles from './layout.module.css';

const ICON: Record<LayoutArea, string> = { left: '‹', right: '›', bottom: '▾' };
const KEYS: Record<LayoutArea, string> = { left: 'Ctrl+B', right: 'Ctrl+Alt+B', bottom: 'Ctrl+J' };

/** Кнопка «Свернуть» в шапке панели; свёрнутую панель разворачивает полоса (EditorLayout). */
export function CollapseButton({ area, className }: { area: LayoutArea; className?: string }) {
  const setCollapsed = useLayoutStore((s) => s.setCollapsed);
  return (
    <button
      type="button"
      className={className ? `${styles.collapseBtn} ${className}` : styles.collapseBtn}
      aria-label={`Свернуть панель: ${AREA_TITLE[area]}`}
      title={`Свернуть (${KEYS[area]})`}
      onClick={() => setCollapsed(area, true)}
    >
      <span aria-hidden="true">{ICON[area]}</span>
    </button>
  );
}
