import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { fixtures } from '../../mocks/fixtures';
import { blockAt, withFields } from './blockEdit';
import { BlockSync, type BlockSyncOptions } from './blockSync';

const client = createApiClient('http://localhost/api');
const methodId = 'com.demo.service.OrderService.merge~0';
const BLOCKS = '*/api/projects/:projectId/methods/:methodId/blocks';
/** var Order a = orders.get(i) внутри for. */
const VAR_PATH = 'root/body/1/body/0';
const VAR_ID = `${methodId}/body/1/body/0`;

let syncs: BlockSync[] = [];
afterEach(() => {
  syncs.forEach((s) => s.dispose());
  syncs = [];
});

type PutBody = { version: number; root: Schemas['Block'] };

/** Запоминает тела PUT blocks, пропуская их дальше в обработчик по умолчанию. */
function recordPuts(): PutBody[] {
  const bodies: PutBody[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'PUT' && request.url.includes('/blocks')) {
      void request.clone().json().then((b) => bodies.push(b as PutBody));
    }
  });
  return bodies;
}

/** Значение, которое должно быть (вместо `!`). */
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('ожидалось значение');
  return v;
}

const rootOf = (sync: BlockSync): Schemas['Block'] => must(sync.getState().view).root;

async function loaded(options: Partial<BlockSyncOptions> = {}): Promise<BlockSync> {
  const sync = new BlockSync({ client, projectId: 'p-1', methodId, version: 5, ...options });
  syncs.push(sync);
  await sync.load();
  return sync;
}

