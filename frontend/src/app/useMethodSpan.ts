import { useEffect, useState } from 'react';
import { getMethodBlocks, type ApiClient, type Schemas } from '../features/api';
import { useAppStore } from './store';

export interface LoadedMethodSpan {
  projectId: string;
  methodId: string;
  span: Schemas['Span'] | null;
}

/**
 * Span метода (`MethodView.root.span`, GET blocks) для прокрутки кода при выборе метода (FE-35).
 * Грузится один раз на каждый выбор метода (`selectSeq` — и повторный клик по нему): правки кода и нод его не перечитывают, поэтому не прокручивают заново.
 * Не загрузился или span нет — span null (ничего не прокручиваем); пока идёт загрузка — null целиком.
 */
export function useMethodSpan(
  client: ApiClient,
  projectId: string | null,
  methodId: string | null,
  selectSeq = 0,
): LoadedMethodSpan | null {
  const [loaded, setLoaded] = useState<LoadedMethodSpan | null>(null);

  useEffect(() => {
    setLoaded(null);
    if (!projectId || !methodId) return;
    let cancelled = false;
    // Тот же запрос, что у холста (getMethodBlocks объединяет одновременные GET blocks).
    getMethodBlocks(client, projectId, methodId, useAppStore.getState().version)
      .then(({ data }) => {
        if (!cancelled && data) setLoaded({ projectId, methodId, span: data.root.span ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, projectId, methodId, selectSeq]);

  return loaded;
}
