import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  type FitViewOptions,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, type LineSpan } from '../../app/store';
import { api, type ApiClient, type Schemas } from '../api';
import { blockAt, withFields, type BlockPath } from './blockEdit';
import { currentRoot, type ConflictInfo, type InvalidEdit } from './blockSync';
import {
  canMove,
  insertOptions,
  nestedCount,
  parentOf,
  skipComments,
  type InsertOption,
  type InsertPoint,
} from './blockTree';
import { blockAtLine } from './blockLocate';
import { blocksToGraph, type GraphNodeData } from './blocksToGraph';
import { collapsedPaths, containerEntries, keysInSlot, lockedPaths, revealKeys } from './collapse';
import { CollapseContext, type CollapseApi } from './collapseContext';
import { NodeEditContext, type NodeEditApi } from './editContext';
import { FOCUS_ZOOM, flowNodeOfBlock, useFocusCenter, type FocusRequest } from './focus';
import {
  MINIMAP_INSET,
  TOP_BAR_INSET,
  computeInitialView,
  graphBounds,
  type InitialView,
  type Insets,
} from './initialView';
import { layoutGraph } from './layout';
import { edgeTypes, nodeTypes } from './nodeTypes';
import { kindMeta } from './kinds';
import { BlockPalette, InsertMenu } from './structureUi';
import { toFlow } from './toFlow';
import { useBlockSync } from './useBlockSync';
import { useCollapseOverrides, useEditorView } from './viewStore';
import styles from './MethodCanvas.module.css';

type Flow = { nodes: Node<GraphNodeData>[]; edges: Edge[] };

type LayoutState =
  | { status: 'pending' }
  | { status: 'ready'; flow: Flow }
  | { status: 'error'; message: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ноды без собственного цвета на мини-карте: рамки контейнеров/веток и «+». */
const MINI_FRAMES = new Set(['container', 'slot', 'insert']);
const miniColor = (n: Node<GraphNodeData>) =>
  MINI_FRAMES.has(n.type ?? '') ? 'transparent' : kindMeta(n.data.kind).color;
const miniStroke = (n: Node<GraphNodeData>) =>
  n.type === 'container' ? kindMeta(n.data.kind).color : 'transparent';

/** Множество с той же ссылкой, пока не изменилось содержимое (чтобы схема не пересчитывалась зря). */
function useStableSet(set: Set<string>): ReadonlySet<string> {
  const key = [...set].sort().join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- зависимость — содержимое (key), не ссылка
  return useMemo(() => set, [key]);
}

export interface MethodGraphProps {
  view: Schemas['MethodView'];
  /** Ошибки текста по пути блока (422): ноды красные. */
  errors?: Record<string, string>;
  /** Правка текста нод; нет — схема только для просмотра. */
  edit?: NodeEditApi;
  /** Подсветить ноду блока (клик по ней, строка курсора в Monaco) — рамка акцентом (FE-05). */
  highlightBlockId?: string | null;
  /** Нода выбранной проблемы — pulse-анимация (без анимации при prefers-reduced-motion). */
  pulseBlockId?: string | null;
  /** Центрировать схему на блоке; один раз на seq, после загрузки дерева, если блока ещё нет. */
  focus?: FocusRequest | null;
  /** Клик по ноде блока: id и span блока (для подсветки строк в коде). */
  onBlockClick?: (blockId: string, span: LineSpan | null) => void;
  /** Клик по пустому месту холста. */
  onPaneClick?: () => void;
}

/** Внутри <ReactFlow>: центрирует схему на ноде запроса (нужен экземпляр из контекста React Flow). */
function FocusCenter({
  targetNodeId,
  seq,
  done,
  getArea,
}: {
  targetNodeId: string | null;
  seq: number | null;
  done: { current: number | null };
  getArea: () => { size: { width: number; height: number }; insets: Insets } | undefined;
}) {
  const rf = useReactFlow();
  useFocusCenter(rf, targetNodeId, seq, done, getArea);
  return null;
}

/** Клавиша пришла из поля ввода (инлайн-редактор, Monaco) или с кнопки / ссылки / пункта меню — не команда схемы. */
function fromTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.closest('[role="menuitem"]') !== null);
}

