import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { CollapseButton } from './CollapseButton';
import { AREA_TITLE, useLayoutStore, type LayoutArea } from './layoutStore';
import styles from './layout.module.css';

interface EditorLayoutProps {
  header: ReactNode;
  /** Слева: дерево проекта (и палитра блоков — позже). */
  left: ReactNode;
  /** Центр: холст схемы метода. */
  canvas: ReactNode;
  /** Справа: панель анализа (вкладки из реестра). */
  right: ReactNode;
  /** Снизу под холстом: код / консоль / тесты (вкладки из реестра). */
  bottom: ReactNode;
}

/**
 * Каркас экрана редактора (docs/design/screens/Editor.dc.html): шапка и три колонки,
 * центр делится на холст и нижнюю панель. Размеры меняются перетаскиванием разделителей
 * и запоминаются в localStorage (autoSaveId). Левую, правую и нижнюю панели можно свернуть
 * в узкую полосу (`useLayoutStore`), клик по полосе разворачивает.
 */
export function EditorLayout({ header, left, canvas, right, bottom }: EditorLayoutProps) {
  const collapsed = useLayoutStore((s) => s.collapsed);
  const setCollapsed = useLayoutStore((s) => s.setCollapsed);
  const refs: Record<LayoutArea, RefObject<ImperativePanelHandle>> = {
    left: useRef<ImperativePanelHandle>(null),
    right: useRef<ImperativePanelHandle>(null),
    bottom: useRef<ImperativePanelHandle>(null),
  };
  const prev = useRef(collapsed);

  // store → панели (кнопки, горячие клавиши, showPanel): трогаем только изменившиеся области.
  // Обратно: onCollapse/onExpand (перетаскивание, состояние из autoSaveId).
  useEffect(() => {
    for (const area of ['left', 'right', 'bottom'] as const) {
      if (prev.current[area] === collapsed[area]) continue;
      if (collapsed[area]) refs[area].current?.collapse();
      else refs[area].current?.expand();
    }
    prev.current = collapsed;
    // refs — стабильные объекты ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  const slot = (area: LayoutArea, content: ReactNode, orientation: 'v' | 'h') => (
    <>
      <div className={collapsed[area] ? styles.hidden : styles.slot}>
        {content}
        {area === 'left' && <CollapseButton area="left" className={styles.leftCollapse} />}
      </div>
      {collapsed[area] && (
        <button
          type="button"
          className={orientation === 'v' ? styles.rail : `${styles.rail} ${styles.railH}`}
          aria-label={`Развернуть панель: ${AREA_TITLE[area]}`}
          title={`Развернуть: ${AREA_TITLE[area]}`}
          onClick={() => setCollapsed(area, false)}
        >
          <span aria-hidden="true">{area === 'left' ? '›' : area === 'right' ? '‹' : '▴'}</span>
          <span className={orientation === 'v' ? styles.railText : undefined}>{AREA_TITLE[area]}</span>
        </button>
      )}
    </>
  );

  return (
    <div className={styles.root}>
      {header}
      <PanelGroup direction="horizontal" autoSaveId="jb-editor-columns" className={styles.columns}>
        <Panel
          id="left"
          order={1}
          ref={refs.left}
          defaultSize={18}
          minSize={12}
          collapsible
          collapsedSize={3.5}
          onCollapse={() => setCollapsed('left', true)}
          onExpand={() => setCollapsed('left', false)}
          className={styles.column}
        >
          {slot('left', left, 'v')}
        </Panel>
        <PanelResizeHandle className={styles.handleV} aria-label="Ширина дерева проекта" />
        <Panel id="center" order={2} defaultSize={58} minSize={30} className={styles.column}>
          <PanelGroup direction="vertical" autoSaveId="jb-editor-center" className={styles.rows}>
            <Panel id="canvas" order={1} defaultSize={66} minSize={20} className={styles.column}>
              {canvas}
            </Panel>
            <PanelResizeHandle className={styles.handleH} aria-label="Высота нижней панели" />
            <Panel
              id="bottom"
              order={2}
              ref={refs.bottom}
              defaultSize={34}
              minSize={12}
              collapsible
              collapsedSize={5}
              onCollapse={() => setCollapsed('bottom', true)}
              onExpand={() => setCollapsed('bottom', false)}
              className={styles.column}
            >
              {slot('bottom', bottom, 'h')}
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className={styles.handleV} aria-label="Ширина панели анализа" />
        <Panel
          id="right"
          order={3}
          ref={refs.right}
          defaultSize={24}
          minSize={15}
          collapsible
          collapsedSize={3.5}
          onCollapse={() => setCollapsed('right', true)}
          onExpand={() => setCollapsed('right', false)}
          className={styles.column}
        >
          {slot('right', right, 'v')}
        </Panel>
      </PanelGroup>
    </div>
  );
}
