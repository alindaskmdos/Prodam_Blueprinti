import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState, useAppStore } from '../../app/store';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { MethodCanvas } from './index';
import { resetEditorView, SHOW_COMMENTS_KEY, SHOW_MINIMAP_KEY, useEditorView } from './viewStore';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

const client = createApiClient('http://localhost/api');
const methodId = 'demo.Deep.run~0';
const FILE = 'src/demo/Deep.java';
type Block = Schemas['Block'];

const span = (startLine: number, endLine = startLine) => ({ file: FILE, startLine, endLine });
const blk = (id: string, kind: Block['kind'], fields: Record<string, string>, slots: Record<string, Block[]>, s: [number, number]): Block => ({
  id,
  kind,
  fields,
  slots,
  span: span(s[0], s[1]),
  issues: id === 'e5' ? ['I-9'] : [],
  collapsed: false,
});

/** for(1) → if(2) → while(3) → for(4) → expr: for(4) по умолчанию свёрнут. Плюс комментарий и return. */
function deepTree(): Block {
  return blk('m', 'method', { signature: 'void run()' }, {
    body: [
      blk('c', 'comment', { text: '// пояснение' }, {}, [5, 5]),
      blk('f1', 'for', { init: 'int i = 0', cond: 'i < n', update: 'i++' }, {
        body: [
          blk('i2', 'if', { cond: 'i > 0' }, {
            then: [
              blk('w3', 'while', { cond: 'ok' }, {
                body: [
                  blk('f4', 'for', { init: 'int j = 0', cond: 'j < m', update: 'j++' }, {
                    body: [blk('e5', 'expr', { text: 'work(i, j)' }, {}, [10, 10])],
                  }, [9, 11]),
                ],
              }, [8, 12]),
            ],
          }, [7, 13]),
        ],
      }, [6, 14]),
      blk('r', 'return', {}, {}, [15, 15]),
    ],
  }, [4, 16]);
}

function serveDeep() {
  server.use(
    http.get('*/api/projects/:projectId/methods/:methodId/blocks', () =>
      HttpResponse.json({ methodId, signature: 'void run()', complexity: 'O(n·m)', root: deepTree() } satisfies Schemas['MethodView']),
    ),
  );
}

function bodies(): { version: number; root: Block }[] {
  const got: { version: number; root: Block }[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT') void request.clone().json().then((b) => got.push(b as never));
  });
  return got;
}

const flowNode = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);

async function renderDeep() {
  serveDeep();
  render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
  await screen.findByTestId('node-method', {}, { timeout: 10_000 });
}

