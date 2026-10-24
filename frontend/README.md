# Frontend — Java Blueprints

Vite + React 18 + TypeScript (strict). Node 22.

## Запуск

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173
```

## Режимы: моки / бэкенд

Переменная `VITE_USE_MOCKS` (см. `.env.example`, по умолчанию в `.env.development` — `true`).

- `true` — запросы `/api/*` перехватывает MSW (`src/mocks`, service worker `public/mockServiceWorker.js`) и отдаёт `contract/fixtures/*.json`. Бэкенд не нужен.
- `false` — dev-прокси Vite: `/api` → `VITE_BACKEND_URL` (по умолчанию `http://localhost:8080`, бэк слушает `/api/...`).

Локально переопределить: `.env.development.local` с `VITE_USE_MOCKS=false` или `VITE_USE_MOCKS=false npm run dev`.
Production-сборка моки не включает (переменная не задана).

## Скрипты

| Скрипт | Что |
|---|---|
| `dev` / `build` / `preview` | Vite |
| `typecheck` | `tsc --noEmit` |
| `lint` | ESLint (flat config, typescript-eslint, react-hooks) |
| `test` | Vitest + jsdom + Testing Library, MSW node-сервер в `src/test/setup.ts` |
| `gen:api` | типы из `../contract/openapi.yaml` → `src/features/api/generated/schema.ts` (коммитится) |

| `e2e` | Playwright (`e2e/`), реальный бэкенд, без моков; в `npm test` не входит |

Перед коммитом: `npm run typecheck && npm run lint && npm test`.

## e2e (Playwright)

`e2e/` — весь путь пользователя в Chromium на **реальном бэкенде, без моков**. Каждый тест грузит `samples/demo`; pageerror и HTTP 5xx от `/api` валят тест.

```bash
cd backend && ./gradlew :app:bootRun                       # :8080, нужен Docker
cd frontend && VITE_USE_MOCKS=false npx vite --port 5173   # фронт без моков
npx playwright install chromium                            # один раз
npm run e2e                                                # E2E_BASE_URL=http://host:port — другой адрес фронта
```

Адрес — `E2E_BASE_URL` (по умолчанию `http://localhost:5173`; для docker compose — адрес фронтенда). Один воркер, таймауты до 90 с на verify / Quality Gate.

## Структура

- `src/features/*` — фичи (см. `frontend/CLAUDE.md`), `src/features/api` — клиент контракта.
- `src/app` — `App` (без `projectId` в store — экран загрузки `features/upload`, иначе экран редактора: каркас `features/layout` + `features/project-tree`, холст выбранного метода и вкладка «Код Java» — `src/app/methodViews.tsx` поверх `editor-nodes` / `editor-code`), реестры `panels.ts` (вкладки панелей: `{id, title, area: 'right' | 'bottom', component}`, порядок списка = порядок вкладок) и `commands.ts` (действия / командная палитра: `project.upload`, `project.export`, `project.run`, `project.verify`, `fix.apply` с `{issueId, fixId}`; `runCommand(id, args?)`), `store.ts` — общее состояние на zustand (`projectId`, `version`, `selectedMethodId`, `selectedIssueId`/`selectedBlockId` через `selectIssue`, активные вкладки панелей `activePanels` / `showPanel(area, id)`, `highlight {source: 'canvas'|'code'|'issue', blockId, span, seq}` — подсветка строка ↔ нода (FE-05: холст пишет `canvas`, редактор кода — `code`, `selectIssue` — `issue`; каждая сторона реагирует только на чужие события, `selectMethod`/смена проекта сбрасывают; связка с редактором кода — `methodViews.tsx`); `useAppStore`, вне React — `useAppStore.getState()`).
- `src/mocks` — MSW: `handlers.ts` (по умолчанию, в т.ч. GET files — `file.order-service.json`, `/health` с docker=true, POST fix — applied + mutation, run — `run.ok.json`, verify — green; + `scenarios` для 409, red/503/422 verify, 503/422 run, отклонённого / неполного / 409 / 404 фикса, `noDocker`, `projectTwoMains`), `browser.ts`, `server.ts`.
- `src/styles/tokens.css` — токены дизайна Graphite (`docs/design/README.md`), анимации `jb-*`, `prefers-reduced-motion`.
