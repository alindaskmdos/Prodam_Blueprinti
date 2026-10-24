import type { ApiClient } from './client';

type BlocksResult = Awaited<ReturnType<typeof request>>;

function request(client: ApiClient, projectId: string, methodId: string) {
  return client.GET('/projects/{projectId}/methods/{methodId}/blocks', { params: { path: { projectId, methodId } } });
}

interface Entry {
  client: ApiClient;
  promise: Promise<BlocksResult>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Сколько готовый ответ предзагрузки отдаётся новым потребителям (холст и код монтируются после анимации). */
const PREFETCH_TTL_MS = 1500;

const entries = new Map<string, Entry>();
const keyOf = (projectId: string, methodId: string, version: number | null) => `${projectId}\u0000${methodId}\u0000${version ?? ''}`;

function drop(key: string, entry: Entry): void {
  if (entries.get(key) !== entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entries.delete(key);
}

function start(client: ApiClient, key: string, projectId: string, methodId: string, keepAfterSettle: boolean): Entry {
  const entry: Entry = { client, promise: request(client, projectId, methodId), timer: null };
  entries.set(key, entry);
  const settle = () => {
    if (keepAfterSettle) entry.timer = setTimeout(() => drop(key, entry), PREFETCH_TTL_MS);
    else drop(key, entry);
  };
  entry.promise.then(settle, settle);
  return entry;
}

/**
 * GET blocks метода с объединением одновременных запросов: холст (BlockSync), прокрутка кода к методу (FE-35)
 * и палитра при выборе метода получают один ответ, а не три последовательных запроса. Готовый ответ
 * предзагрузки (`prefetchMethodBlocks`) живёт PREFETCH_TTL_MS; иначе после ответа запись удаляется — следующая
 * загрузка (новая версия, 409) всегда идёт на сервер. Ключ — проект, метод и известная версия проекта:
 * ответ старой версии новой не отдаётся.
 */
export function getMethodBlocks(
  client: ApiClient,
  projectId: string,
  methodId: string,
  version: number | null = null,
): Promise<BlocksResult> {
  const key = keyOf(projectId, methodId, version);
  const entry = entries.get(key);
  if (entry && entry.client === client) return entry.promise;
  return start(client, key, projectId, methodId, false).promise;
}

/**
 * Начать загрузку метода заранее (переход UML → схема метода: запрос идёт параллельно с анимацией).
 * Результат ждёт первого `getMethodBlocks` не дольше PREFETCH_TTL_MS.
 */
export function prefetchMethodBlocks(client: ApiClient, projectId: string, methodId: string, version: number | null): void {
  const key = keyOf(projectId, methodId, version);
  const entry = entries.get(key);
  if (entry && entry.client === client) return;
  start(client, key, projectId, methodId, true);
}

/** Сброс (тесты). */
export function resetMethodBlocks(): void {
  for (const [key, entry] of entries) drop(key, entry);
}
