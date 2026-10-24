import { useId, type ReactNode } from 'react';
import { useAppStore } from '../../app/store';
import { shortMethodName } from './methodName';
import type { TabDef } from './PanelTabs';
import styles from './layout.module.css';

/** id встроенной вкладки «схема метода» в центральной зоне (`activePanels.canvas`). */
export const CANVAS_METHOD_TAB = 'canvas.method';

interface CanvasSlotProps {
  /** Холст схемы (App: `SelectedMethodCanvas`). Без него — заглушка «Выберите метод…». */
  children?: ReactNode;
  /** Доп. вкладки центральной зоны после схемы метода (реестр panels.ts, `area: 'canvas'`: UML, зависимости). */
  views?: readonly TabDef[];
  /** Активная вкладка (`CANVAS_METHOD_TAB` или id из `views`); нет / неизвестна — схема метода. */
  activeId?: string;
  onActiveChange?: (id: string) => void;
}

/** Рамка центральной панели: вкладки «схема метода» + диаграммы (`views`) и содержимое активной. */
export function CanvasSlot({ children, views = [], activeId, onActiveChange }: CanvasSlotProps) {
  const methodId = useAppStore((s) => s.selectedMethodId);
  const baseId = useId();
  const activeView = views.find((v) => v.id === activeId);
  const Active = activeView?.component;
  const methodOn = !activeView;

  const methodLabel = methodId ? shortMethodName(methodId) : 'Метод не выбран';

  return (
    <section className={styles.panel} aria-label="Схема метода">
      <div className={styles.tabBar}>
        <div className={styles.tabList} role={views.length ? 'tablist' : undefined} aria-label="Холст">
          {views.length === 0 ? (
            methodId ? (
              <span className={`${styles.tab} ${styles.tabOn}`} data-testid="canvas-method" title={methodId}>
                {methodLabel}
              </span>
            ) : (
              <span className={styles.muted}>{methodLabel}</span>
            )
          ) : (
            <>
              <button
                type="button"
                role="tab"
                id={`${baseId}-${CANVAS_METHOD_TAB}`}
                aria-selected={methodOn}
                className={methodOn ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                data-testid="canvas-method"
                title={methodId ?? undefined}
                onClick={() => onActiveChange?.(CANVAS_METHOD_TAB)}
              >
                {methodLabel}
              </button>
              {views.map((v) => {
                const on = v.id === activeView?.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    id={`${baseId}-${v.id}`}
                    aria-selected={on}
                    className={on ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                    onClick={() => onActiveChange?.(v.id)}
                  >
                    {v.title}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
      <div className={styles.canvas} role={views.length ? 'tabpanel' : undefined}>
        {Active ? (
          <Active />
        ) : (
          (children ?? (
            <div className={styles.stub} data-testid="canvas-stub">
              {methodId ? `Схема ${shortMethodName(methodId)}` : 'Выберите метод в дереве проекта'}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
