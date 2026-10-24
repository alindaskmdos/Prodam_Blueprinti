import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import projectJson from '@contract/fixtures/project.json';
import { createApiClient } from '../api';
import { App } from '../../app/App';
import { findCommand } from '../../app/commands';
import { resetAppState } from '../../app/store';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { ExportDialog } from './ExportDialog';
import { filenameFrom } from './projectApi';
import { resetUploadUi } from './uploadUi';

const client = createApiClient('http://localhost/api');

describe('ExportDialog', () => {
  beforeEach(() => {
    resetAppState();
    resetUploadUi();
  });

  it('кнопка «Экспорт» в шапке открывает диалог через команду project.export', async () => {
    render(<App client={client} projectId="p-1" />);
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(findCommand('project.export')?.isEnabled?.()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт ▾' }));
    expect(screen.getByRole('dialog', { name: /Экспорт p-1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('экспорт .zip: галочка «настройки Java Blueprints» включена по умолчанию и уходит includeSettings', async () => {
    const queries: string[] = [];
    server.use(
      http.get('*/api/projects/:projectId/export', ({ request }) => {
        queries.push(new URL(request.url).search);
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Disposition': 'attachment; filename="demo-shop.zip"' },
        });
      }),
    );
    const save = vi.fn();
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={save} />);

    const checkbox = screen.getByRole('checkbox', { name: /Включить настройки Java Blueprints/ });
    expect(checkbox).toBeChecked();
    expect(await screen.findByText(projectJson.files[0]?.path ?? '')).toBeInTheDocument();
    expect(screen.getByText('.blueprints/')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Скачать .zip' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe('demo-shop.zip');
    // Blob из node (fetch), не из jsdom — instanceof не сработает, проверяем размер.
    expect((save.mock.calls[0]?.[0] as Blob).size).toBe(3);

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByText('.blueprints/')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Скачать .zip' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(queries).toEqual(['?format=zip&includeSettings=true', '?format=zip&includeSettings=false']);
  });

  it('.jar: подпись «требует Java 21+», точка входа из mainClasses уходит mainClass', async () => {
    let query = '';
    server.use(
      http.get('*/api/projects/:projectId/export', ({ request }) => {
        query = new URL(request.url).search;
        return new HttpResponse(new Uint8Array([1]));
      }),
    );
    const save = vi.fn();
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={save} />);

    expect(screen.getByText('требует Java 21+')).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: /Точка входа/ })).toHaveValue(projectJson.mainClasses[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Собрать .jar' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[1]).toBe('p-1.jar');
    expect(query).toBe(`?format=jar&mainClass=${projectJson.mainClasses[0]}`);
  });

  it('.jar 501 → понятное сообщение, кнопка неактивна с причиной', async () => {
    server.use(scenarios.exportJarNotImplemented);
    const save = vi.fn();
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={save} />);

    await screen.findByRole('combobox', { name: /Точка входа/ });
    fireEvent.click(screen.getByRole('button', { name: 'Собрать .jar' }));

    const reason = await screen.findByTestId('jar-reason');
    expect(reason).toHaveTextContent('Сборка .jar пока не поддерживается сервером');
    expect(screen.getByRole('button', { name: 'Собрать .jar' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    // .zip при этом работает.
    fireEvent.click(screen.getByRole('button', { name: 'Скачать .zip' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
  });

  it('.jar 422 COMPILE_ERROR → «Проект не компилируется: …», кнопка неактивна с причиной', async () => {
    server.use(scenarios.exportJarCompileError);
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={vi.fn()} />);

    await screen.findByRole('combobox', { name: /Точка входа/ });
    fireEvent.click(screen.getByRole('button', { name: 'Собрать .jar' }));

    const reason = await screen.findByTestId('jar-reason');
    expect(reason).toHaveTextContent('Проект не компилируется: OrderService.java:33 — cannot find symbol byId');
    const button = screen.getByRole('button', { name: 'Собрать .jar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', reason.textContent);
  });

  it('.jar 422 по коду: AMBIGUOUS_MAIN → выбор точки входа (details.mainClasses), иное → message', async () => {
    server.use(
      http.get('*/api/projects/:projectId/export', () =>
        HttpResponse.json(
          {
            code: 'AMBIGUOUS_MAIN',
            message: 'несколько main',
            details: { mainClasses: ['com.demo.Main', 'com.demo.Tool'] },
          },
          { status: 422 },
        ),
      ),
    );
    const { unmount } = render(
      <ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={vi.fn()} />,
    );
    await screen.findByRole('combobox', { name: /Точка входа/ });
    fireEvent.click(screen.getByRole('button', { name: 'Собрать .jar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Несколько классов с main — выберите точку входа. Найдены: com.demo.Main, com.demo.Tool.',
    );
    expect(screen.queryByTestId('jar-reason')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Собрать .jar' })).toBeEnabled();
    unmount();

    server.use(
      http.get('*/api/projects/:projectId/export', () =>
        HttpResponse.json({ code: 'INVALID_REQUEST', message: 'mainClass не найден' }, { status: 422 }),
      ),
    );
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={vi.fn()} />);
    await screen.findByRole('combobox', { name: /Точка входа/ });
    fireEvent.click(screen.getByRole('button', { name: 'Собрать .jar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('mainClass не найден');
    expect(screen.queryByText(/не компилируется/)).not.toBeInTheDocument();
  });

  it('без mainClasses .jar неактивен с причиной', async () => {
    server.use(
      http.get('*/api/projects/:projectId', () => HttpResponse.json({ ...projectJson, mainClasses: [] })),
    );
    render(<ExportDialog client={client} projectId="p-1" version={1} onClose={vi.fn()} save={vi.fn()} />);
    expect(await screen.findByTestId('jar-reason')).toHaveTextContent('нет класса с main');
    expect(screen.getByRole('button', { name: 'Собрать .jar' })).toBeDisabled();
  });

  it('filenameFrom разбирает Content-Disposition', () => {
    expect(filenameFrom('attachment; filename="demo.zip"')).toBe('demo.zip');
    expect(filenameFrom("attachment; filename*=UTF-8''%D0%B4%D0%B5%D0%BC%D0%BE.zip")).toBe('демо.zip');
    expect(filenameFrom(null)).toBeNull();
  });
});
