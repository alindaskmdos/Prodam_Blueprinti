# model

Чистые record'ы по `contract/openapi.yaml`, без логики и без зависимостей (только JDK): `Block`
(fields/slots — упорядоченные `LinkedHashMap`, kind — строка), `Span`, `Issue` (+`Complexity`), `TestCase`,
`TestResult`, `ProjectSnapshot`. Необязательные поля — `null`; сериализовать с `NON_NULL`
(отсутствующий nullable `TestCase.expected` равен null). `Block.issues` по умолчанию `[]`, `collapsed` — `false`.

Зависит от: ничего. Spring здесь не используется.

Тесты: `./gradlew :model:test` — `ContractRoundTripTest`: фикстуры `contract/fixtures` читаются в record'ы
и пишутся обратно тем же JSON (Jackson только в test-scope).
