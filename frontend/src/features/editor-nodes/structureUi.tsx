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
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { GraphNodeData } from './blocksToGraph';
import type { InsertOption, InsertPoint } from './blockTree';
import { useNodeEdit } from './editContext';
import type { FlowEdgeData } from './toFlow';
import styles from './MethodCanvas.module.css';

/** Кнопка «+» (Editor.dc.html: круглая, цвет акцента). */
function PlusButton({ point }: { point: InsertPoint }) {
  const edit = useNodeEdit();
  if (!edit) return null;
  return (
    <button
      type="button"
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
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
        {...(!insert && label !== undefined
          ? { label, labelX, labelY, ...(labelStyle ? { labelStyle } : {}), ...(labelBgPadding ? { labelBgPadding } : {}) }
          : {})}
      />
      {insert && (
        <EdgeLabelRenderer>
          <div
            className={`${styles.wireLabel} nodrag nopan`}
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
  return (
    <div className={styles.insertNode} data-testid={`insert-${data.slotKey ?? ''}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.pin} />
      {data.insert && <PlusButton point={data.insert} />}
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
        title="Удалить (Delete)"
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
