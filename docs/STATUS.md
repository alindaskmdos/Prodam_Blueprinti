# Статус

> Пишет только оркестратор. Это «сохранение игры»: после /clear новая сессия начинает отсюда.
> Обновлять полностью после каждых ~5 закрытых задач или крупного этапа.

Обновлено: 2026-10-24

## Backend

**Готово:** BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, BE-08, BE-09, BE-10, BE-11, BE-12, BE-13, BE-14, BE-15, BE-16, BE-17, BE-07, BE-18, BE-37, BE-19, BE-38, BE-20, BE-40; CT-01 (+ arrow-switch в Block, `<init>~N`)
**В работе:** BE-41 (samples/demo)
**Висящие ветки/worktree:** —. Локальный main впереди origin (BE-12..BE-20, BE-37, BE-38, BE-40, BE-07 + merge BE-06) — нужен push. Папки старых worktree в .claude/worktrees не удаляются из-за длинных путей Windows, стирать вручную. На origin висит устаревшая ветка be-5 (остатки отменённого merge BE-09) — удалить: `git push origin --delete be-5`.
**Заблокировано:** —
**Следующие шаги:** детекторы MVP закрыты (в брифах: не вливать main в ветку, не трогать docs/; Node.equals у JavaParser по содержимому — ключевать узлы по идентичности); app должен отдавать Analysis.metrics из MethodAnalysis.lines()/maxNesting(); BE-19/20/21 (фиксы, нужен BE-18; BE-19 берёт переменные через публичный StringConcatInLoop.concats); app ещё не отдаёт анализ (подстановка blockId по диапазону строк — decisions.md); BE-18 Quality Gate — после BE-10 ✓ и BE-11 ✓, доступна (текст «нет тестов» — по decisions.md); BE-18 Quality Gate — доступна. Фронту: перегенерировать TS-типы (UNPARSED_FILE в LoadWarning.code; BE-38 — version у PUT/DELETE tests, 422/503 у run/verify).

## Frontend

**Готово:** FE-01, FE-02, FE-03, FE-04, FE-11
**В работе:** Также в работе (запущены 2026-10-24, исполнители в worktree `.claude/worktrees/agent-*`, ветки `worktree-agent-*` — смотреть `git worktree list`): FE-15 (upload, App.tsx выбор экрана, кнопки шапки, commands.ts, мок POST /projects), FE-07 (editor-nodes: инлайн-правка текста ноды, PUT blocks, красная нода на 422, мок PUT blocks). Если сессия прервалась: есть коммит FE-xx в ветке → verifier + reviewer; нет → перезапустить исполнителя на ту же ветку.
FE-15 готов, на проверке (verifier+reviewer; при мерже конфликт только frontend/README.md). FE-12 (tests-panel, вкладка «Тесты» в panels.ts, GET/PUT/DELETE tests с version, показ результатов) — в работе.
FE-14 отложен: нужен Dockerfile бэка (зона бэкенда) и Docker-сокет хоста с одинаковым путём BLUEPRINTS_RUN_DIR — согласовать с бэкендом.
**Висящие ветки/worktree:** FE-15, FE-07, FE-12 (см. выше). Локальный main впереди origin: FE-02, фикстура file.order-service.json, FE-04 — нужен push.
**Заблокировано:** —
**Следующие шаги:** интеграция (FE-03 влит): MethodCanvas в проп `canvas` у App (FE-02), CodeEditor в `bottom.code` в panels.ts, мок GET files по умолчанию из contract/fixtures/file.order-service.json (добавлена по разрешению человека 2026-10-24). Дальше FE-05, FE-06, FE-07, FE-11, FE-14. Агенты из `.claude/agents` подхватываются, только если сессия открыта из Prodam_Blueprinti/ (иначе general-purpose + путь к промпту роли).
**Мелочи с ревью (на будущее):** mock PUT blocks по умолчанию нет; fixture<T>() — просто `as T`, нет сверки фикстур со схемой; store.version приходит только из GET tree, selectedMethodId не сверяется после перезагрузки; panels.ts findPanel — мёртвый код; фичи импортируют app/store (обратная зависимость); fileSync: после сетевой ошибки/5xx нет повтора PUT; FE-04: fileText из ответа PUT в редактор не подставляется (намеренно, курсор).

## Известные проблемы

