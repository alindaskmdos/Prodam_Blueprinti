import { http, HttpResponse } from 'msw';
import type { Schemas, paths } from '../features/api';
import { fixtures } from './fixtures';

// '*' перед /api — чтобы совпадать с любым origin (браузер, jsdom в тестах).
const API = '*/api';

type Health = paths['/health']['get']['responses']['200']['content']['application/json'];
type PutFileBody = paths['/projects/{projectId}/files']['put']['requestBody']['content']['application/json'];
type PutTestBody = paths['/projects/{projectId}/tests/{name}']['put']['requestBody']['content']['application/json'];
type DeletedTest = paths['/projects/{projectId}/tests/{name}']['delete']['responses']['200']['content']['application/json'];
type PutBlocksBody =
  paths['/projects/{projectId}/methods/{methodId}/blocks']['put']['requestBody']['content']['application/json'];

/** id первого блока присланного дерева, поля которого отличаются от фикстуры (или которого в ней нет). */
function firstChangedBlockId(root: Schemas['Block']): string {
  const original = new Map<string, string>();
  const index = (b: Schemas['Block']) => {
    original.set(b.id, JSON.stringify(b.fields));
    Object.values(b.slots).forEach((items) => items.forEach(index));
  };
  index(fixtures.methodViewMerge.root);
  const find = (b: Schemas['Block']): string | undefined => {
    if (original.get(b.id) !== JSON.stringify(b.fields)) return b.id;
    for (const items of Object.values(b.slots)) {
      for (const item of items) {
        const id = find(item);
        if (id !== undefined) return id; // у новой ноды id пустой
      }
    }
    return undefined;
  };
  return find(root) ?? root.id;
}

/** Обработчики по умолчанию: «счастливый путь» на фикстурах contract/fixtures. */
export const handlers = [
  // Для /health фикстуры нет — ответ по схеме контракта.
  http.get(`${API}/health`, () => HttpResponse.json<Health>({ status: 'UP', docker: false, llm: false })),

  http.post(`${API}/projects`, () => HttpResponse.json(fixtures.project, { status: 201 })),
  http.get(`${API}/projects/:projectId`, () => HttpResponse.json(fixtures.project)),
  http.get(`${API}/projects/:projectId/tree`, () => HttpResponse.json(fixtures.tree)),
  // Для файла экспорта фикстуры нет — байты-заглушка с заголовком Content-Disposition по контракту.
  http.get(`${API}/projects/:projectId/export`, ({ request, params }) => {
    const format = new URL(request.url).searchParams.get('format') === 'jar' ? 'jar' : 'zip';
    return new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${String(params.projectId)}.${format}"`,
      },
    });
  }),
  http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, () =>
    HttpResponse.json(fixtures.methodViewMerge),
  ),
  // Фикстура одна (n = 10000): параметр n принимается, но числа ops в моке не пересчитываются.
  http.get(`${API}/projects/:projectId/analysis`, () => HttpResponse.json(fixtures.analysisMerge)),
  http.post(`${API}/projects/:projectId/issues/:issueId/fix`, () => HttpResponse.json(fixtures.fixApplied)),
  // Список: IO-тесты из project.json + JUnit из test.junit.json.
  http.get(`${API}/projects/:projectId/tests`, () =>
    HttpResponse.json<Schemas['TestCase'][]>([...fixtures.project.tests, fixtures.testJunit]),
  ),
  http.get(`${API}/projects/:projectId/tests/:name`, () => HttpResponse.json(fixtures.testJunit)),
  // Для TestMutationResult фикстуры нет — версия +1, test = присланный тест без version.
  http.put(`${API}/projects/:projectId/tests/:name`, async ({ request }) => {
    const { version, ...test } = (await request.json()) as PutTestBody;
    return HttpResponse.json<Schemas['TestMutationResult']>({ version: version + 1, test });
  }),
  http.delete(`${API}/projects/:projectId/tests/:name`, ({ request }) => {
    const version = Number(new URL(request.url).searchParams.get('version'));
    return HttpResponse.json<DeletedTest>({ version: version + 1 });
  }),
  http.post(`${API}/projects/:projectId/run`, () => HttpResponse.json(fixtures.runOk)),
  http.post(`${API}/projects/:projectId/verify`, () => HttpResponse.json(fixtures.verifyGreen)),
  // Для MutationResult фикстуры нет — собираем из фикстур: версия +1, method — присланное дерево.
  http.put(`${API}/projects/:projectId/methods/:methodId/blocks`, async ({ request, params }) => {
    const body = (await request.json()) as PutBlocksBody;
    return HttpResponse.json<Schemas['MutationResult']>({
      version: body.version + 1,
      fileText: fixtures.fileOrderService.text,
      method: { ...fixtures.methodViewMerge, methodId: String(params.methodId), root: body.root },
      tree: fixtures.tree,
      analysis: fixtures.analysisMerge,
    });
  }),
  // Для MutationResult фикстуры нет — собираем из tree/analysis; версия +1, fileText = присланный текст.
  // Текст есть только у OrderService.java (file.order-service.json); без ?path= — 400 INVALID_REQUEST, другой путь — 404 (схема Error).
  http.get(`${API}/projects/:projectId/files`, ({ request }) => {
    const path = new URL(request.url).searchParams.get('path');
    if (!path) {
      return HttpResponse.json<Schemas['Error']>(
        { code: 'INVALID_REQUEST', message: 'не указан параметр path' },
        { status: 400 },
      );
    }
    if (path !== fixtures.fileOrderService.path) {
      return HttpResponse.json<Schemas['Error']>({ code: 'NOT_FOUND', message: `файл ${path} не найден` }, { status: 404 });
    }
    return HttpResponse.json(fixtures.fileOrderService);
  }),
  http.put(`${API}/projects/:projectId/files`, async ({ request }) => {
    const body = (await request.json()) as PutFileBody;
    return HttpResponse.json<Schemas['MutationResult']>({
      version: body.version + 1,
      fileText: body.text,
      tree: fixtures.tree,
      analysis: fixtures.analysisMerge,
    });
  }),
];

