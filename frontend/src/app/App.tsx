import { useCallback, useEffect, type ReactNode } from 'react';
import { api, type ApiClient, type Schemas } from '../features/api';
import { FixConflictToast, isFixRunning, QualityGateDialog, useFixStore } from '../features/fix';
import { CommandPalette } from '../features/command-palette';
import { CanvasSlot, EditorHeader, EditorLayout, PanelTabs } from '../features/layout';
import { ProjectTree } from '../features/project-tree';
import { RunDialog, SandboxNotice, sandboxDisabledReason, useSandbox, useSandboxStore } from '../features/sandbox';
import { ExportDialog, UploadScreen, useUploadUi, type SaveFile } from '../features/upload';
import { commands, runCommand } from './commands';
import { SelectedMethodCanvas } from './methodViews';
import { panels as defaultPanels, panelsIn, type PanelDef } from './panels';
import { useAppStore } from './store';

interface AppProps {
  client?: ApiClient;
  /** Открыть этот проект сразу (без экрана загрузки). Иначе — экран загрузки, пока в store нет projectId. */
  projectId?: string;
  /** Подменить холст (тесты); по умолчанию — схема выбранного метода (`SelectedMethodCanvas`). */
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
  const methodId = useAppStore((s) => s.selectedMethodId);
  const exportOpen = useUploadUi((s) => s.exportOpen);
  const closeExport = useUploadUi((s) => s.closeExport);
  const showPanel = useAppStore((s) => s.showPanel);
  const bottomTab = useAppStore((s) => s.activePanels.bottom);
  useSandbox(client, projectId);
  const entryPoint = useSandboxStore((s) => entryPointLabel(s.mainClasses));
  const sandboxBusy = useSandboxStore((s) => s.busy);
  const fixRunning = useFixStore((s) => isFixRunning(s.gate));
  const disabledReason = useSandboxStore(sandboxDisabledReason);

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
            onRun={() => runCommand('project.run')}
            onVerify={() => runCommand('project.verify')}
            busy={sandboxBusy ?? (fixRunning ? 'fix' : null)}
            sandboxDisabledReason={disabledReason}
            onSandboxRecheck={() => void useSandboxStore.getState().checkHealth()}
          />
        }
        left={<ProjectTree client={client} projectId={projectId} />}
        canvas={<CanvasSlot>{canvas ?? (methodId ? <SelectedMethodCanvas client={client} /> : undefined)}</CanvasSlot>}
        right={<PanelTabs title="Анализ" tabs={panelsIn('right', panels)} />}
        bottom={
          <PanelTabs
            aria-label="Код, консоль, тесты"
            tabs={panelsIn('bottom', panels)}
            activeId={bottomTab}
            onActiveChange={(id) => showPanel('bottom', id)}
          />
        }
      />
      <CommandPalette client={client} commands={commands} runCommand={runCommand} />
      <RunDialog />
      <QualityGateDialog />
      <SandboxNotice />
      <FixConflictToast />
      {exportOpen && (
        <ExportDialog client={client} projectId={projectId} version={version} onClose={closeExport} save={saveFile} />
      )}
    </>
  );
}

/** Точка входа для шапки: первый класс с main (Project.mainClasses) → «Main.main»; нет — null. */
function entryPointLabel(mainClasses: string[] | null): string | null {
  const main = mainClasses?.[0];
  if (!main) return null;
  const label = `${main.split('.').pop() ?? main}.main`;
  return mainClasses.length > 1 ? `${label} (+${mainClasses.length - 1})` : label;
}
