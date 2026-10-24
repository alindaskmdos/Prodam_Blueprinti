import { Background, BackgroundVariant, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../app/store';
import { api, prefetchMethodBlocks, type ApiClient, type Schemas } from '../api';
import { ClassCard, type ClassCardNode } from './ClassCard';
import { DiagramToolbar } from './DiagramToolbar';
import { useDiagram } from './diagramsStore';
import { DiagramEdgeView, DiagramMarkers } from './edges';
import { FIT_PADDING, goToClass, goToMethod, useFitView, useFlyTo, useSelectedClassFqn } from './navigation';
import { umlFlow } from './umlFlow';
import { KIND_ICON, matchClasses, RELATION_STYLE, umlToGraph, type RelationKind, type UmlClass, type UmlMember } from './umlGraph';
import { useLayout } from './useLayout';
import { useStartView } from './startView';
import styles from './Diagrams.module.css';

const nodeTypes = { umlClass: ClassCard };
const edgeTypes = { diagram: DiagramEdgeView };

interface Props {
  client?: ApiClient;
}

/** Вкладка «UML» (FE-16): GET uml → карточки классов и связи в UML-нотации; клик → редактор. */
export function UmlView({ client = api }: Props) {
  const remote = useDiagram('uml', client);
  if (!remote.data) {
    if (remote.status === 'error') {
      return (
        <div role="alert" className={styles.error}>
          Не удалось загрузить UML: {remote.message}
        </div>
      );
    }
    return <div className={styles.status}>Загрузка UML…</div>;
  }
  if (remote.data.classes.length === 0) return <div className={styles.status}>В проекте нет классов</div>;
  return (
    <ReactFlowProvider>
      <UmlCanvas client={client} diagram={remote.data} stale={remote.status === 'error' ? remote.message : null} />
    </ReactFlowProvider>
  );
}

export default UmlView;

/** Масштаб, с которого карточки UML читаются (текст 12 px): ниже начальный вид — верх диаграммы, не весь граф. */
const READABLE_ZOOM = 0.6;

function UmlCanvas({ client, diagram, stale }: { client: ApiClient; diagram: Schemas['UmlDiagram']; stale: string | null }) {
  const model = useMemo(() => umlToGraph(diagram), [diagram]);
  const layout = useLayout(model);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [flyingId, setFlyingId] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(false);
  const busy = useRef(false);
  const selectedId = useSelectedClassFqn();
  const fly = useFlyTo();
  const fitView = useFitView();

  const travel = useCallback(
    (id: string, then: () => void) => {
      if (busy.current) return;
      busy.current = true;
      setFlyingId(id);
      const done = () => {
        busy.current = false;
        setFlyingId(null);
      };
      // Отмена полёта (смена вкладки/проекта) тоже снимает «занято»: иначе карточки перестали бы реагировать.
      fly(
        id,
        () => {
          done();
          then();
        },
        done,
      );
    },
    [fly],
  );
  const onClassClick = useCallback(
    (cls: UmlClass) => travel(cls.id, () => void goToClass(cls.id)),
    [travel],
  );
  const onMemberClick = useCallback(
    (cls: UmlClass, m: UmlMember) => {
      // GET blocks метода идёт параллельно с полётом камеры: к приходу на холст схема уже загружена.
      const { projectId, version } = useAppStore.getState();
      if (projectId) prefetchMethodBlocks(client, projectId, m.id, version);
      travel(cls.id, () => goToMethod(m.id));
    },
    [client, travel],
  );

  const matches = useMemo(() => matchClasses(diagram.classes, query), [diagram.classes, query]);
  const flow = useMemo(
    () =>
      layout.status === 'ready'
        ? umlFlow(layout.model, layout.layout, { hovered, matches, selectedId, flyingId, onClassClick, onMemberClick })
        : null,
    [layout, hovered, matches, selectedId, flyingId, onClassClick, onMemberClick],
  );

  const onSearchEnter = () => {
    const first = diagram.classes.find((c) => matches?.has(c.id));
    // Enter не перебивает идущий полёт с переходом в редактор.
    if (first && !busy.current) fly(first.id, () => undefined);
  };

  const start = useStartView(flow?.nodes ?? null, READABLE_ZOOM);

  if (layout.status === 'error') {
    return (
      <div role="alert" className={styles.error}>
        Не удалось разложить диаграмму: {layout.message}
      </div>
    );
  }
  if (!flow) return <div ref={start.ref} className={styles.status}>Раскладка диаграммы…</div>;

  return (
    <div ref={start.ref} className={styles.canvas} data-testid="uml-canvas">
      <DiagramMarkers />
      <ReactFlow<ClassCardNode, (typeof flow.edges)[number]>
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
            nodeColor={(n) => KIND_ICON[(n.data as { cls: UmlClass }).cls.kind].color}
            nodeBorderRadius={4}
            bgColor="var(--jb-panel)"
            maskColor="rgba(11, 14, 19, 0.6)"
            pannable
            zoomable
            ariaLabel="Мини-карта UML"
          />
        )}
        <Panel position="top-left">
          <DiagramToolbar
            query={query}
            onQuery={setQuery}
            onEnter={onSearchEnter}
            found={matches ? matches.size : null}
            onFit={fitView}
            minimap={minimap}
            onMinimap={() => setMinimap((v) => !v)}
            placeholder="Найти класс…"
            stale={stale}
          />
        </Panel>
        <Panel position="top-right">
          <UmlLegend />
        </Panel>
      </ReactFlow>
    </div>
  );
}

const LEGEND: RelationKind[] = ['extends', 'implements', 'association', 'dependency', 'aggregation', 'composition'];

/** Легенда нотации связей: сворачиваемая (по умолчанию закрыта) — не перекрывает диаграмму. */
function UmlLegend() {
  return (
    <details className={`${styles.legendBox} nodrag nopan`}>
      <summary>Обозначения</summary>
      <LegendBody />
    </details>
  );
}

function LegendBody() {
  return (
    <div className={styles.legend} aria-label="Обозначения связей">
      {LEGEND.map((k) => {
        const s = RELATION_STYLE[k];
        return (
          <span key={k} className={styles.legendItem}>
            <svg width="42" height="12" aria-hidden="true">
              <path
                d="M 4 6 L 38 6"
                className={`${styles.edgePath} ${s.dashed ? styles.dashed : ''}`}
                markerEnd={s.end ? `url(#jb-dg-${s.end}-base)` : undefined}
                markerStart={s.start ? `url(#jb-dg-${s.start}-base)` : undefined}
              />
            </svg>
            {s.label}
          </span>
        );
      })}
      <span className={styles.legendItem}>
        <span className={`${styles.edgeLabel} ${styles.badgeLabel} ${styles.legendBadge}`}>эвристика</span>
        агрегация/композиция
      </span>
    </div>
  );
}
