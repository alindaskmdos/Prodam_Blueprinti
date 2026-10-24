# api

Типизированный клиент контракта `contract/openapi.yaml`.

- `generated/schema.ts` — типы, сгенерированные `npm run gen:api` (openapi-typescript, `--default-non-nullable false`). Руками не править; файл закоммичен, CI проверяет, что генерация не даёт диффа.
- `client.ts` — `createApiClient(baseUrl?)` на openapi-fetch, `api` — экземпляр по умолчанию (`<origin>/api`). Тип `Schemas` = `components['schemas']`.
- `methodBlocks.ts` — `getMethodBlocks(client, projectId, methodId, version)`: GET blocks метода с объединением одновременных запросов (холст, прокрутка кода, палитра получают один ответ; ключ — проект, метод и версия, после ответа запись удаляется — следующая загрузка идёт на сервер). `prefetchMethodBlocks(...)` — начать загрузку заранее (UML → схема метода идёт параллельно с анимацией); готовый ответ держится 1500 мс. `resetMethodBlocks()` — сброс кэша (тесты).
- Типы ответов брать только отсюда: `Schemas['ProjectTree']`, `paths['/health']['get']['responses']['200']…`.

Пример:

```ts
const { data, error, response } = await api.GET('/projects/{projectId}/tree', {
  params: { path: { projectId } },
});
```

Ошибки (4xx/5xx) приходят в `error` с телом `Schemas['Error']`; на 409 — перезагрузить состояние проекта.

Тесты: `src/features/api/client.test.ts` — запросы через MSW-сервер (`src/mocks`) получают фикстуры `contract/fixtures`; `methodBlocks.test.ts` — объединение GET, предзагрузка и TTL, ключ по версии (клиент-заглушка).