describe('BlockSync', () => {
  afterEach(() => server.events.removeAllListeners());

  it('загружает метод; без известной версии берёт её из GET /projects/{id}', async () => {
    const onVersion = vi.fn();
    const sync = await loaded({ version: null, onVersion });
    expect(sync.getState().status).toBe('ready');
    expect(sync.getState().view?.methodId).toBe(methodId);
    expect(sync.getState().version).toBe(1);
    expect(onVersion).toHaveBeenCalledWith(1);
  });

  it('правка → PUT с полным деревом и текущей версией; 200 → новая версия и дерево из ответа', async () => {
    const bodies = recordPuts();
    const onVersion = vi.fn();
    const onMutation = vi.fn();
    const sync = await loaded({ onVersion, onMutation });
    const before = rootOf(sync);

    sync.startEdit(VAR_PATH);
    expect(sync.getState().editing).toBe(VAR_PATH);
    expect(sync.draftFor(VAR_PATH)).toEqual({ type: 'Order', name: 'a', init: 'orders.get(i)' });

    const p = sync.apply(VAR_PATH, { type: 'Order', name: 'a', init: 'orders.get(0)' });
    expect(sync.getState().status).toBe('saving');
    await p;

    expect(bodies).toHaveLength(1);
    expect(must(bodies[0]).version).toBe(5);
    expect(must(bodies[0]).root.id).toBe(methodId);
    expect(blockAt(must(bodies[0]).root, VAR_PATH)?.fields.init).toBe('orders.get(0)');
    // Полное дерево: остальные ноды на месте.
    expect(must(bodies[0]).root.slots.body).toHaveLength(must(before.slots.body).length);

    const s = sync.getState();
    expect(s).toMatchObject({ status: 'ready', version: 6, editing: null, invalid: null });
    expect(blockAt(must(s.view).root, VAR_PATH)?.fields.init).toBe('orders.get(0)');
    expect(onVersion).toHaveBeenCalledWith(6);
    expect(onMutation).toHaveBeenCalledWith(expect.objectContaining({ version: 6 }));
  });

  it('без изменений — редактор закрывается без запроса', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, sync.draftFor(VAR_PATH));
    expect(sync.getState().editing).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it('422 PARSE_ERROR → нода красная с черновиком, дерево и версия прежние; Esc отменяет черновик', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    const onVersion = vi.fn();
    const sync = await loaded({ onVersion });
    const root = rootOf(sync);

    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { type: 'Order', name: 'a', init: 'orders.get(i) ==' });

    const s = sync.getState();
    expect(s.status).toBe('ready');
    expect(s.version).toBe(5);
    expect(must(s.view).root).toBe(root);
    expect(s.editing).toBeNull();
    expect(s.invalid).toMatchObject({ path: VAR_PATH, errorPath: VAR_PATH, blockId: VAR_ID });
    expect(s.invalid?.message).toContain('Синтаксическая ошибка');
    expect(onVersion).not.toHaveBeenCalled();

    // Повторное открытие показывает введённый текст; Esc — отмена, черновик сброшен.
    sync.startEdit(VAR_PATH);
    expect(sync.draftFor(VAR_PATH).init).toBe('orders.get(i) ==');
    sync.cancelEdit();
    expect(sync.getState().invalid).toBeNull();
    expect(sync.draftFor(VAR_PATH).init).toBe('orders.get(i)');
  });

  it('422 с blockId другой ноды → ошибка на ней; неизвестный blockId → на правленой', async () => {
    const other = `${methodId}/body/0`;
    server.use(
      http.put(BLOCKS, () => HttpResponse.json({ code: 'PARSE_ERROR', message: 'плохо', blockId: other }, { status: 422 })),
    );
    const sync = await loaded();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'x' });
    expect(sync.getState().invalid).toMatchObject({ path: VAR_PATH, errorPath: 'root/body/0' });

    server.use(http.put(BLOCKS, () => HttpResponse.json({ code: 'PARSE_ERROR', message: 'плохо' }, { status: 422 })));
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'y' });
    expect(sync.getState().invalid).toMatchObject({ path: VAR_PATH, errorPath: VAR_PATH, draft: { init: 'y' } });
  });

  it('исправление красной ноды → 200 → ошибка снята', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    const sync = await loaded();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'bad ==' });
    expect(sync.getState().invalid).not.toBeNull();

    server.resetHandlers();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'orders.get(1)' });
    expect(sync.getState().invalid).toBeNull();
    expect(blockAt(rootOf(sync), VAR_PATH)?.fields.init).toBe('orders.get(1)');
  });

  it('409 → конфликт для тоста, onConflict, перезагрузка GET blocks и версии', async () => {
    server.use(scenarios.conflictOnBlocks);
    const onConflict = vi.fn();
    const onVersion = vi.fn();
    const sync = await loaded({ onConflict, onVersion });
    let gets = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'GET' && request.url.includes('/blocks')) gets += 1;
    });

    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'z' });
    await sync.idle();

    const s = sync.getState();
    expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ code: 'VERSION_CONFLICT' }));
    expect(s.conflict).toMatchObject({ clientVersion: 2, serverVersion: 3, seq: 1 });
    expect(gets).toBe(1);
    expect(s.status).toBe('ready');
    expect(s.editing).toBeNull();
    // Версия — с сервера (GET /projects/{id} в моках — 1).
    expect(s.version).toBe(1);
    expect(onVersion).toHaveBeenLastCalledWith(1);
    expect(blockAt(must(s.view).root, VAR_PATH)?.fields.init).toBe('orders.get(i)');
    sync.dismissConflict();
    expect(sync.getState().conflict).toBeNull();
  });

  it('прочая ошибка → редактор остаётся открытым, сообщение в error', async () => {
    server.use(http.put(BLOCKS, () => HttpResponse.json({ code: 'INTERNAL', message: 'упало' }, { status: 500 })));
    const sync = await loaded();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'q' });
    expect(sync.getState()).toMatchObject({ status: 'ready', editing: VAR_PATH, error: 'упало', invalid: null });
  });

  it('не правится: метод, неизвестный путь, во время сохранения', async () => {
    const sync = await loaded();
    sync.startEdit('root');
    sync.startEdit('root/body/77');
    expect(sync.getState().editing).toBeNull();

    sync.startEdit(VAR_PATH);
    const p = sync.apply(VAR_PATH, { init: 'w' });
    await sync.apply(VAR_PATH, { init: 'w2' }); // второй apply во время PUT игнорируется
    sync.cancelEdit(); // и отмена тоже
    expect(sync.getState().status).toBe('saving');
    await p;
    expect(blockAt(rootOf(sync), VAR_PATH)?.fields.init).toBe('w');
  });

  it('ошибка загрузки метода → status error', async () => {
    server.use(http.get(BLOCKS, () => HttpResponse.json({ code: 'NOT_FOUND', message: 'нет метода' }, { status: 404 })));
    const sync = await loaded();
    expect(sync.getState()).toMatchObject({ status: 'error', error: 'нет метода', view: null });
  });
});

/** Метод «после правки в коде»: var merged = 42 вместо 0. */
const CODE_PATH = 'root/body/0';
function changedInCode(): Schemas['MethodView'] {
  const root = withFields(fixtures.methodViewMerge.root, CODE_PATH, { init: '42' });
  return { ...fixtures.methodViewMerge, root };
}

