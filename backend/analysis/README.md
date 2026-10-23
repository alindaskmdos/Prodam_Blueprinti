# analysis

Big O, символы размера, граф вызовов, детекторы дефектов (§8 ТЗ).

Точка расширения: `Detector` (сейчас только `id()`), реестр — `DetectorRegistry`.
Новое правило = новый класс `Detector` + регистрация в `DetectorRegistry.defaults()`, плюс тест на позитивный и негативный пример.

Зависит от: model, source.

Тесты: `./gradlew :analysis:test`.
