# Статус

> Пишет только оркестратор. Это «сохранение игры»: после /clear новая сессия начинает отсюда.
> Обновлять полностью после каждых ~5 закрытых задач или крупного этапа.

Обновлено: 2026-10-24

## Backend

**Готово:** BE-01, BE-02, BE-03, BE-04, BE-05, BE-08, BE-09, BE-10, BE-11, BE-12, BE-13; CT-01 (+ arrow-switch в Block, `<init>~N`)
**В работе:** BE-06 (Станислав).
**Висящие ветки/worktree:** —. Папки старых worktree в .claude/worktrees не удаляются из-за длинных путей Windows, стирать вручную. На origin висит устаревшая ветка be-5 (остатки отменённого merge BE-09) — удалить: `git push origin --delete be-5`.
**Заблокировано:** —
**Следующие шаги:** BE-06 (BlocksToJava + RoundTripCorpusTest, Станислав; первым шагом — локальные enum/interface, см. decisions.md; учесть: текст полей блоков сохраняет `\r\n` у CRLF-файлов, комментарий внутри типа уходит блоком перед оператором/в слот catches) ; BE-14..BE-17 (детекторы, после BE-12 ✓; blockId подставляет app по диапазону строк — decisions.md); BE-18 Quality Gate — после BE-10 ✓ и BE-11 ✓, доступна (текст «нет тестов» — по decisions.md); BE-07 — после BE-06 и BE-04. В бриф BE-07 передать: ApiErrorHandler — добавить HttpMessageNotReadableException и MultipartException в bad() (сейчас 500 вместо 400).

## Frontend

**Готово:** —
**В работе:** —
**Висящие ветки/worktree:** —
**Заблокировано:** —
**Следующие шаги:** FE-01 (контракт готов).

## Известные проблемы

- samples/demo: `ReportService.java:80` — `String.format("%.2f")` без Locale, под ru_RU 4/6 IO-тестов demo падают (под en — 6/6).
- app: битый JSON / битый multipart → 500 INTERNAL вместо 400 (чинится в BE-07).
- app: export jar → 501 (заглушка до BE-36, кода 501 нет в контракте).
- CLAUDE.md и .claude/ в .gitignore — правила и агенты не переносятся на другие устройства через git.
- JavaParser 3.26.2 не разбирает локальные enum/interface (samples/roundtrip/NestedClasses.java) — решается в BE-06.
- Windows: после пуля с .gitattributes уже склонированные копии нужно один раз перевыписать (`git ls-files -z | xargs -0 rm -f && git checkout -- .` при чистом дереве), иначе .out останутся с CRLF и IO-тесты упадут.
- Windows: 2 теста RunnerTest (fakeDocker) пропускаются — нужен /bin/bash.
- testing: TestResult/IoTestCase пока свои типы в `testing` — после BE-05 заменить на `model` адаптером.
- testing/JUnit: причина compile_error («тесты» vs «программа») определяется по простому имени файла — при совпадении имён может быть неверной.
- Фронт: у `passed` IO- и JUnit-теста (пропущенный @Disabled) `error` может быть непустым — это пояснение («оригинал не проходит этот тест — правка его исправила»), не ошибка.

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
- BE-13: NestedLoopSameCollection (общий символ размера у вложенных циклов; fresh-символ или while/do → low; общий курсор while-while не сообщается). Issues.of — общий хелпер (id rule:methodId:строка:колонка, blockId=null, ops при n=10000). На demo — только OrderService.merge.
