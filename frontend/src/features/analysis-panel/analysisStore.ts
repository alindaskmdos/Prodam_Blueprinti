import { useEffect } from 'react';
import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';

type Analysis = Schemas['Analysis'];

/** n по умолчанию — как в контракте (GET analysis, `n` default 10000) и ТЗ §8.4. */
export const DEFAULT_N = 10000;

export type AnalysisStatus = 'idle' | 'loading' | 'ok' | 'error';

interface AnalysisState {
  /** n, с которым запрашивается оценка «≈ операций». */
  n: number;
  status: AnalysisStatus;
  /** Последний полученный анализ (при перезагрузке остаётся до прихода нового). */
  analysis: Analysis | null;
  error: string | null;
  /** Для чего получен `analysis`: проект и запрошенное n. */
  loadedFor: { projectId: string; n: number } | null;
  /** Ключ запроса в полёте (projectId|version|n); устаревшие ответы отбрасываются. */
  pendingKey: string | null;
  setN: (n: number) => void;
  /** GET /projects/{projectId}/analysis?n=…; повторно не запрашивает то, что уже загружено/грузится. */
  load: (client: ApiClient, projectId: string, version: number | null, n: number) => Promise<void>;
  /** Анализ из другого ответа (напр. MutationResult.analysis после правки). */
  setAnalysis: (projectId: string, analysis: Analysis) => void;
}

const initial = {
  n: DEFAULT_N,
  status: 'idle' as AnalysisStatus,
  analysis: null,
  error: null,
  loadedFor: null,
  pendingKey: null,
};

/** Общий для трёх вкладок анализ: вкладки рендерятся по одной, данные и n живут здесь. */
export const useAnalysisStore = create<AnalysisState>()((set, get) => ({
  ...initial,
  setN: (n) => set({ n }),
  load: async (client, projectId, version, n) => {
    const s = get();
    const key = `${projectId}|${version ?? ''}|${n}`;
    if (s.pendingKey === key) return;
    const fresh =
      s.status === 'ok' &&
      s.loadedFor?.projectId === projectId &&
      s.loadedFor.n === n &&
      (version === null || s.analysis?.version === version);
    if (fresh) return;

    const otherProject = s.loadedFor !== null && s.loadedFor.projectId !== projectId;
    set({ pendingKey: key, status: 'loading', error: null, ...(otherProject ? { analysis: null, loadedFor: null } : {}) });
    try {
      const { data, error, response } = await client.GET('/projects/{projectId}/analysis', {
        params: { path: { projectId }, query: { n } },
      });
      if (get().pendingKey !== key) return;
      if (data) {
        set({ analysis: data, status: 'ok', loadedFor: { projectId, n }, pendingKey: null });
      } else {
        set({ status: 'error', error: error?.message ?? `HTTP ${response.status}`, pendingKey: null });
      }
    } catch (e: unknown) {
      if (get().pendingKey !== key) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), pendingKey: null });
    }
  },
  setAnalysis: (projectId, analysis) =>
    set({ analysis, status: 'ok', error: null, loadedFor: { projectId, n: analysis.n }, pendingKey: null }),
}));

/** Сброс (тесты). */
export function resetAnalysisState(): void {
  useAnalysisStore.setState({ ...initial });
}

/**
 * Анализ открытого проекта: грузит при смене проекта, версии (`useAppStore`) или n.
 * Возвращает состояние стора анализа.
 */
export function useAnalysis(client: ApiClient) {
  const projectId = useAppStore((s) => s.projectId);
  const version = useAppStore((s) => s.version);
  const n = useAnalysisStore((s) => s.n);
  const load = useAnalysisStore((s) => s.load);

  useEffect(() => {
    if (projectId) void load(client, projectId, version, n);
  }, [client, projectId, version, n, load]);

  const status = useAnalysisStore((s) => s.status);
  const analysis = useAnalysisStore((s) => s.analysis);
  const error = useAnalysisStore((s) => s.error);
  return { projectId, status, analysis, error, n };
}
