import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './client';
import { getMethodBlocks, prefetchMethodBlocks, resetMethodBlocks } from './methodBlocks';

/** Клиент-заглушка: считает GET blocks, ответ — пустой, но готовый. */
function stubClient() {
  const GET = vi.fn(() => Promise.resolve({ data: undefined, response: { status: 200 } }));
  return { client: { GET } as unknown as ApiClient, GET };
}

describe('getMethodBlocks / prefetchMethodBlocks', () => {
  beforeEach(() => {
    resetMethodBlocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMethodBlocks();
  });

  it('одновременные запросы одного метода и версии — один GET; после ответа следующий идёт на сервер', async () => {
    const { client, GET } = stubClient();
    const [a, b] = [getMethodBlocks(client, 'p', 'm', 1), getMethodBlocks(client, 'p', 'm', 1)];
    expect(a).toBe(b);
    await a;
    expect(GET).toHaveBeenCalledTimes(1);
    await getMethodBlocks(client, 'p', 'm', 1);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('предзагрузка: get в пределах TTL берёт готовый ответ; после TTL — новый GET', async () => {
    const { client, GET } = stubClient();
    prefetchMethodBlocks(client, 'p', 'm', 1);
    await vi.advanceTimersByTimeAsync(1000);
    await getMethodBlocks(client, 'p', 'm', 1);
    expect(GET).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    await getMethodBlocks(client, 'p', 'm', 1);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it('ключ — проект, метод и версия: другая версия или метод не получают чужой ответ', async () => {
    const { client, GET } = stubClient();
    prefetchMethodBlocks(client, 'p', 'm', 1);
    await getMethodBlocks(client, 'p', 'm', 2);
    await getMethodBlocks(client, 'p', 'other', 1);
    await getMethodBlocks(client, 'q', 'm', 1);
    expect(GET).toHaveBeenCalledTimes(4);
  });
});
