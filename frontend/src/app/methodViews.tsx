import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ApiClient, type Schemas } from '../features/api';
import { useAnalysisStore } from '../features/analysis-panel';
import { CodeEditor, revealFor, revealForMethod } from '../features/editor-code';
import { MethodCanvas } from '../features/editor-nodes';
import { PanelStub } from '../features/layout';
import { findMethodFile, reloadProjectTree, useTreeStore } from '../features/project-tree';
import { useAppStore, type LineSpan } from './store';
import { useMethodSpan } from './useMethodSpan';

/** Счётчик событий прокрутки к методу (FE-35): новый выбор — новый seq. */
let methodRevealSeq = 0;

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
 * 409 → перезагрузка дерева. Подсветка (FE-05): клик по ноде / выбор проблемы → строки в редакторе
 * (span проблемы — из анализа), курсор пользователя → store `highlight` (source 'code') → нода на холсте.
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

  const highlight = useAppStore((s) => s.highlight);
  const issueId = useAppStore((s) => s.selectedIssueId);
  const issueSpan = useAnalysisStore((s) => (issueId ? s.analysis?.issues.find((i) => i.id === issueId)?.span : null) ?? null);
  // FE-35: выбор метода прокручивает к span метода (из GET blocks). Одноразово: подсветка, выставленная после
  // выбора метода (клик по ноде, курсор, проблема), и любая правка (версия) гасят его; поздний ответ GET blocks
  // после такой подсветки не применяется. Повторный клик по методу (selectSeq) прокручивает снова.
  const selectSeq = useAppStore((s) => s.methodSelectSeq);
  const loadedSpan = useMethodSpan(client, projectId, methodId, selectSeq);
  const [methodReveal, setMethodReveal] = useState<{
    methodId: string;
    span: LineSpan | null;
    seq: number;
    version: number | null;
  } | null>(null);
  useEffect(() => {
    const { highlight: current, version: currentVersion } = useAppStore.getState();
    if (loadedSpan && !current) {
      setMethodReveal({
        methodId: loadedSpan.methodId,
        span: loadedSpan.span,
        seq: ++methodRevealSeq,
        version: currentVersion,
      });
    } else setMethodReveal(null);
  }, [loadedSpan]);
  useEffect(() => {
    if (highlight) setMethodReveal(null);
  }, [highlight]);
  const methodRevealLines = useMemo(
    () =>
      path && methodReveal && methodReveal.methodId === methodId && methodReveal.version === version
        ? revealForMethod(methodReveal.span, path, methodReveal.seq)
        : null,
    [methodReveal, methodId, path, version],
  );
  const highlightReveal = useMemo(
    () => (path ? revealFor(highlight, path, issueSpan) : null),
    [highlight, path, issueSpan],
  );
  const reveal = highlight ? highlightReveal : methodRevealLines;
  const onCursorLine = useCallback(
    (line: number) => {
      if (path) useAppStore.getState().setHighlight({ source: 'code', span: { file: path, startLine: line, endLine: line } });
    },
    [path],
  );

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
      reveal={reveal}
      onCursorLine={onCursorLine}
    />
  );
}
