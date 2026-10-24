import { useEffect, useState } from 'react';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';

export type TreeState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; tree: Schemas['ProjectTree'] };

/** GET /projects/{projectId}/tree; версия из ответа кладётся в общее состояние. */
export function useProjectTree(client: ApiClient, projectId: string): TreeState {
  const [state, setState] = useState<TreeState>({ kind: 'loading' });
  const setVersion = useAppStore((s) => s.setVersion);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    client
      .GET('/projects/{projectId}/tree', { params: { path: { projectId } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) {
          setState({ kind: 'ok', tree: data });
          setVersion(data.version);
        } else {
          setState({ kind: 'error', message: error?.message ?? `HTTP ${response.status}` });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, setVersion]);

  return state;
}