- analysis/ExpensiveCallInLoop: `for (;;)` / `while (true)` с обходом коллекции и break внутри вызываемого считаются дешёвыми (редкий N+1 пропускается).
- samples/demo: `ReportService.java:80` — `String.format("%.2f")` без Locale, под ru_RU 4/6 IO-тестов demo падают (под en — 6/6).
- app: export jar → 501 (заглушка до BE-36, кода 501 нет в контракте).
- CLAUDE.md и .claude/ в .gitignore — правила и агенты не переносятся на другие устройства через git.
- JavaParser (3.26.2, и 3.28.2 тоже) не разбирает локальные enum/interface: такие файлы (samples/roundtrip/NestedClasses.java) грузятся текстом без блоков с предупреждением UNPARSED_FILE; в RoundTripCorpusTest их тела не перегенерируются из блоков.
- Windows: после пуля с .gitattributes уже склонированные копии нужно один раз перевыписать (`git ls-files -z | xargs -0 rm -f && git checkout -- .` при чистом дереве), иначе .out останутся с CRLF и IO-тесты упадут.
- Windows: 2 теста RunnerTest (fakeDocker) пропускаются — нужен /bin/bash.
- testing: TestResult/IoTestCase пока свои типы в `testing` — после BE-05 заменить на `model` адаптером.
- testing/JUnit: причина compile_error («тесты» vs «программа») определяется по простому имени файла — при совпадении имён может быть неверной.
- backend/fixes: StringBuilderFixTest.demoJoinAndFullReportCompileAndKeepOutput падает под ru_RU (на main, с BE-19) — та же причина, что ReportService.java:80 `String.format("%.2f")` без Locale. Под C/en зелёный. Нужна задача бэку.
- Фронт: Vitest 3.2.7 — npm audit: уязвимости в dev-зависимостях (tinypool, @vitest/mocker); vitest 4 не ставится на npm 10.9.8 (edgesOut).
- Фронт: у `passed` IO- и JUnit-теста (пропущенный @Disabled) `error` может быть непустым — это пояснение («оригинал не проходит этот тест — правка его исправила»), не ошибка.

