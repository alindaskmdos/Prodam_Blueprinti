# sandbox

«▶ Запуск» и «Проверить поведение» (ТЗ §10, §11а): состояние песочницы, диалог запуска, ошибки.

- `useSandboxStore` (zustand, вне React — `getState()` из `src/app/commands.ts`): `init(client, projectId)` (хук `useSandbox` в экране редактора) — `GET /health` (`docker`) и `GET /projects/{id}` (`mainClasses`).
- `run(mainClass, stdin)` → `POST run`. 200 → `useTestsStore.showRunResult` и вкладка «Результат тестов» (`showPanel('bottom', 'bottom.tests')`). 422 `AMBIGUOUS_MAIN` → диалог остаётся, выбор из `details.mainClasses`; 422 `INVALID_REQUEST` → текст в диалоге.
- `verify()` → `POST verify`. 200 → `showVerifyResult` + вкладка тестов. 422 → тост «Проверка невозможна» (список main).
- 503 (SandboxUnavailable) → `unavailable` = `Error.message`, тост «Песочница недоступна» с «Проверить снова» (`checkHealth`; docker=true снимает блокировку).
- `sandboxDisabledReason(state)` — причина неактивности кнопок (нет проекта / docker=false / 503); `busy` ('run' | 'verify') — идёт прогон, кнопки заблокированы.
- Пока песочница недоступна (503 или docker=false), `useSandbox` повторяет `GET /health` каждые `HEALTH_RETRY_MS` (15 с); опрос останавливается при успехе и размонтировании. «Проверить снова» — в тосте и в плашке шапки.
- `RunDialog` — точка входа (select при нескольких main, обязателен), stdin, «Запустить» с индикатором. `SandboxNotice` — тост ошибок.

Моки: run — `run.ok.json`, verify — `verify.green.json`; `scenarios.verifyRed`, `verifyUnavailable`, `verifyAmbiguousMain`, `runUnavailable`, `runAmbiguousMain`, `runInvalidMain`, `noDocker`, `projectTwoMains`.

Тесты: `src/app/sandboxActions.test.tsx`.
