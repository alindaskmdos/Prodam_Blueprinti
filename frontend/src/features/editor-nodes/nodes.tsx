import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { runCommand } from '../../app/commands';
import { useAiFeature } from '../ai';
import { useAnalysisStore } from '../analysis-panel/analysisStore';
import { issueTooltip } from '../analysis-panel/format';
import { editableFields } from './blockEdit';
import type { GraphNodeData } from './blocksToGraph';
import { blocksLabel } from './collapse';
import { useCollapse } from './collapseContext';
import { useNodeEdit } from './editContext';
import { JavaText } from './JavaText';
import { kindMeta } from './kinds';
import { NodeTextEditor } from './NodeTextEditor';
import { explainParseError } from './parseError';
import { NodeTools } from './structureUi';
import styles from './MethodCanvas.module.css';

type FlowNode = Node<GraphNodeData>;

function Pins() {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className={styles.pin} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.pin} />
    </>
  );
}

function kindColor(data: GraphNodeData): CSSProperties {
  return { '--kind': kindMeta(data.kind).color } as CSSProperties;
}

/** «!» в заголовке: подсказка — русское название правила, серьёзность и текст каждой проблемы ноды. */
export function IssueBadge({ issues }: { issues: string[] }) {
  const all = useAnalysisStore((s) => s.analysis?.issues);
  if (issues.length === 0) return null;
  return (
    <span className={styles.issueBadge} title={issueTooltip(issues, all)}>
      !
    </span>
  );
}

/**
 * Кнопка сворачивания (FE-06) в заголовке контейнера рядом с ↑ ↓ ✕: ▾ — развёрнут (свернуть), ▸ — свёрнут (развернуть).
 * locked — внутри открыт редактор или красная нода: свернуть нельзя.
 */
function CollapseToggle({ data }: { data: GraphNodeData }) {
  const api = useCollapse();
  const c = data.collapse;
  if (!c || !api) return null;
  return (
    <button
      type="button"
      className={`${styles.collapseBtn} nodrag`}
      aria-label={c.collapsed ? `Развернуть: ${data.title}` : `Свернуть: ${data.title}`}
      aria-expanded={!c.collapsed}
      title={c.locked ? 'Внутри идёт правка — свернуть нельзя' : c.collapsed ? 'Развернуть' : 'Свернуть'}
      disabled={c.locked}
      onClick={(ev) => {
        ev.stopPropagation();
        api.setCollapsed(c.key, !c.collapsed);
      }}
    >
      {c.collapsed ? '▸' : '▾'}
    </button>
  );
}

/** Сводка свёрнутого контейнера: «N блоков». */
function HiddenBadge({ data }: { data: GraphNodeData }) {
  if (!data.collapse?.collapsed) return null;
  return (
    <span className={styles.badge} data-testid="collapsed-count">
      {blocksLabel(data.collapse.hidden ?? 0)}
    </span>
  );
}

/** Правка текста ноды: состояние редактора для data.path (null — нода только для просмотра). */
function useEditing(data: GraphNodeData) {
  const edit = useNodeEdit();
  if (!edit || !data.editable) return null;
  return { edit, open: edit.editing === data.path };
}

/** Кнопка «править» в заголовке. */
function EditButton({ data }: { data: GraphNodeData }) {
  const e = useEditing(data);
  if (!e || e.open) return null;
  return (
    <button
      type="button"
      className={`${styles.editBtn} nodrag`}
      aria-label={`Править: ${data.title}`}
      title="Править текст (двойной клик или Enter на выделенной ноде)"
      disabled={e.edit.saving}
      onClick={(ev) => {
        ev.stopPropagation();
        e.edit.startEdit(data.path);
      }}
    >
      ✎
    </button>
  );
}

/**
 * ИИ-кнопки в заголовке (FE-24, по /capabilities; нет функции — кнопки нет): «Объясни метод» на ноде метода,
 * «Изменить текстом (ИИ)» на ноде блока (на ноде метода — правка всего метода). Работают через команды ai.*.
 */
function AiTools({ data }: { data: GraphNodeData }) {
  const edit = useNodeEdit();
  const canExplain = useAiFeature('explain');
  const canEdit = useAiFeature('edit-node');
  if (!edit || edit.editing === data.path) return null;
  const isMethod = data.path === 'root';
  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };
  if (!(isMethod && canExplain) && !canEdit) return null;
  return (
    <span className={`${styles.tools} nodrag`}>
      {isMethod && canExplain && (
        <button
          type="button"
          aria-label="Объясни метод"
          title="Объяснить метод (ИИ)"
          onClick={stop(() => runCommand('ai.explain'))}
        >
          <ExplainIcon />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          aria-label={`Изменить текстом (ИИ): ${data.title}`}
          title="Изменить текстом (ИИ): опишите правку, сначала будет показан дифф"
          disabled={edit.saving}
          onClick={stop(() => runCommand('ai.edit', { blockId: data.blockId }))}
        >
          <SparkIcon />
        </button>
      )}
    </span>
  );
}

/** «Объясни метод»: облачко с «?» (12×12, цвет текста заголовка). */
function ExplainIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" strokeLinejoin="round" />
      <path d="M6.4 5.6a1.6 1.6 0 1 1 2.2 1.5c-.4.2-.6.5-.6.9v.3" strokeLinecap="round" />
      <circle cx="8" cy="9.6" r=".4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** «Изменить текстом (ИИ)»: искра — общепринятый знак ИИ. */
function SparkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5c.3 2.9 1.6 4.2 4.5 4.5-2.9.3-4.2 1.6-4.5 4.5-.3-2.9-1.6-4.2-4.5-4.5 2.9-.3 4.2-1.6 4.5-4.5Z" />
      <path d="M12.5 9.5c.15 1.4.8 2.05 2 2.2-1.2.15-1.85.8-2 2.3-.15-1.5-.8-2.15-2-2.3 1.2-.15 1.85-.8 2-2.2Z" />
    </svg>
  );
}

/**
 * Тело ноды: текст (двойной клик — правка), инлайн-редактор или — для красной ноды — сообщение об ошибке.
 * view — как показывается текст без редактора.
 */
function EditableBody({ data, className, view }: { data: GraphNodeData; className: string; view: ReactNode }) {
  const e = useEditing(data);
  if (e?.open) {
    return (
      <NodeTextEditor
        key={data.path}
        specs={editableFields(data)}
        initial={e.edit.draftFor(data.path)}
        saving={e.edit.saving}
        stale={e.edit.stale}
        onApply={(draft) => e.edit.apply(data.path, draft)}
        onRebase={(draft) => e.edit.rebase(data.path, draft)}
        onCancel={e.edit.cancelEdit}
      />
    );
  }
  return (
    <>
      <pre
        className={className}
        title={data.text}
        onDoubleClick={
          e
            ? (ev) => {
                ev.stopPropagation();
                e.edit.startEdit(data.path);
              }
            : undefined
        }
      >
        {view}
      </pre>
      {data.error !== undefined && (
        <div className={styles.nodeError} role="alert" title={explainParseError(data.error).details}>
          <span>{explainParseError(data.error).text} В код не попало.</span>
          {e && (
            <button type="button" className={`${styles.errorUndo} nodrag`} onClick={e.edit.discardInvalid}>
              Отменить правку
            </button>
          )}
        </div>
      )}
    </>
  );
}

function stateClass(data: GraphNodeData): string {
  return data.error !== undefined ? styles.invalid ?? '' : '';
}

/** Обычная нода и заголовок контейнера: цветной заголовок по kind, выражение моноширинным. */
export function BlockNode({ data }: NodeProps<FlowNode>) {
  const hasIssues = data.issues.length > 0;
  return (
    <div
      className={`${styles.node} ${hasIssues ? styles.hasIssue : ''} ${stateClass(data)}`}
      style={kindColor(data)}
      data-kind={data.kind}
      data-testid={`node-${data.kind}`}
      data-invalid={data.error !== undefined || undefined}
      data-collapsed={data.collapse?.collapsed || undefined}
    >
      <Pins />
      <div className={`${styles.header} ${data.kind === 'method' ? styles.headerLight : ''}`}>
        <span className={styles.headerTitle}>
          {data.error !== undefined ? `${data.title} · ошибка` : data.title}
        </span>
        {data.badge && (
          <span className={`${styles.badge} ${styles.badgeFit}`} title={data.badge}>
            {data.badge}
          </span>
        )}
        <HiddenBadge data={data} />
        <IssueBadge issues={data.issues} />
        <CollapseToggle data={data} />
        <EditButton data={data} />
        <AiTools data={data} />
        <NodeTools data={data} />
      </div>
      <EditableBody data={data} className={styles.body ?? ''} view={<JavaText text={data.text} />} />
    </div>
  );
}

/** raw — неподдержанная конструкция: исходный текст как есть, пунктирная рамка. */
export function RawNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`${styles.node} ${styles.raw} ${stateClass(data)}`}
      data-kind={data.kind}
      data-testid="node-raw"
      data-invalid={data.error !== undefined || undefined}
      data-collapsed={data.collapse?.collapsed || undefined}
    >
      <Pins />
      <div className={`${styles.header} ${styles.rawHeader}`}>
        <span className={styles.headerTitle}>
          {data.title}
        </span>
        <HiddenBadge data={data} />
        <IssueBadge issues={data.issues} />
        <CollapseToggle data={data} />
        <EditButton data={data} />
        <AiTools data={data} />
        <NodeTools data={data} />
      </div>
      <EditableBody data={data} className={`${styles.body} ${styles.rawBody}`} view={data.text} />
    </div>
  );
}

/** Комментарий — жёлтый стикер. */
export function CommentNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`${styles.comment} ${stateClass(data)}`}
      data-kind="comment"
      data-testid="node-comment"
      data-invalid={data.error !== undefined || undefined}
    >
      <Pins />
      <span className={styles.commentTools}>
        <EditButton data={data} />
        <NodeTools data={data} />
      </span>
      <EditableBody data={data} className={styles.commentText ?? ''} view={data.text} />
    </div>
  );
}

/** Group-нода контейнера: рамка цвета kind, внутри заголовок и ветки. */
export function ContainerNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`${styles.container} ${data.issues.length > 0 || data.error !== undefined ? styles.containerIssue : ''}`}
      style={kindColor(data)}
      data-kind={data.kind}
      data-testid={`container-${data.kind}`}
    >
      <Pins />
    </div>
  );
}

/** Рамка ветки контейнера с несколькими ветками (then/else, try/catch/finally). */
export function SlotNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={styles.slot} style={kindColor(data)} data-testid={`slot-${data.slotKey ?? ''}`}>
      <Pins />
    </div>
  );
}
