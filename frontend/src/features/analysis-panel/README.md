# analysis-panel

Панель анализа справа (ТЗ §8.4, макет — правая колонка `docs/design/screens/Editor.dc.html`).
Три вкладки — отдельные элементы реестра `src/app/panels.ts` (`area: 'right'`): `ProblemsTab`, `WarningsTab`, `MetricsTab` (проп `client?`, по умолчанию `api`).

- Данные: `GET /projects/{projectId}/analysis?n=…` (`Schemas['Analysis']`). Общий стор `useAnalysisStore` (zustand): `n` (по умолчанию 10 000), `analysis`, `status`; `useAnalysis(client)` грузит при смене `projectId`/`version` из `useAppStore` или `n`, дубли не шлёт, устаревшие ответы отбрасывает. `setAnalysis(projectId, a)` — подставить анализ из `MutationResult` (n берётся из `a.n`). Ошибка перезагрузки при старом анализе — плашка «устаревшие данные».
- «Проблемы» — `confidence: high`, «Предупреждения» — `confidence: low` (бейдж «возможно», «без автоисправления»). Сортировка `sortBySeverity`: high → medium → low, затем файл и строка.
- Карточка (`IssueCard`): бейдж серьёзности, правило, `Метод:строка` (полный файл и строки в `title`), сообщение, Big O до/после, «≈X → ≈Y операций при n = …» с подписью «асимптотическая оценка» (`formatOpsEstimate`), рекомендация; у каждого id из `Issue.fixes` — кнопка «Применить» (`onApplyFix`) → команда `runCommand('fix.apply', { issueId, fixId })` → диалог Quality Gate (`features/fix`). Id фиксов не хардкодятся. Кнопка неактивна (`fixDisabledReason`, причина в `title`), если песочница недоступна (`/health` docker=false, 503) или уже идёт запуск / проверка / другой фикс. Карточка — `div`: выбор — внутренняя кнопка (`aria-pressed`), фиксы — отдельная группа.
- Клик по карточке → `useAppStore().selectIssue({issueId, methodId, blockId})`: выставляет `selectedIssueId`, `selectedBlockId` и `selectedMethodId`; без `methodId` метод не меняется, `selectedBlockId` = null. Центрирование ноды по `selectedBlockId` — FE-05.
- `OpsEstimate`: «≈10⁸ → ≈10⁴ операций при n = …» из готовых `complexity.opsBefore/opsAfter` (`formatOps` только форматирует), поле n (Enter/blur → новый запрос), подпись «асимптотическая оценка, не замер». «Ускорение в X раз» здесь не показывается.
- «Метрики» — `Analysis.metrics` (`MethodMetrics`): плитки (методов / строк / макс. вложенность) и таблица метод · строк · влож. · время; клик по строке → `selectMethod`.

Моки: GET analysis — `contract/fixtures/analysis.merge.json` (числа не зависят от n), `scenarios.analysisNotFound` — 404.

Тесты: `AnalysisPanel.test.tsx` — три вкладки на фикстуре, сортировка, клик → store, смена n → запрос с n, ошибка; `format`.