/** Альтернативные сценарии для тестов и ручной проверки: `server.use(scenarios.fixRejected)`. */
export const scenarios = {
  fixRejected: http.post(`${API}/projects/:projectId/issues/:issueId/fix`, () =>
    HttpResponse.json(fixtures.fixRejected),
  ),
  verifyRed: http.post(`${API}/projects/:projectId/verify`, () => HttpResponse.json(fixtures.verifyRed)),
  conflictOnBlocks: http.put(`${API}/projects/:projectId/methods/:methodId/blocks`, () =>
    HttpResponse.json(fixtures.errorConflict, { status: 409 }),
  ),
  // Для 404 фикстуры нет — ответ по схеме Error контракта.
  analysisNotFound: http.get(`${API}/projects/:projectId/analysis`, () =>
    HttpResponse.json<Schemas['Error']>({ code: 'NOT_FOUND', message: 'Проект не найден' }, { status: 404 }),
  ),
  conflictOnTest: http.put(`${API}/projects/:projectId/tests/:name`, () =>
    HttpResponse.json(fixtures.errorConflict, { status: 409 }),
  ),
  conflictOnTestDelete: http.delete(`${API}/projects/:projectId/tests/:name`, () =>
    HttpResponse.json(fixtures.errorConflict, { status: 409 }),
  ),
  // Для 422 фикстуры нет — ответ по схеме Error контракта.
  invalidTest: http.put(`${API}/projects/:projectId/tests/:name`, () =>
    HttpResponse.json<Schemas['Error']>(
      { code: 'INVALID_REQUEST', message: 'JUnit-текст не разбирается: строка 3' },
      { status: 422 },
    ),
  ),
  /** 422 PARSE_ERROR на первую изменённую относительно фикстуры ноду (blockId — её id). */
  parseErrorOnBlocks: http.put(`${API}/projects/:projectId/methods/:methodId/blocks`, async ({ request }) => {
    const body = (await request.json()) as PutBlocksBody;
    return HttpResponse.json<Schemas['Error']>(
      {
        code: 'PARSE_ERROR',
        message: 'Синтаксическая ошибка: лишний «==».',
        blockId: firstChangedBlockId(body.root),
      },
      { status: 422 },
    );
  }),
  conflictOnFile: http.put(`${API}/projects/:projectId/files`, () =>
    HttpResponse.json(fixtures.errorConflict, { status: 409 }),
  ),

  // POST /projects: проект без предупреждений и с предупреждениями всех кодов LoadWarning.
  uploadClean: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Project']>({ ...fixtures.project, warnings: [] }, { status: 201 }),
  ),
  uploadWarnings: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Project']>({ ...fixtures.project, warnings: loadWarnings }, { status: 201 }),
  ),
  // POST /projects: отказы по кодам Error из контракта (§11).
  uploadDuplicateFqn: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Error']>(
      {
        code: 'DUPLICATE_FQN',
        message: 'класс com.demo.Order объявлен в нескольких файлах',
        files: ['a/com/demo/Order.java', 'b/com/demo/Order.java'],
      },
      { status: 422 },
    ),
  ),
  uploadNoSources: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Error']>(
      { code: 'NO_SOURCES', message: 'нужны исходники, а не скомпилированный код' },
      { status: 422 },
    ),
  ),
  uploadZipSlip: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Error']>({ code: 'ZIP_SLIP', message: 'путь ../evil.java вне архива' }, { status: 422 }),
  ),
  uploadLimitExceeded: http.post(`${API}/projects`, () =>
    HttpResponse.json<Schemas['Error']>(
      { code: 'LIMIT_EXCEEDED', message: 'распакованный размер больше 20 МБ' },
      { status: 413 },
    ),
  ),

  // GET export: jar не компилируется (422) и jar ещё не реализован на бэке (501, тело — как у app сейчас).
  exportJarCompileError: http.get(`${API}/projects/:projectId/export`, ({ request }) =>
    new URL(request.url).searchParams.get('format') === 'jar'
      ? HttpResponse.json<Schemas['Error']>(
          { code: 'COMPILE_ERROR', message: 'OrderService.java:33 — cannot find symbol byId' },
          { status: 422 },
        )
      : undefined,
  ),
  exportJarNotImplemented: http.get(`${API}/projects/:projectId/export`, ({ request }) =>
    new URL(request.url).searchParams.get('format') === 'jar'
      ? HttpResponse.json<Schemas['Error']>(
          { code: 'INTERNAL', message: 'экспорт .jar пока не реализован' },
          { status: 501 },
        )
      : undefined,
  ),
};

const loadWarnings: Schemas['LoadWarning'][] = [
  ...fixtures.project.warnings,
  { code: 'TESTS_IMPORTED', message: 'Найдена папка tests/: 1 IO-тест.' },
  { code: 'IGNORED_FILE', file: 'pom.xml', message: 'pom.xml не нужен — работаем с исходниками.' },
  { code: 'UNPARSED_FILE', file: 'src/com/demo/Nested.java', message: 'Файл загружен текстом, без схемы.' },
];
