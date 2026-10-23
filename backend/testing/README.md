# testing

Источники тестов и проверка поведения (§10 ТЗ): IO-тесты, JUnit, BehaviorVerifier.

Точка расширения: `TestSource` (сейчас только `id()`). Реализации — BE-09 (IoTestSource), BE-11 (JUnitTestSource).

Зависит от: model, runner.

Тесты: `./gradlew :testing:test`.
