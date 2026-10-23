# runner

Компиляция и запуск пользовательского кода (§11а ТЗ). Главный класс: `blueprints.runner.Runner`.

- `Runner.compile(srcDir, outDir)` — все `.java` одним вызовом `javax.tools`, возвращает список ошибок; pom/gradle игнорируются.
- `Runner.run(sources, mainClass, stdin, rewrite)` — `sources`: путь → текст. Пишет копию с переписыванием во временную папку,
  компилирует в процессе сервера, запускает в одноразовом контейнере (`--network none`, `--memory`, `--cpus`, read-only, cap-drop,
  таймаут 10 с, по таймауту `docker rm -f`). Возвращает `RunResult` (stdout, stderr, exitCode, timedOut, millis, ошибки компиляции).
- `Runner.runBatch(programs, jobs, rewrite)` — пакетный запуск: несколько программ (`Program(sources, mainClass)`, например
  текущая версия и оригинал) компилируются по отдельности и монтируются в `/app/p<i>` **одного** контейнера
  (`docker run -d ... sleep`, те же ограничения); `jobs` (`Job(program, stdin)`) выполняются по порядку `docker exec` с
  таймаутом `config.timeout()` на запуск и общим таймаутом контейнера; `/tmp` чистится между запусками; в конце — `docker rm -f`.
  Команда запуска `k` пишется до старта файлом `/app/jobs/<k>.sh` (read-only, каждый аргумент в `'...'`, `jobScript`) и
  выполняется `docker exec ... sh /app/jobs/<k>.sh`: в argv docker нет кавычек и пробелов — на Windows ProcessBuilder
  склеивает argv в строку, и `sh -c "..."` ломался.
  Если `docker exec` завис — контейнер убивается, этот и остальные запуски получают `aborted=true` (не `timedOut`).
  Если контейнер не стартовал за 120 с — `IllegalStateException`, `docker rm -f` сразу и повторно в фоне.
  `runAll(sources, mainClass, stdins, rewrite)` — то же для одной программы. Ошибка компиляции — `compiled=false` у её запусков.
- Добавления BE-11: `runBatch(programs, jobs, rewrite, files)` — `files` (путь в контейнере → файл сервера) копируются в
  рабочую папку и монтируются read-only (не под `/app`); `Job(program, stdin, command)` — вместо `java ... main` выполняется
  argv `command` (классы — в `programDir(i)` = `/app/p<i>`, свой таймаут `Config.commandTimeout()` = 30 с — у java-запусков
  остаётся `timeout()` = 10 с, общий таймаут контейнера — сумма по запускам; `JDK_JAVA_OPTIONS=-Xmx...`), main у программы
  только с command-запусками не ищется; `Program(sources, main, rewrite, classpath)` — свой rewrite и classpath компиляции.
- `mainClass == null`: берётся единственный `main`, при нескольких — `IllegalArgumentException` со списком (`findMainClasses`).
- `Rewrite.RUN`: `new Random()` → `new Random(42)`, `Math.random()` → `bp.rt.Seed.random()` (класс добавляется в копию);
  `Rewrite.JUNIT` = seed + `packagePrivate` (убирает `private`, для JUnit). Исходники не меняются. Замена регулярками, не AST.

Компиляция идёт в процессе сервера, но с `-proc:none`: пользовательский код при компиляции не исполняется. Вывод усечён до 1 МБ на поток (`truncated`), `-Xmx` = 75% лимита памяти.

Настройка (`Config.defaults()`): env `BLUEPRINTS_RUN_DIR` (рабочая папка запусков) и `BLUEPRINTS_RUN_IMAGE` (по умолчанию `eclipse-temurin:21-jdk`).
**Путь `BLUEPRINTS_RUN_DIR` должен быть одинаковым на хосте Docker и в процессе сервера**: если сервер сам в контейнере
с `/var/run/docker.sock`, смонтируйте папку по тому же пути (`-v /srv/bp-run:/srv/bp-run`).

Зависит от: model, source. Тесты: `./gradlew :runner:test` (тесты с Docker пропускаются, если `docker info` не проходит).
