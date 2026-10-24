import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
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
 * и запоминаются в localStorage (autoSaveId).
 */
export function EditorLayout({ header, left, canvas, right, bottom }: EditorLayoutProps) {
  return (
    <div className={styles.root}>
      {header}
      <PanelGroup direction="horizontal" autoSaveId="jb-editor-columns" className={styles.columns}>
        <Panel id="left" order={1} defaultSize={18} minSize={12} className={styles.column}>
          {left}
        </Panel>
        <PanelResizeHandle className={styles.handleV} aria-label="Ширина дерева проекта" />
        <Panel id="center" order={2} defaultSize={58} minSize={30} className={styles.column}>
          <PanelGroup direction="vertical" autoSaveId="jb-editor-center" className={styles.rows}>
            <Panel id="canvas" order={1} defaultSize={66} minSize={20} className={styles.column}>
              {canvas}
            </Panel>
            <PanelResizeHandle className={styles.handleH} aria-label="Высота нижней панели" />
            <Panel id="bottom" order={2} defaultSize={34} minSize={12} className={styles.column}>
              {bottom}
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle className={styles.handleV} aria-label="Ширина панели анализа" />
        <Panel id="right" order={3} defaultSize={24} minSize={15} className={styles.column}>
          {right}
        </Panel>
      </PanelGroup>
    </div>
  );
}
