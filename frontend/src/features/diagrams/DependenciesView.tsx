import { Background, BackgroundVariant, Controls, Handle, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, type ApiClient } from '../api';
import { SEVERITY_LABEL } from '../analysis-panel';
import { DiagramToolbar } from './DiagramToolbar';
import { useDiagram } from './diagramsStore';
import { cycleLabel, depsFlow, depsToGraph, type DepCycle, type DepFlowNode, type DepGraph, type DepNodeInfo } from './depsGraph';
import { DiagramEdgeView, DiagramMarkers } from './edges';
import { FIT_PADDING, goToClass, goToCycleIssue, useFitView, useFlyTo, useSelectedClassFqn } from './navigation';
import { KIND_ICON, matchClasses } from './umlGraph';
import { useLayout } from './useLayout';
import { useStartView } from './startView';
import styles from './Diagrams.module.css';

const STATE_CLASS = {
  normal: undefined,
  dim: styles.cardDim,
  active: styles.cardActive,
  match: styles.cardMatch,
} as const;

/** Узел графа зависимостей: иконка kind, имя, пакет; узел цикла — красная рамка. */
function DepNode({ data }: NodeProps<DepFlowNode>) {
  const { info, inCycle, state, selected, flying, onClick } = data;
  const icon = KIND_ICON[info.kind ?? 'class'];
  const className = [
    styles.depNode,
    STATE_CLASS[state] ?? '',
    selected ? styles.cardSelected : '',
    flying ? styles.cardFlying : '',
    inCycle ? styles.depCycle : '',
  ]
    .filter(Boolean)
    .join(' ');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(info);
    }
  };
  return (
    <div
      className={`${className} nodrag`}
      style={{ ['--kind' as string]: icon.color }}
      role="button"
      tabIndex={0}
      title={`${info.id} — открыть в редакторе`}
      data-testid="dep-node"
      data-class-id={info.id}
      data-in-cycle={inCycle || undefined}
      onClick={() => onClick(info)}
      onKeyDown={onKey}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} isConnectable={false} />
      <span className={styles.kindIcon} aria-label={info.kind ?? 'class'}>
        {icon.letter}
      </span>
      <span className={styles.depText}>
        <span className={styles.depName}>{info.name}</span>
        <span className={styles.depPkg}>{info.package || '(пакет по умолчанию)'}</span>
      </span>
    </div>
  );
}

const nodeTypes = { dep: DepNode };
const edgeTypes = { diagram: DiagramEdgeView };

interface Props {
  client?: ApiClient;
}

/** Вкладка «Зависимости» (FE-18): GET dependencies → граф «класс использует класс», циклы красным. */
export function DependenciesView({ client = api }: Props) {
  const remote = useDiagram('deps', client);
  if (!remote.data) {
    if (remote.status === 'error') {
      return (
        <div role="alert" className={styles.error}>
          Не удалось загрузить граф зависимостей: {remote.message}
        </div>
      );
    }
    return <div className={styles.status}>Загрузка графа зависимостей…</div>;
  }
  if (remote.data.nodes.length === 0) return <div className={styles.status}>В проекте нет классов</div>;
  return (
    <ReactFlowProvider>
      <DepsCanvas graph={remote.data} stale={remote.status === 'error' ? remote.message : null} />
    </ReactFlowProvider>
  );
}

export default DependenciesView;

