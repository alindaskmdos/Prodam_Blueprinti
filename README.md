# Java Blueprints (Prodam_Blueprinti)

Веб-инструмент для Java-проектов: загружает `.java` / `.zip` / `.jar` с исходниками или папку, показывает метод как
граф нод (в стиле Unreal Blueprints) и как код с синхронизацией в обе стороны, оценивает сложность методов (Big O),
находит дефекты производительности и качества, применяет безопасные автоисправления с проверкой тестами
(Quality Gate), запускает программу в песочнице и доказывает, что поведение после правок не изменилось. Для разработчиков,
которые разбирают и оптимизируют чужой монолит (~1000 строк). Бэкенд — Java 21 + Spring Boot, фронтенд — React + TypeScript.

## Быстрый старт

```bash
git clone https://github.com/alindaskmdos/Prodam_Blueprinti.git && cd Prodam_Blueprinti
```

Нужен Docker с доступом к `/var/run/docker.sock`: бэкенд запускает пользовательский код в соседних контейнерах.
Без сокета всё, кроме запуска / «Проверить поведение» / Quality Gate, работает, а `/api/health` вернёт `docker: false`
(UI сам отключит эти кнопки).

Файла `.env` и `example.env` нет — все переменные необязательны (см. «Конфигурацию»). Единственная, которую имеет
смысл задать, — ключ LLM; без него всё работает:

```
LLM_API_KEY=
```

`docker-compose.yml` не публикует порты наружу (он рассчитан на Coolify). Чтобы открыть приложение локально,
создай рядом локальный `docker-compose.override.yml` (compose подхватывает его сам, коммитить не нужно):

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  frontend:
    ports: ["8000:80"]
EOF
docker compose up --build
```

Поднимаются два сервиса: `backend` (Spring Boot + docker CLI, :8080 внутри сети) и `frontend` (nginx со статикой
и проксированием `/api` → `backend:8080`, :80 внутри контейнера). Базы данных, очереди и хранилища нет: проекты живут в
памяти бэкенда, миграций тоже нет. Образ песочницы (`eclipse-temurin:21-jdk`) бэкенд подтягивает в фоне при старте;
`frontend` стартует, когда `backend` стал healthy.

Приложение будет на http://localhost:8000 (порт 80 внутри контейнера), API — на http://localhost:8000/api.
Swagger UI нет: описание API — [contract/openapi.yaml](contract/openapi.yaml).

## Пример

Тот же путь, что проходит UI, но через API на демо-монолите `samples/demo` (7 заложенных дефектов, 6 IO-тестов):
загрузка → анализ → фикс через Quality Gate → проверка поведения → сборка jar. Команды из Git Bash / Linux / macOS, от корня репо.

```bash
API=http://localhost:8000/api      # без Docker: http://localhost:8080/api