/**
 * Схема метода: дерево блоков → ELK → React Flow. С `edit` — тексты нод правятся (FE-07), «+» на стрелках,
 * удаление и вверх/вниз (FE-08): Delete или Backspace / Enter / Alt+↑ / Alt+↓ на выделенной ноде.
 */
export function MethodGraph({
  view,
  errors,
  edit,
  highlightBlockId = null,
  pulseBlockId = null,
  focus = null,
  onBlockClick,
  onPaneClick,
}: MethodGraphProps) {
  const insertable = edit !== undefined;
  const methodId = view.methodId;
  // Вид (FE-06): сворачивание и комментарии — состояние клиента, дерево и PUT не меняются.
  const showComments = useEditorView((s) => s.showComments);
  const setShowComments = useEditorView((s) => s.setShowComments);
  const showMinimap = useEditorView((s) => s.showMinimap);
  const setShowMinimap = useEditorView((s) => s.setShowMinimap);
  // Поля, занятые оверлеями: верхняя панель и (если показана) мини-карта. Начальный вид и полёт к блоку их обходят.
  const insets = useMemo<Insets>(
    () => ({ top: TOP_BAR_INSET, left: 0, right: showMinimap ? MINIMAP_INSET.right : 0, bottom: showMinimap ? MINIMAP_INSET.bottom : 0 }),
    [showMinimap],
  );
  const setCollapsedKeys = useEditorView((s) => s.setCollapsed);
  const overrides = useCollapseOverrides(methodId);
  // Открытый редактор и красные ноды всегда видны: их контейнеры не сворачиваются, комментарий не скрывается.
  const editingPath = edit?.editing ?? null;
  const forcedOpen = useMemo(
    () => [...(editingPath !== null ? [editingPath] : []), ...Object.keys(errors ?? {})],
    [editingPath, errors],
  );
  const collapsed = useStableSet(collapsedPaths(view.root, overrides, forcedOpen));
  const locked = useStableSet(lockedPaths(view.root, forcedOpen));
  const keepVisible = useStableSet(new Set(forcedOpen));
  const graph = useMemo(
    () =>
      blocksToGraph(view.root, {
        methodBadge: view.complexity,
        insertable,
        collapsed,
        collapseLocked: locked,
        hideComments: !showComments,
        keepVisible,
        ...(errors ? { errors } : {}),
      }),
    [view, errors, insertable, collapsed, locked, showComments, keepVisible],
  );
  const collapseApi = useMemo<CollapseApi>(
    () => ({ setCollapsed: (key, value) => setCollapsedKeys(methodId, [key], value) }),
    [setCollapsedKeys, methodId],
  );
  const setAll = (value: boolean) =>
    setCollapsedKeys(
      methodId,
      containerEntries(view.root).map((c) => c.key),
      value,
    );

  // Проблема (focus) или строка кода (highlight) внутри свёрнутого контейнера — путь к ноде разворачивается.
  // Один раз на запрос: свернуть контейнер обратно можно, пока цель не сменилась.
  const revealRef = useRef({ root: view.root, collapsed });
  revealRef.current = { root: view.root, collapsed };
  const reveal = useCallback(
    (blockId: string) => {
      const { root, collapsed: c } = revealRef.current;
      setCollapsedKeys(methodId, revealKeys(root, blockId, c), false);
    },
    [setCollapsedKeys, methodId],
  );
  const focusBlockId = focus?.blockId ?? null;
  const focusSeqKey = focus?.seq ?? null;
  useEffect(() => {
    if (focusBlockId !== null) reveal(focusBlockId);
  }, [focusBlockId, focusSeqKey, reveal]);
  useEffect(() => {
    if (highlightBlockId !== null) reveal(highlightBlockId);
  }, [highlightBlockId, reveal]);
  // Выделение своё: ноды React Flow контролируемые (без onNodesChange), selected проставляется при рендере.
  // Выделение привязано к дереву, на котором сделано: любая смена дерева (↑↓✕, вставка, 409, правка извне)
  // его сбрасывает — иначе путь указал бы на другой блок и Delete удалил бы не тот.
  const [rawSelection, setRawSelection] = useState<{ id: string; path: BlockPath; root: Schemas['Block'] } | null>(null);
  // Нода, скрытая сворачиванием или переключателем комментариев, не выделена: Delete её не удалит.
  const selection =
    rawSelection && rawSelection.root === view.root && graph.nodes.some((n) => n.id === rawSelection.id && n.data.path === rawSelection.path)
      ? rawSelection
      : null;
  const setSelection = (s: { id: string; path: BlockPath } | null) =>
    setRawSelection(s ? { ...s, root: view.root } : null);
  const selected = selection?.path ?? null;
  const editRef = useRef(edit);
  const selectedEditable = useRef(false);
  selectedEditable.current = graph.nodes.some((n) => n.id === selection?.id && n.data.editable);

  useEffect(() => {
    if (!insertable || selected === null || selected === 'root') return;
    const onKey = (e: KeyboardEvent) => {
      const api = editRef.current;
      if (!api || fromTextInput(e.target) || e.defaultPrevented) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Тот же путь, что у ✕ на ноде (edit.remove: confirm для контейнера с содержимым).
        e.preventDefault();
        api.remove(selected);
        setSelection(null);
      } else if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Enter на выделенной ноде — править её текст, как ✎ / двойной клик.
        if (!selectedEditable.current) return;
        e.preventDefault();
        api.startEdit(selected);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const delta = e.key === 'ArrowUp' ? -1 : 1;
        if (!api.canMove(selected, delta)) return;
        e.preventDefault();
        api.move(selected, delta);
        setSelection(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSelection пересоздаётся на каждый рендер
  }, [insertable, selected]);
  const [state, setState] = useState<{
    graph: typeof graph;
    root: Schemas['Block'];
    methodId: string;
    layout: LayoutState;
  }>({
    graph,
    root: view.root,
    methodId,
    layout: { status: 'pending' },
  });

  useEffect(() => {
    let cancelled = false;
    const root = view.root;
    const methodId = view.methodId;
    layoutGraph(graph)
      .then((laid) => {
        if (!cancelled) setState({ graph, root, methodId, layout: { status: 'ready', flow: toFlow(laid) } });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ graph, root, methodId, layout: { status: 'error', message: errorText(e) } });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- root входит в graph
  }, [graph]);

  // Пока считается новая раскладка того же метода, на экране прежняя схема с устаревшими путями нод, а
  // edit работает по новому дереву: правки (двойной клик, «+», Delete, ↑↓, drag из палитры) на это время выключены.
  const layoutStale = state.graph !== graph;
  const guardedEdit = useMemo<NodeEditApi | undefined>(
    () =>
      edit && layoutStale
        ? {
            ...edit,
            structure: false,
            startEdit: () => {},
            requestInsert: () => {},
            canDrop: () => false,
            dropInsert: () => {},
            remove: () => {},
            move: () => {},
            canMove: () => false,
          }
        : edit,
    [edit, layoutStale],
  );
  editRef.current = guardedEdit;

  // Раскладка другого метода не показывается, пока не готова новая. Тот же метод (правка, «+», удаление,
  // сворачивание, комментарии) — прежняя схема остаётся до новой раскладки: React Flow не пересоздаётся,
  // масштаб и сдвиг те же (FE-29); fitView только при первом открытии метода и при смене метода.
  const layout: LayoutState =
    state.graph === graph || (state.layout.status === 'ready' && state.methodId === methodId)
      ? state.layout
      : { status: 'pending' };
  const flowNodes = layout.status === 'ready' ? layout.flow.nodes : null;
  const highlightId = flowNodes && highlightBlockId ? flowNodeOfBlock(flowNodes, highlightBlockId) : null;
  const pulseId = flowNodes && pulseBlockId ? flowNodeOfBlock(flowNodes, pulseBlockId) : null;
  const nodes = useMemo(
    () =>
      flowNodes?.map((n) => {
        const cls = [n.id === highlightId && styles.lineHighlight, n.id === pulseId && styles.issuePulse].filter(Boolean);
        if (n.id !== selection?.id && cls.length === 0) return n;
        return {
          ...n,
          ...(n.id === selection?.id ? { selected: true } : {}),
          ...(cls.length > 0 ? { className: cls.join(' ') } : {}),
        };
      }) ?? [],
    [flowNodes, selection, highlightId, pulseId],
  );
  // Центрирование по проблеме (FE-05): seq уже показанного запроса — переживает перерисовки схемы.
  const focusDone = useRef<number | null>(null);
  const focusNodeId = flowNodes && focus ? flowNodeOfBlock(flowNodes, focus.blockId) : null;
  const focusSeq = focus?.seq ?? null;
  // Первый показ схемы с ещё не показанной целью — начальный fitView сразу на ноду (иначе он перебил бы центрирование).
  const initialFit =
    focusNodeId !== null && focusDone.current !== focusSeq ? { nodes: [{ id: focusNodeId }], maxZoom: FOCUS_ZOOM } : undefined;
  // Начальный вид (FE-34): решение принимается один раз на метод при первой готовой раскладке и не меняется
  // от правок. Цель-проблема (FE-05) приоритетнее; слишком высокая схема — верх в читаемом масштабе.
  const canvasRef = useRef<HTMLDivElement>(null);
  const initialViewRef = useRef<{ methodId: string; view: InitialView } | null>(null);
  if (layout.status === 'ready' && initialViewRef.current?.methodId !== view.methodId) {
    const el = canvasRef.current;
    const size = el ? { width: el.clientWidth, height: el.clientHeight } : null;
    initialViewRef.current = {
      methodId: view.methodId,
      view: initialFit ? { mode: 'fit' } : computeInitialView(graphBounds(layout.flow.nodes), size, undefined, insets),
    };
  }
  const startView = initialViewRef.current?.methodId === view.methodId ? initialViewRef.current.view : null;
  const topViewport = startView?.mode === 'top' ? startView.viewport : null;
  // Поля как у padding 0.1 (≈4.5% стороны), но сверху / справа / снизу — не меньше занятого оверлеями.
  const side = (px: number): `${number}px` | `${number}%` => (px > 0 ? `${px}px` : '4.5%');
  const fitViewOptions: FitViewOptions = {
    padding: { top: side(insets.top), right: side(insets.right), bottom: side(insets.bottom), left: side(insets.left) },
    ...(initialFit ?? {}),
  };
  const getArea = useCallback(() => {
    const el = canvasRef.current;
    return el ? { size: { width: el.clientWidth, height: el.clientHeight }, insets } : undefined;
  }, [insets]);

  return (
    <NodeEditContext.Provider value={guardedEdit ?? null}>
    <CollapseContext.Provider value={collapseApi}>
    <div ref={canvasRef} className={styles.canvas} data-testid="method-canvas">
      {layout.status === 'pending' && <div className={styles.status}>Раскладка схемы…</div>}
      {layout.status === 'error' && (
        <div role="alert" className={styles.error}>
          Не удалось разложить схему: {layout.message}
        </div>
      )}
      {layout.status === 'ready' && (
        <ReactFlow
          key={view.methodId}
          nodes={nodes}
          edges={layout.flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, n) => {
            if (n.data.collapse?.collapsed) {
              // Клик по свёрнутому контейнеру разворачивает его (выделение не ставится).
              collapseApi.setCollapsed(n.data.collapse.key, false);
              setSelection(null);
              onBlockClick?.(n.data.blockId, n.data.span ?? null);
              return;
            }
            setSelection(n.selectable === false || n.data.path === 'root' ? null : { id: n.id, path: n.data.path });
            if (n.selectable !== false) onBlockClick?.(n.data.blockId, n.data.span ?? null);
          }}
          onPaneClick={() => {
            setSelection(null);
            onPaneClick?.();
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          // Групповых действий нет — рамка выделения и мультивыбор выключены.
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          colorMode="dark"
          fitView={topViewport === null}
          {...(topViewport ? { defaultViewport: topViewport } : {})}
          fitViewOptions={fitViewOptions}
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
          <Controls showInteractive={false}>
            <ControlButton
              onClick={() => setShowMinimap(!showMinimap)}
              title={showMinimap ? 'Скрыть мини-карту' : 'Показать мини-карту'}
              aria-label={showMinimap ? 'Скрыть мини-карту' : 'Показать мини-карту'}
              aria-pressed={showMinimap}
            >
              <span aria-hidden="true">▦</span>
            </ControlButton>
          </Controls>
          {showMinimap && (
            <MiniMap
              className={styles.minimap}
              style={{ width: 140, height: 90 }}
              nodeColor={miniColor}
              nodeStrokeColor={miniStroke}
              nodeStrokeWidth={2}
              nodeBorderRadius={4}
              bgColor="var(--jb-panel)"
              maskColor="rgba(11, 14, 19, 0.6)"
              pannable
              zoomable
              ariaLabel="Мини-карта схемы"
            />
          )}
          <Panel position="top-left">
            <div className={`${styles.topBar} nodrag nopan`}>
              {edit && <BlockPalette />}
              <div className={styles.viewBar} data-testid="view-bar">
                <label>
                  <input type="checkbox" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} />
                  Комментарии
                </label>
                <button type="button" onClick={() => setAll(false)} title="Развернуть всё" aria-label="Развернуть всё">
                  Развернуть
                </button>
                <button type="button" onClick={() => setAll(true)} title="Свернуть всё" aria-label="Свернуть всё">
                  Свернуть
                </button>
              </div>
            </div>
          </Panel>
          <FocusCenter targetNodeId={focusNodeId} seq={focusSeq} done={focusDone} getArea={getArea} />
        </ReactFlow>
      )}
    </div>
    </CollapseContext.Provider>
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

interface MenuState {
  point: InsertPoint;
  options: InsertOption[];
  x: number;
  y: number;
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
  const { view, invalid, editing, status, error, conflict, stale, pending, lostInsert } = state;
  const hostRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Показывается дерево с неотправленной вставкой (FE-08), если она есть.
  const { shown, errors } = useMemo(() => {
    if (!view) return { shown: null, errors: undefined };
    const root = currentRoot({ view, pending }) ?? view.root;
    return invalidView(root === view.root ? view : { ...view, root }, invalid);
  }, [view, pending, invalid]);
  const root = shown?.root ?? null;

  // Подсветка строка ↔ нода (FE-05): холст пишет в store только клик по ноде, на свои события не реагирует.
  const highlight = useAppStore((s) => s.highlight);
  const selectedBlockId = useAppStore((s) => s.selectedBlockId);
  const setHighlight = useAppStore((s) => s.setHighlight);
  const highlightBlockId = useMemo(() => {
    if (!highlight) return null;
    if (highlight.source !== 'code') return highlight.blockId;
    if (!root || !highlight.span) return null;
    return blockAtLine(root, highlight.span.startLine, highlight.span.file)?.id ?? null;
  }, [highlight, root]);
  const focus = useMemo<FocusRequest | null>(
    () => (highlight?.source === 'issue' && highlight.blockId ? { blockId: highlight.blockId, seq: highlight.seq } : null),
    [highlight],
  );
  const onBlockClick = useCallback(
    (blockId: string, span: LineSpan | null) => setHighlight({ source: 'canvas', blockId, span }),
    [setHighlight],
  );
  const onPaneClick = useCallback(() => {
    if (useAppStore.getState().highlight?.source === 'canvas') setHighlight(null);
  }, [setHighlight]);

  const showComments = useEditorView((s) => s.showComments);
  const moveSkip = showComments ? undefined : skipComments;
  // id блоков позиционные: после своих вставки / удаления / ↑↓ состояние сворачивания слота сбрасывается,
  // чтобы соседям не досталось чужое.
  const resetCollapsed = useEditorView((s) => s.resetCollapsed);
  const forgetSlotOf = useCallback(
    (parent: string, slot: string) => {
      if (root) resetCollapsed(methodId, keysInSlot(root, parent, slot));
    },
    [root, resetCollapsed, methodId],
  );
  const forgetSlot = useCallback(
    (path: string) => {
      const p = parentOf(path);
      if (p) forgetSlotOf(p.parent, p.slot);
    },
    [forgetSlotOf],
  );

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
      structure: pending === null && !stale,
      requestInsert: (point, anchor) => {
        const owner = root && blockAt(root, point.parent);
        const host = hostRef.current?.getBoundingClientRect();
        if (!owner || !host) return;
        const options = insertOptions(owner, point.slot);
        if (options.length === 0) return;
        const r = anchor.getBoundingClientRect();
        setMenu({ point, options, x: r.left - host.left + r.width / 2, y: r.bottom - host.top + 6 });
      },
      canDrop: (point, kind) => {
        const owner = root && blockAt(root, point.parent);
        return pending === null && !stale && !!owner && insertOptions(owner, point.slot).some((o) => o.kind === kind);
      },
      dropInsert: (point, kind) => {
        forgetSlotOf(point.parent, point.slot);
        void sync.insert(point, kind);
      },
      remove: (path) => {
        const block = root && blockAt(root, path);
        if (!block) return;
        const n = nestedCount(block);
        if (n > 0 && !window.confirm(`Удалить блок вместе с содержимым (вложенных блоков: ${n})?`)) return;
        forgetSlot(path);
        void sync.remove(path);
      },
      // Скрытые комментарии ↑↓ не считает соседями: иначе код менялся бы, а схема — нет.
      move: (path, delta) => {
        forgetSlot(path);
        void sync.move(path, delta, moveSkip);
      },
      canMove: (path, delta) => (root ? canMove(root, path, delta, moveSkip) : false),
    }),
    [sync, editing, status, stale, pending, root, moveSkip, forgetSlot, forgetSlotOf],
  );

  useEffect(() => {
    if (!conflict) return;
    const t = setTimeout(() => sync.dismissConflict(), TOAST_MS);
    return () => clearTimeout(t);
    // Перезапуск таймера на каждый новый 409.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, conflict?.seq]);

  return (
    <div className={styles.host} ref={hostRef}>
      {shown ? (
        <MethodGraph
          view={shown}
          errors={errors}
          edit={edit}
          highlightBlockId={highlightBlockId}
          pulseBlockId={selectedBlockId}
          focus={focus}
          onBlockClick={onBlockClick}
          onPaneClick={onPaneClick}
        />
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
      {lostInsert && (
        <div role="alert" className={styles.lostInsert}>
          <span>Метод изменился, и места для нового блока больше нет — блок не вставлен. Ваш текст:</span>
          <pre>{lostInsert.text}</pre>
          <span className={styles.staleActions}>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(lostInsert.text)}>
              Скопировать
            </button>
            <button type="button" onClick={() => sync.dismissLostInsert()}>
              Закрыть
            </button>
          </span>
        </div>
      )}
      {menu && (
        <InsertMenu
          options={menu.options}
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          onPick={(o) => {
            setMenu(null);
            forgetSlotOf(menu.point.parent, menu.point.slot);
            void sync.insert(menu.point, o.kind);
          }}
        />
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
