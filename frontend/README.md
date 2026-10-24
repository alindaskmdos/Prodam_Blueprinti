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

Перед коммитом: `npm run typecheck && npm run lint && npm test`.

## Структура

- `src/features/*` — фичи (см. `frontend/CLAUDE.md`), `src/features/api` — клиент контракта.
- `src/app` — `App` (экран редактора: каркас `features/layout` + `features/project-tree`), реестры `panels.ts` (вкладки панелей: `{id, title, area: 'right' | 'bottom', component}`, порядок списка = порядок вкладок) и `commands.ts` (действия / командная палитра), `store.ts` — общее состояние на zustand (`projectId`, `version`, `selectedMethodId`, `selectedIssueId`/`selectedBlockId` через `selectIssue`; `useAppStore`, вне React — `useAppStore.getState()`).
- `src/mocks` — MSW: `handlers.ts` (по умолчанию + `scenarios` для 409, red verify, отклонённого фикса), `browser.ts`, `server.ts`.
- `src/styles/tokens.css` — токены дизайна Graphite (`docs/design/README.md`), анимации `jb-*`, `prefers-reduced-motion`.
