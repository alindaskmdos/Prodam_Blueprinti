import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';
import { server } from '../../mocks/server';
import { createApiClient } from '../api';
import { MethodCanvas } from './index';

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
