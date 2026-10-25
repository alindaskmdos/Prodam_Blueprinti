# app

Spring Boot: REST по `contract/openapi.yaml`, хранение проектов в памяти, версия проекта (409 при старой), сборка реестров модулей в бины.
Единственный модуль, который знает про Spring. Зависит от всех остальных модулей.

Главный класс: `blueprints.app.Application`. Эндпоинты (`/api`): `GET /health` (`{status: UP, docker, llm}`: docker — `docker version` за 2 с, кэш 5 с; llm — непустой `LLM_API_KEY`; LLM-настройки `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` читает `LlmConfig.fromEnv()`, пустое = дефолт провайдера), `POST /projects` (multipart `files[]` + `paths[]`), `GET /projects/{id}`, `GET /projects/{id}/tree`, `GET /projects/{id}/export?format=zip&includeSettings=` / `?format=jar&mainClass=`,
`PUT /projects/{id}/methods/{methodId}/blocks` (`{version, root}`), `PUT /projects/{id}/files?path=` (`{version, text}`) -> MutationResult,
`GET /projects/{id}/methods/{methodId}/blocks` -> MethodView, `GET /projects/{id}/files?path=` -> FileText, `GET /projects/{id}/analysis` -> Analysis,
`GET /projects/{id}/uml` -> UmlDiagram (`DiagramController`, `ProjectAnalysis.uml()` по текущей версии),
`GET /projects/{id}/dependencies` -> DependencyGraph (kind узлов всегда; cycles[].issueId = Issue CyclicDependency в analysis).
`GET/PUT/DELETE /projects/{id}/pmd-config` (`PmdConfigController`, §14а.2): GET -> PmdConfig (`isDefault` — нет своего конфига, отдан
`PmdDetector.DEFAULT_RULESET`); PUT `{version, xml}` -> PmdConfigMutationResult (version+1, analysis с новым конфигом), невалидный ruleset
(`PmdDetector.validate`) -> 422 INVALID_RULESET с line, конфиг и версия прежние; DELETE `?version=` — сброс к стандартному. Старая версия -> 409.
Конфиг хранится в `ProjectStore.Stored.pmdRuleset` (null — стандартный), все `ProjectView` строятся из `Stored` с ним. Экспорт zip с
includeSettings дописывает `<root>.blueprints/pmd-ruleset.xml`; при загрузке тот же файл (отдельно или в zip) становится конфигом,
невалидный — предупреждение IGNORED_FILE и стандартный набор.
Находки уровня проекта (methodId null) в ProjectView идут без blockId и фиксов и не входят в issueCount методов.

- GET blocks / analysis — те же представления `ProjectView`, что в MutationResult (снимок строится на каждый запрос, без кэша);
  неизвестный проект/метод/файл -> 404 NOT_FOUND. `GET analysis?n=` (по умолчанию 10 000) — ops проблем при этом n, оно же в поле `n`; n < 1 -> 400 INVALID_REQUEST.
  `GET tree` — `ProjectView.tree` (complexity и issueCount методов) через `ProjectDto.ClassDto`/`MethodDto` (ключи extends/implements/throws).

- `EditController` — правки через `ProjectStore.update`: PUT blocks = `NodeValidator` -> `BlocksToJava.replaceMethod` -> повторный разбор;
  неверная нода -> 422 PARSE_ERROR с blockId, версия не растёт; PUT files — разбор JavaParser, ошибка -> 422 PARSE_ERROR с line.
  Новое состояние — повторная загрузка `ProjectLoader` (PUT blocks и files): пакет, предупреждения, mainClasses; дубликат FQN -> 422 DUPLICATE_FQN с `files`, лимит 20 МБ / 2000 файлов -> 422 LIMIT_EXCEEDED (413 — только у загрузки); версия не растёт. Файл, загруженный как UNPARSED_FILE, через PUT files не правится (422).
  `method` в ответе нет, если сигнатура переименовала метод (под старым id другой метод).
