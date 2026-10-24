# Задачи

Формат: `- [ ] ID Название | Трогает | Зависит от | ТЗ §`
Параллельно запускаются только задачи с разным «Трогает». Каждая сторона правит только свой раздел.

## Общее (делают люди вместе, первый час)

- [x] CT-01 `contract/openapi.yaml` v1: файл проекта (`path` + `package`), блок, Issue, тест, результат теста, все эндпоинты §12; ручные фикстуры для одного метода | contract | — | §4, §11, §12
- [ ] HU-01 (Иван) Coolify: ресурс «Docker Compose» из GitHub-репо, ветка `main`, файл `/docker-compose.yml`; домен только на сервис `frontend` (порт 80) | Coolify | BE-47, FE-14 | §2
- [ ] HU-02 (Иван) Coolify: автодеплой выключить; Deploy Webhook и API-токен положить в секреты GitHub `COOLIFY_WEBHOOK`, `COOLIFY_TOKEN` (нужны для CI-01) | Coolify, GitHub | HU-01 | §2
- [ ] HU-03 (Иван) VPS: ≥ 2 ГБ RAM (лучше 4), Docker; `LLM_API_KEY` в переменных Coolify — только если нужен ИИ | VPS | — | §2
- [ ] HU-04 (Иван) Проверить вкладку Actions на GitHub: CI зелёный на main (у агентов нет `gh`) | GitHub | — | §2
- [ ] HU-05 (оба) После первого деплоя: открыть публичный адрес, загрузить samples/demo, прогнать фикс → запуск → «Проверить поведение» → экспорт | — | HU-01 | §2

## Backend

