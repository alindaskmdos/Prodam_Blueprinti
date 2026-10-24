import { fireEvent, render } from '@testing-library/react';
import { Position, ReactFlowProvider, type Edge, type EdgeProps } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeEditContext, type NodeEditApi } from './editContext';
import { BlockPalette, FlowEdge } from './structureUi';
import type { FlowEdgeData } from './toFlow';
import { resetEditorView, useEditorView } from './viewStore';

const point = { parent: 'root', slot: 'body', index: 1 };
const dt = (kind?: string) => ({ types: [], getData: () => kind ?? '', setData: () => {}, dropEffect: '', effectAllowed: '' });
const highlighted = () => document.querySelector('path[style*="--jb-accent"]');

function setup(canDrop = true) {
  useEditorView.getState().setPaletteOpen(true); // палитра по умолчанию свёрнута
  const edit = { structure: true, canDrop: vi.fn(() => canDrop), dropInsert: vi.fn() } as unknown as NodeEditApi;
  const props = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 0,
    targetY: 100,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { insert: point },
  } as unknown as EdgeProps<Edge<FlowEdgeData>>;
  const { container } = render(
    <ReactFlowProvider>
      <NodeEditContext.Provider value={edit}>
        <BlockPalette />
        <svg>
          <FlowEdge {...props} />
        </svg>
      </NodeEditContext.Provider>
    </ReactFlowProvider>,
  );
  const zone = container.querySelector('[data-testid="drop-root/body/1"]') as Element;
  const item = container.querySelector('[data-testid="palette"] [data-kind="while"]') as Element;
  return { edit, zone, item };
}

describe('FlowEdge — drop из палитры (FE-09)', () => {
  afterEach(() => {
    localStorage.clear();
    resetEditorView();
  });

  it('над стрелкой подсвечивается, dragleave снимает, drop вставляет kind в место стрелки', () => {
    const { edit, zone, item } = setup();
    fireEvent.dragStart(item, { dataTransfer: dt() });
    fireEvent.dragOver(zone, { dataTransfer: dt() });
    expect(highlighted()).not.toBeNull();
    fireEvent.dragLeave(zone);
    expect(highlighted()).toBeNull();
    fireEvent.drop(zone, { dataTransfer: dt('while') });
    expect(edit.dropInsert).toHaveBeenCalledWith(point, 'while');
  });

  it('сюда нельзя (canDrop=false) — нет подсветки и вставки', () => {
    const { edit, zone, item } = setup(false);
    fireEvent.dragStart(item, { dataTransfer: dt() });
    fireEvent.dragOver(zone, { dataTransfer: dt() });
    expect(highlighted()).toBeNull();
    fireEvent.drop(zone, { dataTransfer: dt('while') });
    expect(edit.dropInsert).not.toHaveBeenCalled();
  });

  it('drop без drag из палитры (чужой файл / текст) ничего не вставляет', () => {
    const { edit, zone } = setup();
    fireEvent.dragOver(zone, { dataTransfer: dt() });
    expect(highlighted()).toBeNull();
    fireEvent.drop(zone, { dataTransfer: dt() });
    expect(edit.dropInsert).not.toHaveBeenCalled();
  });
});