- `ProjectView` — снимок для ответов: Analysis (`ProjectAnalysis` + `DetectorRegistry.defaults(pmdRuleset)` — встроенные детекторы и PMD с конфигом проекта или
  стандартным набором; `new ProjectView(stored[, n])` берёт контент и `Stored.pmdRuleset`, `new ProjectView(loadedProject)` — стандартный набор PMD; n по умолчанию 10 000, в MutationResult — всегда оно; blockId проблемы —
  самый глубокий блок метода, чей span содержит span проблемы; metrics complexity/lines/maxNesting), ProjectTree с complexity и issueCount, MethodView с id проблем в блоках. Экспорт zip возвращает исходную структуру вместе с отрезанной обёрткой (`LoadedProject.root`).

- `TestsController` — `GET /projects/{id}/tests`, `GET/PUT/DELETE /tests/{name}`: источник правды — файлы `tests/` проекта
  (io — разбор `IoTestFiles`, пара .in/.out = manual, как её гоняет verify; junit — `tests/<имя>.java`). PUT io пишет
  `tests/<имя>.json` (`IoTestFiles.toJson`), junit — `.java` (JavaParser, ошибка -> 422 PARSE_ERROR с line); файлы того же
  имени с другими расширениями удаляются. Имя `[A-Za-z0-9_][A-Za-z0-9._-]*` без `..` (GET/PUT/DELETE), неверный тест / name не равен пути -> 422 INVALID_REQUEST.
  `X.json` и `X.java` сразу (только из загрузки): в списке оба, GET X -> 422, PUT X оставляет один вид, DELETE X удаляет оба. PUT/DELETE -> version+1;
  `version` обязателен (в теле PUT, `?version=` у DELETE): нет — 400 INVALID_REQUEST, старый — 409, как в PUT blocks/files.
