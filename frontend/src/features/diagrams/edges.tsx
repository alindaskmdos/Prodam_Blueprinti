import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import type { Point } from './diagramLayout';
import { MARKER_COLOR, markerId, polylinePath, type EdgeTone, type EndMarker, type StartMarker } from './edgeGeometry';
import styles from './Diagrams.module.css';

export interface DiagramEdgeData extends Record<string, unknown> {
  /** Ломаная ELK в направлении рисования; нет — прямая между нодами. */
  points: Point[] | null;
  dashed: boolean;
  end: EndMarker;
  start: StartMarker;
  tone: EdgeTone;
  /** Эвристическая связь (UML: агрегация/композиция по полям) — штрих-пунктир, подписи на ребре нет. */
  heuristic?: boolean;
  /**
   * Кратность у конца `to` («1» / «*») и её место (вне карточек; нет места — не рисуется). Передаётся только
   * для связей наведённой/выбранной карточки — на остальных рёбрах подписей нет.
   */
  multiplicity?: string;
  multiplicityAt?: Point | null;
  /** Всплывающая подсказка ребра. */
  title?: string;
}

export type DiagramEdge = Edge<DiagramEdgeData, 'diagram'>;

const TONE_CLASS: Record<EdgeTone, string | undefined> = {
  base: undefined,
  active: styles.edgeActive,
  dim: styles.edgeDim,
  faint: styles.edgeFaint,
  cycle: styles.edgeCycle,
};

/** Ребро диаграммы: ломаная ELK, UML-маркеры на концах, кратность (если передана). */
export function DiagramEdgeView({ id, data, sourceX, sourceY, targetX, targetY }: EdgeProps<DiagramEdge>) {
  if (!data) return null;
  const points = data.points && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  const className = [styles.edgePath, data.dashed ? styles.dashed : '', data.heuristic ? styles.heuristic : '', TONE_CLASS[data.tone] ?? ''].filter(Boolean).join(' ');
  const labelCls = [styles.edgeLabel, data.tone === 'dim' ? styles.labelDim : ''].filter(Boolean).join(' ');
  const mult = data.multiplicity ? (data.multiplicityAt ?? null) : null;
  return (
    <>
      <BaseEdge
        id={id}
        path={polylinePath(points)}
        className={className}
        markerEnd={data.end ? `url(#${markerId(data.end, data.tone)})` : undefined}
        markerStart={data.start ? `url(#${markerId(data.start, data.tone)})` : undefined}
        interactionWidth={12}
      />
      {data.title && (
        <path d={polylinePath(points)} fill="none" stroke="transparent" strokeWidth={12}>
          <title>{data.title}</title>
        </path>
      )}
      {mult && (
        <EdgeLabelRenderer>
          <div className={labelCls} style={{ transform: `translate(-50%, -50%) translate(${mult.x}px, ${mult.y}px)` }}>
            {data.multiplicity}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** SVG-маркеры UML (один раз на диаграмму): полый треугольник, открытая стрелка, ромбы — в трёх тонах. */
export function DiagramMarkers() {
  const tones = ['base', 'active', 'cycle'] as const;
  return (
    <svg className={styles.markers} aria-hidden="true" width="0" height="0">
      <defs>
        {tones.map((tone) => {
          const color = MARKER_COLOR[tone];
          return (
            <g key={tone}>
              <marker
                id={markerId('triangle', tone)}
                viewBox="0 0 16 16"
                refX="15"
                refY="8"
                markerWidth="16"
                markerHeight="16"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M1 1 L15 8 L1 15 Z" style={{ fill: 'var(--jb-bg)', stroke: color, strokeWidth: 1.4 }} />
              </marker>
              <marker
                id={markerId('arrow', tone)}
                viewBox="0 0 14 14"
                refX="13"
                refY="7"
                markerWidth="14"
                markerHeight="14"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M1 1.5 L13 7 L1 12.5" style={{ fill: 'none', stroke: color, strokeWidth: 1.5 }} />
              </marker>
              <marker
                id={markerId('diamond', tone)}
                viewBox="0 0 20 12"
                refX="19"
                refY="6"
                markerWidth="20"
                markerHeight="12"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M1 6 L10 1 L19 6 L10 11 Z" style={{ fill: 'var(--jb-bg)', stroke: color, strokeWidth: 1.4 }} />
              </marker>
              <marker
                id={markerId('diamondFilled', tone)}
                viewBox="0 0 20 12"
                refX="19"
                refY="6"
                markerWidth="20"
                markerHeight="12"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M1 6 L10 1 L19 6 L10 11 Z" style={{ fill: color, stroke: color, strokeWidth: 1.4 }} />
              </marker>
            </g>
          );
        })}
      </defs>
    </svg>
  );
}
