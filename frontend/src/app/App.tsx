import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type ApiClient, type Schemas } from '../features/api';
import { CanvasSlot, EditorHeader, EditorLayout, PanelTabs } from '../features/layout';
import { ProjectTree } from '../features/project-tree';
import { ExportDialog, UploadScreen, useUploadUi, type SaveFile } from '../features/upload';
import { runCommand } from './commands';
import { panels as defaultPanels, panelsIn, type PanelDef } from './panels';
import { useAppStore } from './store';

interface AppProps {
  client?: ApiClient;
  /** Открыть этот проект сразу (без экрана загрузки). Иначе — экран загрузки, пока в store нет projectId. */
  projectId?: string;
  /** Холст схемы метода (FE-03); без него — заглушка. */
  canvas?: ReactNode;
  /** Реестр вкладок (по умолчанию `panels.ts`). */
  panels?: readonly PanelDef[];
  /** Сохранение экспортированного файла (тесты). */
  saveFile?: SaveFile;
}

/** Экран загрузки (нет проекта или команда project.upload) либо экран редактора. */
export function App({ client = api, projectId: initialProjectId, canvas, panels = defaultPanels, saveFile }: AppProps) {
  const openProject = useAppStore((s) => s.openProject);
  const storeProjectId = useAppStore((s) => s.projectId);
  const uploadOpen = useUploadUi((s) => s.uploadOpen);
  const closeUpload = useUploadUi((s) => s.closeUpload);

  useEffect(() => {
    if (initialProjectId) openProject(initialProjectId);
  }, [openProject, initialProjectId]);

  const onLoaded = useCallback(
    (project: Schemas['Project']) => {
      openProject(project.id, project.version);
      closeUpload();
    },
    [openProject, closeUpload],
  );

  const projectId = storeProjectId ?? initialProjectId ?? null;

  if (!projectId || uploadOpen) {
    return <UploadScreen client={client} onOpen={onLoaded} onCancel={projectId ? closeUpload : undefined} />;
  }

  return <EditorScreen client={client} projectId={projectId} canvas={canvas} panels={panels} saveFile={saveFile} />;
}

interface EditorScreenProps {
  client: ApiClient;
  projectId: string;
  canvas?: ReactNode;
  panels: readonly PanelDef[];
  saveFile?: SaveFile;
}

/** Экран редактора: шапка, дерево проекта, холст, панель анализа, нижняя панель; диалог экспорта поверх. */
function EditorScreen({ client, projectId, canvas, panels, saveFile }: EditorScreenProps) {
  const version = useAppStore((s) => s.version);
  const exportOpen = useUploadUi((s) => s.exportOpen);
  const closeExport = useUploadUi((s) => s.closeExport);
  const entryPoint = useEntryPoint(client, projectId);

  return (
    <>
      <EditorLayout
        header={
          <EditorHeader
            projectName={projectId}
            version={version}
            entryPoint={entryPoint}
            onUpload={() => runCommand('project.upload')}
            onExport={() => runCommand('project.export')}
          />
        }
        left={<ProjectTree client={client} projectId={projectId} />}
        canvas={<CanvasSlot>{canvas}</CanvasSlot>}
        right={<PanelTabs title="Анализ" tabs={panelsIn('right', panels)} />}
        bottom={<PanelTabs aria-label="Код, консоль, тесты" tabs={panelsIn('bottom', panels)} />}
      />
      {exportOpen && (
        <ExportDialog client={client} projectId={projectId} version={version} onClose={closeExport} save={saveFile} />
      )}
    </>
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
