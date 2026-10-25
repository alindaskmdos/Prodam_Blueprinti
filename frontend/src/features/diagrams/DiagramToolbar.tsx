import type { ReactNode } from 'react';
import styles from './Diagrams.module.css';

interface ToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  /** Enter в поиске — показать первый найденный. */
  onEnter: () => void;
  /** Сколько найдено; null — поиск пуст. */
  found: number | null;
  onFit: () => void;
  /** Мини-карта показана; кнопка «Карта» скрывает её (она закрывает угол диаграммы). */
  minimap: boolean;
  onMinimap: () => void;
  placeholder: string;
  /** Ошибка перезагрузки при показанной старой диаграмме. */
  stale?: string | null;
  /** Дополнительные кнопки после «Карта» (UML: «Развернуть все»). */
  children?: ReactNode;
}

/** Панель диаграммы: поиск класса, число совпадений, Fit View, мини-карта. */
export function DiagramToolbar({ query, onQuery, onEnter, found, onFit, minimap, onMinimap, placeholder, stale, children }: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={`${styles.search} nodrag`}
        value={query}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter();
          if (e.key === 'Escape') onQuery('');
        }}
      />
      {found !== null && (
        <span className={found ? styles.found : `${styles.found} ${styles.notFound}`} aria-live="polite">
          {found ? `найдено: ${found}` : 'не найдено'}
        </span>
      )}
      <button type="button" className={styles.toolButton} onClick={onFit} title="Показать всю диаграмму">
        Fit View
      </button>
      <button type="button" className={styles.toolButton} aria-pressed={minimap} onClick={onMinimap} title="Показать или скрыть мини-карту">
        Карта
      </button>
      {children}
      {stale && (
        <span className={styles.stale} title={stale}>
          устаревшие данные
        </span>
      )}
    </div>
  );
}
