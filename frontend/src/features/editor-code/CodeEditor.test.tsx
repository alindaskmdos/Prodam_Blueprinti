import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { scenarios } from '../../mocks/handlers';
import { createApiClient, type Schemas } from '../api';
import type { MonacoViewProps } from './MonacoView';
import { CodeEditor } from './CodeEditor';

// Monaco в jsdom не работает — подменяем представление textarea с тем же интерфейсом.
vi.mock('./MonacoView', async () => {
  const { useEffect, useState } = await import('react');
  function FakeMonaco({ text, loadSeq, parseError, onChange, readOnly }: MonacoViewProps) {
    const [value, setValue] = useState(text);
    useEffect(() => setValue(text), [text, loadSeq]);
    return (
      <textarea
        aria-label="код"
        data-error-line={parseError?.line ?? ''}
        value={value}
        readOnly={readOnly}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
      />
    );
  }
  return { default: FakeMonaco };
});

const API = '*/api';
const PATH = 'src/com/demo/Main.java';
const client = createApiClient('http://localhost/api');

function serveFile(text: string, version: number) {
  server.use(
    http.get(`${API}/projects/:projectId/files`, () =>
      HttpResponse.json<Schemas['FileText']>({ path: PATH, text, version }),
    ),
  );
}

describe('<CodeEditor>', () => {
  it('открывает файл и отправляет правку, новая версия уходит в onVersion', async () => {
    serveFile('class Main {}', 1);
    const onVersion = vi.fn();
    render(<CodeEditor client={client} projectId="p-1" path={PATH} onVersion={onVersion} debounceMs={0} />);

    const area = await screen.findByLabelText('код');
    expect(area).toHaveValue('class Main {}');
    expect(screen.getByRole('status')).toHaveTextContent('синхронизировано');
    expect(onVersion).toHaveBeenCalledWith(1);

    fireEvent.change(area, { target: { value: 'class Main { }' } });
    // Обработчик PUT files по умолчанию (src/mocks/handlers.ts): версия + 1.
    await waitFor(() => expect(onVersion).toHaveBeenLastCalledWith(2));
    expect(screen.getByRole('status')).toHaveTextContent('синхронизировано');
  });

  it('409 → тост «Проект изменён … Состояние перезагружено» и текст файла с сервера', async () => {
    serveFile('class Main {}', 2);
    const onConflict = vi.fn();
    render(<CodeEditor client={client} projectId="p-1" path={PATH} onConflict={onConflict} debounceMs={0} />);
    const area = await screen.findByLabelText('код');

    server.use(scenarios.conflictOnFile);
    serveFile('class Main { /* с сервера */ }', 3);
    fireEvent.change(area, { target: { value: 'class Main { int lost; }' } });

    const toast = await screen.findByText('Проект изменён');
    expect(toast.parentElement).toHaveTextContent('Ваша правка относилась к версии 2, сейчас 3. Состояние перезагружено.');
    await waitFor(() => expect(area).toHaveValue('class Main { /* с сервера */ }'));
    expect(onConflict).toHaveBeenCalledTimes(1);
    // Черновик не потерян: плашка с тремя кнопками, редактор только для чтения.
    expect(screen.getByText('Проект изменён — ваши правки не отправлены')).toBeInTheDocument();
    expect(area).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Оставить мои' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText('Проект изменён')).not.toBeInTheDocument();
  });

  it('422 PARSE_ERROR → сообщение со строкой и маркер, правка не применена', async () => {
    serveFile('class Main {}', 1);
    const onVersion = vi.fn();
    render(<CodeEditor client={client} projectId="p-1" path={PATH} onVersion={onVersion} debounceMs={0} />);
    const area = await screen.findByLabelText('код');
    onVersion.mockClear();

    server.use(
      http.put(`${API}/projects/:projectId/files`, () =>
        HttpResponse.json<Schemas['Error']>({ code: 'PARSE_ERROR', message: "'}' expected", line: 1 }, { status: 422 }),
      ),
    );
    fireEvent.change(area, { target: { value: 'class Main {' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Синтаксическая ошибка в коде');
    expect(alert).toHaveTextContent("Main.java:1 — '}' expected");
    expect(screen.getByRole('status')).toHaveTextContent('синтаксическая ошибка');
    expect(area).toHaveAttribute('data-error-line', '1');
    expect(onVersion).not.toHaveBeenCalled();
  });

  it('внешняя version без правок → новый текст в редакторе, плашки нет', async () => {
    serveFile('class Main {}', 1);
    const { rerender } = render(<CodeEditor client={client} projectId="p-1" path={PATH} version={1} debounceMs={0} />);
    const area = await screen.findByLabelText('код');
    serveFile('class Main { /* нода */ }', 2);
    rerender(<CodeEditor client={client} projectId="p-1" path={PATH} version={2} debounceMs={0} />);
    await waitFor(() => expect(area).toHaveValue('class Main { /* нода */ }'));
    expect(screen.queryByText(/Ваши правки не отправлены/)).not.toBeInTheDocument();
  });

  it('внешняя version при неотправленной правке → плашка; «Взять новый текст» и «Оставить мои»', async () => {
    serveFile('class Main {}', 1);
    const puts: { version: number; text: string }[] = [];
    server.use(
      http.put(`${API}/projects/:projectId/files`, async ({ request }) => {
        const body = (await request.json()) as { version: number; text: string };
        puts.push(body);
        const version = body.version + 1;
        return HttpResponse.json<Schemas['MutationResult']>({
          version,
          fileText: body.text,
          tree: { version, classes: [] } as never,
          analysis: { version } as never,
        });
      }),
    );
    const props = { client, projectId: 'p-1', path: PATH, debounceMs: 60_000 };
    const { rerender } = render(<CodeEditor {...props} version={1} />);
    const area = await screen.findByLabelText('код');
    fireEvent.change(area, { target: { value: 'class Main { int mine; }' } });

    serveFile('class Main { /* нода */ }', 2);
    rerender(<CodeEditor {...props} version={2} />);
    expect(await screen.findByText('Файл изменён (на схеме или фиксом). Ваши правки не отправлены')).toBeInTheDocument();
    await waitFor(() => expect(area).toHaveValue('class Main { /* нода */ }'));
    expect(puts).toHaveLength(0);
    expect(area).toHaveAttribute('readonly');
    expect(screen.getByText(/только для чтения, пока вы не выберете/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Оставить мои' }));
    await waitFor(() => expect(area).toHaveValue('class Main { int mine; }'));
    expect(area).not.toHaveAttribute('readonly');
    await waitFor(() => expect(puts).toEqual([{ version: 2, text: 'class Main { int mine; }' }]));
    expect(screen.queryByText(/Ваши правки не отправлены/)).not.toBeInTheDocument();

    // Снова: правка, внешняя версия, теперь «Взять новый текст».
    fireEvent.change(area, { target: { value: 'class Main { int again; }' } });
    serveFile('class Main { /* фикс */ }', 4);
    rerender(<CodeEditor {...props} version={4} />);
    await screen.findByText(/Ваши правки не отправлены/);
    await waitFor(() => expect(area).toHaveValue('class Main { /* фикс */ }'));
    fireEvent.click(screen.getByRole('button', { name: 'Взять новый текст' }));
    expect(screen.queryByText(/Ваши правки не отправлены/)).not.toBeInTheDocument();
    expect(area).toHaveValue('class Main { /* фикс */ }');
    expect(puts).toHaveLength(1);
  });

  it('плашка: «Скопировать» кладёт неотправленный текст в буфер обмена', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    serveFile('class Main {}', 1);
    const props = { client, projectId: 'p-1', path: PATH, debounceMs: 60_000 };
    const { rerender } = render(<CodeEditor {...props} version={1} />);
    const area = await screen.findByLabelText('код');
    fireEvent.change(area, { target: { value: 'class Main { int mine; }' } });
    serveFile('class Main { /* нода */ }', 2);
    rerender(<CodeEditor {...props} version={2} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать' }));
    expect(writeText).toHaveBeenCalledWith('class Main { int mine; }');
  });
});
