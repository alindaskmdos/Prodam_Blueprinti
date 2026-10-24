import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import errorConflictJson from '@contract/fixtures/error.conflict.json';
import { server } from '../../mocks/server';
import { scenarios } from '../../mocks/handlers';
import { createApiClient, type Schemas } from '../api';
import { FileSync } from './fileSync';

const API = '*/api';
const PATH = 'src/com/demo/service/OrderService.java';
const client = createApiClient('http://localhost/api');

interface PutCall {
  path: string | null;
  version: number;
  text: string;
}

/** GET files отдаёт текущий «серверный» текст и версию; PUT files записывается в puts. */
function serverFile(initial: { text: string; version: number }) {
  const file = { ...initial };
  const puts: PutCall[] = [];
  let gets = 0;
  server.use(
    http.get(`${API}/projects/:projectId/files`, ({ request }) => {
      gets++;
      const path = new URL(request.url).searchParams.get('path') ?? '';
      return HttpResponse.json<Schemas['FileText']>({ path, text: file.text, version: file.version });
    }),
    http.put(`${API}/projects/:projectId/files`, async ({ request }) => {
      const body = (await request.json()) as { version: number; text: string };
      puts.push({ path: new URL(request.url).searchParams.get('path'), ...body });
      file.text = body.text;
      file.version = body.version + 1;
      return HttpResponse.json<Schemas['MutationResult']>({
        version: file.version,
        fileText: body.text,
        tree: { version: file.version, classes: [] } as never,
        analysis: { version: file.version } as never,
      });
    }),
  );
  return { file, puts, gets: () => gets };
}

async function created(options: Partial<ConstructorParameters<typeof FileSync>[0]> = {}) {
  const sync = new FileSync({ client, projectId: 'p-1', path: PATH, ...options });
  await sync.load();
  return sync;
}

/** Прокрутить debounce и дождаться всех запросов. */
async function settle(sync: FileSync, ms = 500) {
  await vi.advanceTimersByTimeAsync(ms);
  await sync.idle();
}

