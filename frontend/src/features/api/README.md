# api

Типизированный клиент контракта `contract/openapi.yaml`.

- `generated/schema.ts` — типы, сгенерированные `npm run gen:api` (openapi-typescript, `--default-non-nullable false`). Руками не править; файл закоммичен, CI проверяет, что генерация не даёт диффа.
- `client.ts` — `createApiClient(baseUrl?)` на openapi-fetch, `api` — экземпляр по умолчанию (`<origin>/api`). Тип `Schemas` = `components['schemas']`.
- Типы ответов брать только отсюда: `Schemas['ProjectTree']`, `paths['/health']['get']['responses']['200']…`.

Пример:

```ts
const { data, error, response } = await api.GET('/projects/{projectId}/tree', {
  params: { path: { projectId } },
});
```

Ошибки (4xx/5xx) приходят в `error` с телом `Schemas['Error']`; на 409 — перезагрузить состояние проекта.

Тесты: `src/features/api/client.test.ts` — запросы через MSW-сервер (`src/mocks`) получают фикстуры `contract/fixtures`.