/** GET blocks отдаёт метод после правки в коде; считает запросы. */
function serveChanged(): { gets: number } {
  const counter = { gets: 0 };
  server.use(
    http.get(BLOCKS, () => {
      counter.gets += 1;
      return HttpResponse.json(changedInCode());
    }),
  );
  return counter;
}

describe('BlockSync — внешняя смена версии (правка кода, фикс)', () => {
  afterEach(() => server.events.removeAllListeners());

  it('внешняя version новее → перезагрузка дерева; следующий PUT — с новым деревом и этой версией', async () => {
    const sync = await loaded();
    const counter = serveChanged();

    sync.adoptVersion(3); // старее — ничего
    expect(counter.gets).toBe(0);
    expect(sync.getState().version).toBe(5);

    sync.adoptVersion(9);
    await sync.idle();
    expect(counter.gets).toBe(1);
    expect(sync.getState().version).toBe(9);
    expect(blockAt(rootOf(sync), CODE_PATH)?.fields.init).toBe('42');

    const bodies = recordPuts();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'orders.get(0)' });
    const sent = must(bodies[0]);
    expect(sent.version).toBe(9);
    expect(blockAt(sent.root, CODE_PATH)?.fields.init).toBe('42'); // правка из кода не затёрта
    expect(blockAt(sent.root, VAR_PATH)?.fields.init).toBe('orders.get(0)');
  });

  it('открыт редактор → stale: дерево не трогается, Enter/blur не отправляют; rebase применяет черновик к новому дереву', async () => {
    const sync = await loaded();
    const counter = serveChanged();
    const bodies = recordPuts();
    sync.startEdit(VAR_PATH);

    sync.adoptVersion(9);
    expect(sync.getState()).toMatchObject({ stale: true, editing: VAR_PATH, status: 'ready' });
    expect(counter.gets).toBe(0);

    await sync.apply(VAR_PATH, { init: 'draft' });
    expect(bodies).toHaveLength(0);
    expect(sync.getState().editing).toBe(VAR_PATH);

    await sync.rebase(VAR_PATH, { init: 'draft' });
    expect(counter.gets).toBe(1);
    const sent = must(bodies[0]);
    expect(sent.version).toBe(9);
    expect(blockAt(sent.root, CODE_PATH)?.fields.init).toBe('42');
    expect(blockAt(sent.root, VAR_PATH)?.fields.init).toBe('draft');
    expect(sync.getState()).toMatchObject({ stale: false, editing: null, version: 10 });
  });

  it('stale + отмена → черновик отброшен, дерево перезагружено', async () => {
    const sync = await loaded();
    const counter = serveChanged();
    sync.startEdit(VAR_PATH);
    sync.adoptVersion(9);
    sync.cancelEdit();
    await sync.idle();
    expect(counter.gets).toBe(1);
    expect(sync.getState()).toMatchObject({ stale: false, editing: null, version: 9 });
    expect(blockAt(rootOf(sync), CODE_PATH)?.fields.init).toBe('42');
  });

  it('гонка: версия выросла, пока шла загрузка → дерево перезагружается ещё раз', async () => {
    const counter = serveChanged();
    const sync = new BlockSync({ client, projectId: 'p-1', methodId, version: null });
    syncs.push(sync);
    const p = sync.load(); // версия из GET /projects (в моках 1)
    sync.adoptVersion(4); // пришла из стора, пока запросы в полёте
    await p;
    await sync.idle();
    expect(counter.gets).toBe(2);
    expect(sync.getState()).toMatchObject({ status: 'ready', version: 4 });
  });

  it('красная нода переживает перезагрузку из-за внешней версии', async () => {
    server.use(scenarios.parseErrorOnBlocks);
    const sync = await loaded();
    sync.startEdit(VAR_PATH);
    await sync.apply(VAR_PATH, { init: 'bad ==' });
    serveChanged();
    sync.adoptVersion(9);
    await sync.idle();
    expect(blockAt(rootOf(sync), CODE_PATH)?.fields.init).toBe('42');
    expect(sync.getState().invalid).toMatchObject({ path: VAR_PATH, draft: { init: 'bad ==' } });
  });
});

