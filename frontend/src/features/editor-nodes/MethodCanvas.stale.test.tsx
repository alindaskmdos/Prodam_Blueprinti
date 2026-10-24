import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState, useAppStore } from '../../app/store';
import { server } from '../../mocks/server';
import { createApiClient } from '../api';
import { MethodCanvas } from './index';

// Раскладка: первый вызов сразу, остальные ждут release() — окно «показана прежняя схема, дерево уже новое».
const gate = vi.hoisted(() => ({ calls: 0, release: () => {}, wait: null as Promise<void> | null }));
vi.mock('./layout', async (orig) => {
  const real = await orig<typeof import('./layout')>();
  return {
    ...real,
    layoutGraph: async (...args: Parameters<typeof real.layoutGraph>) => {
      gate.calls += 1;
      if (gate.calls > 1) await gate.wait;
      return real.layoutGraph(...args);
    },
  };
});

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

describe('MethodCanvas — правки на время раскладки (FE-29)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 7);
    gate.calls = 0;
    gate.wait = new Promise<void>((r) => {
      gate.release = r;
    });
  });
  afterEach(() => {
    gate.release();
    server.events.removeAllListeners();
  });

  it('пока считается новая раскладка, двойной клик и Delete не запускают правку', async () => {
    const puts: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') puts.push(request.url);
    });
    render(<MethodCanvas projectId="p-1" methodId={methodId} client={client} />);
    await screen.findByTestId('node-method', {}, { timeout: 10_000 });
    const first = screen.getAllByTestId('node-var').find((n) => n.textContent?.includes('a = orders.get(i)')) as HTMLElement;
    const find = () =>
      screen.getAllByTestId('node-var').find((n) => /a = (orders\.get\(i\)|new Order\(\))/.test(n.textContent ?? '')) ?? first;
    const pre = () => within(find()).getByText((_, el) => el?.tagName === 'PRE');

    // Правка применена → дерево новое, раскладка висит.
    fireEvent.doubleClick(pre());
    const init = within(first).getByLabelText('=');
    fireEvent.change(init, { target: { value: 'new Order()' } });
    fireEvent.keyDown(init, { key: 'Enter' });
    await waitFor(() => expect(useAppStore.getState().version).toBe(8));
    expect(screen.getByTestId('node-method')).toBeInTheDocument();
    expect(puts).toHaveLength(1);

    fireEvent.doubleClick(pre());
    expect(screen.queryByTestId('node-editor')).not.toBeInTheDocument();

    fireEvent.click(find());
    fireEvent.keyDown(document, { key: 'Delete' });
    await new Promise((r) => setTimeout(r, 100));
    expect(puts).toHaveLength(1);

    // Раскладка готова — правки снова работают.
    gate.release();
    await waitFor(() =>
      expect(screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'Order a = new Order()')).toBeInTheDocument(),
    );
    fireEvent.doubleClick(pre());
    expect(await screen.findByTestId('node-editor')).toBeInTheDocument();
  }, 20_000);
});
