import type { ReactNode } from 'react';
import { useAppStore } from '../../app/store';
import { shortMethodName } from './methodName';
import styles from './layout.module.css';

interface CanvasSlotProps {
  /** Холст схемы (App: `SelectedMethodCanvas`). Без него — заглушка «Выберите метод…». */
  children?: ReactNode;
}

/** Рамка центральной панели: полоса с открытым методом + холст (слот). */
export function CanvasSlot({ children }: CanvasSlotProps) {
  const methodId = useAppStore((s) => s.selectedMethodId);

  return (
    <section className={styles.panel} aria-label="Схема метода">
      <div className={styles.tabBar}>
        <div className={styles.tabList}>
          {methodId ? (
            <span className={`${styles.tab} ${styles.tabOn}`} data-testid="canvas-method" title={methodId}>
              {shortMethodName(methodId)}
            </span>
          ) : (
            <span className={styles.muted}>Метод не выбран</span>
          )}
        </div>
      </div>
      <div className={styles.canvas}>
        {children ?? (
          <div className={styles.stub} data-testid="canvas-stub">
            {methodId ? `Схема ${shortMethodName(methodId)}` : 'Выберите метод в дереве проекта'}
          </div>
        )}
      </div>
    </section>
  );
}
