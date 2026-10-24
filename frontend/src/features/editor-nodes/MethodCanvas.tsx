import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import { api, type ApiClient, type Schemas } from '../api';
import { blocksToGraph, type GraphNodeData } from './blocksToGraph';
import { layoutGraph } from './layout';
import { nodeTypes } from './nodeTypes';
import { toFlow } from './toFlow';
import styles from './MethodCanvas.module.css';

type Flow = { nodes: Node<GraphNodeData>[]; edges: Edge[] };

type LayoutState =
  | { status: 'pending' }
  | { status: 'ready'; flow: Flow }
  | { status: 'error'; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface MethodGraphProps {
  view: Schemas['MethodView'];
}

/** Схема метода только для просмотра: дерево блоков → ELK → React Flow. */
export function MethodGraph({ view }: MethodGraphProps) {
  const graph = useMemo(() => blocksToGraph(view.root, { methodBadge: view.complexity }), [view]);
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
  );
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; view: Schemas['MethodView'] };

export interface MethodCanvasProps {
  projectId: string;
  methodId: string;
  client?: ApiClient;
}

/** Загружает дерево блоков метода (GET blocks) и показывает схему. */
export function MethodCanvas({ projectId, methodId, client = api }: MethodCanvasProps) {
  const [state, setState] = useState<{ key: string; load: LoadState }>({ key: '', load: { status: 'loading' } });
  const key = `${projectId}\u0000${methodId}`;

  useEffect(() => {
    let cancelled = false;
    client
      .GET('/projects/{projectId}/methods/{methodId}/blocks', { params: { path: { projectId, methodId } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setState({ key, load: { status: 'ok', view: data } });
        else setState({ key, load: { status: 'error', message: error?.message ?? `HTTP ${response.status}` } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key, load: { status: 'error', message: errorText(e) } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, methodId, key]);

  const load: LoadState = state.key === key ? state.load : { status: 'loading' };

  if (load.status === 'ok') return <MethodGraph view={load.view} />;
  return (
    <div className={styles.canvas} data-testid="method-canvas">
      {load.status === 'loading' ? (
        <div className={styles.status}>Загрузка метода…</div>
      ) : (
        <div role="alert" className={styles.error}>
          Ошибка загрузки метода: {load.message}
        </div>
      )}
    </div>
  );
}
