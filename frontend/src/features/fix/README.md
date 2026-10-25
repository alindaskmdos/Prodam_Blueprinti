# fix

Применение фикса через Quality Gate (ТЗ §9, макет `docs/design/screens/QualityGate.dc.html`).

- `useFixStore` (zustand): `apply(client, projectId, issue, fixId, version)` → `POST /projects/{id}/issues/{issueId}/fix` с `{version, fixId}`; `version` — версия анализа, из которого взят `Issue` (Issue.id действителен только для неё), `fixId` — из `Issue.fixes`.
  - `applied` → `setVersion(result.version)`, снят выбор проблемы, анализ из `mutation.analysis` (иначе перезагрузится по version), `reloadProjectTree()`; холст и код подтягиваются сами по version. `verify` → панель тестов (`showVerifyResult`).
  - `applied=false` → «Исправление не подтверждено» + `reason` дословно, shake, версия прежняя; «Показать diff вывода» открывает вкладку тестов.
  - «Подтверждено, поведение совпадает» — только при `applied` и `verify.status = green`; иначе (`verify` нет, не green, нет тестов) — «Применено, проверка неполная» + `reason` дословно.
  - 409 → диалог закрыт, тост `FixConflictToast`, версия из `GET /projects/{id}` и перезагрузка дерева. 404 / сеть → ошибка в диалоге.
- `QualityGateDialog` — unified diff из ответа (`parseUnifiedDiff`: +/−, номера строк новой версии), Big O и «≈X → ≈Y операций при n = …» с подписью «асимптотическая оценка» (без «ускорения в X раз»), шаги `gateSteps` (патч → компиляция → IO-тесты → JUnit) — только по данным ответа: `applied` = патч и компиляция ок (ТЗ §9), тесты — из `verify`; что бэк не детализировал (rejected без `verify`, тесты при applied без `verify`) — статус `unknown` «сервер не детализировал шаги», без догадок по тексту `reason`, итог `verdictOf`. Пока запрос в полёте — закрыть нельзя.
- «Откатить» из макета нет: в контракте нет эндпоинта отката.

Подключение: `App` рендерит `<QualityGateDialog />` и `<FixConflictToast />`; кнопки «Применить» в `analysis-panel/IssueCard` вызывают команду `fix.apply` (`runCommand('fix.apply', { issueId, fixId })`, `src/app/commands.ts`: Issue и версия — из стора анализа, клиент — из стора песочницы).

Моки: POST fix — `fix.applied.json` + mutation; `scenarios.fixRejected`, `fixIncomplete`, `fixConflict`, `fixNotFound`.

Тесты: `gate.test.ts` (diff, шаги, вердикт), `src/app/sandboxActions.test.tsx` (applied/rejected/incomplete/409/нет Docker).

FE-24: `applyAi(client, projectId, issue, version)` — POST `/issues/{issueId}/ai-fix` `{version}` и тот же поток, что у `apply` (`apply(..., ai=true)`; `AI_FIX_ID` = «ИИ» вместо id фикса); 429/503 — `message` (+ `retryAfterSec`) в диалоге. `reloadAfterConflict` экспортирован для `features/ai`.
