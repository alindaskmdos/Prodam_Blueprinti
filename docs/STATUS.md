# Статус

> Пишет только оркестратор. Это «сохранение игры»: после /clear новая сессия начинает отсюда.
> Обновлять полностью после каждых ~5 закрытых задач или крупного этапа.

Обновлено: 2026-10-23

## Backend

**Готово:** BE-01, BE-02, BE-03, BE-04, BE-08, BE-09, BE-11; CT-01 (+ arrow-switch в Block)
**В работе:** BE-05 (напарник) — правки по ревью (final-модификаторы в fields.type, комментарии перед case/catch, сигнатура метода, тест контракта, arrow-switch по новому контракту).
**Висящие ветки/worktree:** be-05 (напарник). Папки старых worktree в .claude/worktrees не удаляются из-за длинных путей Windows, стирать вручную.
**Заблокировано:** —
**Следующие шаги:** влить BE-05 → BE-06 (BlocksToJava + RoundTripCorpusTest, Станислав) и BE-12 (анализ); BE-10 — доступна (в BE-10: warning «N тестов пропущено» по decisions.md); BE-07 — после BE-06 и BE-04. В бриф BE-07 передать: ApiErrorHandler — добавить HttpMessageNotReadableException и MultipartException в bad() (сейчас 500 вместо 400).

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
