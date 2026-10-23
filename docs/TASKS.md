# Задачи

Формат: `- [ ] ID Название | Трогает | Зависит от | ТЗ §`
Параллельно запускаются только задачи с разным «Трогает». Каждая сторона правит только свой раздел.

## Общее (делают люди вместе, первый час)

- [x] CT-01 `contract/openapi.yaml` v1: файл проекта (`path` + `package`), блок, Issue, тест, результат теста, все эндпоинты §12; ручные фикстуры для одного метода | contract | — | §4, §11, §12

## Backend

- [x] BE-01 Скелет: Gradle Kotlin DSL, wrapper, `settings.gradle.kts` со всеми модулями, `build-logic` (convention-плагин: toolchain 21, JUnit 5), `libs.versions.toml`, `app` со Spring Boot + health, интерфейсы-заглушки точек расширения, CI GitHub Actions (`./gradlew build`), `gradle.properties`: `org.gradle.parallel=true`, `org.gradle.caching=true`, `org.gradle.jvmargs=-Xmx1g` (несколько worktree = несколько демонов) | backend/* | — | §2, §3
- [x] BE-02 Демо-монолит `samples/demo/` ~1000 строк с заложенными дефектами + IO-тесты к нему | samples/demo | — | §13
- [x] BE-03 Корпус `samples/roundtrip/`: по файлу на каждую конструкцию слайда 7 | samples/roundtrip | — | §5
- [x] BE-04 Загрузка .java/.zip/.jar (только с исходниками), защита от zip slip и zip bomb, отрезание обёртки, source root по `package`, предупреждение о несовпадении пакета, отказ на дубликатах FQN, импорт `tests/`, экспорт с исходной структурой; хранение в памяти, дерево по пакетам, версия + 409 | app, source | BE-01, CT-01 | §11, §12
- [x] BE-05 Модели `model` по контракту + AstToBlocks для всех kind, включая `comment` и `raw` | model, blocks | BE-01, CT-01 | §4, §5
- [x] BE-06 BlocksToJava + замена тела метода + `RoundTripCorpusTest` | blocks | BE-05, BE-03 | §5
- [ ] BE-07 Валидация текста нод (parseExpression/parseStatement), эндпоинты PUT blocks / PUT files | blocks, app | BE-06, BE-04 | §5, §12
- [ ] BE-36 Экспорт исполняемого .jar из чистого кода (манифест Main-Class, без tests/ и .blueprints/), тест через `java -jar` на IO-тестах | runner, app | BE-08, BE-09 | §11
- [x] BE-08 Runner: Docker, лимиты, таймаут, переписывание для запуска (seed) | runner | BE-01 | §11а, §10.4
- [x] BE-09 IoTestSource: `tests/*.json`, импорт `*.in/*.out`, режимы original/manual, ignoreLines | testing | BE-08 | §10.1
- [x] BE-10 BehaviorVerifier: двойной прогон, шумные строки, правило сравнения, блок при отсутствии stdin-тестов | testing | BE-09 | §10.3–10.5
- [x] BE-11 JUnitTestSource: console launcher, XML-отчёт, private→package-private, статус «не компилируется» | testing | BE-08 | §10.2
- [x] BE-12 Символы размера коллекций + алгебра Big O + таблица JDK + граф вызовов | analysis | BE-04 | §8.1, §8.2
- [x] BE-13 Детектор NestedLoopSameCollection | analysis | BE-12 | §8.3
- [x] BE-14 Детектор LinearSearchInLoop | analysis | BE-12 | §8.3
- [x] BE-15 Детектор ExpensiveCallInLoop | analysis | BE-12 | §8.3
- [ ] BE-16 Детектор StringConcatInLoop | analysis | BE-12 | §8.3
- [ ] BE-17 Детекторы LongMethod / DeepNesting | analysis | BE-12 | §8.3
- [ ] BE-18 Quality Gate: применить → компиляция → все тесты → откат | fixes | BE-10, BE-11 | §9
- [ ] BE-19 Фикс StringBuilder | fixes | BE-16, BE-18 | §9
- [ ] BE-20 Фикс contains → LinkedHashSet | fixes | BE-14, BE-18 | §9
- [ ] BE-21 Фикс «индекс по id» | fixes | BE-13, BE-18 | §9

## Frontend

- [ ] FE-01 Скелет Vite+TS, `gen:api`, MSW на фикстурах, `VITE_USE_MOCKS`, CI | frontend/* | CT-01 | §2
- [ ] FE-02 Каркас экрана как слайд 4: дерево, холст, панель анализа, нижняя панель; реестр вкладок | layout | FE-01 | §6
- [ ] FE-03 Ноды только просмотр: React Flow + ELK, контейнеры, стиль Blueprints, ноды-комментарии | editor-nodes | FE-01 | §6
- [ ] FE-04 Monaco + синхронизация (debounce, версия, 409) | editor-code | FE-01 | §5, §12
- [ ] FE-05 Подсветка строка ↔ нода, клик по проблеме → разворот и центрирование | editor-nodes, analysis-panel | FE-03, FE-04 | §6
- [ ] FE-06 Сворачивание контейнеров, мини-карта, переключатель комментариев | editor-nodes | FE-03 | §6
- [ ] FE-07 Правка текста в ноде с подсветкой синтаксиса Java + красная нода при ошибке | editor-nodes | FE-03 | §5, §6
- [ ] FE-08 «+» на стрелке, удаление, вверх/вниз | editor-nodes | FE-07 | §6
- [ ] FE-09 Drag из палитры на стрелку | editor-nodes | FE-08 | §6
- [ ] FE-10 Формы классов/полей/конструкторов/методов | project-tree | FE-02 | §7
- [ ] FE-11 Панель анализа: Проблемы / Предупреждения / Метрики, оценка «≈ операций» с n | analysis-panel | FE-02 | §8.4
- [ ] FE-12 Панель тестов: IO-тесты, JUnit в Monaco, результаты, diff, шумные строки серым | tests-panel | FE-02, FE-04 | §10
- [ ] FE-13 Кнопки: применить фикс, запуск, проверить поведение | analysis-panel, tests-panel | FE-11, FE-12 | §9, §10
- [ ] FE-14 docker-compose, деплой | docker-compose.yml | FE-01 | §2
- [ ] FE-15 Экран загрузки: drag&drop файлов, .zip/.jar, папки целиком (`webkitdirectory`); показ предупреждений и ошибок загрузки; экспорт .zip с галочкой «настройки Java Blueprints» и .jar (неактивна с причиной, если не компилируется; подпись «требует Java 21+») | upload | FE-02 | §11

## Если успеем (только после того, как обязательный путь работает целиком; по порядку)

Задачи с зависимостью от CT-xx начинаются с изменения `contract/` людьми.

- [ ] CT-02 Контракт для пп.1–4: UML, граф зависимостей, конфиг PMD | contract | — | §14а
- [ ] BE-22 UML-модель: классы, члены, связи (агрегация/композиция с флагом «эвристика») | analysis, app | BE-12, CT-02 | §14а.1
- [ ] FE-16 Вкладка UML: React Flow + ELK, клик → дерево проекта | diagrams | FE-02, CT-02 | §14а.1
- [ ] BE-23 PmdDetector + `.blueprints/pmd-ruleset.xml` по умолчанию (без правил, пересекающихся с нашими детекторами), привязка к нодам по строке, GET/PUT конфига | analysis, app | BE-12, CT-02 | §14а.2
- [ ] FE-17 Редактор конфига PMD (Monaco XML), источник «PMD» в предупреждениях | analysis-panel | FE-11, CT-02 | §14а.2
- [ ] BE-24 Детектор мёртвого кода (исключения из §14а.3) | analysis | BE-12 | §14а.3
- [ ] BE-25 Граф зависимостей классов + циклы (Tarjan) как Issue, без связей внешний↔вложенный | analysis, app | BE-12, CT-02 | §14а.4
- [ ] FE-18 Вкладка графа зависимостей, циклы красным | diagrams | FE-16 | §14а.4
- [ ] CT-03 Контракт для пп.5–9: сложность по памяти, покрытие, шаблоны, консоль | contract | — | §14а
- [ ] BE-26 Сложность по памяти | analysis | BE-12, CT-03 | §14а.5
- [ ] FE-19 Второй бейдж «память», в карточке фикса до/после | analysis-panel, editor-nodes | FE-11, CT-03 | §14а.5
- [ ] BE-27 Инструментация `Trace.hit(int)` в копии для запуска по правилам §14а.6, тесты на корпусе | runner | BE-08 | §14а.6
- [ ] BE-28 Покрытие нод по кнопке (отдельный прогон), «неполное» при таймауте, процент | testing, app | BE-27, BE-10, CT-03 | §14а.6
- [ ] FE-20 Серые непокрытые ноды, счётчики, процент в панели тестов | editor-nodes, tests-panel | FE-12, CT-03 | §14а.6
- [ ] FE-21 Экспорт схем и диаграмм в PNG/SVG | editor-nodes, diagrams | FE-03 | §14а.7
- [ ] BE-29 Хранение пользовательских шаблонов `.blueprints/templates/`, экспорт с проектом | app | BE-04, CT-03 | §14а.8
- [ ] FE-22 Встроенные шаблоны в палитре (обязательные заполнители, суффиксы имён) + «Сохранить как шаблон» | editor-nodes | FE-09, CT-03 | §14а.8
- [ ] BE-30 Интерактивный запуск по WebSocket (stdin/stdout поток, таймаут бездействия, код с seed, одна консоль на сессию) | runner, app | BE-08, CT-03 | §14а.9
- [ ] FE-23 Консоль xterm.js + «Сохранить сессию как IO-тест» | console | FE-12, CT-03 | §14а.9
- [ ] CT-04 Контракт для пп.10, 12–14: capabilities, ИИ, символы, трасса, отчёт | contract | — | §14а
- [ ] BE-31 Модуль `ai`: LlmFixProvider, «объясни метод», правка ноды текстом (дифф до применения); лимиты запросов; `/capabilities` | ai, app | BE-18, CT-04 | §14а.10
- [ ] FE-24 Кнопки ИИ по `/capabilities` | analysis-panel, editor-nodes | FE-13, CT-04 | §14а.10
- [ ] BE-32 Модуль `cli` (picocli): analyze, verify, `--fail-on`, json/text | cli | BE-12, BE-10 | §14а.11
- [ ] BE-33 Таблица символов для метода целиком с областями видимости по нодам | analysis, app | BE-12, CT-04 | §14а.12
- [ ] FE-25 Автодополнение в Monaco и полях нод (локальная фильтрация) | editor-code, editor-nodes | FE-07, CT-04 | §14а.12
- [ ] BE-34 Запись значений `Trace.value` на одном тесте: 10 000 шагов, без `toString()` у объектов | runner, app | BE-27, CT-04 | §14а.13
- [ ] FE-26 Пошаговое воспроизведение: подсветка ноды, переменные, ползунок | debug | FE-03, CT-04 | §14а.13
- [ ] FE-28 Командная палитра (cmdk): поиск по классам/методам/полям/нодам/проблемам, реестр команд `commands.ts` | command-palette | FE-02, FE-05 | §14а.14
- [ ] BE-35 Модуль `report`: HTML-отчёт | report, app | BE-28, CT-04 | §14а.15
- [ ] FE-27 Кнопка экспорта отчёта | analysis-panel | FE-13, CT-04 | §14а.15

## Позже (не брать, пока основной путь не работает целиком)

Граф вызовов проекта (вкладка), декомпозиция, Refactoring (выделить метод, переместить, переименовать), LlmFixProvider, Benchmark (замер по кнопке), анализ через поля классов, доп. детекторы и фиксы (§8.3, §9).
