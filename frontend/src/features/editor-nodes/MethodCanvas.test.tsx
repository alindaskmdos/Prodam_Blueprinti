import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState, useAppStore } from '../../app/store';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createApiClient } from '../api';
import { MethodCanvas } from './index';
import styles from './MethodCanvas.module.css';

// React Flow в jsdom требует ResizeObserver и DOMMatrixReadOnly.
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
const methodId = 'com.demo.service.OrderService.merge~0';

describe('MethodCanvas', () => {
  it('загружает метод через GET blocks (моки fixtures) и рисует ноды и контейнеры', async () => {
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    expect(screen.getByText('Загрузка метода…')).toBeInTheDocument();

    expect(await screen.findByTestId('node-method', {}, { timeout: 10_000 })).toHaveTextContent('public int merge()');
    expect(screen.getByText('O(n²)')).toBeInTheDocument();
    expect(screen.getAllByTestId('container-for')).toHaveLength(2);
    expect(screen.getAllByTestId('container-if')).toHaveLength(2);
    expect(screen.getAllByTestId('node-expr')).toHaveLength(4);
    expect(screen.getByTestId('node-return')).toHaveTextContent('return merged');
    expect(screen.getByTestId('node-continue')).toBeInTheDocument();
  }, 15_000);

  it('ошибка загрузки показывается сообщением', async () => {
    server.use(
      http.get('*/api/projects/:projectId/methods/:methodId/blocks', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'метод не найден' }, { status: 404 }),
      ),
    );
    render(<MethodCanvas projectId="p-1" methodId="nope" client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('метод не найден');
  });
});

describe('MethodCanvas — правка текста в ноде (FE-07)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
  });

  /** Нода var «Order a = orders.get(i)». */
  async function varNode(): Promise<HTMLElement> {
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const node = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)'));
    if (!node) throw new Error('нет ноды var a');
    return node;
  }

  function bodies(): { version: number; root: unknown }[] {
    const got: { version: number; root: unknown }[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') void request.clone().json().then((b) => got.push(b as never));
    });
    return got;
  }

  afterEach(() => server.events.removeAllListeners());

  it('двойной клик → редактор с подсветкой; Enter → PUT с версией из стора; 200 → новый текст и версия', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();

    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const editor = within(node).getByTestId('node-editor');
    // Фокус в первом поле; у var поля тип / имя / значение.
    expect(within(editor).getByLabelText('тип')).toHaveFocus();
    const init = within(editor).getByLabelText('=');
    // Слой подсветки (pre) лежит рядом с textarea и показывает тот же текст.
    expect(init.previousElementSibling).toHaveTextContent('orders.get(i)');

    fireEvent.change(init, { target: { value: 'new Order()' } });
    expect(within(editor).getByText('new')).toHaveClass(styles.tok_keyword ?? 'tok_keyword');
    fireEvent.keyDown(init, { key: 'Enter' });

    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(sent[0]?.version).toBe(7);
    await waitFor(() => expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument());
    expect(await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'Order a = new Order()')).toBeInTheDocument();
  }, 15_000);

  it('422 → нода красная с введённым текстом и сообщением; «Отменить правку» возвращает текст', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();

    fireEvent.click(within(node).getByRole('button', { name: /Править/ }));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(i) ==' } });
    fireEvent.keyDown(init, { key: 'Enter' });

    const alert = await screen.findByText(/Синтаксическая ошибка.*В код не попало/, {}, { timeout: 10_000 });
    const red = alert.closest('[data-testid="node-var"]') as HTMLElement;
    expect(red).toHaveAttribute('data-invalid', 'true');
    expect(red).toHaveTextContent('Order a = orders.get(i) ==');
    expect(red).toHaveTextContent('Переменная · ошибка');
    expect(useAppStore.getState().version).toBe(7);

    fireEvent.click(within(red).getByRole('button', { name: 'Отменить правку' }));
    await waitFor(() => expect(screen.queryByText(/В код не попало/)).not.toBeInTheDocument(), { timeout: 10_000 });
    expect(await varNode()).not.toHaveAttribute('data-invalid');
  }, 20_000);

  it('Esc — отмена без запроса', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'zzz' } });
    fireEvent.keyDown(init, { key: 'Escape' });
    expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument();
    expect(node).toHaveTextContent('Order a = orders.get(i)');
    expect(sent).toHaveLength(0);
  }, 15_000);

  it('409 → тост «Проект изменился» и перезагрузка метода', async () => {
    server.use(scenarios.conflictOnBlocks);
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(0)' } });
    fireEvent.blur(init);

    expect(await screen.findByText('Проект изменился')).toBeInTheDocument();
    expect(screen.getByText(/версии 2, сейчас 3/)).toBeInTheDocument();
    expect(await varNode()).toHaveTextContent('Order a = orders.get(i)');
  }, 15_000);

  it('версия в сторе выросла при открытом редакторе → пометка «Метод изменился», черновик цел; «Применить к новому» → PUT', async () => {
    const sent = bodies();
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    const node = await varNode();
    fireEvent.doubleClick(within(node).getByText((_, el) => el?.tagName === 'PRE'));
    const init = within(node).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'orders.get(5)' } });

    act(() => useAppStore.getState().setVersion(12));
    expect(await within(node).findByText(/Метод изменился/)).toBeInTheDocument();
    fireEvent.blur(init);
    expect(within(node).getByLabelText('=')).toHaveValue('orders.get(5)');
    expect(sent).toHaveLength(0);

    fireEvent.click(within(node).getByRole('button', { name: 'Применить к новому' }));
    await waitFor(() => expect(useAppStore.getState().version).toBe(13));
    expect(sent[0]?.version).toBe(12);
  }, 15_000);
});
