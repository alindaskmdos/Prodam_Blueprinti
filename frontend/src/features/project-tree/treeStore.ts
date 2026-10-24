import { create } from 'zustand';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';

export type TreeState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; tree: Schemas['ProjectTree'] };

interface TreeStore {
  /** Проект, для которого загружено/грузится `state`. */
  projectId: string | null;
  state: TreeState;
  /** Номер последнего запроса: ответы старых запросов отбрасываются. */
  seq: number;
}

const initial: TreeStore = { projectId: null, state: { kind: 'loading' }, seq: 0 };

/** Дерево открытого проекта — общее для колонки проекта и панели кода (путь файла метода). */
export const useTreeStore = create<TreeStore>()(() => ({ ...initial }));

let lastClient: ApiClient | null = null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * GET /projects/{projectId}/tree в `useTreeStore`. `keepStale` — пока перезагружается тот же проект,
 * показывать старое дерево, а не «загрузку». Версия из ответа уходит в общий store, если она новее
 * (версии проекта только растут; моки отдают tree.json с одной и той же версией).
 */
export async function loadProjectTree(client: ApiClient, projectId: string, keepStale = false): Promise<void> {
  lastClient = client;
  const prev = useTreeStore.getState();
  const seq = prev.seq + 1;
  const stale = keepStale && prev.projectId === projectId && prev.state.kind === 'ok';
  useTreeStore.setState(stale ? { seq } : { seq, projectId, state: { kind: 'loading' } });
  const current = () => useTreeStore.getState().seq === seq;
  try {
    const { data, error, response } = await client.GET('/projects/{projectId}/tree', {
      params: { path: { projectId } },
    });
    if (!current()) return;
    if (data) {
      useTreeStore.setState({ projectId, state: { kind: 'ok', tree: data } });
      const { version, setVersion } = useAppStore.getState();
      if (version === null || data.version > version) setVersion(data.version);
    } else {
      useTreeStore.setState({
        projectId,
        state: { kind: 'error', message: error?.message ?? `HTTP ${response.status}` },
      });
    }
  } catch (e: unknown) {
    if (current()) useTreeStore.setState({ projectId, state: { kind: 'error', message: errorText(e) } });
  }
}

/** Перезагрузить дерево открытого проекта (после правки кода, на 409); старое дерево видно до ответа. */
export function reloadProjectTree(): Promise<void> {
  const { projectId } = useTreeStore.getState();
  if (!lastClient || !projectId) return Promise.resolve();
  return loadProjectTree(lastClient, projectId, true);
}

/** Клиент API последней загрузки дерева (формы структуры, команды палитры); дерево не загружалось — null. */
export function getTreeClient(): ApiClient | null {
  return lastClient;
}

/**
 * Дерево из ответа правки (MutationResult.tree) — без повторного GET. Ответы ещё летящих GET отбрасываются.
 * Версия — в общий store, если новее.
 */
export function applyTree(projectId: string, tree: Schemas['ProjectTree'], version: number): void {
  const { seq, projectId: current } = useTreeStore.getState();
  if (current !== projectId) return;
  useTreeStore.setState({ seq: seq + 1, state: { kind: 'ok', tree } });
  const app = useAppStore.getState();
  if (app.version === null || version > app.version) app.setVersion(version);
}

/** Сброс (тесты). */
export function resetTreeState(): void {
  lastClient = null;
  useTreeStore.setState({ ...initial });
}

/** Путь файла (ProjectFile.path), где объявлен метод/конструктор с id = `methodId`; нет — null. */
export function findMethodFile(tree: Schemas['ProjectTree'], methodId: string): string | null {
  for (const pkg of tree.packages) {
    for (const file of pkg.files) {
      const found = file.classes.some(
        (cls) => cls.methods.some((m) => m.id === methodId) || cls.constructors.some((m) => m.id === methodId),
      );
      if (found) return file.path;
    }
  }
  return null;
}
