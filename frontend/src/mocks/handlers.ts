import { http, HttpResponse } from 'msw';
import type { Schemas, paths } from '../features/api';
import { fixtures } from './fixtures';

// '*' перед /api — чтобы совпадать с любым origin (браузер, jsdom в тестах).
const API = '*/api';

type Health = paths['/health']['get']['responses']['200']['content']['application/json'];

/** Обработчики по умолчанию: «счастливый путь» на фикстурах contract/fixtures. */
export const handlers = [
  // Для /health фикстуры нет — ответ по схеме контракта.
  http.get(`${API}/health`, () => HttpResponse.json<Health>({ status: 'UP', docker: false, llm: false })),

  http.post(`${API}/projects`, () => HttpResponse.json(fixtures.project, { status: 201 })),
  http.get(`${API}/projects/:projectId`, () => HttpResponse.json(fixtures.project)),
  http.get(`${API}/projects/:projectId/tree`, () => HttpResponse.json(fixtures.tree)),
  http.get(`${API}/projects/:projectId/methods/:methodId/blocks`, () =>
    HttpResponse.json(fixtures.methodViewMerge),
  ),
  http.get(`${API}/projects/:projectId/analysis`, () => HttpResponse.json(fixtures.analysisMerge)),
  http.post(`${API}/projects/:projectId/issues/:issueId/fix`, () => HttpResponse.json(fixtures.fixApplied)),
  http.get(`${API}/projects/:projectId/tests`, () => HttpResponse.json<Schemas['TestCase'][]>([fixtures.testJunit])),
  http.get(`${API}/projects/:projectId/tests/:name`, () => HttpResponse.json(fixtures.testJunit)),
  http.post(`${API}/projects/:projectId/run`, () => HttpResponse.json(fixtures.runOk)),
  http.post(`${API}/projects/:projectId/verify`, () => HttpResponse.json(fixtures.verifyGreen)),
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
};
