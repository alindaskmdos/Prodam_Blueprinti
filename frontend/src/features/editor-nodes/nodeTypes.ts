import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { BlockNode, CommentNode, ContainerNode, RawNode, SlotNode } from './nodes';
import { FlowEdge, InsertNode } from './structureUi';

/** Типы нод React Flow по GraphNodeType. Объект вне компонента — React Flow требует стабильную ссылку. */
export const nodeTypes: NodeTypes = {
  block: BlockNode,
  raw: RawNode,
  comment: CommentNode,
  container: ContainerNode,
  slot: SlotNode,
  insert: InsertNode,
};

/** Стрелки: smoothstep с «+» (FE-08). */
export const edgeTypes: EdgeTypes = { flow: FlowEdge };
