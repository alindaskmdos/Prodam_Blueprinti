import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../app/store';
import { api, type ApiClient, type Schemas } from '../api';
import { withFields } from './blockEdit';
import type { ConflictInfo, InvalidEdit } from './blockSync';
import { blocksToGraph, type GraphNodeData } from './blocksToGraph';
import { NodeEditContext, type NodeEditApi } from './editContext';
import { layoutGraph } from './layout';
import { nodeTypes } from './nodeTypes';
import { toFlow } from './toFlow';
import { useBlockSync } from './useBlockSync';
import styles from './MethodCanvas.module.css';

type Flow = { nodes: Node<GraphNodeData>[]; edges: Edge[] };

type LayoutState =
  | { status: 'pending' }
  | { status: 'ready'; flow: Flow }
  | { status: 'error'; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface MethodGraphProps {
  view: Schemas['MethodView'];
  /** Ошибки текста по пути блока (422): ноды красные. */
  errors?: Record<string, string>;
  /** Правка текста нод; нет — схема только для просмотра. */
  edit?: NodeEditApi;
}

/** Схема метода: дерево блоков → ELK → React Flow. С `edit` — тексты нод правятся (FE-07). */
export function MethodGraph({ view, errors, edit }: MethodGraphProps) {
  const graph = useMemo(
    () => blocksToGraph(view.root, { methodBadge: view.complexity, ...(errors ? { errors } : {}) }),
    [view, errors],
  );
  const [state, setState] = useState<{ graph: typeof graph; layout: LayoutState }>({
    graph,
    layout: { status: 'pending' },
  });

  useEffect(() => {
    let cancelled = false;
    layoutGraph(graph)
      .then((laid) => {
        if (!cancelled) setState({ graph, layout: { status: 'ready', flow: toFlow(laid) } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ graph, layout: { status: 'error', message: errorText(e) } });
      });
    return () => {
      cancelled = true;
    };
  }, [graph]);

  // Раскладка от предыдущего метода не показывается, пока не готова новая.
  const layout: LayoutState = state.graph === graph ? state.layout : { status: 'pending' };

  return (
    <NodeEditContext.Provider value={edit ?? null}>
    <div className={styles.canvas} data-testid="method-canvas">
      {layout.status === 'pending' && <div className={styles.status}>Раскладка схемы…</div>}
      {layout.status === 'error' && (
        <div role="alert" className={styles.error}>
          Не удалось разложить схему: {layout.message}
        </div>
      )}
      {layout.status === 'ready' && (
        <ReactFlow
          key={view.methodId}
          nodes={layout.flow.nodes}
          edges={layout.flow.edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          colorMode="dark"
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--jb-border-strong)"
            bgColor="var(--jb-bg)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
    </NodeEditContext.Provider>
  );
}

/** Сколько висит тост о конфликте версий. */
const TOAST_MS = 6000;

export interface MethodCanvasProps {
  projectId: string;
  methodId: string;
  client?: ApiClient;
  /** Версия проекта; по умолчанию — из общего стора (useAppStore). Берётся, если новее известной. */
  version?: number;
  /** Новая версия после принятой правки; по умолчанию — setVersion общего стора. */
  onVersion?: (version: number) => void;
  /** Принятая правка (MutationResult): новый текст файла, дерево проекта, анализ. */
  onMutation?: (result: Schemas['MutationResult']) => void;
  /** 409: приложению перезагрузить своё состояние (метод холст перезагружает сам). */
  onConflict?: (error: Schemas['Error']) => void;
}

function conflictText(c: ConflictInfo): string {
  const versions =
    c.clientVersion !== undefined && c.serverVersion !== undefined
      ? `Ваша правка относилась к версии ${c.clientVersion}, сейчас ${c.serverVersion}. `
      : '';
  return `${versions}Состояние перезагружено.`;
}

/** Как показывать метод с красной нодой: введённый текст на месте правки, ошибка на ноде из Error.blockId. */
function invalidView(view: Schemas['MethodView'], invalid: InvalidEdit | null) {
  if (!invalid) return { shown: view, errors: undefined };
  const errors: Record<string, string> = { [invalid.errorPath]: invalid.message };
  if (invalid.path !== invalid.errorPath) errors[invalid.path] ??= 'Правка не применена: ошибка в другой ноде.';
  return { shown: { ...view, root: withFields(view.root, invalid.path, invalid.draft) }, errors };
}

/**
 * Загружает дерево блоков метода (GET blocks), показывает схему и даёт править текст нод:
 * двойной клик / ✎ → инлайн-редактор → Enter/blur → PUT blocks с полным деревом.
 */
export function MethodCanvas({ projectId, methodId, client = api, version, onVersion, onMutation, onConflict }: MethodCanvasProps) {
  const storeVersion = useAppStore((s) => s.version);
  const setStoreVersion = useAppStore((s) => s.setVersion);
  const { sync, state } = useBlockSync({
    client,
    projectId,
    methodId,
    version: version ?? storeVersion,
    onVersion: onVersion ?? setStoreVersion,
    onMutation,
    onConflict,
  });
  const { view, invalid, editing, status, error, conflict, stale } = state;

  const { shown, errors } = useMemo(() => (view ? invalidView(view, invalid) : { shown: null, errors: undefined }), [view, invalid]);

  const edit = useMemo<NodeEditApi>(
    () => ({
      editing,
      saving: status === 'saving',
      stale,
      startEdit: (path) => sync.startEdit(path),
      draftFor: (path) => sync.draftFor(path),
      apply: (path, draft) => void sync.apply(path, draft),
      rebase: (path, draft) => void sync.rebase(path, draft),
      cancelEdit: () => sync.cancelEdit(),
      discardInvalid: () => sync.discardInvalid(),
    }),
    [sync, editing, status, stale],
  );

  useEffect(() => {
    if (!conflict) return;
    const t = setTimeout(() => sync.dismissConflict(), TOAST_MS);
    return () => clearTimeout(t);
    // Перезапуск таймера на каждый новый 409.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, conflict?.seq]);

  return (
    <div className={styles.host}>
      {shown ? (
        <MethodGraph view={shown} errors={errors} edit={edit} />
      ) : (
        <div className={styles.canvas} data-testid="method-canvas">
          {status === 'error' ? (
            <div role="alert" className={styles.error}>
              Ошибка загрузки метода: {error}
            </div>
          ) : (
            <div className={styles.status}>Загрузка метода…</div>
          )}
        </div>
      )}
      {shown && error && (
        <div role="alert" className={styles.banner}>
          Правка не сохранена: {error}
        </div>
      )}
      {conflict && (
        <div className={styles.toast} role="alert" key={conflict.seq}>
          <span className={styles.toastIcon} aria-hidden="true">
            !
          </span>
          <div className={styles.toastBody}>
            <span className={styles.toastTitle}>Проект изменился</span>
            <span className={styles.toastText}>{conflictText(conflict)}</span>
          </div>
          <button type="button" className={styles.toastClose} onClick={() => sync.dismissConflict()} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
