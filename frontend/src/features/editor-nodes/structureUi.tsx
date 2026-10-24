import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { GraphNodeData } from './blocksToGraph';
import { STATEMENT_OPTIONS, type InsertOption, type InsertPoint } from './blockTree';
import { useNodeEdit } from './editContext';
import { useEditorView } from './viewStore';
import type { BlockKind } from './kinds';
import type { FlowEdgeData } from './toFlow';
import styles from './MethodCanvas.module.css';

/** Тип данных drag из палитры; kind дублируется в `draggedKind`, потому что на dragover getData недоступен. */
const DRAG_MIME = 'application/x-jb-block';
let draggedKind: BlockKind | null = null;

/**
 * Палитра типов блоков (FE-09): те же kind, что в меню «+»; тащится на стрелку схемы. Без drag — «+».
 * По умолчанию свёрнута в кнопку «+ Блок» (раскрытая закрывала левую треть холста); состояние запоминается.
 */
export function BlockPalette() {
  const edit = useNodeEdit();
  const open = useEditorView((s) => s.paletteOpen);
  const setOpen = useEditorView((s) => s.setPaletteOpen);
  if (!edit) return null;
  return (
    <div className={`${styles.paletteWrap} nodrag nopan`}>
      <button
        type="button"
        className={styles.paletteToggle}
        aria-expanded={open}
        aria-label="Палитра блоков"
        title={open ? 'Свернуть палитру блоков' : 'Палитра блоков: перетащите блок на стрелку схемы'}
        data-testid="palette-toggle"
        onClick={() => setOpen(!open)}
      >
        {open ? '× Блок' : '+ Блок'}
      </button>
      {open && (
        <div className={styles.palette} role="list" aria-label="Палитра блоков" data-testid="palette">
          {STATEMENT_OPTIONS.map((o) => (
            <div
              key={o.kind}
              role="listitem"
              className={styles.paletteItem}
              draggable={edit.structure}
              aria-disabled={!edit.structure}
              aria-label={`Перетащить на стрелку: ${o.label}`}
              title={`${o.label} — перетащите на стрелку (или нажмите «+» на ней)`}
              data-kind={o.kind}
              onDragStart={(e) => {
                draggedKind = o.kind;
                e.dataTransfer.setData(DRAG_MIME, o.kind);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={() => {
                draggedKind = null;
              }}
            >
              <span className={styles.menuSwatch} style={{ background: `var(--jb-node-${o.kind})` }} aria-hidden="true" />
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Drop-цель палитры (FE-09): стрелка и «+» в конце слота. Подсвечивается, только если такой kind сюда можно вставить. */
function useDropTarget(insert: InsertPoint | undefined) {
  const edit = useNodeEdit();
  const [over, setOver] = useState(false);
  const drop = insert && {
    onDragOver: (e: DragEvent) => {
      if (draggedKind && edit?.canDrop(insert, draggedKind)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false);
      const kind = (e.dataTransfer.getData(DRAG_MIME) || draggedKind) as BlockKind | null;
      draggedKind = null;
      if (!kind || !edit?.canDrop(insert, kind)) return;
      e.preventDefault();
      edit.dropInsert(insert, kind);
    },
  };
  return { over, drop };
}

/** Кнопка «+» (Editor.dc.html: круглая, цвет акцента). */
function PlusButton({ point, drop, over }: { point: InsertPoint; drop?: ReturnType<typeof useDropTarget>['drop']; over?: boolean }) {
  const edit = useNodeEdit();
  if (!edit) return null;
  return (
    <button
      type="button"
      {...drop}
      data-over={over || undefined}
      className={`${styles.plus} nodrag nopan`}
      aria-label="Вставить блок"
      title="Вставить блок"
      disabled={!edit.structure}
      data-insert={`${point.parent}/${point.slot}/${point.index}`}
      // Без смены фокуса: открытый редактор применяется своим blur до клика сам.
      onClick={(e) => {
        e.stopPropagation();
        edit.requestInsert(point, e.currentTarget);
      }}
    >
      +
    </button>
  );
}

/**
 * Стрелка схемы: smoothstep, подпись ветки (да / нет). С местом вставки и в режиме правки — «+» посередине.
 * Пользователь стрелки не рисует: «+» вставляет блок в дерево, стрелки строятся заново из дерева.
 */
export function FlowEdge(props: EdgeProps<Edge<FlowEdgeData>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props;
  const { label, labelStyle, labelBgPadding } = props;
  const edit = useNodeEdit();
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const insert = edit ? data?.insert : undefined;
  const { over, drop } = useDropTarget(insert);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style || over ? { style: { ...style, ...(over ? { stroke: 'var(--jb-accent)', strokeWidth: 3 } : {}) } } : {})}
        {...(!insert && label !== undefined
          ? { label, labelX, labelY, ...(labelStyle ? { labelStyle } : {}), ...(labelBgPadding ? { labelBgPadding } : {}) }
          : {})}
      />
      {insert && drop && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={28}
          style={{ pointerEvents: 'stroke' }}
          data-testid={`drop-${insert.parent}/${insert.slot}/${insert.index}`}
          {...drop}
        />
      )}
      {insert && (
        <EdgeLabelRenderer>
          <div
            {...drop}
            className={`${styles.wireLabel} nodrag nopan`}
            data-over={over || undefined}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label !== undefined && (
              <span className={styles.wireText} style={labelStyle}>
                {label}
              </span>
            )}
            <PlusButton point={insert} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** «+» в конце слота или в пустом слоте (if без else, пустое тело цикла). */
export function InsertNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const { over, drop } = useDropTarget(data.insert);
  return (
    <div className={styles.insertNode} data-testid={`insert-${data.slotKey ?? ''}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.pin} />
      {data.insert && <PlusButton point={data.insert} drop={drop} over={over} />}
    </div>
  );
}

/** Кнопки ↑ ↓ ✕ в заголовке ноды (не у method). */
export function NodeTools({ data }: { data: GraphNodeData }) {
  const edit = useNodeEdit();
  if (!edit || data.path === 'root' || edit.editing === data.path) return null;
  const off = !edit.structure;
  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <span className={`${styles.tools} nodrag`}>
      <button
        type="button"
        aria-label={`Выше: ${data.title}`}
        title="Выше (Alt+↑)"
        disabled={off || !edit.canMove(data.path, -1)}
        onClick={stop(() => edit.move(data.path, -1))}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Ниже: ${data.title}`}
        title="Ниже (Alt+↓)"
        disabled={off || !edit.canMove(data.path, 1)}
        onClick={stop(() => edit.move(data.path, 1))}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={`Удалить: ${data.title}`}
        title="Удалить (Delete или Backspace на выделенной ноде)"
        disabled={off}
        onClick={stop(() => edit.remove(data.path))}
      >
        ✕
      </button>
    </span>
  );
}

export interface InsertMenuProps {
  options: InsertOption[];
  /** Позиция относительно холста. */
  x: number;
  y: number;
  onPick: (option: InsertOption) => void;
  onClose: () => void;
}

/** Меню выбора kind для «+»: Esc или клик мимо — закрыть. */
export function InsertMenu({ options, x, y, onPick, onClose }: InsertMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const down = (e: MouseEvent) => {
      if (ref.current && e.target instanceof globalThis.Node && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Вставить блок"
      className={styles.insertMenu}
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {options.map((o) => (
        <button key={o.kind} type="button" role="menuitem" data-kind={o.kind} onClick={() => onPick(o)}>
          <span className={styles.menuSwatch} style={{ background: `var(--jb-node-${o.kind})` }} aria-hidden="true" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
