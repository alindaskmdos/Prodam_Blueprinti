# runner

Компиляция и запуск пользовательского кода (§11а ТЗ). Главный класс: `blueprints.runner.Runner`.

- `Runner.compile(srcDir, outDir)` — все `.java` одним вызовом `javax.tools`, возвращает список ошибок; pom/gradle игнорируются.
- `Runner.run(sources, mainClass, stdin, rewrite)` — `sources`: путь → текст. Пишет копию с переписыванием во временную папку,
  компилирует в процессе сервера, запускает в одноразовом контейнере (`--network none`, `--memory`, `--cpus`, read-only, cap-drop,
  таймаут 10 с, по таймауту `docker rm -f`). Возвращает `RunResult` (stdout, stderr, exitCode, timedOut, millis, ошибки компиляции).
- `mainClass == null`: берётся единственный `main`, при нескольких — `IllegalArgumentException` со списком (`findMainClasses`).
- `Rewrite.RUN`: `new Random()` → `new Random(42)`, `Math.random()` → `bp.rt.Seed.random()` (класс добавляется в копию);
  `packagePrivate=true` убирает `private` (для JUnit, BE-11). Исходники не меняются. Замена регулярками, не AST.

Компиляция идёт в процессе сервера, но с `-proc:none`: пользовательский код при компиляции не исполняется. Вывод усечён до 1 МБ на поток (`truncated`), `-Xmx` = 75% лимита памяти.

Настройка (`Config.defaults()`): env `BLUEPRINTS_RUN_DIR` (рабочая папка запусков) и `BLUEPRINTS_RUN_IMAGE` (по умолчанию `eclipse-temurin:21-jdk`).
**Путь `BLUEPRINTS_RUN_DIR` должен быть одинаковым на хосте Docker и в процессе сервера**: если сервер сам в контейнере
с `/var/run/docker.sock`, смонтируйте папку по тому же пути (`-v /srv/bp-run:/srv/bp-run`).

Зависит от: model, source. Тесты: `./gradlew :runner:test` (тесты с Docker пропускаются, если `docker info` не проходит).
