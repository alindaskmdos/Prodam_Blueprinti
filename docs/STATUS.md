# Статус

> Пишет только оркестратор. Это «сохранение игры»: после /clear новая сессия начинает отсюда.
> Обновлять полностью после каждых ~5 закрытых задач или крупного этапа.

Обновлено: 2026-10-24

## Backend

**Готово:** BE-01, BE-02, BE-03, BE-04, BE-05, BE-06, BE-08, BE-09, BE-10, BE-11, BE-12, BE-13, BE-14, BE-15, BE-16, BE-17, BE-07, BE-18, BE-37, BE-19, BE-38; CT-01 (+ arrow-switch в Block, `<init>~N`)
**В работе:** BE-20 (fixes, ждёт решения после 3 красных ревью)
**Висящие ветки/worktree:** —. Локальный main впереди origin (BE-12..BE-19, BE-37, BE-38, BE-07 + merge BE-06) — нужен push. Папки старых worktree в .claude/worktrees не удаляются из-за длинных путей Windows, стирать вручную. На origin висит устаревшая ветка be-5 (остатки отменённого merge BE-09) — удалить: `git push origin --delete be-5`.
**Заблокировано:** —
**Следующие шаги:** детекторы MVP закрыты (в брифах: не вливать main в ветку, не трогать docs/; Node.equals у JavaParser по содержимому — ключевать узлы по идентичности); app должен отдавать Analysis.metrics из MethodAnalysis.lines()/maxNesting(); BE-19/20/21 (фиксы, нужен BE-18; BE-19 берёт переменные через публичный StringConcatInLoop.concats); app ещё не отдаёт анализ (подстановка blockId по диапазону строк — decisions.md); BE-18 Quality Gate — после BE-10 ✓ и BE-11 ✓, доступна (текст «нет тестов» — по decisions.md); BE-18 Quality Gate — доступна. Фронту: перегенерировать TS-типы (UNPARSED_FILE в LoadWarning.code; BE-38 — version у PUT/DELETE tests, 422/503 у run/verify).

## Frontend

**Готово:** —
**В работе:** —
**Висящие ветки/worktree:** —
**Заблокировано:** —
**Следующие шаги:** FE-01 (контракт готов).

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
- Фронт: у `passed` IO- и JUnit-теста (пропущенный @Disabled) `error` может быть непустым — это пояснение («оригинал не проходит этот тест — правка его исправила»), не ошибка.

- app/PUT files: не пересчитывает предупреждения загрузки, mainClasses, дубликаты FQN; UNPARSED_FILE через PUT files не правится (422); при переименовании метода сигнатурой поля method в ответе нет.
- app/ProjectView: Issue без methodId → blockId null (по контракту обязателен; сейчас детекторы methodId всегда ставят); DetectorRegistry.defaults() вызывается напрямую, а не бином.
- fixes/QualityGate: Refactoring получает саму карту currentFiles (не unmodifiable); StandardJavaFileManager не закрывается; без системного компилятора (JRE) — NPE.
- app: ProjectView строится заново на каждый запрос (без кэша); GET /tree без complexity/issueCount, параметр n у analysis игнорируется (n=10000, тест ContractConformanceTest ждёт 10000 при n=500) — BE-39.
- fixes/StringBuilderFix: `s += foo()` с foo(): char[] молча меняет вывод (только тест вывода поймает); комментарий внутри `s += /*c*/ x` теряется при замене; Issue.fixes пока пуст — BE-40.
- contract/openapi.yaml:137 — description с запятой без кавычек в flow-маппинге (лишний ключ в schema version у PUT blocks); ждёт решения человека.
- app/verify: если все tests/*.json битые, проверка main пропускается (io=false).
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
