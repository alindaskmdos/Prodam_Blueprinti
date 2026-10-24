import type { NodeTypes } from '@xyflow/react';
import { BlockNode, CommentNode, ContainerNode, RawNode, SlotNode } from './nodes';

/** Типы нод React Flow по GraphNodeType. Объект вне компонента — React Flow требует стабильную ссылку. */
export const nodeTypes: NodeTypes = {
  block: BlockNode,
  raw: RawNode,
  comment: CommentNode,
  container: ContainerNode,
  slot: SlotNode,
};
