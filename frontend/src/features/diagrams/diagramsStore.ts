import { useEffect } from 'react';
import { create } from 'zustand';
import { useAppStore } from '../../app/store';
import type { ApiClient, Schemas } from '../api';

export interface Remote<T> {
  /** `projectId#version`, для которого загружено/грузится. */
  key: string | null;
  projectId: string | null;
  status: 'idle' | 'loading' | 'ok' | 'error';
  /** Последний успешный ответ этого проекта: виден, пока грузится новая версия. */
  data: T | null;
  message: string | null;
}

interface DiagramsState {
  uml: Remote<Schemas['UmlDiagram']>;
  deps: Remote<Schemas['DependencyGraph']>;
}

export type DiagramKind = keyof DiagramsState;

const empty = { key: null, projectId: null, status: 'idle' as const, data: null, message: null };

/** Диаграммы открытого проекта (UML — FE-16, граф зависимостей для циклов в UML — FE-18/FE-48): кэш по версии проекта. */
export const useDiagramsStore = create<DiagramsState>()(() => ({ uml: { ...empty }, deps: { ...empty } }));

function request(kind: DiagramKind, client: ApiClient, projectId: string) {
  const init = { params: { path: { projectId } } };
  return kind === 'uml' ? client.GET('/projects/{projectId}/uml', init) : client.GET('/projects/{projectId}/dependencies', init);
}

function put(kind: DiagramKind, value: Remote<unknown>): void {
  useDiagramsStore.setState({ [kind]: value } as Partial<DiagramsState>);
}

/**
 * GET uml / dependencies для `projectId` и `version` проекта. Та же версия уже загружена или грузится — запроса нет;
 * новая версия перезагружает, старая диаграмма видна до ответа. Устаревший ответ отбрасывается.
 */
export async function loadDiagram(kind: DiagramKind, client: ApiClient, projectId: string, version: number | null): Promise<void> {
  const key = `${projectId}#${version ?? ''}`;
  const prev = useDiagramsStore.getState()[kind];
  if (prev.key === key && (prev.status === 'loading' || prev.status === 'ok')) return;
  const keep = prev.projectId === projectId ? prev.data : null;
  put(kind, { key, projectId, status: 'loading', data: keep, message: null });
  const current = () => useDiagramsStore.getState()[kind].key === key;
  try {
    const { data, error, response } = await request(kind, client, projectId);
    if (!current()) return;
    put(
      kind,
      data
        ? { key, projectId, status: 'ok', data, message: null }
        : { key, projectId, status: 'error', data: keep, message: error?.message ?? `HTTP ${response.status}` },
    );
  } catch (e: unknown) {
    if (current()) {
      put(kind, { key, projectId, status: 'error', data: keep, message: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Диаграмма открытого проекта; перезагружается при смене версии проекта (правка, фикс). */
export function useDiagram<K extends DiagramKind>(kind: K, client: ApiClient): DiagramsState[K] {
  const projectId = useAppStore((s) => s.projectId);
  const version = useAppStore((s) => s.version);
  useEffect(() => {
    if (projectId) void loadDiagram(kind, client, projectId, version);
  }, [kind, client, projectId, version]);
  return useDiagramsStore((s) => s[kind]) as DiagramsState[K];
}

/** Сброс (тесты). */
export function resetDiagrams(): void {
  useDiagramsStore.setState({ uml: { ...empty }, deps: { ...empty } });
}