- [x] BE-01 Скелет: Gradle Kotlin DSL, wrapper, `settings.gradle.kts` со всеми модулями, `build-logic` (convention-плагин: toolchain 21, JUnit 5), `libs.versions.toml`, `app` со Spring Boot + health, интерфейсы-заглушки точек расширения, CI GitHub Actions (`./gradlew build`), `gradle.properties`: `org.gradle.parallel=true`, `org.gradle.caching=true`, `org.gradle.jvmargs=-Xmx1g` (несколько worktree = несколько демонов) | backend/* | — | §2, §3
- [x] BE-02 Демо-монолит `samples/demo/` ~1000 строк с заложенными дефектами + IO-тесты к нему | samples/demo | — | §13
- [x] BE-03 Корпус `samples/roundtrip/`: по файлу на каждую конструкцию слайда 7 | samples/roundtrip | — | §5
- [x] BE-04 Загрузка .java/.zip/.jar (только с исходниками), защита от zip slip и zip bomb, отрезание обёртки, source root по `package`, предупреждение о несовпадении пакета, отказ на дубликатах FQN, импорт `tests/`, экспорт с исходной структурой; хранение в памяти, дерево по пакетам, версия + 409 | app, source | BE-01, CT-01 | §11, §12
- [x] BE-05 Модели `model` по контракту + AstToBlocks для всех kind, включая `comment` и `raw` | model, blocks | BE-01, CT-01 | §4, §5
- [x] BE-06 BlocksToJava + замена тела метода + `RoundTripCorpusTest` | blocks | BE-05, BE-03 | §5
- [x] BE-07 Валидация текста нод (parseExpression/parseStatement), эндпоинты PUT blocks / PUT files | blocks, app | BE-06, BE-04 | §5, §12
- [x] BE-36 Экспорт исполняемого .jar из чистого кода (манифест Main-Class, без tests/ и .blueprints/), тест через `java -jar` на IO-тестах | runner, app | BE-08, BE-09 | §11
- [x] BE-37 Эндпоинты GET blocks / GET files / GET analysis (представления из ProjectView) | app | BE-07 | §12
- [x] BE-38 Эндпоинты тестов (GET tests, GET/PUT/DELETE tests/{name}), POST run, POST verify | app | BE-09, BE-10, BE-11 | §10, §12
- [x] BE-39 GET /tree через ProjectView.tree (complexity, issueCount обязателен по схеме); параметр `n` у GET analysis пересчитывает ops | app, analysis | BE-37 | §8.4, §12
- [x] BE-40 POST issues/{issueId}/fix (QualityGate + RefactoringRegistry, version/diff в FixResult); Issue.fixes = id фиксов с canApply (пусто при confidence=low) | app | BE-19, BE-38 | §9, §12
- [x] BE-41 samples/demo: место, где безопасен фикс contains → LinkedHashSet (локальный список из `new` в том же методе, без сторонних вызовов в цикле); IO-тесты demo зелёные, тесты детекторов/фиксов на demo обновить | samples/demo | BE-20 | §13
- [x] BE-08 Runner: Docker, лимиты, таймаут, переписывание для запуска (seed) | runner | BE-01 | §11а, §10.4
- [x] BE-09 IoTestSource: `tests/*.json`, импорт `*.in/*.out`, режимы original/manual, ignoreLines | testing | BE-08 | §10.1
- [x] BE-10 BehaviorVerifier: двойной прогон, шумные строки, правило сравнения, блок при отсутствии stdin-тестов | testing | BE-09 | §10.3–10.5
- [x] BE-11 JUnitTestSource: console launcher, XML-отчёт, private→package-private, статус «не компилируется» | testing | BE-08 | §10.2
- [x] BE-12 Символы размера коллекций + алгебра Big O + таблица JDK + граф вызовов | analysis | BE-04 | §8.1, §8.2
- [x] BE-13 Детектор NestedLoopSameCollection | analysis | BE-12 | §8.3
- [x] BE-14 Детектор LinearSearchInLoop | analysis | BE-12 | §8.3
- [x] BE-15 Детектор ExpensiveCallInLoop | analysis | BE-12 | §8.3
- [x] BE-16 Детектор StringConcatInLoop | analysis | BE-12 | §8.3
- [x] BE-17 Детекторы LongMethod / DeepNesting | analysis | BE-12 | §8.3
- [x] BE-18 Quality Gate: применить → компиляция → все тесты → откат | fixes | BE-10, BE-11 | §9
- [x] BE-19 Фикс StringBuilder | fixes | BE-16, BE-18 | §9
- [x] BE-20 Фикс contains → LinkedHashSet | fixes | BE-14, BE-18 | §9
- [x] BE-21 Фикс «индекс по id» | fixes | BE-13, BE-18 | §9
- [x] BE-42 samples/demo: `String.format` с `Locale.ROOT` (ReportService:80 и др.) — IO-тесты demo и StringBuilderFixTest зелёные под ru_RU | samples/demo | BE-41 | §13
- [x] BE-43 Долги fixes: List/ArrayList/LinkedList по простому имени в LinkedHashSetFix (как в IndexByIdFix), StringBuilderFix — отказ на `char[]` и сохранение комментария, QualityGate — закрыть StandardJavaFileManager, без системного компилятора отказ вместо NPE, Refactoring получает unmodifiable карту | fixes | BE-18…BE-21 | §9
- [x] BE-44 Долги app: PUT files пересчитывает предупреждения загрузки/mainClasses/дубликаты FQN; verify не пропускает main при битых tests/*.json; ProjectsApiTest.javaJar ждёт/убивает процесс java | app | BE-07, BE-38, BE-36 | §11, §12
- [x] BE-45 runner: `--release 21` в Runner.run (на JDK 22 demo приходит original_fails); Instrumenter — при отказе вставки/некомпилируемой копии файл без вставок, атомарная запись trace-файла, `docker exec cat` в общем бюджете времени; тесты на jar без инструментации и halt → hits null | runner | BE-27 | §11а, §14а.6
- [x] BE-46 `GET /health` по контракту: `docker` (реальная проверка доступности Docker, как у Runner) и `llm` (задан ли LLM_API_KEY); тест на схему ответа | app | BE-38 | §2, §11а
- [x] BE-48 Поля дерева для форм FE-10 по CT-02: fqn/modifiers/extends/implements/typeParams/headerSpan у ClassNode, span у полей, span/headerSpan/modifiers/returnType/params/throws у MethodNode | app, source | CT-02 | §7
- [ ] BE-49 Настройка LLM через env: кроме `LLM_API_KEY` — `LLM_BASE_URL` (OpenAI-совместимый endpoint) и `LLM_MODEL`; проброс в docker-compose*.yml, таблица env в README, `/health` llm:true только при ключе | app, compose, README | BE-01 | §9
- [x] BE-47 `backend/Dockerfile` под Coolify (см. decisions «Деплой через Coolify»): многоэтапная сборка Gradle → JDK 21 (компиляция через javax.tools в процессе) + docker CLI; при старте фоном `docker pull $BLUEPRINTS_RUN_IMAGE`, если образа нет; JVM по лимиту контейнера (MaxRAMPercentage); HEALTHCHECK на /api/health; `.dockerignore`; проверка: образ собирается, в контейнере с docker.sock и папкой запуска /health → docker:true и verify на samples/demo зелёный | backend (Dockerfile) | BE-46 | §2

## Frontend

- [x] FE-01 Скелет Vite+TS, `gen:api`, MSW на фикстурах, `VITE_USE_MOCKS`, CI | frontend/* | CT-01 | §2
- [x] FE-02 Каркас экрана как слайд 4: дерево, холст, панель анализа, нижняя панель; реестр вкладок | layout | FE-01 | §6
- [x] FE-03 Ноды только просмотр: React Flow + ELK, контейнеры, стиль Blueprints, ноды-комментарии | editor-nodes | FE-01 | §6
- [x] FE-04 Monaco + синхронизация (debounce, версия, 409) | editor-code | FE-01 | §5, §12
- [x] FE-05 Подсветка строка ↔ нода, клик по проблеме → разворот и центрирование | editor-nodes, analysis-panel | FE-03, FE-04 | §6
- [x] FE-06 Сворачивание контейнеров, мини-карта, переключатель комментариев | editor-nodes | FE-03 | §6
- [x] FE-07 Правка текста в ноде с подсветкой синтаксиса Java + красная нода при ошибке | editor-nodes | FE-03 | §5, §6
- [x] FE-08 «+» на стрелке, удаление, вверх/вниз | editor-nodes | FE-07 | §6
- [x] FE-09 Drag из палитры на стрелку | editor-nodes | FE-08 | §6
- [x] FE-10 Формы классов/полей/конструкторов/методов: правка заголовка объявления по headerSpan/span в тексте файла → PUT files (решение 2026-10-25), создание/удаление шаблоном текста | project-tree | FE-02, CT-02 (моки), BE-48 (реальный бэк) | §7
- [x] FE-11 Панель анализа: Проблемы / Предупреждения / Метрики, оценка «≈ операций» с n | analysis-panel | FE-02 | §8.4
- [x] FE-12 Панель тестов: IO-тесты, JUnit в Monaco, результаты, diff, шумные строки серым | tests-panel | FE-02, FE-04 | §10
- [x] FE-13 Кнопки: применить фикс, запуск, проверить поведение | analysis-panel, tests-panel | FE-11, FE-12 | §9, §10
- [x] FE-14 `frontend/Dockerfile` (сборка Vite → nginx) + `docker-compose.yml` под Coolify по стыку из decisions «Деплой через Coolify»: nginx-проксирование /api, лимит тела и таймаут, только `expose`, healthcheck фронта, depends_on backend healthy | docker-compose.yml, frontend (Dockerfile) | FE-01, BE-47 (стык зафиксирован — можно параллельно) | §2
- [x] FE-15 Экран загрузки: drag&drop файлов, .zip/.jar, папки целиком (`webkitdirectory`); показ предупреждений и ошибок загрузки; экспорт .zip с галочкой «настройки Java Blueprints» и .jar (неактивна с причиной, если не компилируется; подпись «требует Java 21+») | upload | FE-02 | §11
- [x] FE-29 Холст после правки: правка ноды / «+» / удаление не сбрасывают viewport на fitView всей схемы; switch с множеством case не раскладывается в одну широкую строку (читаемо при fitView) | editor-nodes | FE-09 | §6
- [x] FE-30 Красный тест на main: UploadScreen «папка (webkitdirectory) уходит multipart-запросом» получает content-type text/plain — найти причину (код загрузки или тестовое окружение) и починить | upload | FE-15 | §11
- [x] FE-31 e2e на Playwright в `frontend/e2e/`: загрузка samples/demo, проблема → схема, правка ноды, фикс через Quality Gate, запуск со STDIN, verify зелёный и красный, экспорт zip/jar, drag из палитры; против URL из env (локально или compose) | frontend (e2e) | FE-14 | §2
- [x] FE-32 Красный тест на main при Node 26: MethodCanvas.collapse «Комментарии выкл» — `localStorage` undefined (Node-овский Web Storage перекрывает jsdom); in-memory Storage в setup.ts | frontend (test env) | FE-30 | —
- [x] FE-33 Ранжирование в командной палитре: точное > префикс > подстрока > инициалы > описание, без подпоследовательностей; навигация выше действий (Enter по имени метода не запускает фикс) | command-palette | FE-28 | §14а.14
- [x] FE-34 Длинный метод (switch на 14 case) открывается верхом схемы в читаемом масштабе вместо fitView 0.1; Fit View по-прежнему вписывает всё | editor-nodes | FE-29 | §6
- [x] FE-35 Выбор метода в дереве/палитре прокручивает Monaco к началу метода (MethodView.root.span) и подсвечивает его; клик по проблеме — как в FE-05 | editor-code, app | FE-05 | §6
- [x] FE-36 Сворачиваемые панели «Проект»/«Анализ»/нижняя (кнопки, полосы, Ctrl+B/J/Alt+B, «Только схема» Ctrl+\, команды «Вид», showPanel разворачивает); вкладки анализа в одну строку; имя папки/архива в шапке; вывод запуска во вкладке «Консоль» | layout, app, upload | FE-02 | §6
- [x] FE-37 Холст без перекрытий: палитра свёрнута в «+ Блок», панель вида в строку, мини-карта скрыта по умолчанию (решение 2026-10-25), начальный вид и полёт к блоку учитывают оверлеи; Delete/Backspace/Enter на выбранной ноде, мультивыбор выключен | editor-nodes | FE-09, FE-34 | §6
- [x] FE-38 Панель анализа: русские названия правил, выделение выбранной проблемы, строка-сводка над «Проблемами»/«Предупреждениями», метрики в одну строку с title | analysis-panel | FE-11 | §8.4
- [ ] FE-39 Дерево проекта: бейдж сложности с ellipsis+title; выбор метода из проблемы/палитры раскрывает и прокручивает дерево к нему | project-tree | FE-16 влит | §6
- [ ] FE-40 Палитра: точное имя класса («Order») выше полей/методов с подстрокой; починить флейк CommandPalette.test «хоткеи Ctrl+K» (таймаут под нагрузкой) | command-palette | FE-33 | §14а.14
- [ ] FE-41 Первый вход: запуск открывает «Консоль», а не «Результат тестов»; убрать «Шаг 1 из 6» с экрана загрузки или показать шаги; после загрузки открывать метод с самой серьёзной проблемой | sandbox, upload, app | FE-36 | §6, §11
- [ ] FE-42 Панель анализа: вкладки при переносе не налезают на список; порядок в «Проблемах», «Предупреждениях», «Метриках» — текущий метод, остальные методы текущего класса, всё остальное | analysis-panel | FE-38 | §8.4
- [ ] FE-43 Ноды: текст ошибки не наслаивается на код (под кодом, перенос); понятное сообщение парсера («Синтаксическая ошибка: неожиданный «-»»); наведение на «!» показывает русское название и текст проблемы, а не id; кнопка свернуть/развернуть на блоке; кнопка закрытия у палитры «+ Блок» | editor-nodes | FE-37 | §6
- [ ] CI-01 `.github/workflows/ci.yml`: job `compose` — `docker compose up`, /health → docker:true, FE-31 e2e; job `deploy` только на main после всех зелёных — POST на webhook Coolify (секреты COOLIFY_WEBHOOK, COOLIFY_TOKEN) | .github | BE-47, FE-14, FE-31 | §2

## Если успеем (только после того, как обязательный путь работает целиком; по порядку)

Задачи с зависимостью от CT-xx начинаются с изменения `contract/` людьми.

- [x] CT-02 Контракт для пп.1–4: UML, граф зависимостей, конфиг PMD | contract | — | §14а
- [x] BE-22 UML-модель: классы, члены, связи (агрегация/композиция с флагом «эвристика») | analysis, app | BE-12, CT-02 | §14а.1
- [ ] FE-16 Вкладка UML: React Flow + ELK, клик → дерево проекта; переход UML → редактор (класс → дерево + Monaco на span, метод → схема метода) с анимацией | diagrams | FE-02, CT-02 | §14а.1
- [ ] BE-23 PmdDetector + `.blueprints/pmd-ruleset.xml` по умолчанию (без правил, пересекающихся с нашими детекторами), привязка к нодам по строке, GET/PUT конфига | analysis, app | BE-12, CT-02 | §14а.2
- [ ] FE-17 Редактор конфига PMD (Monaco XML), источник «PMD» в предупреждениях | analysis-panel | FE-11, CT-02 | §14а.2
- [x] BE-24 Детектор мёртвого кода (исключения из §14а.3) | analysis | BE-12 | §14а.3
- [x] BE-25 Граф зависимостей классов + циклы (Tarjan) как Issue, без связей внешний↔вложенный | analysis, app | BE-12, CT-02 | §14а.4
- [ ] FE-18 Вкладка графа зависимостей, циклы красным | diagrams | FE-16 | §14а.4
- [ ] CT-03 Контракт для пп.5–9: сложность по памяти, покрытие, шаблоны, консоль | contract | — | §14а
- [ ] BE-26 Сложность по памяти | analysis | BE-12, CT-03 | §14а.5
- [ ] FE-19 Второй бейдж «память», в карточке фикса до/после | analysis-panel, editor-nodes | FE-11, CT-03 | §14а.5
- [x] BE-27 Инструментация `Trace.hit(int)` в копии для запуска по правилам §14а.6, тесты на корпусе | runner | BE-08 | §14а.6
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
- [x] BE-32 Модуль `cli` (picocli): analyze, verify, `--fail-on`, json/text | cli | BE-12, BE-10 | §14а.11
- [ ] BE-33 Таблица символов для метода целиком с областями видимости по нодам | analysis, app | BE-12, CT-04 | §14а.12
- [ ] FE-25 Автодополнение в Monaco и полях нод (локальная фильтрация) | editor-code, editor-nodes | FE-07, CT-04 | §14а.12
- [ ] BE-34 Запись значений `Trace.value` на одном тесте: 10 000 шагов, без `toString()` у объектов | runner, app | BE-27, CT-04 | §14а.13
- [ ] FE-26 Пошаговое воспроизведение: подсветка ноды, переменные, ползунок | debug | FE-03, CT-04 | §14а.13
- [x] FE-28 Командная палитра (cmdk): поиск по классам/методам/полям/нодам/проблемам, реестр команд `commands.ts` | command-palette | FE-02, FE-05 | §14а.14
- [ ] BE-35 Модуль `report`: HTML-отчёт | report, app | BE-28, CT-04 | §14а.15
- [ ] FE-27 Кнопка экспорта отчёта | analysis-panel | FE-13, CT-04 | §14а.15

## Позже (не брать, пока основной путь не работает целиком)

Граф вызовов проекта (вкладка), декомпозиция, Refactoring (выделить метод, переместить, переименовать), LlmFixProvider, Benchmark (замер по кнопке), анализ через поля классов, доп. детекторы и фиксы (§8.3, §9).
