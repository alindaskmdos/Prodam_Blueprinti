import { useEffect, useState, type ReactNode } from 'react';
import { api, type ApiClient } from '../features/api';
import { CanvasSlot, EditorHeader, EditorLayout, PanelTabs } from '../features/layout';
import { ProjectTree } from '../features/project-tree';
import { panels as defaultPanels, panelsIn, type PanelDef } from './panels';
import { useAppStore } from './store';

/** Проект по умолчанию до экрана загрузки (id из contract/fixtures/project.json). */
const DEMO_PROJECT_ID = 'p-1';

interface AppProps {
  client?: ApiClient;
  projectId?: string;
  /** Холст схемы метода (FE-03); без него — заглушка. */
  canvas?: ReactNode;
  /** Реестр вкладок (по умолчанию `panels.ts`). */
  panels?: readonly PanelDef[];
}

/** Экран редактора: шапка, дерево проекта, холст, панель анализа, нижняя панель. */
export function App({ client = api, projectId = DEMO_PROJECT_ID, canvas, panels = defaultPanels }: AppProps) {
  const openProject = useAppStore((s) => s.openProject);
  const version = useAppStore((s) => s.version);
  const entryPoint = useEntryPoint(client, projectId);

  useEffect(() => {
    openProject(projectId);
  }, [openProject, projectId]);

  return (
    <EditorLayout
      header={<EditorHeader projectName={projectId} version={version} entryPoint={entryPoint} />}
      left={<ProjectTree client={client} projectId={projectId} />}
      canvas={<CanvasSlot>{canvas}</CanvasSlot>}
      right={<PanelTabs title="Анализ" tabs={panelsIn('right', panels)} />}
      bottom={<PanelTabs aria-label="Код, консоль, тесты" tabs={panelsIn('bottom', panels)} />}
    />
  );
}

/** Точка входа для шапки: первый класс с main из GET /projects/{id} → «Main.main». */
function useEntryPoint(client: ApiClient, projectId: string): string | null {
  const [entry, setEntry] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntry(null);
    client
      .GET('/projects/{projectId}', { params: { path: { projectId } } })
      .then(({ data }) => {
        const main = data?.mainClasses?.[0];
        if (!cancelled && main) setEntry(`${main.split('.').pop() ?? main}.main`);
      })
      .catch(() => {
        // Шапка без точки входа — не ошибка экрана.
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  return entry;
}
