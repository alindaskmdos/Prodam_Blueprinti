import { useEffect } from 'react';
import type { ApiClient } from '../api';
import { loadProjectTree, useTreeStore, type TreeState } from './treeStore';

export type { TreeState } from './treeStore';

const LOADING: TreeState = { kind: 'loading' };

/** GET /projects/{projectId}/tree в общий `useTreeStore`; версия из ответа кладётся в общее состояние. */
export function useProjectTree(client: ApiClient, projectId: string): TreeState {
  useEffect(() => {
    void loadProjectTree(client, projectId);
  }, [client, projectId]);

  const loadedFor = useTreeStore((s) => s.projectId);
  const state = useTreeStore((s) => s.state);
  return loadedFor === projectId ? state : LOADING;
}
