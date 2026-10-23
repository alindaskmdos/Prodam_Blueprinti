# app

Spring Boot: REST по `contract/openapi.yaml`, хранение проектов в памяти, версия проекта (409 при старой), сборка реестров модулей в бины.
Единственный модуль, который знает про Spring. Зависит от всех остальных модулей.

Главный класс: `blueprints.app.Application`. Эндпоинты (`/api`): `GET /health`, `POST /projects` (multipart `files[]` + `paths[]`), `GET /projects/{id}`, `GET /projects/{id}/tree`, `GET /projects/{id}/export?format=zip&includeSettings=`,
`PUT /projects/{id}/methods/{methodId}/blocks` (`{version, root}`), `PUT /projects/{id}/files?path=` (`{version, text}`) -> MutationResult.

- `EditController` — правки через `ProjectStore.update`: PUT blocks = `NodeValidator` -> `BlocksToJava.replaceMethod` -> повторный разбор;
  неверная нода -> 422 PARSE_ERROR с blockId, версия не растёт; PUT files — разбор JavaParser, ошибка -> 422 PARSE_ERROR с line.
  Пакет файла пересчитывается; предупреждения загрузки, mainClasses и дубликаты FQN — нет. Файл, загруженный как UNPARSED_FILE, через PUT files не правится (422).
  `method` в ответе нет, если сигнатура переименовала метод (под старым id другой метод).
- `ProjectView` — снимок для ответов: Analysis (`ProjectAnalysis` + `DetectorRegistry.defaults()`, n = 10 000; blockId проблемы —
  самый глубокий блок метода, чей span содержит span проблемы; metrics complexity/lines/maxNesting), ProjectTree с complexity и issueCount, MethodView с id проблем в блоках. Экспорт zip возвращает исходную структуру вместе с отрезанной обёрткой (`LoadedProject.root`).

- `format=jar` пока заглушка: 501 INTERNAL, реализуется в BE-36.

- `ProjectStore` — `ConcurrentHashMap`; любая мутация через `update(id, clientVersion, fn)`: старая версия -> `ApiException` 409 `VERSION_CONFLICT` (details clientVersion/serverVersion), иначе version+1. Использовать в BE-07 и далее.
- `ApiException` + `ApiErrorHandler` — любая ошибка отдаётся телом `Error` контракта: `LoadException` из `source` -> 413/422/400 (DUPLICATE_FQN с `files`), `InvalidNodeException` из `blocks` -> 422 PARSE_ERROR (blockId), неверные параметры, битый JSON и битый multipart -> 400 INVALID_REQUEST, прочее -> 500 INTERNAL.
- `ProjectDto` — DTO руками по контракту; `TestImporter` — `Project.tests` из `tests/*.json`, пар `*.in`/`*.out` (mode original, expected null) и `tests/*.java` (junit).
- В BE-09/BE-11 разбор тестов переедет из `TestImporter` в `TestSource` модуля `testing`.

Запуск: `./gradlew :app:bootRun`. Тесты (RANDOM_PORT): `./gradlew :app:test`; `ContractConformanceTest`, `ProjectsApiTest` и `EditApiTest` валидируют ответы JSON Schema из `contract/openapi.yaml`.