- app/PUT files: не пересчитывает предупреждения загрузки, mainClasses, дубликаты FQN; UNPARSED_FILE через PUT files не правится (422); при переименовании метода сигнатурой поля method в ответе нет.
- app/ProjectView: Issue без methodId → blockId null (по контракту обязателен; сейчас детекторы methodId всегда ставят); DetectorRegistry.defaults() вызывается напрямую, а не бином.
- fixes/QualityGate: Refactoring получает саму карту currentFiles (не unmodifiable); StandardJavaFileManager не закрывается; без системного компилятора (JRE) — NPE.
- app: ProjectView строится заново на каждый запрос (без кэша); GET /tree без complexity/issueCount, параметр n у analysis игнорируется (n=10000, тест ContractConformanceTest ждёт 10000 при n=500) — BE-39.
- fixes/StringBuilderFix: `s += foo()` с foo(): char[] молча меняет вывод (только тест вывода поймает); комментарий внутри `s += /*c*/ x` теряется при замене; 
- app/verify: если все tests/*.json битые, проверка main пропускается (io=false).
- fixes/LinkedHashSetFix: только своя локальная из `new ArrayList/LinkedList` или без сторонних вызовов в цикле; элемент String/обёртка; неявный код в цикле (toString, iterator() пользовательского Iterable) не учитывается; тип аргумента по имени в методе. В demo до BE-41 неприменим.
- app/fix: без Docker / несколько main / нет main → 200 applied=false с reason (у fix в контракте нет 422/503); фикс, создающий новый файл, → 500; applied с пустым changed → 500; canApply считается на каждый снимок без кэша; Diff не видит разницу только в финальном 
. Фронт: schema.ts устарел после BE-38 — CI-шаг gen:api упадёт, напарнику перегенерировать.
- blocks/NodeValidator: исходный текст с \u разрешён в любом не-comment поле — можно перенести в ноду другого kind (крайний случай).

## Журнал (одна строка на закрытую задачу)

- BE-01: скелет бэкенда (9 модулей, build-logic, app+health, заглушки, CI). Нужен интернет при первой сборке (foojay скачает JDK 21).
- BE-02: демо-монолит samples/demo (16 классов ~1160 строк, 7 дефектов, 6 IO-тестов .in/.out, run-tests.sh).
- BE-08: Runner (javax.tools, docker run --network none, лимиты, таймаут 10 с, seed-переписывание регулярками). Env: BLUEPRINTS_RUN_DIR, BLUEPRINTS_RUN_IMAGE; путь рабочей папки одинаков на хосте и в сервере.
- CT-01: contract/openapi.yaml v1 (13 путей, methodId вида Class.method~N) + 11 фикстур.
- BE-03: корпус samples/roundtrip (20 файлов-конструкций, expected .out/.exit, run-tests.sh; вывод не зависит от локали).
- BE-04: загрузка (zip slip/bomb, обёртка root, source root по package, дубликаты FQN, tests/), дерево по пакетам, экспорт zip байт в байт, ProjectStore.update + 409, ContractConformanceTest.
- BE-09: IoTestSource (tests/*.json, импорт .in/.out, original/manual, ignoreLines, сравнение §10.3), Runner.runBatch — один контейнер на прогон (текущая + оригинал), RunResult.aborted.
- BE-11: JUnitTestSource (console launcher 1.11.3 из ресурсов, XML-отчёт, имя = FQN.метод, private→package-private в копии, compile_error), Runner: command-job, доп. read-only файлы, Config.commandTimeout 30 с; IO и JUnit в одном контейнере.
- BE-10: BehaviorVerifier (один runBatch: IO текущей + оригинал ×2 + JUnit; шумные строки → noisyLines; >50% шума, нестабильный выход оригинала, нет тестов → incomplete; stdin без входных тестов → blocked; warning о пропущенных). Приоритет blocked > red > incomplete > green.
- BE-05: model (record'ы по контракту, без зависимостей) + AstToBlocks (все kind, модификаторы префиксом в type, комментарии comment-блоками, тексты из TokenRange, arrow/pattern-switch).
- BE-11 (Windows): command-job через файл-скрипт /app/jobs/<k>.sh (read-only, аргументы в одинарных кавычках), .gitattributes с LF. Полная сборка main зелёная на Windows с Docker (2 пропуска fakeDocker).
- BE-12: analysis — ProjectAnalysis.of(files) → MethodAnalysis (complexity/confidence, size, loopSize, callCost), BigO (бейдж n,m,k по старшей степени), JdkCosts, CallGraph (Тарьян). Символы квалифицированы (FQN|поле, methodId|имя). Detector.detect(MethodAnalysis, ProjectAnalysis) абстрактный. Типы — текстом, без Symbol Solver; перегрузки одной арности не различаются; стримы только через forEach.
- BE-06: BlocksToJava (замена тела по смещениям, неизменённое байт в байт, комментарии в исходном виде, UnsafeCommentException для нового комментария с \u), RoundTripCorpusTest (roundtrip LF/CRLF + demo, javac + stdout/exit), JavacOutline в source: не разобранный JavaParser файл грузится текстом с UNPARSED_FILE (контракт). 4 круга ревью.
- BE-13: NestedLoopSameCollection (общий символ размера у вложенных циклов; fresh-символ или while/do → low; общий курсор while-while не сообщается). Issues.of — общий хелпер (id rule:methodId:строка:колонка, blockId=null, ops при n=10000). На demo — только OrderService.merge.
- BE-14: LinearSearchInLoop (contains/indexOf/lastIndexOf/remove(Object) у List в цикле; remove(int) и выражения-индексы не сообщаются; Collection/неизвестный тип → low; нераспознанное число итераций confidence не понижает — decisions.md). На demo 3 high: InventoryService.watched, distinctIds, Validator.checkLines.
- BE-15: ExpensiveCallInLoop (вызов с callCost ≥ O(n) в цикле; без дублей BE-14; данные элемента for-each без промежуточных циклов, длины строк/int-параметры и счётные циклы от них — дешёвые; нераспознанное → low). 4 круга ревью. Demo: 4 high (reserve/rollback findProduct, subtotal lineTotal, fullReport findCustomer), 8 low.
- BE-16: StringConcatInLoop (`s += x` / `s = s + x` для String в цикле, который строка переживает, включая init for; одна Issue на цикл; prepend не сообщается). Публичный concats(method) для BE-19. Demo: ReportService.fullReport, Texts.join — high.
- BE-17: LongMethod (> 50 строк объявления, low) и DeepNesting (> 4, тело метода — уровень 1, else-if не углубляет, лямбда прозрачна, тело анонимного/локального класса не считается; одна Issue на метод, span — самая глубокая конструкция). MethodAnalysis.lines()/maxNesting() для MethodMetrics. Demo: fullReport (56), hotProducts (7); merge 19/4 как в фикстуре.
- BE-07: NodeValidator (печать ноды + разбор в обёртке: синтаксис, // в выражении, вылезший текст, kind не на месте, лишние слоты, новый \u), PUT blocks / PUT files с analysis (metrics, blockId по строкам, issueCount/complexity в дереве), 409, ошибки нод → 422 PARSE_ERROR (по контракту), битый JSON/multipart → 400, дыра originals закрыта.
- BE-18: QualityGate (canApply/apply → javac программы без tests/ → проверка поведения через Function<TestContext,VerifyResult> = behaviorVerifier::verify; blocked/red/ошибка компиляции/исключение → отказ «исправление не подтверждено», вход не меняется; incomplete применяется с пометкой — нет тестов или шум). Result ложится на FixResult, version/diff добавит app.
- BE-37: GET blocks (ProjectView.method), GET files (FileText), GET analysis (ProjectView.analysis); 404 NOT_FOUND; ContractConformanceTest — SpringBootTest на демо по HTTP.
- BE-19: StringBuilderFix `string-builder` (переменные из StringConcatInLoop.concats; sSb до цикла, append, s = sSb.toString() после; только локальная не-null String, без меток и try между объявлением и циклом), RefactoringRegistry.defaults()/byId(); target = id Issue. Demo через QualityGate, вывод сверен локальной java (Docker-теста нет: fixes не зависит от runner).
- BE-38: TestsController (GET/PUT/DELETE tests, имя по шаблону, version обязателен, 409; одноимённые .json/.java видны оба), RunController (run/verify; 422 AMBIGUOUS_MAIN/INVALID_REQUEST — у verify только при IO-тестах; 503 SandboxUnavailable на ошибку Runner), ProjectStore.original — эталон для verify, .in/.out → mode manual. Контракт правлен по решению человека. Полный build с Docker зелёный (впервые выполнены Docker-тесты runner/testing/app; 2 пропуска fakeDocker).
- BE-20: LinkedHashSetFix `linked-hash-set` (находка LinearSearchInLoop; `Set<T> xsSet = xs == null ? null : new LinkedHashSet<>(xs)` перед ближайшим циклом, только contains; отказ при изменении/алиасах/views списка, сторонних вызовах для не-new, неподходящем типе аргумента). FixText — общие текстовые хелперы. 4 круга ревью.
- FE-01: скелет фронта (Vite+React 18+TS strict, ESLint, Vitest), gen:api (openapi-typescript, `--default-non-nullable false` — поля с default не required), клиент openapi-fetch /api, MSW из contract/fixtures при VITE_USE_MOCKS (иначе proxy /api → :8080), tokens.css Graphite, реестры panels.ts/commands.ts, job frontend в CI.
- BE-40: FixController (POST issues/{id}/fix: 409 до и после QualityGate атомарно, 404 на неизвестную проблему/fixId; applied → version+1, unified diff; rejected → версия не меняется), Issue.fixes = canApply по RefactoringRegistry (low → пусто). Docker-тест: applied Texts.join, rejected fullReport.
- FE-02: каркас редактора (шапка, дерево проекта из GET tree, слот холста, панели с вкладками из panels.ts {id,title,area,component}, zustand store projectId/version/selectedMethodId, react-resizable-panels).
- FE-04: CodeEditor (Monaco локально, ленивый чанк), fileSync: debounce 500 мс, полный текст + version, 409 → тост и перезагрузка, 422 → маркер, один запрос в полёте; мок PUT files по умолчанию.
- FE-03: MethodCanvas/MethodGraph (GET blocks), blocksToGraph — чистая функция дерево → ноды/рёбра, ELK layered в воркере (bundled-фолбэк), все kind + фолбэк неизвестного как raw, стрелки не редактируются, цвета из tokens.css. 2 круга ревью.
- FE-11: панель анализа (вкладки Проблемы/Предупреждения/Метрики в panels.ts, сортировка high→medium→low, confidence low = «возможно», оценка ≈ операций из opsBefore/opsAfter «при n = …» + «асимптотическая оценка», n → GET analysis?n, selectIssue в store). 2 круга ревью.
