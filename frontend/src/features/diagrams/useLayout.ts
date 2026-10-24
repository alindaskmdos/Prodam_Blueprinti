import { useEffect, useState } from 'react';
import { layoutDiagram, type DiagramLayout, type LayoutEdge, type LayoutNode } from './diagramLayout';

export type LayoutState<M> =
  | { status: 'pending'; model: null; layout: null }
  | { status: 'ready'; model: M; layout: DiagramLayout }
  | { status: 'error'; model: null; layout: null; message: string };

/**
 * Раскладка ELK для модели диаграммы. Пока считается новая (новая версия проекта) — видна прежняя:
 * React Flow не пересоздаётся, масштаб и сдвиг сохраняются.
 */
export function useLayout<M extends { nodes: readonly LayoutNode[]; edges: readonly LayoutEdge[] }>(
  model: M | null,
  options?: Record<string, string>,
): LayoutState<M> {
  const [state, setState] = useState<LayoutState<M>>({ status: 'pending', model: null, layout: null });
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    layoutDiagram(model.nodes, model.edges, options).then(
      (layout) => {
        if (!cancelled) setState({ status: 'ready', model, layout });
      },
      (e: unknown) => {
        if (!cancelled) setState({ status: 'error', model: null, layout: null, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      cancelled = true;
    };
    // options — константа модуля у вызывающих.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  return state;
}
