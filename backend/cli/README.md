# cli

CLI для CI (§14а.11), picocli, без Spring. Главный класс: `blueprints.cli.Cli` (`Cli.commandLine()` — команда с кодами выхода).
Сборка: `./gradlew :cli:installDist` → `cli/build/install/blueprints/bin/blueprints[.bat]`. Запускать на JDK 21.

- `analyze <проект> [--fail-on "O(n^2)"] [--format json|text]` — проблемы `DetectorRegistry` и сложность методов. `<проект>` —
  папка (только `.java` и `tests/`, без скрытых папок) или `.zip/.jar`, загрузка — `ProjectLoader`. json — `Analysis` контракта
  без `version`; у Issue нет `blockId`, `fixes` пусты. Нарушения и предупреждения — в stderr.
- `--fail-on` — `O(n²)`, `O(n^2)`, `O(n log n)`, `O(n*m)` (одно слагаемое; `Rank`): срабатывает, если старшее слагаемое
  хоть одного метода (все символы = n, `O(n·m)` ~ `O(n²)`) **не меньше** заданного.
- `verify <проект> [--format json|text]` — `BehaviorVerifier` (IO + JUnit) в Docker; оригинал = текущая версия
  (manual-тесты сверяются с `.out`). json — `VerifyResult` контракта.

Коды выхода: `0` — ок (verify: `green`/`incomplete`); `1` — нарушение (`--fail-on`; verify: `red`/`blocked`);
`2` — неверные аргументы (picocli); `3` — проект не загружен или ошибка ввода-вывода (нет пути, нет .java, синтаксис,
несколько main); `4` — песочница недоступна (`docker info` не прошёл, контейнер не стартовал); `5` — внутренняя ошибка.

Зависит от: model, source, analysis, testing, runner.
Тесты: `./gradlew :cli:test` (на `samples/demo`; `VerifyDockerTest` пропускается без Docker).