describe('MethodCanvas — сворачивание, мини-карта, комментарии (FE-06)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(SHOW_COMMENTS_KEY);
    } catch {
      // нет хранилища — переключатель по умолчанию
    }
    resetEditorView();
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
    useAppStore.getState().selectMethod(methodId);
  });
  afterEach(() => server.events.removeAllListeners());

  it('вложенность > 3 — свёрнут: заголовок, «1 блок», бейдж проблемы внутри; шеврон разворачивает', async () => {
    await renderDeep();
    const folded = flowNode('f4');
    expect(folded).not.toBeNull();
    const node = within(folded as HTMLElement).getByTestId('node-for');
    expect(node).toHaveAttribute('data-collapsed', 'true');
    expect(within(node).getByTestId('collapsed-count')).toHaveTextContent('1 блок');
    expect(within(node).getByTitle('I-9')).toBeInTheDocument();
    expect(screen.queryByTestId('node-expr')).not.toBeInTheDocument();
    // «+» внутри свёрнутого нет.
    expect(flowNode('f4#add:body')).toBeNull();

    fireEvent.click(within(node).getByRole('button', { name: 'Развернуть: Цикл for' }));
    expect(await screen.findByTestId('node-expr', {}, { timeout: 10_000 })).toHaveTextContent('work(i, j)');
    expect(flowNode('f4#head')).not.toBeNull();
  }, 20_000);

  it('мини-карта по умолчанию скрыта; кнопка в Controls показывает и скрывает, выбор запоминается', async () => {
    await renderDeep();
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать мини-карту' }));
    expect(document.querySelector('.react-flow__minimap')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Мини-карта схемы' })).toBeInTheDocument();
    expect(localStorage.getItem(SHOW_MINIMAP_KEY)).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть мини-карту' }));
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    localStorage.removeItem(SHOW_MINIMAP_KEY);
  }, 15_000);

  it('«Свернуть всё» / «Развернуть всё»; клик по свёрнутому разворачивает', async () => {
    await renderDeep();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть всё' }));
    await waitFor(() => expect(flowNode('i2#head')).toBeNull(), { timeout: 10_000 });
    expect(within(flowNode('f1') as HTMLElement).getByTestId('collapsed-count')).toHaveTextContent('4 блока');

    fireEvent.click(flowNode('f1') as HTMLElement);
    await waitFor(() => expect(flowNode('i2')).not.toBeNull(), { timeout: 10_000 });
    expect(flowNode('f1#head')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть всё' }));
    expect(await screen.findByTestId('node-expr', {}, { timeout: 10_000 })).toBeInTheDocument();
  }, 20_000);

  it('выбор проблемы внутри свёрнутого → путь разворачивается, нода на схеме', async () => {
    await renderDeep();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть всё' }));
    await waitFor(() => expect(flowNode('i2#head')).toBeNull(), { timeout: 10_000 });
    act(() => useAppStore.getState().selectIssue({ issueId: 'I-9', methodId, blockId: 'e5' }));
    await waitFor(() => expect(flowNode('e5')).not.toBeNull(), { timeout: 10_000 });
    expect(flowNode('f1#head')).not.toBeNull();
  }, 20_000);

  it('курсор в коде на строке внутри свёрнутого → путь разворачивается', async () => {
    await renderDeep();
    act(() => useAppStore.getState().setHighlight({ source: 'code', span: span(10) }));
    await waitFor(() => expect(flowNode('e5')).not.toBeNull(), { timeout: 10_000 });
  }, 20_000);

  it('«Комментарии» выкл → стикера нет, но PUT отправляет полное дерево с комментарием', async () => {
    const sent = bodies();
    await renderDeep();
    expect(screen.getByTestId('node-comment')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Комментарии' }));
    await waitFor(() => expect(screen.queryByTestId('node-comment')).not.toBeInTheDocument(), { timeout: 10_000 });
    expect(localStorage.getItem(SHOW_COMMENTS_KEY)).toBe('false');

    fireEvent.click(within(screen.getByTestId('node-return')).getByRole('button', { name: /Выше/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.root.slots.body?.map((x) => x.kind)).toEqual(['comment', 'return', 'for']);
    expect(sent[0]?.root.slots.body?.[0]?.fields.text).toBe('// пояснение');
  }, 20_000);

  it('«Комментарии» выкл → ↑ не меняет блок со скрытым комментарием; ↓ — с видимым соседом', async () => {
    const sent = bodies();
    await renderDeep();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Комментарии' }));
    await waitFor(() => expect(screen.queryByTestId('node-comment')).not.toBeInTheDocument(), { timeout: 10_000 });
    const head = within(flowNode('f1#head') as HTMLElement);
    expect(head.getByRole('button', { name: /Выше/ })).toBeDisabled();

    fireEvent.click(head.getByRole('button', { name: /Ниже/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.root.slots.body?.map((x) => x.kind)).toEqual(['comment', 'return', 'for']);
  }, 20_000);

  it('после своей ↑↓ состояние сворачивания слота сбрасывается (id позиционные)', async () => {
    await renderDeep();
    fireEvent.click(within(flowNode('f1#head') as HTMLElement).getByRole('button', { name: 'Свернуть: Цикл for' }));
    await waitFor(() => expect(flowNode('i2#head')).toBeNull(), { timeout: 10_000 });
    expect(useEditorView.getState().collapsed[methodId]).toEqual({ f1: true });
    fireEvent.click(within(screen.getByTestId('node-return')).getByRole('button', { name: /Выше/ }));
    await waitFor(() => expect(useEditorView.getState().collapsed[methodId]).toEqual({}));
  }, 20_000);

  it('выделенная нода скрыта сворачиванием → Delete ничего не удаляет', async () => {
    const sent = bodies();
    await renderDeep();
    const head = flowNode('i2#head') as HTMLElement;
    fireEvent.click(head);
    await waitFor(() => expect(flowNode('i2#head')).toHaveClass('selected'));

    fireEvent.click(within(flowNode('f1#head') as HTMLElement).getByRole('button', { name: 'Свернуть: Цикл for' }));
    await waitFor(() => expect(flowNode('i2#head')).toBeNull(), { timeout: 10_000 });
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toHaveLength(0);
  }, 20_000);
});
