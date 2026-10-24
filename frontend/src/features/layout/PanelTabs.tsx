import { useId, useState, type ComponentType, type ReactNode } from 'react';
import styles from './layout.module.css';

export interface TabDef {
  id: string;
  title: string;
  component: ComponentType;
}

interface PanelTabsProps {
  /** Вкладки зоны из реестра (`panelsIn(area)`). */
  tabs: readonly TabDef[];
  /** Подпись панели, напр. «Анализ»; без неё — только полоса вкладок. */
  title?: string;
  /** Доп. содержимое справа от вкладок (статус синхронизации и т.п.). */
  extra?: ReactNode;
  initialTabId?: string;
  'aria-label'?: string;
}

/** Панель с вкладками: отрисовывает кнопки по списку и содержимое активной вкладки. */
export function PanelTabs({ tabs, title, extra, initialTabId, 'aria-label': ariaLabel }: PanelTabsProps) {
  const [activeId, setActiveId] = useState<string | undefined>(initialTabId);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const baseId = useId();
  const Active = active?.component;

  return (
    <section className={styles.panel} aria-label={ariaLabel ?? title}>
      {title && <div className={styles.panelHeader}>{title}</div>}
      <div className={styles.tabBar}>
        <div role="tablist" aria-label={ariaLabel ?? title} className={styles.tabList}>
          {tabs.map((t) => {
            const selected = t.id === active?.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${baseId}-${t.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                className={selected ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => setActiveId(t.id)}
              >
                {t.title}
              </button>
            );
          })}
        </div>
        {extra && <div className={styles.tabExtra}>{extra}</div>}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={active ? `${baseId}-${active.id}` : undefined}
        className={styles.panelBody}
      >
        {Active && <Active />}
      </div>
    </section>
  );
}
