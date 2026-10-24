import type { Node } from '@xyflow/react';
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { GraphNodeData } from './blocksToGraph';
import type { Insets, Size } from './initialView';

/** Ноды, которые изображают сам блок (не рамки контейнера/ветки и не «+»). */
const BLOCK_TYPES = new Set(['block', 'raw', 'comment']);

/** Масштаб, с которым показывается нода при центрировании (не меньше текущего, если тот крупнее). */
export const FOCUS_ZOOM = 1;
export const FOCUS_DURATION_MS = 400;

/**
 * id ноды React Flow для блока: обычная нода или заголовок контейнера (`#head`). Нет на схеме — null.
 */
export function flowNodeOfBlock(nodes: readonly Node<GraphNodeData>[], blockId: string): string | null {
  return nodes.find((n) => n.data.blockId === blockId && BLOCK_TYPES.has(n.type ?? ''))?.id ?? null;
}

/** Часть экземпляра React Flow, нужная для центрирования (в тестах — мок). */
export interface CenterApi {
  getInternalNode: (id: string) =>
    | {
        internals: { positionAbsolute: { x: number; y: number } };
        measured?: { width?: number; height?: number };
        width?: number;
        height?: number;
      }
    | undefined;
  setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => Promise<boolean> | unknown;
  getZoom: () => number;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** Центрирует схему на ноде (абсолютные координаты — с учётом родительских групп). false — ноды нет. */
export function centerOnNode(
  rf: CenterApi,
  nodeId: string,
  reducedMotion = prefersReducedMotion(),
  area?: { size: Size; insets: Insets },
): boolean {
  const node = rf.getInternalNode(nodeId);
  if (!node) return false;
  const { x, y } = node.internals.positionAbsolute;
  const w = node.measured?.width ?? node.width ?? 0;
  const h = node.measured?.height ?? node.height ?? 0;
  const zoom = Math.max(rf.getZoom(), FOCUS_ZOOM);
  // Нода — в центре свободной области (без оверлеев): центр вида сдвигается на разницу центров.
  const shiftX = area ? (area.insets.right - area.insets.left) / 2 / zoom : 0;
  const shiftY = area ? (area.insets.bottom - area.insets.top) / 2 / zoom : 0;
  void rf.setCenter(x + w / 2 + shiftX, y + h / 2 + shiftY, {
    zoom,
    duration: reducedMotion ? 0 : FOCUS_DURATION_MS,
  });
  return true;
}

/** Запрос «показать блок»: seq растёт на каждый новый выбор проблемы. */
export interface FocusRequest {
  blockId: string;
  seq: number;
}

/**
 * Центрирует схему на ноде запроса один раз на seq. Ноды ещё нет (дерево другого метода грузится) —
 * ждёт, пока она появится в `targetNodeId`. `done` — seq, уже показанный (в т.ч. начальным fitView).
 */
export function useFocusCenter(
  rf: CenterApi | null,
  targetNodeId: string | null,
  seq: number | null,
  done: MutableRefObject<number | null>,
  getArea?: () => { size: Size; insets: Insets } | undefined,
): void {
  const first = useRef(true);
  const areaRef = useRef(getArea);
  areaRef.current = getArea;
  useEffect(() => {
    // Первый показ схемы: на ноду уже навёл начальный fitView (fitViewOptions.nodes) — повторно не двигаем.
    if (first.current) {
      first.current = false;
      if (targetNodeId !== null && seq !== null) {
        done.current = seq;
        return;
      }
    }
    if (!rf || targetNodeId === null || seq === null || done.current === seq) return;
    if (centerOnNode(rf, targetNodeId, prefersReducedMotion(), areaRef.current?.())) done.current = seq;
  }, [rf, targetNodeId, seq, done]);
}
