# app

Spring Boot: REST по `contract/openapi.yaml`, хранение проектов в памяти, версия проекта (409 при старой), сборка реестров модулей в бины.
Единственный модуль, который знает про Spring. Зависит от всех остальных модулей.

Главный класс: `blueprints.app.Application`. Сейчас есть `GET /api/health` -> `{"status":"ok"}`.

Запуск: `./gradlew :app:bootRun`. Тесты (RANDOM_PORT): `./gradlew :app:test`.
