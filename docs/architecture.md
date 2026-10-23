# Архитектура (коротко)

Подробности — `docs/TZ.md` §3. Этот файл держать коротким: модули и интерфейсы.

```
Frontend (React)
  editor-code (Monaco) ⇄ editor-nodes (React Flow + ELK)
  project-tree, analysis-panel, tests-panel
        │ REST/JSON по contract/openapi.yaml, версия проекта (409 при устаревшей)
Backend — Gradle, модульный монолит (backend/)
  app (Spring Boot, REST, хранение, версия)
   ├─ fixes ──→ analysis, testing, source
   ├─ blocks ─→ source
   ├─ analysis → source
   ├─ testing → runner → source
   ├─ ai → fixes (если успеем)
   ├─ report → analysis, testing (если успеем)
   ├─ benchmark → runner (позже)
   └─ все → model (record'ы без зависимостей)
cli (без Spring) → те же модули, что app (если успеем)
```
Зависимости между модулями — только по таблице в `backend/CLAUDE.md`; нарушение = ошибка компиляции.

## Точки расширения

| Интерфейс | Пакет | Реестр |
|---|---|---|
| `Detector` | analysis | `DetectorRegistry` |
| `FixProvider` | fixes | `FixProviderRegistry` |
| `Refactoring` | fixes | `RefactoringRegistry` |
| `TestSource` | testing | `TestSourceRegistry` |
| `Benchmark` | benchmark | — (позже) |
| Вкладки UI | frontend `panels.ts` | список |

## Поток изменения

Правка ноды → PUT /methods/{id}/blocks (полное дерево + версия) → BlocksToJava → замена тела метода → печать → парсинг → новые блоки + анализ + версия+1.
