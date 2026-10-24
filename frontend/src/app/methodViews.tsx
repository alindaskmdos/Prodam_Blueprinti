import { useCallback } from 'react';
import { api, type ApiClient, type Schemas } from '../features/api';
import { useAnalysisStore } from '../features/analysis-panel';
import { CodeEditor } from '../features/editor-code';
import { MethodCanvas } from '../features/editor-nodes';
import { PanelStub } from '../features/layout';
import { findMethodFile, reloadProjectTree, useTreeStore } from '../features/project-tree';
import { useAppStore } from './store';

interface Props {
  client?: ApiClient;
}

/** Ответ правки (PUT blocks / PUT files): анализ из ответа — в стор анализа, дерево проекта перезагружается. */
function useOnMutation(projectId: string | null) {
  return useCallback(
    (result: Schemas['MutationResult']) => {
      if (!projectId) return;
      useAnalysisStore.getState().setAnalysis(projectId, result.analysis);
      void reloadProjectTree();
    },
    [projectId],
  );
}

/**
 * Холст выбранного в дереве метода. Без выбранного метода — null (CanvasSlot покажет «Выберите метод…»).
 * Версия — из store: на чужую правку (код, фикс) холст сам перезагружает блоки (editor-nodes, adoptVersion),
 * поэтому без ремоунта. Своя правка нод → onMutation: анализ из ответа и перезагрузка дерева проекта.
 */
export function SelectedMethodCanvas({ client = api }: Props) {
  const projectId = useAppStore((s) => s.projectId);
  const methodId = useAppStore((s) => s.selectedMethodId);
  const onMutation = useOnMutation(projectId);
  if (!projectId || !methodId) return null;
  return <MethodCanvas client={client} projectId={projectId} methodId={methodId} onMutation={onMutation} />;
}

/**
 * Вкладка «Код Java»: файл выбранного метода (путь — из дерева проекта) в редакторе кода.
 * Новая версия (только рост) → store; ответ PUT files → onMutation (анализ из ответа, перезагрузка дерева);
 * 409 → перезагрузка дерева.
 */
export function SelectedMethodCode({ client = api }: Props) {
  const projectId = useAppStore((s) => s.projectId);
  const methodId = useAppStore((s) => s.selectedMethodId);
  const version = useAppStore((s) => s.version);
  const tree = useTreeStore((s) => (s.projectId === projectId ? s.state : null));
  const path = tree?.kind === 'ok' && methodId ? findMethodFile(tree.tree, methodId) : null;

  const onVersion = useCallback((next: number) => {
    const { version: prev, setVersion } = useAppStore.getState();
    if (prev === null || next > prev) setVersion(next);
  }, []);
  const onConflict = useCallback(() => void reloadProjectTree(), []);
  const onMutation = useOnMutation(projectId);

  if (!projectId) return null;
  if (!methodId) return <PanelStub text="Выберите метод в дереве проекта — здесь откроется код его файла" />;
  if (!path) {
    return <PanelStub text={tree?.kind === 'ok' ? 'Файл метода не найден в дереве проекта' : 'Загрузка дерева проекта…'} />;
  }
  return (
    <CodeEditor
      client={client}
      projectId={projectId}
      path={path}
      version={version ?? undefined}
      onVersion={onVersion}
      onMutation={onMutation}
      onConflict={onConflict}
    />
  );
}
