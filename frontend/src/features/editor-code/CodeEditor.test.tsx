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
  function FakeMonaco({ text, loadSeq, parseError, onChange }: MonacoViewProps) {
    const [value, setValue] = useState(text);
    useEffect(() => setValue(text), [text, loadSeq]);
    return (
      <textarea
        aria-label="код"
        data-error-line={parseError?.line ?? ''}
        value={value}
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
});
