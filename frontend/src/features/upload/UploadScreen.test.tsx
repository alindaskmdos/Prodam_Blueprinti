import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import projectJson from '@contract/fixtures/project.json';
import { createApiClient } from '../api';
import { App } from '../../app/App';
import { resetAppState, useAppStore } from '../../app/store';
import { findCommand } from '../../app/commands';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { resetUploadUi, useUploadUi } from './uploadUi';
import { UploadScreen } from './UploadScreen';
import { buildUploadForm } from './projectApi';
import { fromFileList } from './collectFiles';

const client = createApiClient('http://localhost/api');

function javaFile(name: string, relativePath?: string): File {
  const file = new File(['class A {}'], name, { type: 'text/x-java' });
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function pick(input: HTMLElement, files: File[]) {
  fireEvent.change(input, { target: { files } });
}

describe('UploadScreen', () => {
  beforeEach(() => {
    resetAppState();
    resetUploadUi();
  });

  it('без проекта App показывает экран загрузки; загрузка без предупреждений → редактор', async () => {
    server.use(scenarios.uploadClean);
    render(<App client={client} />);

    expect(screen.getByText('проект не загружен')).toBeInTheDocument();
    expect(screen.getByText('Перетащите файлы сюда')).toBeInTheDocument();

    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('Main.java')]);

    // Редактор: дерево из tree.json.
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(useAppStore.getState().projectId).toBe(projectJson.id);
    expect(useAppStore.getState().version).toBe(projectJson.version);
  });

  it('предупреждения загрузки показываются, «Открыть проект →» переходит в редактор', async () => {
    server.use(scenarios.uploadWarnings);
    render(<App client={client} />);

    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('demo.zip')]);

    const list = await screen.findByRole('list', { name: 'Предупреждения загрузки' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(list).getByText(projectJson.warnings[0]?.message ?? '')).toBeInTheDocument();
    expect(within(list).getAllByText('внимание')).toHaveLength(2);
    expect(within(list).getByText('тесты')).toBeInTheDocument();
    expect(within(list).getByText('пропущено')).toBeInTheDocument();
    expect(screen.getAllByLabelText('готово')).toHaveLength(4);
    expect(useAppStore.getState().projectId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть проект →' }));
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(useAppStore.getState().projectId).toBe(projectJson.id);
  });

  it('неизвестный код LoadWarning не роняет экран: плашка «внимание», текст как есть', async () => {
    server.use(
      http.post('*/api/projects', () =>
        HttpResponse.json(
          { ...projectJson, warnings: [{ code: 'FUTURE_CODE', file: 'X.java', message: 'новое предупреждение' }] },
          { status: 201 },
        ),
      ),
    );
    render(<UploadScreen client={client} onOpen={vi.fn()} />);
    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('demo.zip')]);

    const list = await screen.findByRole('list', { name: 'Предупреждения загрузки' });
    expect(within(list).getByText('внимание')).toBeInTheDocument();
    expect(within(list).getByText('новое предупреждение')).toBeInTheDocument();
    expect(within(list).getByText('X.java')).toBeInTheDocument();
  });

  it('отказ DUPLICATE_FQN: заголовок, сообщение сервера и конфликтующие файлы; проект не открывается', async () => {
    server.use(scenarios.uploadDuplicateFqn);
    const onOpen = vi.fn();
    render(<UploadScreen client={client} onOpen={onOpen} />);

    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('demo.zip')]);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Дубликат класса')).toBeInTheDocument();
    expect(within(alert).getByText('a/com/demo/Order.java')).toBeInTheDocument();
    expect(within(alert).getByText('b/com/demo/Order.java')).toBeInTheDocument();
    expect(screen.getByLabelText('ошибка')).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('413 LIMIT_EXCEEDED и 422 NO_SOURCES — понятные сообщения', async () => {
    server.use(scenarios.uploadLimitExceeded);
    const { unmount } = render(<UploadScreen client={client} onOpen={vi.fn()} />);
    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('big.zip')]);
    expect(await screen.findByText('Слишком большой проект')).toBeInTheDocument();
    unmount();

    server.use(scenarios.uploadNoSources);
    render(<UploadScreen client={client} onOpen={vi.fn()} />);
    pick(screen.getByLabelText('Выбрать файлы'), [javaFile('lib.jar')]);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Нужны исходники')).toBeInTheDocument();
    expect(within(alert).getByText('нужны исходники, а не скомпилированный код')).toBeInTheDocument();
  });

  it('папка (webkitdirectory) уходит multipart-запросом, имя папки — в заголовке панели', async () => {
    let contentType: string | null = null;
    server.use(
      http.post('*/api/projects', ({ request }) => {
        // Тело не читаем: в jsdom File из FormData не сериализуется (в браузере — ок); состав формы — тест ниже.
        contentType = request.headers.get('content-type');
        return HttpResponse.json(projectJson, { status: 201 });
      }),
    );
    render(<UploadScreen client={client} onOpen={vi.fn()} />);

    const folder = screen.getByLabelText('Выбрать папку');
    expect(folder).toHaveAttribute('webkitdirectory');
    pick(folder, [javaFile('Main.java', 'demo/src/Main.java'), javaFile('a.json', 'demo/tests/a.json')]);

    expect(await screen.findByRole('button', { name: 'Открыть проект →' })).toBeInTheDocument();
    expect(screen.getByText('demo/')).toBeInTheDocument();
    expect(screen.getByText('2 файла')).toBeInTheDocument();
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('форма POST /projects: files + paths в том же порядке для папки, без paths для одиночных файлов', () => {
    const folder = buildUploadForm(
      fromFileList([javaFile('Main.java', 'demo/src/Main.java'), javaFile('a.json', 'demo/tests/a.json')]),
    );
    expect(folder.getAll('files').map((f) => (f as File).name)).toEqual(['Main.java', 'a.json']);
    expect(folder.getAll('paths')).toEqual(['demo/src/Main.java', 'demo/tests/a.json']);

    const single = buildUploadForm(fromFileList([javaFile('demo.zip')]));
    expect(single.getAll('files')).toHaveLength(1);
    expect(single.getAll('paths')).toEqual([]);
  });

  it('drop файлов на зону загружает их', async () => {
    server.use(scenarios.uploadClean);
    const onOpen = vi.fn();
    render(<UploadScreen client={client} onOpen={onOpen} />);
    const file = javaFile('Main.java');
    fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files: [file], items: [] } });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: projectJson.id }), 'Main.java'));
  });

  it('имя проекта: общая папка важнее одиночного файла в ней', async () => {
    server.use(scenarios.uploadClean);
    const onOpen = vi.fn();
    render(<UploadScreen client={client} onOpen={onOpen} />);
    pick(screen.getByLabelText('Выбрать папку'), [javaFile('Main.java', 'demo/Main.java')]);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.anything(), 'demo'));
  });

  it('команда project.upload из редактора открывает экран загрузки, «← К проекту» возвращает', async () => {
    render(<App client={client} projectId="p-1" />);
    expect(await screen.findByText('OrderService')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить проект' }));
    expect(useUploadUi.getState().uploadOpen).toBe(true);
    expect(screen.getByText('Перетащите файлы сюда')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '← К проекту' }));
    expect(await screen.findByText('OrderService')).toBeInTheDocument();
    expect(findCommand('project.upload')?.group).toBe('Проект');
  });
});