describe('BlockSync — структура (FE-08)', () => {
  afterEach(() => server.events.removeAllListeners());
  const FOR_BODY = { parent: 'root/body/1', slot: 'body' };

  it('вставка: нода локально с редактором, без запроса; Enter → PUT полного дерева с новым блоком без id', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    const before = rootOf(sync);
    expect(await sync.insert({ ...FOR_BODY, index: 1 }, 'expr')).toBe(true);

    let s = sync.getState();
    expect(bodies).toHaveLength(0);
    expect(s.editing).toBe('root/body/1/body/1');
    expect(s.pending?.path).toBe('root/body/1/body/1');
    expect(rootOf(sync)).toBe(before); // сервер не тронут
    expect(sync.draftFor('root/body/1/body/1')).toEqual({ text: '' });
    expect(sync.structureOpen()).toBe(false);

    await sync.apply('root/body/1/body/1', { text: 'log(a)' });
    expect(bodies).toHaveLength(1);
    const sent = must(bodies[0]).root;
    expect(blockAt(sent, 'root/body/1/body/1')).toEqual({ id: '', kind: 'expr', fields: { text: 'log(a)' }, slots: {} });
    expect(blockAt(sent, 'root/body/1/body/2')?.kind).toBe('if');
    s = sync.getState();
    expect(s).toMatchObject({ status: 'ready', version: 6, pending: null, editing: null });
    expect(blockAt(rootOf(sync), 'root/body/1/body/1')?.fields.text).toBe('log(a)');
  });

  it('Esc в редакторе новой ноды — вставка отменяется без запроса', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.insert({ parent: 'root', slot: 'body', index: 0 }, 'var');
    sync.cancelEdit();
    expect(sync.getState()).toMatchObject({ pending: null, editing: null, invalid: null });
    expect(bodies).toHaveLength(0);
  });

  it('break/try — сразу PUT; try с шаблонным catch', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.insert({ parent: 'root', slot: 'body', index: 2 }, 'try');
    expect(bodies).toHaveLength(1);
    const t = blockAt(must(bodies[0]).root, 'root/body/2');
    expect(t?.kind).toBe('try');
    expect(t?.slots.catches?.[0]?.fields).toEqual({ type: 'Exception', var: 'e' });
    expect(sync.getState().pending).toBeNull();
  });

  it('422 на новую ноду → красная, введённый текст остаётся; повторная правка отправляет его; «Отменить» убирает вставку', async () => {
    server.use(
      http.put(BLOCKS, () => HttpResponse.json({ code: 'PARSE_ERROR', message: 'пустое выражение', blockId: '' }, { status: 422 })),
    );
    const sync = await loaded();
    await sync.insert({ ...FOR_BODY, index: 0 }, 'expr');
    await sync.apply('root/body/1/body/0', { text: 'foo(' });

    let s = sync.getState();
    expect(s.version).toBe(5);
    expect(s.pending?.path).toBe('root/body/1/body/0');
    expect(s.invalid).toMatchObject({ path: 'root/body/1/body/0', errorPath: 'root/body/1/body/0', message: 'пустое выражение' });
    expect(blockAt(must(s.pending).root, 'root/body/1/body/0')?.fields.text).toBe('foo(');

    sync.startEdit('root/body/1/body/0');
    expect(sync.draftFor('root/body/1/body/0')).toEqual({ text: 'foo(' });
    sync.cancelEdit();
    s = sync.getState();
    expect(s.pending).toBeNull();
    expect(s.invalid).toBeNull();

    await sync.insert({ ...FOR_BODY, index: 0 }, 'expr');
    await sync.apply('root/body/1/body/0', { text: '' });
    sync.discardInvalid();
    expect(sync.getState()).toMatchObject({ pending: null, invalid: null });
    expect(blockAt(rootOf(sync), 'root/body/1/body/0')?.kind).toBe('var');
  });

  it('удаление листа и контейнера → PUT без блока', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.remove('root/body/1/body/1/then/0');
    expect(blockAt(must(bodies[0]).root, 'root/body/1/body/1')?.slots.then).toEqual([]);
    await sync.remove('root/body/1');
    expect(must(bodies[1]).root.slots.body?.map((x) => x.kind)).toEqual(['var', 'return']);
    expect(must(bodies[1]).version).toBe(6);
    expect(sync.getState().version).toBe(7);
    // Корень не удаляется.
    await sync.remove('root');
    expect(bodies).toHaveLength(2);
  });

  it('вверх/вниз внутри слота; на границе — без запроса', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.move('root/body/1/body/0', -1);
    await sync.move('root/body/2', 1);
    expect(bodies).toHaveLength(0);
    await sync.move('root/body/1/body/0', 1);
    expect(must(bodies[0]).root.slots.body?.[1]?.slots.body?.map((x) => x.kind)).toEqual(['if', 'var', 'for']);
  });

  it('422 на удаление → откат: дерево и версия прежние, сообщение', async () => {
    server.use(http.put(BLOCKS, () => HttpResponse.json({ code: 'PARSE_ERROR', message: 'нельзя' }, { status: 422 })));
    const sync = await loaded();
    const root = rootOf(sync);
    await sync.remove('root/body/0');
    expect(sync.getState()).toMatchObject({ status: 'ready', version: 5, error: 'операция не применена: нельзя', pending: null });
    expect(rootOf(sync)).toBe(root);
  });

  it('409 на структурную операцию → конфликт и перезагрузка', async () => {
    server.use(scenarios.conflictOnBlocks);
    const sync = await loaded();
    await sync.move('root/body/0', 1);
    await sync.idle();
    expect(sync.getState().conflict).not.toBeNull();
    expect(sync.getState().status).toBe('ready');
  });

  it('версия сменилась извне при открытом редакторе новой ноды → «Применить к новому» переносит вставку и отправляет текст', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.insert({ ...FOR_BODY, index: 1 }, 'expr');
    sync.adoptVersion(9);
    expect(sync.getState().stale).toBe(true);
    await sync.rebase('root/body/1/body/1', { text: 'kept()' });
    await sync.idle();
    expect(bodies).toHaveLength(1);
    expect(must(bodies[0]).version).toBe(9);
    expect(blockAt(must(bodies[0]).root, 'root/body/1/body/1')?.fields.text).toBe('kept()');
    expect(sync.getState()).toMatchObject({ pending: null, error: null, lostInsert: null });
  });

  it('красная новая нода + внешняя версия → вставка на новом дереве с текстом; родителя нет → текст в lostInsert', async () => {
    server.use(http.put(BLOCKS, () => HttpResponse.json({ code: 'PARSE_ERROR', message: 'плохо', blockId: '' }, { status: 422 })));
    const sync = await loaded();
    await sync.insert({ ...FOR_BODY, index: 0 }, 'expr');
    await sync.apply('root/body/1/body/0', { text: 'foo(' });
    sync.adoptVersion(9);
    await sync.idle();
    let s = sync.getState();
    expect(s.pending?.path).toBe('root/body/1/body/0');
    expect(s.invalid).toMatchObject({ path: 'root/body/1/body/0', draft: { text: 'foo(' }, message: 'плохо' });

    // Новое дерево без цикла for — места для вставки нет.
    const view = fixtures.methodViewMerge;
    const without = { ...view, root: { ...view.root, slots: { body: (view.root.slots.body ?? []).filter((x) => x.kind !== 'for') } } };
    server.use(http.get(BLOCKS, () => HttpResponse.json(without)));
    sync.adoptVersion(10);
    await sync.idle();
    s = sync.getState();
    expect(s.pending).toBeNull();
    expect(s.invalid).toBeNull();
    expect(s.lostInsert).toEqual({ text: 'foo(' });
    sync.dismissLostInsert();
    expect(sync.getState().lostInsert).toBeNull();
  });

  it('Esc в редакторе новой ноды при stale — вставка отменена без сообщения', async () => {
    const sync = await loaded();
    await sync.insert({ ...FOR_BODY, index: 0 }, 'expr');
    sync.adoptVersion(9);
    sync.cancelEdit();
    await sync.idle();
    expect(sync.getState()).toMatchObject({ status: 'ready', pending: null, error: null, lostInsert: null, version: 9 });
  });

  it('удаление по пути, поставленное во время перестановки, не трогает другой блок', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    const moving = sync.move('root/body/0', 1);
    const removing = sync.remove('root/body/0');
    await Promise.all([moving, removing]);
    expect(bodies).toHaveLength(1);
    expect(rootOf(sync).slots.body?.map((x) => x.kind)).toEqual(['for', 'var', 'return']);
  });

  it('пока есть неотправленная вставка — другие структурные операции не выполняются', async () => {
    const bodies = recordPuts();
    const sync = await loaded();
    await sync.insert({ parent: 'root', slot: 'body', index: 0 }, 'expr');
    await sync.remove('root/body/1');
    expect(await sync.insert({ parent: 'root', slot: 'body', index: 0 }, 'expr')).toBe(false);
    expect(bodies).toHaveLength(0);
  });
});