describe('FileSync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('GET files: текст и версия по пути из query', async () => {
    serverFile({ text: 'class A {}', version: 3 });
    const onVersion = vi.fn();
    const sync = await created({ onVersion });
    expect(sync.getState()).toMatchObject({ status: 'synced', loadedText: 'class A {}', version: 3, loadSeq: 1 });
    expect(onVersion).toHaveBeenCalledWith(3);
  });

  it('debounce 500 мс: серия правок → один PUT с последним полным текстом и текущей версией', async () => {
    const srv = serverFile({ text: 'class A {}', version: 3 });
    const onVersion = vi.fn();
    const onMutation = vi.fn();
    const sync = await created({ onVersion, onMutation });

    sync.edit('class A { }');
    await vi.advanceTimersByTimeAsync(300);
    sync.edit('class A { int x; }');
    await vi.advanceTimersByTimeAsync(499);
    expect(srv.puts).toHaveLength(0);
    expect(sync.getState().status).toBe('pending');

    await settle(sync, 1);
    expect(srv.puts).toEqual([{ path: PATH, version: 3, text: 'class A { int x; }' }]);
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 4, parseError: null });
    expect(onVersion).toHaveBeenLastCalledWith(4);
    expect(onMutation).toHaveBeenCalledWith(expect.objectContaining({ version: 4, fileText: 'class A { int x; }' }));
  });

  it('следующий PUT уходит с новой версией из ответа', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const sync = await created();
    sync.edit('ab');
    await settle(sync);
    sync.edit('abc');
    await settle(sync);
    expect(srv.puts.map((p) => p.version)).toEqual([1, 2]);
    expect(sync.getState().version).toBe(3);
  });

  it('правка во время запроса не теряется и уходит после ответа', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.put(
        `${API}/projects/:projectId/files`,
        async () => {
          await gate;
        },
        { once: true },
      ),
    );
    const sync = await created();
    sync.edit('ab');
    await vi.advanceTimersByTimeAsync(500);
    expect(sync.getState().status).toBe('saving');

    sync.edit('abc');
    await vi.advanceTimersByTimeAsync(500);
    release();
    await sync.idle();
    // Первый PUT перехвачен «задержкой» и прошёл дальше к serverFile; второй — после него.
    expect(srv.puts.map((p) => p.text)).toEqual(['ab', 'abc']);
    expect(srv.puts.map((p) => p.version)).toEqual([1, 2]);
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 3 });
  });

  it('возврат к принятому тексту отменяет отправку', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const sync = await created();
    sync.edit('ab');
    sync.edit('a');
    await settle(sync);
    expect(srv.puts).toHaveLength(0);
    expect(sync.getState().status).toBe('synced');
  });

  it('409: тост-данные из error.conflict.json, правка отброшена, текст перезагружен', async () => {
    const srv = serverFile({ text: 'server v1', version: 2 });
    const onConflict = vi.fn();
    const sync = await created({ onConflict });
    // Сервер ушёл вперёд (правка нод в другом месте).
    srv.file.text = 'server v2';
    srv.file.version = 3;
    server.use(scenarios.conflictOnFile);

    sync.edit('my edit');
    await settle(sync);

    expect(onConflict).toHaveBeenCalledWith(errorConflictJson);
    expect(srv.gets()).toBe(2);
    expect(sync.getState()).toMatchObject({
      status: 'synced',
      loadedText: 'server v2',
      version: 3,
      loadSeq: 2,
      conflict: { clientVersion: 2, serverVersion: 3, message: errorConflictJson.message, seq: 1 },
    });

    sync.dismissConflict();
    expect(sync.getState().conflict).toBeNull();
  });

  it('422 PARSE_ERROR: ошибка с номером строки, версия не меняется, исправление снимает ошибку', async () => {
    const srv = serverFile({ text: 'class A {}', version: 5 });
    const onVersion = vi.fn();
    const onMutation = vi.fn();
    const sync = await created({ onVersion, onMutation });
    onVersion.mockClear();
    server.use(
      http.put(
        `${API}/projects/:projectId/files`,
        () =>
          HttpResponse.json<Schemas['Error']>(
            { code: 'PARSE_ERROR', message: "';' expected", line: 2 },
            { status: 422 },
          ),
        { once: true },
      ),
    );

    sync.edit('class A {\n int x \n}');
    await settle(sync);
    expect(sync.getState()).toMatchObject({
      status: 'parse-error',
      version: 5,
      parseError: { line: 2, message: "';' expected" },
    });
    expect(onVersion).not.toHaveBeenCalled();
    expect(onMutation).not.toHaveBeenCalled();
    expect(srv.file.text).toBe('class A {}');

    sync.edit('class A {\n int x;\n}');
    await settle(sync);
    expect(srv.puts.at(-1)).toMatchObject({ version: 5, text: 'class A {\n int x;\n}' });
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 6, parseError: null });
  });

  it('прочие ошибки → status error с сообщением', async () => {
    serverFile({ text: 'a', version: 1 });
    const sync = await created();
    server.use(
      http.put(`${API}/projects/:projectId/files`, () =>
        HttpResponse.json<Schemas['Error']>({ code: 'NOT_FOUND', message: 'нет файла' }, { status: 404 }),
      ),
    );
    sync.edit('ab');
    await settle(sync);
    expect(sync.getState()).toMatchObject({ status: 'error', error: 'нет файла', version: 1 });
  });

  it('GET files 404 → status error', async () => {
    server.use(
      http.get(`${API}/projects/:projectId/files`, () =>
        HttpResponse.json<Schemas['Error']>({ code: 'NOT_FOUND', message: 'нет файла' }, { status: 404 }),
      ),
    );
    const sync = await created();
    expect(sync.getState()).toMatchObject({ status: 'error', error: 'нет файла', loadedText: null });
  });

  it('adoptVersion: одинаковая или меньшая версия — ничего не происходит', async () => {
    const srv = serverFile({ text: 'a', version: 4 });
    const sync = await created();
    sync.adoptVersion(2);
    sync.adoptVersion(4);
    await sync.idle();
    expect(srv.gets()).toBe(1);
    expect(sync.getState()).toMatchObject({ version: 4, loadSeq: 1, stale: null });
    sync.edit('ab');
    await settle(sync);
    expect(srv.puts[0]?.version).toBe(4);
  });

  it('внешняя версия новее → GET files, новый текст в редактор, следующий PUT с новым текстом и версией', async () => {
    const srv = serverFile({ text: 'class A {}', version: 4 });
    const onVersion = vi.fn();
    const sync = await created({ onVersion });
    // Правка нод на холсте: сервер ушёл вперёд, store.version → adoptVersion.
    srv.file.text = 'class A { /* нода */ }';
    srv.file.version = 5;
    sync.adoptVersion(5);
    await sync.idle();
    expect(srv.gets()).toBe(2);
    expect(sync.getState()).toMatchObject({
      status: 'synced',
      version: 5,
      loadedText: 'class A { /* нода */ }',
      loadSeq: 2,
      stale: null,
    });
    sync.edit('class A { /* нода */ int x; }');
    await settle(sync);
    expect(srv.puts).toEqual([{ path: PATH, version: 5, text: 'class A { /* нода */ int x; }' }]);
  });

  it('внешняя версия при неотправленной правке: PUT со старым текстом не уходит, stale; «Взять новый текст»', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const sync = await created();
    sync.edit('a mine');
    await vi.advanceTimersByTimeAsync(200);
    srv.file.text = 'a theirs';
    srv.file.version = 2;
    sync.adoptVersion(2);
    await settle(sync, 1000);
    expect(srv.puts).toHaveLength(0);
    expect(sync.getState()).toMatchObject({
      status: 'synced',
      version: 2,
      loadedText: 'a theirs',
      loadSeq: 2,
      stale: { text: 'a mine' },
    });

    sync.takeTheirs();
    await settle(sync, 1000);
    expect(srv.puts).toHaveLength(0);
    expect(sync.getState()).toMatchObject({ stale: null, loadedText: 'a theirs', status: 'synced' });
  });

  it('stale → «Оставить мои»: текст пользователя в редактор и PUT с актуальной версией', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const sync = await created();
    sync.edit('a mine');
    srv.file.text = 'a theirs';
    srv.file.version = 2;
    sync.adoptVersion(2);
    await sync.idle();
    expect(sync.getState().stale).toEqual({ text: 'a mine' });

    sync.keepMine();
    expect(sync.getState()).toMatchObject({ stale: null, loadedText: 'a mine', loadSeq: 3 });
    await sync.idle();
    expect(srv.puts).toEqual([{ path: PATH, version: 2, text: 'a mine' }]);
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 3 });
  });

  /**
   * Задержанный PUT: принимается как версия body.version + 1, затем «извне» (правка нод) сервер уходит
   * на theirs.version с текстом theirs.text. Возвращает release.
   */
  function gatedPut(srv: ReturnType<typeof serverFile>, theirs: { text: string; version: number }) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.put(
        `${API}/projects/:projectId/files`,
        async ({ request }) => {
          await gate;
          const body = (await request.json()) as { version: number; text: string };
          srv.puts.push({ path: new URL(request.url).searchParams.get('path'), ...body });
          const version = body.version + 1;
          Object.assign(srv.file, theirs);
          return HttpResponse.json<Schemas['MutationResult']>({
            version,
            fileText: body.text,
            tree: { version, classes: [] } as never,
            analysis: { version } as never,
          });
        },
        { once: true },
      ),
    );
    return () => release();
  }

  it('внешняя версия во время PUT в полёте: без новых правок — тихая перезагрузка после ответа', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const release = gatedPut(srv, { text: 'ab theirs', version: 3 });
    const sync = await created();
    sync.edit('ab');
    await vi.advanceTimersByTimeAsync(500);
    expect(sync.getState().status).toBe('saving');
    // Наш PUT станет версией 2, правка нод — 3.
    sync.adoptVersion(3);
    expect(srv.gets()).toBe(1); // GET только после ответа PUT
    release();
    await sync.idle();
    expect(srv.puts.map((p) => p.version)).toEqual([1]);
    expect(srv.gets()).toBe(2);
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 3, loadedText: 'ab theirs', stale: null });
  });

  it('внешняя версия во время PUT в полёте: правка, набранная во время запроса, не уходит — stale', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const release = gatedPut(srv, { text: 'ab theirs', version: 3 });
    const sync = await created();
    sync.edit('ab');
    await vi.advanceTimersByTimeAsync(500);
    sync.edit('abc');
    sync.adoptVersion(3);
    await vi.advanceTimersByTimeAsync(500);
    release();
    await settle(sync, 1000);
    expect(srv.puts.map((p) => p.text)).toEqual(['ab']);
    expect(sync.getState()).toMatchObject({
      status: 'synced',
      version: 3,
      loadedText: 'ab theirs',
      stale: { text: 'abc' },
    });

    sync.keepMine();
    await sync.idle();
    expect(srv.puts.at(-1)).toMatchObject({ version: 3, text: 'abc' });
    expect(sync.getState()).toMatchObject({ status: 'synced', version: 4, stale: null, loadedText: 'abc' });
  });

  it('внешняя версия после 422: отклонённый текст сохраняется в stale', async () => {
    const srv = serverFile({ text: 'class A {}', version: 5 });
    const sync = await created();
    server.use(
      http.put(
        `${API}/projects/:projectId/files`,
        () => HttpResponse.json<Schemas['Error']>({ code: 'PARSE_ERROR', message: 'x', line: 1 }, { status: 422 }),
        { once: true },
      ),
    );
    sync.edit('class A {');
    await settle(sync);
    expect(sync.getState().status).toBe('parse-error');
    srv.file.text = 'class A { int y; }';
    srv.file.version = 6;
    sync.adoptVersion(6);
    await sync.idle();
    expect(sync.getState()).toMatchObject({
      status: 'synced',
      parseError: null,
      loadedText: 'class A { int y; }',
      stale: { text: 'class A {' },
    });
  });

  it('внешняя версия во время первой загрузки: GET вернул старую версию → догоняющий GET', async () => {
    const srv = serverFile({ text: 'new', version: 2 });
    server.use(
      http.get(
        `${API}/projects/:projectId/files`,
        ({ request }) =>
          HttpResponse.json<Schemas['FileText']>({
            path: new URL(request.url).searchParams.get('path') ?? '',
            text: 'old',
            version: 1,
          }),
        { once: true },
      ),
    );
    const sync = new FileSync({ client, projectId: 'p-1', path: PATH });
    const first = sync.load();
    sync.adoptVersion(2);
    await first;
    await sync.idle();
    expect(srv.gets()).toBe(1); // первый GET перехвачен once-обработчиком
    expect(sync.getState()).toMatchObject({ version: 2, loadedText: 'new', stale: null });
  });

  it('dispose отменяет отложенную отправку', async () => {
    const srv = serverFile({ text: 'a', version: 1 });
    const sync = await created();
    sync.edit('ab');
    sync.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv.puts).toHaveLength(0);
  });
});
