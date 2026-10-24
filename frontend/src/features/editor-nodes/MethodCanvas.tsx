import { Background, BackgroundVariant, Controls, ReactFlow, useReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, type LineSpan } from '../../app/store';
import { api, type ApiClient, type Schemas } from '../api';
import { blockAt, withFields, type BlockPath } from './blockEdit';
import { currentRoot, type ConflictInfo, type InvalidEdit } from './blockSync';
import { canMove, insertOptions, nestedCount, type InsertOption, type InsertPoint } from './blockTree';
import { blockAtLine } from './blockLocate';
import { blocksToGraph, type GraphNodeData } from './blocksToGraph';
import { NodeEditContext, type NodeEditApi } from './editContext';
import { FOCUS_ZOOM, flowNodeOfBlock, useFocusCenter, type FocusRequest } from './focus';
import { layoutGraph } from './layout';
import { edgeTypes, nodeTypes } from './nodeTypes';
import { InsertMenu } from './structureUi';
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
function FocusCenter({ targetNodeId, seq, done }: { targetNodeId: string | null; seq: number | null; done: { current: number | null } }) {
  const rf = useReactFlow();
  useFocusCenter(rf, targetNodeId, seq, done);
  return null;
}

/** Клавиша пришла из поля ввода (инлайн-редактор, Monaco) — не команда схемы. */
function fromTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

/**
 * Схема метода: дерево блоков → ELK → React Flow. С `edit` — тексты нод правятся (FE-07), «+» на стрелках,
 * удаление и вверх/вниз (FE-08): Delete / Alt+↑ / Alt+↓ на выделенной ноде.
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
  const graph = useMemo(
    () => blocksToGraph(view.root, { methodBadge: view.complexity, insertable, ...(errors ? { errors } : {}) }),
    [view, errors, insertable],
  );
  // Выделение своё: ноды React Flow контролируемые (без onNodesChange), selected проставляется при рендере.
  // Выделение привязано к дереву, на котором сделано: любая смена дерева (↑↓✕, вставка, 409, правка извне)
  // его сбрасывает — иначе путь указал бы на другой блок и Delete удалил бы не тот.
  const [rawSelection, setRawSelection] = useState<{ id: string; path: BlockPath; root: Schemas['Block'] } | null>(null);
  const selection = rawSelection && rawSelection.root === view.root ? rawSelection : null;
  const setSelection = (s: { id: string; path: BlockPath } | null) =>
    setRawSelection(s ? { ...s, root: view.root } : null);
  const selected = selection?.path ?? null;
  const editRef = useRef(edit);
  editRef.current = edit;

  useEffect(() => {
    if (!insertable || selected === null || selected === 'root') return;
    const onKey = (e: KeyboardEvent) => {
      const api = editRef.current;
      if (!api || fromTextInput(e.target) || e.defaultPrevented) return;
      if (e.key === 'Delete') {
        e.preventDefault();
        api.remove(selected);
        setSelection(null);
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
          nodes={nodes}
          edges={layout.flow.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, n) => {
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
          zoomOnDoubleClick={false}
          colorMode="dark"
          fitView
          {...(initialFit ? { fitViewOptions: initialFit } : {})}
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
          <FocusCenter targetNodeId={focusNodeId} seq={focusSeq} done={focusDone} />
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
      remove: (path) => {
        const block = root && blockAt(root, path);
        if (!block) return;
        const n = nestedCount(block);
        if (n > 0 && !window.confirm(`Удалить блок вместе с содержимым (вложенных блоков: ${n})?`)) return;
        void sync.remove(path);
      },
      move: (path, delta) => void sync.move(path, delta),
      canMove: (path, delta) => (root ? canMove(root, path, delta) : false),
    }),
    [sync, editing, status, stale, pending, root],
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