- `RunController` — `POST /run` (`Runner.run`, `Rewrite.RUN` — тот же seed, что у verify; несколько main без mainClass ->
  422 AMBIGUOUS_MAIN с details.mainClasses, несуществующий mainClass -> 422 INVALID_REQUEST; compileErrors — путь файла из проекта по имени), `POST /verify`
  (`BehaviorVerifier` на `ProjectStore.Stored.original` — проект как загружен — и текущей версии; адаптер `testing.TestResult` -> DTO;
  битые `tests/*.json` (`IoTestFiles.load().errors`) -> warning «тест не прогнан: …» на каждый, green -> incomplete).
  У verify до запуска, только если есть IO-тесты (mainClass нужен лишь им): несколько main в текущей версии или оригинале -> 422 AMBIGUOUS_MAIN, main нет -> 422 INVALID_REQUEST. Сбой запуска вне кода пользователя (IllegalStateException/UncheckedIOException Runner'а: нет Docker, JDK, ошибка временной папки) -> 503 INTERNAL с сообщением Runner (responses/SandboxUnavailable; UI отключает кнопки по /health). Без тестов verify
  контейнер не запускает.
- `FixController` — `POST /projects/{id}/issues/{issueId}/fix` (`{version, fixId}`) -> FixResult: версия не та -> 409 (id проблемы — только для своей версии),
  нет проблемы / фикс не из `Issue.fixes` -> 404; `QualityGate` (оригинал — `Stored.original`, mainClass null, проверки main — `RunController.checkMains`).
  applied -> изменённые файлы (исходники и `tests/`) в проект, version+1, `diff` — unified diff (`Diff`, 3 строки контекста) по `changed`,
  `mutation` (fileText — первый изменённый файл); rejected -> версия та же, `reason`. В контракте у fix нет 422/503: несколько main,
  нет main для IO-тестов и недоступная песочница -> 200 `applied=false`, reason «исправление не подтверждено: <сообщение>».
- `AiController` (модуль `ai`, §14а.10): `GET /capabilities` -> Capabilities (llm, features `explain|fix|edit-node` или пусто без ключа,
  limits из `RateLimiter`); `POST /methods/{methodId}/explain` `{version}` -> AiExplanation; `POST /methods/{methodId}/ai-edit`
  `{version, blockId, instruction}` -> AiEditProposal (новый текст файла + `Diff.unified`, проект не меняется; blockId = id метода —
  правка всего метода; ответ модели не Java -> 422 PARSE_ERROR); `POST /issues/{issueId}/ai-fix` `{version}` -> FixResult через
  `FixController.gate` (тот же Quality Gate, что у fix). Порядок: нет ИИ -> 503 LLM_UNAVAILABLE; version/проект/метод/нода/проблема ->
  400/409/404; лимит -> 429 RATE_LIMITED с details.retryAfterSec; провайдер не ответил -> 503 LLM_UNAVAILABLE. Бины `Ai` и `RateLimiter`
  — `AiController.Beans` из env (`LlmConfig`, `LLM_RATE_PER_MINUTE`/`LLM_RATE_PER_DAY`); `AiApiTest` подменяет их фейком (@Primary).
- `Issue.fixes` (в `ProjectView`, т.е. во всех Analysis/MutationResult) — id фиксов `RefactoringRegistry.defaults()` с `canApply(файлы, issue.id)`; при confidence=low пусто.
- Экспорт `format=jar` — `Runner.jar` на исходниках без `tests/` и `.blueprints/`, без seed; main — `RunController.chooseMain` (как у run:
  несколько без mainClass -> 422 AMBIGUOUS_MAIN, не найден / нет main -> 422 INVALID_REQUEST); не компилируется -> 422 COMPILE_ERROR,
  в message — ошибки `путь:строка: текст` через перевод строки. Имя файла `<id>.jar`, как у zip.

- `ProjectStore` — `ConcurrentHashMap`; любая мутация через `update(id, clientVersion, fn)`: старая версия -> `ApiException` 409 `VERSION_CONFLICT` (details clientVersion/serverVersion), иначе version+1. Использовать в BE-07 и далее.
- `ApiException` + `ApiErrorHandler` — любая ошибка отдаётся телом `Error` контракта: `LoadException` из `source` -> 413/422/400 (DUPLICATE_FQN с `files`), `InvalidNodeException` из `blocks` -> 422 PARSE_ERROR (blockId), неверные параметры, битый JSON и битый multipart -> 400 INVALID_REQUEST, прочее -> 500 INTERNAL.
- `ProjectDto` — DTO руками по контракту; `TestImporter` — `Project.tests` из `tests/*.json`, пар `*.in`/`*.out` (mode manual, expected = .out, как в IoTestFiles) и `tests/*.java` (junit).
- В BE-09/BE-11 разбор тестов переедет из `TestImporter` в `TestSource` модуля `testing`.

Запуск: `./gradlew :app:bootRun`. Тесты (RANDOM_PORT): `./gradlew :app:test`; `ContractConformanceTest` (в т.ч. GET blocks/files/analysis, run/verify/tests), `ProjectsApiTest`, `EditApiTest` и `TestsApiTest` (Docker-часть пропускается без `docker info`) валидируют ответы JSON Schema из `contract/openapi.yaml`.

## Docker-образ (`backend/Dockerfile`, деплой Coolify)

Контекст сборки — `backend/` (`samples/` и `contract/` нужны только тестам, в образ не идут): `docker build -t blueprints-backend backend`.
Стадия Gradle (`:app:bootJar`, без тестов) → рантайм `eclipse-temurin:21-jdk` (JDK, не JRE: компиляция в процессе через `javax.tools`; тот же образ, что песочница, — слои общие) + docker CLI (`docker:27-cli`) + curl.
Env по умолчанию: `BLUEPRINTS_RUN_DIR=/var/lib/blueprints-run`, `BLUEPRINTS_RUN_IMAGE=eclipse-temurin:21-jdk`, `JAVA_OPTS=-XX:MaxRAMPercentage=75` (переопределяется целиком). `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` не заданы.
При старте: создаётся `$BLUEPRINTS_RUN_DIR`; если образа песочницы нет у демона — `docker pull` в фоне, ошибка только в лог. Порт 8080, HEALTHCHECK — `curl /api/health`. Процесс под root (доступ к docker.sock).

    docker run -d -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock \
      -v /var/lib/blueprints-run:/var/lib/blueprints-run blueprints-backend

Папка запуска монтируется по **одному и тому же пути** (Runner передаёт демону свои пути). На Docker Desktop (Windows) так же: `/var/lib/blueprints-run` — путь внутри VM демона, из Git Bash запускать с `MSYS_NO_PATHCONV=1`.
