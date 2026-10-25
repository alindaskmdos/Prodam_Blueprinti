# ai

Опциональный ИИ-слой (§14а.10 ТЗ). Без Spring. Включается только при `LLM_API_KEY`; без ключа `Ai.available()` = false.

- `Ai` — фасад: `explain(text, method)` → Markdown; `edit(text, method, fragment|null, instruction)` → новый полный текст
  файла (меняется только диапазон объявления метода, остальное байт в байт; результат обязан разбираться, иначе
  `MethodPatch.BadReply`); `proposeFix(issue, path, text, method)` → `Refactoring` для Quality Gate. `method` — `CallableDeclaration`
  из разбора того же `text`. Без клиента и при сбое провайдера — `LlmClient.Unavailable`.
- `fixProviders()` — список `FixProvider` слоя (новый источник — новый класс + строка в конструкторе `Ai`). Сейчас `LlmFixProvider` (`llm`):
  модель переписывает метод с проблемой; в промпте правило порядка перебора (§9); `apply` отклоняет ответ, где HashMap/HashSet
  (не Linked) встречаются чаще, чем в исходном методе, неразборчивый и не изменивший метод ответ. `canApply` — файл не менялся с запроса.
- Формат ответа модели: блок ```java с методом целиком, недостающие `import` — строками в начале блока (дописываются после последнего импорта).
  Отступ выравнивается под место метода, перевод строки файла (`\r\n`/`\n`) сохраняется.
- `LlmClient` — интерфейс запроса (в тестах фейк); `OpenAiClient(apiKey, baseUrl, model)` — OpenAI-совместимый
  `POST {baseUrl}/chat/completions` (по умолчанию `https://api.openai.com/v1`, `gpt-4o-mini`), таймаут 90 с.
- `RateLimiter` — `perMinute` запросов за скользящие 60 с на сессию + общий `perDay` за сутки UTC; env `LLM_RATE_PER_MINUTE`
  (5), `LLM_RATE_PER_DAY` (200). Превышение — `Limited` с текстом и `retryAfterSec`; отклонённый запрос не считается.
  Сессию определяет app: заголовок `X-Session-Id`, иначе первый адрес `X-Forwarded-For`, иначе адрес клиента
  (заголовки подделываются — от расходов защищает общий дневной лимит).

Зависит от: model, source, fixes. Тесты: `./gradlew :ai:test` (без сети: фейк LLM, `OpenAiClient` — на локальном HttpServer).
