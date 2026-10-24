import { useId, useState, type ComponentType, type ReactNode } from 'react';
import { CollapseButton } from './CollapseButton';
import type { LayoutArea } from './layoutStore';
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
  /** Управляемый режим: активная вкладка задаётся снаружи (напр. store), клик сообщает `onActiveChange`. */
  activeId?: string;
  onActiveChange?: (id: string) => void;
  /** Зона каркаса: в шапке панели (без `title` — справа от вкладок) появляется кнопка «Свернуть». */
  collapseArea?: LayoutArea;
  'aria-label'?: string;
}

/** Панель с вкладками (длинные названия при нехватке места сжимаются с многоточием — остальные не трогаем): отрисовывает кнопки по списку и содержимое активной вкладки. */
export function PanelTabs({
  tabs,
  title,
  extra,
  initialTabId,
  activeId: controlledId,
  onActiveChange,
  collapseArea,
  'aria-label': ariaLabel,
}: PanelTabsProps) {
  const [localId, setLocalId] = useState<string | undefined>(initialTabId);
  const activeId = controlledId ?? localId;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const baseId = useId();
  const Active = active?.component;

  return (
    <section className={styles.panel} aria-label={ariaLabel ?? title}>
      {title && (
        <div className={styles.panelHeader}>
          {title}
          {collapseArea && <CollapseButton area={collapseArea} />}
        </div>
      )}
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
                className={[styles.tab, selected && styles.tabOn, t.title.length > 10 && styles.tabLong].filter(Boolean).join(' ')}
                title={t.title}
                onClick={() => {
                  setLocalId(t.id);
                  onActiveChange?.(t.id);
                }}
              >
                {t.title}
              </button>
            );
          })}
        </div>
        {(extra || (collapseArea && !title)) && (
          <div className={styles.tabExtra}>
            {extra}
            {collapseArea && !title && <CollapseButton area={collapseArea} />}
          </div>
        )}
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
