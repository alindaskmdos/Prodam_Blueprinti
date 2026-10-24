import { http, HttpResponse } from 'msw';
import type { Schemas, paths } from '../features/api';
import { fixtures } from './fixtures';

// '*' перед /api — чтобы совпадать с любым origin (браузер, jsdom в тестах).
const API = '*/api';

type Health = paths['/health']['get']['responses']['200']['content']['application/json'];
type PutFileBody = paths['/projects/{projectId}/files']['put']['requestBody']['content']['application/json'];

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
  http.get(`${API}/projects/:projectId/tests`, () => HttpResponse.json<Schemas['TestCase'][]>([fixtures.testJunit])),
  http.get(`${API}/projects/:projectId/tests/:name`, () => HttpResponse.json(fixtures.testJunit)),
  http.post(`${API}/projects/:projectId/run`, () => HttpResponse.json(fixtures.runOk)),
  http.post(`${API}/projects/:projectId/verify`, () => HttpResponse.json(fixtures.verifyGreen)),
  // Для MutationResult фикстуры нет — собираем из tree/analysis; версия +1, fileText = присланный текст.
  // GET files по умолчанию нет: в фикстурах нет текста файлов.
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
