# app

Spring Boot: REST по `contract/openapi.yaml`, хранение проектов в памяти, версия проекта (409 при старой), сборка реестров модулей в бины.
Единственный модуль, который знает про Spring. Зависит от всех остальных модулей.

Главный класс: `blueprints.app.Application`. Эндпоинты (`/api`): `GET /health`, `POST /projects` (multipart `files[]` + `paths[]`), `GET /projects/{id}`, `GET /projects/{id}/tree`, `GET /projects/{id}/export?format=zip&includeSettings=`. Экспорт zip возвращает исходную структуру вместе с отрезанной обёрткой (`LoadedProject.root`).

- `format=jar` пока заглушка: 501 INTERNAL, реализуется в BE-36.

- `ProjectStore` — `ConcurrentHashMap`; любая мутация через `update(id, clientVersion, fn)`: старая версия -> `ApiException` 409 `VERSION_CONFLICT` (details clientVersion/serverVersion), иначе version+1. Использовать в BE-07 и далее.
- `ApiException` + `ApiErrorHandler` — любая ошибка отдаётся телом `Error` контракта: `LoadException` из `source` -> 413/422/400 (DUPLICATE_FQN с `files`), неверные параметры -> 400 INVALID_REQUEST, прочее -> 500 INTERNAL.
- `ProjectDto` — DTO руками по контракту; `TestImporter` — `Project.tests` из `tests/*.json`, пар `*.in`/`*.out` (mode original, expected null) и `tests/*.java` (junit).
- В BE-09/BE-11 разбор тестов переедет из `TestImporter` в `TestSource` модуля `testing`.

Запуск: `./gradlew :app:bootRun`. Тесты (RANDOM_PORT): `./gradlew :app:test`; `ContractConformanceTest` и `ProjectsApiTest` валидируют ответы JSON Schema из `contract/openapi.yaml`.
