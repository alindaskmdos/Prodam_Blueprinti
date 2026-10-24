# Backend — правила

Java 21, **Gradle (Kotlin DSL), многомодульный монолит**, Spring Boot только в `app`, JavaParser + Symbol Solver.
ТЗ: §4 (модель данных), §5 (round-trip), §8 (анализатор), §9 (фиксы), §10 (тесты), §11 (загрузка), §11а (песочница).

## Модули

`backend/` — корень Gradle-проекта (`settings.gradle.kts`). Каждый модуль — подпроект.

| Модуль | Что | Зависит от | Точка расширения |
|---|---|---|---|
| `model` | Block, Issue, TestCase, TestResult, ProjectSnapshot — чистые record'ы | — | — |
| `source` | загрузка исходников, настройка JavaParser + SymbolSolver, CompilationUnit'ы проекта | model | — |
| `blocks` | `AstToBlocks`, `BlocksToJava`, валидация текста нод | model, source | — |
| `analysis` | Big O, символы размера, граф вызовов, детекторы | model, source | `Detector` |
| `runner` | компиляция, запуск в Docker, переписывание и инструментация для запуска | model, source | — |
| `testing` | IO-тесты, JUnit, сравнение поведения | model, runner | `TestSource` |
| `fixes` | quick-fix'ы, Quality Gate | model, source, analysis, testing | `FixProvider`, `Refactoring` |
| `benchmark` | замер сложности (позже) | model, runner | `Benchmark` |
| `ai` | опциональный LLM-слой (если успеем) | model, source, fixes | `FixProvider` |
| `report` | отчёт об оптимизации (если успеем) | model, analysis, testing | — |
| `cli` | CLI на picocli, без Spring (если успеем) | model, source, blocks, analysis, runner, testing, fixes | — |
| `app` | Spring Boot: REST по контракту, хранение проектов, версия, сборка модулей вместе | все, кроме `cli` | — |

**Направление зависимостей строго сверху вниз по таблице.** Нельзя добавлять зависимость, которой нет в таблице, и нельзя создавать циклы. Если задача требует новой зависимости между модулями — верни «заблокировано» с обоснованием.

- Только `app` знает про Spring. `cli` собирает модули без Spring.
- Модули `ai`, `report`, `cli` создаются только когда до них дойдёт очередь «если успеем» — не заранее. Остальные модули — обычные Java-библиотеки без Spring-аннотаций.
- Реализации точек расширения регистрируются в реестре своего модуля (`DetectorRegistry` и т.п.); `app` собирает реестры в бины.
- Версии библиотек — только в `gradle/libs.versions.toml`. Общие настройки модулей (toolchain 21, JUnit 5) — в convention-плагине `build-logic/`. В `build.gradle.kts` модуля — только его зависимости.
- В каждом модуле — `README.md` (что здесь, главный класс, как тестировать).

## Правила кода

- Новое правило анализа = новый класс в `analysis`, реализующий `Detector`, + регистрация. Тест на позитивный и негативный пример.
- Новый фикс = класс в `fixes`, реализующий `Refactoring` (`canApply` / `apply`), + регистрация. Условия безопасности — в `canApply`.
- Фиксы используют только `LinkedHashMap`/`LinkedHashSet`.
- Неуверенный вывод анализатора → `confidence: low`. Не выдумывай уверенность.
- Генерация кода: заменяй только тело изменённого метода, остальное — через `LexicalPreservingPrinter`.
- Неподдержанный узел AST → блок `raw`, не исключение.
- DTO в `app` соответствуют `contract/openapi.yaml`; `ContractConformanceTest` проверяет ответы на фикстурах.
- Изменяющий эндпоинт увеличивает версию проекта; запрос со старой версией → 409.

## Песочница

- Пользовательский код только в одноразовом контейнере: `--network none`, лимит памяти и CPU, таймаут 10 с, уникальное имя контейнера.
- Переписывание для запуска (`Random` → seed 42, `Math.random()`, `private` → package-private для JUnit, инструментация) — только в копии для запуска.
- Экспорт `.jar` собирается **только из чистого кода** пользователя, без любых переписываний.

## Тесты и сборка

- Во время работы: `./gradlew :<модуль>:test` — только свой модуль.
- Перед коммитом: `./gradlew build` из `backend/` (все модули, включая round-trip).
- `RoundTripCorpusTest` (модуль `blocks`): каждый файл из `samples/` → блоки → Java → компилируется. Никогда не отключай и не ослабляй его.
- Spring-тесты в `app` — на случайном порту (`RANDOM_PORT`).
- Используй только `./gradlew`, не системный `gradle`. Wrapper закоммичен.