function DepsCanvas({ graph, stale }: { graph: DepGraph; stale: string | null }) {
  const model = useMemo(() => depsToGraph(graph), [graph]);
  const layout = useLayout(model);
  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredCycle, setHoveredCycle] = useState<DepCycle | null>(null);
  const [query, setQuery] = useState('');
  const [flyingId, setFlyingId] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(false);
  const busy = useRef(false);
  const selectedId = useSelectedClassFqn();
  const fly = useFlyTo();
  const fitView = useFitView();

  const onClick = useCallback(
    (info: DepNodeInfo) => {
      if (busy.current) return;
      busy.current = true;
      setFlyingId(info.id);
      const done = () => {
        busy.current = false;
        setFlyingId(null);
      };
      // Отмена полёта (смена вкладки/проекта) тоже снимает «занято».
      fly(
        info.id,
        () => {
          done();
          goToClass(info.id);
        },
        done,
      );
    },
    [fly],
  );

  const searched = useMemo(() => matchClasses(graph.nodes, query), [graph.nodes, query]);
  const matches = useMemo(() => (hoveredCycle ? new Set(hoveredCycle.classes) : searched), [hoveredCycle, searched]);
  const flow = useMemo(
    () => (layout.status === 'ready' ? depsFlow(layout.model, layout.layout, { hovered, matches, selectedId, flyingId, onClick }) : null),
    [layout, hovered, matches, selectedId, flyingId, onClick],
  );

  const start = useStartView(flow?.nodes ?? null);

  if (layout.status === 'error') {
    return (
      <div role="alert" className={styles.error}>
        Не удалось разложить граф: {layout.message}
      </div>
    );
  }
  if (!flow) return <div ref={start.ref} className={styles.status}>Раскладка графа…</div>;

  return (
    <div ref={start.ref} className={styles.canvas} data-testid="deps-canvas">
      <DiagramMarkers />
      <ReactFlow<DepFlowNode, (typeof flow.edges)[number]>
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onPaneClick={() => setHovered(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        colorMode="dark"
        fitView={start.viewport === null}
        {...(start.viewport ? { defaultViewport: start.viewport } : {})}
        fitViewOptions={{ padding: FIT_PADDING }}
        minZoom={0.08}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--jb-border-strong)" bgColor="var(--jb-bg)" />
        <Controls showInteractive={false} />
        {minimap && (
          <MiniMap
            className={styles.minimap}
            style={{ width: 150, height: 96 }}
            nodeColor={(n) => ((n.data as { inCycle?: boolean }).inCycle ? 'var(--jb-severity-high)' : 'var(--jb-border-strong)')}
            nodeBorderRadius={4}
            bgColor="var(--jb-panel)"
            maskColor="rgba(11, 14, 19, 0.6)"
            pannable
            zoomable
            ariaLabel="Мини-карта графа зависимостей"
          />
        )}
        <Panel position="top-left">
          <DiagramToolbar
            query={query}
            onQuery={setQuery}
            onEnter={() => {
              const first = graph.nodes.find((n) => searched?.has(n.id));
              // Enter не перебивает идущий полёт с переходом в редактор.
              if (first && !busy.current) fly(first.id, () => undefined);
            }}
            found={searched ? searched.size : null}
            onFit={fitView}
            minimap={minimap}
            onMinimap={() => setMinimap((v) => !v)}
            placeholder="Найти класс…"
            stale={stale}
          />
        </Panel>
        <Panel position="top-right">
          <CycleList graph={graph} onHover={setHoveredCycle} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** Список циклов: клик → Issue CyclicDependency (панель «Проблемы» + код по span проблемы). */
function CycleList({ graph, onHover }: { graph: DepGraph; onHover: (c: DepCycle | null) => void }) {
  return (
    <div className={styles.cycles} aria-label="Циклы зависимостей" data-testid="cycle-list">
      <div className={styles.cyclesTitle}>Циклы: {graph.cycles.length}</div>
      {graph.cycles.length === 0 && <div className={styles.noCycles}>Циклических зависимостей нет</div>}
      {graph.cycles.map((c) => (
        <button
          key={c.issueId}
          type="button"
          className={`${styles.cycleItem} nodrag nopan`}
          onClick={() => goToCycleIssue(c.issueId)}
          onMouseEnter={() => onHover(c)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(c)}
          onBlur={() => onHover(null)}
          title="Открыть проблему «циклическая зависимость»"
        >
          <span className={styles.cycleSeverity}>
            {SEVERITY_LABEL[c.severity]} · {c.classes.length} кл.
          </span>
          <span>{cycleLabel(c, graph.nodes)}</span>
        </button>
      ))}
    </div>
  );
}
