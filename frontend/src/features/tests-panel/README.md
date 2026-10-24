# tests-panel

Вкладка «Результат тестов» нижней панели (ТЗ §10, макет `docs/design/screens/Tests.dc.html`). Регистрация — `bottom.tests` в `src/app/panels.ts`.

- `<TestsPanel client? />` — слева список IO- и JUnit-тестов (`GET tests` при смене `projectId` из `useAppStore`), справа результаты выбранного теста и форма правки; сверху — плашка итога проверки.
- Правка: IO — имя, режим «как у оригинала / вручную» (`expected` только в manual), stdin, `ignoreLines` («6, 7»); JUnit — текст `tests/*.java` в Monaco (`JUnitSourceEditor` — ленивый чанк, та же `setupMonaco`/тема `jb-graphite`, что у `editor-code`, из `editor-code/monaco`). Имя меняется только у нового теста.
- `useTestsStore` (zustand): `save` → `PUT tests/{name}` с `version` из `useAppStore` (не известна — `GET /projects/{id}`), `remove` → `DELETE tests/{name}?version=`. 200 → `setVersion`; 409 → тост «Проект изменён», черновик отброшен (`reloadSeq`), версия (`GET project`) и список перезагружены; 422 и прочие ошибки → `saveError` в форме, черновик остаётся.
- **Показ результатов (для FE-13):** `useTestsStore.getState().showVerifyResult(verifyResult)` — ответ `POST verify` / `FixResult.verify`; `showRunResult(runResult)` — ответ `POST run` (пункт «Последний запуск»). Результаты помечаются «получены на версии N», если версия с тех пор изменилась.
- Черновики: форма сообщает `setDirty`. Если в форме есть правки, `showRunResult` не переключает выбор, а помечает «Последний запуск» бейджем «новый». При 409 правка сохраняется в `conflict.draft`: тост не закрывается сам, в нём «Повторить с моей правкой» (`restoreDraft` открывает форму с черновиком, новый тест остаётся новым), «Скопировать» и текст правки.
- Результаты к тесту: IO — точно по имени; JUnit — имя равно имени теста или класс в `pkg.Class.method` (предпоследний сегмент; `Outer$Inner` — по `Outer` или `Outer$Inner`) равен тесту (`resultsFor`). Результаты без теста — группа «Только результаты». Статус вне контракта показывается нейтрально как «неизвестно» (`aggregateStatus` → `'unknown'`, `VerifySummary` → «Статус проверки неизвестен»).
- `OutputDiff` — построчный diff ожидаемого/полученного stdout, «отличается со строки N»; `noisyLines` и `ignoreLines` — серым зачёркнутым, не считаются отличием. `TestResultView` — статус (пройден / не пройден / не компилируется / оригинал тоже не проходит), время, `error`; у `passed` `error` — нейтральное пояснение (напр. @Disabled), не ошибка.
- `VerifySummary` — green/red/incomplete/blocked, счётчики, полоса, `warnings`; при `blocked` — «Создать заготовку» (новый IO-тест).
- Чистые функции — `results.ts` (`diffLines`, `firstDiffLine`, `resultsFor`, `aggregateStatus`, `parseLineList`, `newTest`).

Моки (`src/mocks/handlers.ts`): GET tests — `project.json` tests + `test.junit.json`; PUT/DELETE — версия +1; `scenarios.conflictOnTest`, `conflictOnTestDelete` (409), `invalidTest` (422).

Тесты: `TestsPanel.test.tsx` (список, создание с version, DELETE с version, 409, 422, verify.red.json, noisyLines, run.ok.json), `results.test.ts`.
