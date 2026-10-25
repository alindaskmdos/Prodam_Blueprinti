import { useEffect } from 'react';
import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';

type Capabilities = Schemas['Capabilities'];
export type AiFeature = Capabilities['features'][number];

interface CapabilitiesState {
  /** null — ещё не загружено или не удалось: кнопок ИИ нет. */
  caps: Capabilities | null;
}

export const useCapabilitiesStore = create<CapabilitiesState>()(() => ({ caps: null }));

/** GET /capabilities один раз на клиента; ошибка = ИИ недоступен (кнопок нет). */
export function useLoadCapabilities(client: ApiClient): void {
  useEffect(() => {
    let alive = true;
    client
      .GET('/capabilities')
      .then(({ data }) => alive && useCapabilitiesStore.setState({ caps: data ?? null }))
      .catch(() => alive && useCapabilitiesStore.setState({ caps: null }));
    return () => {
      alive = false;
    };
  }, [client]);
}

/** Есть ли ИИ-функция: нужен llm=true и функция в features. Нет — кнопку не рисуем (не disabled). */
export function hasAiFeature(caps: Capabilities | null, feature: AiFeature): boolean {
  return caps !== null && caps.llm && caps.features.includes(feature);
}

export function useAiFeature(feature: AiFeature): boolean {
  return useCapabilitiesStore((s) => hasAiFeature(s.caps, feature));
}

/** Сброс (тесты). */
export function resetCapabilitiesState(): void {
  useCapabilitiesStore.setState({ caps: null });
}
