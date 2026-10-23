# fixes

Quick-fix'ы и Quality Gate (§9 ТЗ).

Точки расширения: `Refactoring` (`canApply` / `apply`; пока над `Map<путь, исходник>`, перейдёт на ProjectSnapshot)
и `FixProvider` (сейчас только `id()`). Новый фикс = новый класс + регистрация. Только `LinkedHashMap`/`LinkedHashSet`.
Любой `Refactoring` обновляет ссылки во всех файлах проекта, включая `tests/*.java`.

Зависит от: model, source, analysis, testing.

Тесты: `./gradlew :fixes:test`.