# 1. загрузка папки: files[] и paths[] — в одном порядке
cd samples/demo
args=(); while IFS= read -r f; do args+=(-F "files=@$f" -F "paths=$f"); done < <(find src tests -type f | sort)
ID=$(curl -s -X POST $API/projects "${args[@]}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
cd ../..

# 2. анализ: находим проблему «конкатенация строк в цикле» (у неё есть фикс string-builder)
ISSUE=$(curl -s $API/projects/$ID/analysis | grep -o '"id":"StringConcatInLoop[^"]*"' | head -1 | cut -d'"' -f4)
echo "$ISSUE"

# 3. фикс: компиляция + все тесты, при красном результате проект не меняется (applied=false)
curl -s -X POST "$API/projects/$ID/issues/$ISSUE/fix" \
  -H 'Content-Type: application/json' -d '{"version":1,"fixId":"string-builder"}' | head -c 300; echo

# 4. поведение сохранено? оригинал и текущая версия на одних и тех же тестах
curl -s -X POST $API/projects/$ID/verify | grep -o '^{"status":"[a-z]*"'

# 5. исполняемый jar только из чистого кода пользователя
curl -s "$API/projects/$ID/export?format=jar" -o demo.jar
echo 'CUSTOMER 1 Alice gold' | java -jar demo.jar | head -3
```

Версия проекта (`version`) растёт при каждой правке; запрос со старой версией получает `409`.

## Как устроено

```
backend/                Gradle (Kotlin DSL), модульный монолит; Spring Boot только в app
  model/                record'ы по контракту: Block, Issue, TestCase, TestResult, ProjectSnapshot
  source/               загрузка zip/jar/папки, JavaParser, UNPARSED_FILE для неразобранных файлов
  blocks/               AstToBlocks, BlocksToJava (round-trip), NodeValidator
  analysis/             Big O, граф вызовов, 7 детекторов (реестр DetectorRegistry)
  runner/               компиляция и запуск в Docker (--network none, лимиты, таймаут 10 с), instrumenter, jar
  testing/              IO-тесты, JUnit, BehaviorVerifier (сравнение поведения)
  fixes/                3 фикса (RefactoringRegistry) и QualityGate
  benchmark/            заглушка точки расширения (замер сложности — позже)
  cli/                  picocli: analyze / verify для CI (без Spring)
  app/                  REST по контракту, ProjectStore (в памяти, версия, 409), сборка реестров
frontend/               Vite + React 18 + TS; features: editor-nodes, editor-code, project-tree,
                        analysis-panel, tests-panel, fix, sandbox, upload, command-palette, api
contract/               openapi.yaml + fixtures/ — единственный источник формата фронт ↔ бэк
samples/                demo (монолит с дефектами), roundtrip (корпус конструкций для round-trip)
docs/                   TZ.md, architecture.md, decisions.md, STATUS.md, TASKS.md
docker-compose.yml      backend + frontend (деплой Coolify)
```

**Поток данных.** Запрос → контроллер в `app` → `ProjectStore.update(id, version, fn)` (старая версия → 409,
иначе version+1) → модули. Правка ноды: `PUT /methods/{id}/blocks` с полным деревом метода и версией → `NodeValidator` →
`BlocksToJava` заменяет только тело метода → код печатается и разбирается заново → новые блоки + анализ + version+1.
Правка текста в Monaco: `PUT /files` с текстом файла и версией (debounce 500 мс).
Типы фронта генерируются из контракта (`npm run gen:api`), Java-DTO бэка пишутся руками и сверяются с JSON Schema
контракта в `ContractConformanceTest`.

**Код ↔ ноды.** Метод — дерево блоков, а не произвольный граф; выражения — текст внутри блока. Пользователь не рисует
стрелки: структура меняется вставкой («+» на стрелке), удалением, перемещением вверх/вниз и правкой текста.
Неподдержанная конструкция превращается в блок `raw` с исходным текстом — код не теряется. Источник правды — текст:
неизменённые методы сохраняются байт в байт. Невалидный текст ноды → `422`, нода красная, правка не применяется.

**Анализ.** `NestedLoopSameCollection`, `LinearSearchInLoop`, `ExpensiveCallInLoop`, `StringConcatInLoop`, `LongMethod`,
`DeepNesting`, `DeadCode`. Типы определяются текстом, без Symbol Solver, поэтому неуверенный вывод помечается
`confidence: low` и показывается как «возможно». Оценка «≈ операций при n = …» — асимптотическая, не замер.
Новое правило — новый класс `Detector` в `analysis` и строка в `DetectorRegistry.defaults()`.

**Фиксы и Quality Gate.** `string-builder`, `linked-hash-set`, `index-by-id`; порядок перебора сохраняется
(`LinkedHashMap` / `LinkedHashSet`). `fix` применяется к копии: компиляция программы → проверка поведения тестами
→ только при зелёном результате (или `incomplete` с пометкой: тестов нет / вывод шумный) изменения попадают в проект.
Отказ возвращается как `applied: false` с причиной, версия не меняется. Фикс — новый класс `Refactoring` + регистрация.

**Тесты и проверка поведения.** Источник правды — файлы `tests/` внутри проекта: IO-тесты (`.in`/`.out` или
`.json` с режимами `original` / `manual` и `ignoreLines`) и JUnit (`tests/*.java`). `verify` прогоняет в одном контейнере
оригинал (дважды, чтобы найти шумные строки) и текущую версию; статус `green` / `red` / `incomplete` / `blocked`.

**Песочница.** Пользовательский код выполняется только в одноразовом контейнере: `--network none`, лимиты памяти и CPU,
таймаут 10 с (`verify` — 120 с общий), `Random` переписывается на seed 42 — только в копии для запуска.
Экспорт `.jar` собирается из чистого кода без переписываний и инструментации.

**Аутентификация и права.** Нет: БД и пользователей нет, проект привязан к id в памяти и пропадает при перезапуске
бэкенда. Лимиты загрузки: 20 МБ после распаковки, 2000 файлов, тело запроса до 100 МБ.

## Конфигурация

Все переменные необязательны — у каждой есть значение по умолчанию. `.env` рядом с `docker-compose.yml` compose читает
сам (в `.gitignore`); читаются они в `runner` (`BLUEPRINTS_*`), `app` (`LLM_API_KEY`) и Vite (`VITE_*`).

| Переменная | Назначение | По умолчанию / пример |
|---|---|---|
| `LLM_API_KEY` | Ключ LLM-провайдера; без него продукт работает полностью, `/health` отдаёт `llm: false` | пусто |
| `BLUEPRINTS_RUN_DIR` | Рабочая папка запусков. Монтируется по **одному и тому же пути** на хосте и в контейнере бэкенда: Runner передаёт демону свои пути | `/var/lib/blueprints-run` в образе; если не задана — `<java.io.tmpdir>/blueprints-run` |
| `BLUEPRINTS_RUN_IMAGE` | Образ песочницы с JDK 21 | `eclipse-temurin:21-jdk` |
| `JAVA_OPTS` | Опции JVM бэкенда (задаются целиком, только в образе) | `-XX:MaxRAMPercentage=75` |
| `VITE_USE_MOCKS` | Только dev-сервер: `true` — запросы `/api` обслуживает MSW на `contract/fixtures`, `false` — прокси на бэкенд | `true` |
| `VITE_BACKEND_URL` | Только dev-сервер: адрес бэкенда для прокси | `http://localhost:8080` |

## Разработка

**Запуск без Docker-образов** (Java 21 — при первой сборке Gradle сам скачает JDK 21 через foojay, нужен интернет;
Node 22+; Docker нужен лишь для запуска, verify и Quality Gate — сборка и остальное работают без него):

```bash
cd backend && ./gradlew :app:bootRun        # http://localhost:8080/api
cd frontend && npm ci
npm run dev                                 # http://localhost:5173, по умолчанию на моках
VITE_USE_MOCKS=false npm run dev            # то же, но с прокси на бэкенд :8080
```

Если системная Java не 21, запускай бэкенд с `JAVA_HOME` на Temurin 21. Используй только `./gradlew`, не системный `gradle`.

**Тесты** (Docker нужен для тестов runner / testing / app с песочницей — без `docker info` они пропускаются):

```bash
cd backend && ./gradlew build                                         # все модули, включая round-trip корпуса
cd backend && ./gradlew :<модуль>:test                                # один модуль
cd frontend && npm run typecheck && npm run lint && npm test         # Vitest + Testing Library + MSW
bash samples/demo/run-tests.sh                                       # IO-тесты демо напрямую через javac
```

Покрыто: round-trip корпуса `samples/roundtrip` и демо (`RoundTripCorpusTest`: блоки → Java → компиляция → тот же stdout и
exit code), соответствие ответов API JSON Schema контракта (`ContractConformanceTest`, `ProjectsApiTest`, `EditApiTest`,
`TestsApiTest`), детекторы (позитивные и негативные примеры), фиксы и Quality Gate, runner в Docker, `BehaviorVerifier`,
CLI, а на фронте — холст, синхронизация с кодом, панели, загрузка, фикс и запуск. CI (GitHub Actions) гоняет то же
плюс `npm run gen:api` без диффа в сгенерированных типах.

**Контракт.** `contract/openapi.yaml` и `contract/fixtures/` меняются только по решению людей; после правки —
`cd frontend && npm run gen:api` и коммит `src/features/api/generated`.

**CLI для CI** (без Spring; Java 21):

```bash
cd backend && ./gradlew :cli:installDist
cli/build/install/blueprints/bin/blueprints analyze ../samples/demo --fail-on "O(n^2)"   # код выхода 1 при нарушении
cli/build/install/blueprints/bin/blueprints verify ../samples/demo                        # нужен Docker
```

**Правила для людей и агентов** — [CLAUDE.md](CLAUDE.md), модули —
`README.md` в каждом пакете, состояние работ — [docs/STATUS.md](docs/STATUS.md), полное ТЗ — [docs/TZ.md](docs/TZ.md).

## Ограничения

- Файлы с локальными `enum` / `interface` JavaParser не разбирает: они загружаются текстом без блоков (предупреждение `UNPARSED_FILE`) и через `PUT files` не правятся.
- Фиксы консервативны: при алиасах, сторонних вызовах в цикле или непонятных типах отказываются применяться, а не рискуют.
- Формы классов / полей / методов (FE-10) не реализованы: нужных эндпоинтов нет в контракте. Модули `ai` и `report`, замер сложности (`benchmark`) — не сделаны.
- Без Docker запуск, проверка поведения и Quality Gate недоступны; на Windows 2 теста `RunnerTest` (fakeDocker) пропускаются — нужен `/bin/bash`.
