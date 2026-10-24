import createClient from 'openapi-fetch';
import type { components, paths } from './generated/schema';

export type { components, paths };
/** Схемы контракта: `Schemas['ProjectTree']` и т.п. Только из сгенерированных типов. */
export type Schemas = components['schemas'];

/** Префикс API из `servers` контракта. */
export const API_PREFIX = '/api';

function defaultBaseUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  return `${origin}${API_PREFIX}`;
}

/**
 * Типизированный клиент контракта. `fetch` берётся из globalThis на каждый вызов,
 * чтобы перехват MSW работал независимо от порядка инициализации.
 */
export function createApiClient(baseUrl: string = defaultBaseUrl()) {
  return createClient<paths>({
    baseUrl,
    fetch: (request: Request) => globalThis.fetch(request),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient();
