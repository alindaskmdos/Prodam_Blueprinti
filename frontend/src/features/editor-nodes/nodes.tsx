import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { GraphNodeData } from './blocksToGraph';
import { highlightJava } from './highlightJava';
import { kindMeta } from './kinds';
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

function JavaText({ text }: { text: string }) {
  return (
    <>
      {highlightJava(text).map((t, i) =>
        t.type === 'plain' ? t.text : (
          <span key={i} className={styles[`tok_${t.type}`]}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
}

function kindColor(data: GraphNodeData): CSSProperties {
  return { '--kind': kindMeta(data.kind).color } as CSSProperties;
}

function IssueBadge({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <span className={styles.issueBadge} title={issues.join(', ')}>
      !
    </span>
  );
}

/** Обычная нода и заголовок контейнера: цветной заголовок по kind, выражение моноширинным. */
export function BlockNode({ data }: NodeProps<FlowNode>) {
  const hasIssues = data.issues.length > 0;
  return (
    <div
      className={`${styles.node} ${hasIssues ? styles.hasIssue : ''}`}
      style={kindColor(data)}
      data-kind={data.kind}
      data-testid={`node-${data.kind}`}
    >
      <Pins />
      <div className={`${styles.header} ${data.kind === 'method' ? styles.headerLight : ''}`}>
        <span>{data.title}</span>
        {data.badge && <span className={styles.badge}>{data.badge}</span>}
        <IssueBadge issues={data.issues} />
      </div>
      <pre className={styles.body} title={data.text}>
        <JavaText text={data.text} />
      </pre>
    </div>
  );
}

/** raw — неподдержанная конструкция: исходный текст как есть, пунктирная рамка. */
export function RawNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`${styles.node} ${styles.raw}`} data-kind={data.kind} data-testid="node-raw">
      <Pins />
      <div className={`${styles.header} ${styles.rawHeader}`}>
        <span>{data.title}</span>
        <IssueBadge issues={data.issues} />
      </div>
      <pre className={`${styles.body} ${styles.rawBody}`}>{data.text}</pre>
    </div>
  );
}

/** Комментарий — жёлтый стикер. */
export function CommentNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={styles.comment} data-kind="comment" data-testid="node-comment">
      <Pins />
      <pre className={styles.commentText}>{data.text}</pre>
    </div>
  );
}

/** Group-нода контейнера: рамка цвета kind, внутри заголовок и ветки. */
export function ContainerNode({ data }: NodeProps<FlowNode>) {
  return (
    <div
      className={`${styles.container} ${data.issues.length > 0 ? styles.containerIssue : ''}`}
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
