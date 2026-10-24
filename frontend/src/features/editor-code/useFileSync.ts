import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FileSync, type FileSyncOptions, type FileSyncState } from './fileSync';

export interface UseFileSync {
  state: FileSyncState;
  edit: (text: string) => void;
  reload: () => void;
  dismissConflict: () => void;
  /** stale: отбросить свои правки, оставить новый текст. */
  takeTheirs: () => void;
  /** stale: вернуть свои правки и отправить их с актуальной версией. */
  keepMine: () => void;
}

/**
 * React-обёртка над FileSync: один экземпляр на (client, projectId, path, debounceMs).
 * Колбэки читаются через ref — их смена не пересоздаёт синхронизацию.
 */
export function useFileSync(options: FileSyncOptions & { version?: number }): UseFileSync {
  const { client, projectId, path, debounceMs, version } = options;
  const callbacks = useRef(options);
  callbacks.current = options;

  const [sync, setSync] = useState(() => createSync());
  function createSync(): FileSync {
    return new FileSync({
      client,
      projectId,
      path,
      debounceMs,
      onVersion: (v) => callbacks.current.onVersion?.(v),
      onMutation: (r) => callbacks.current.onMutation?.(r),
      onConflict: (e) => callbacks.current.onConflict?.(e),
    });
  }

  useEffect(() => {
    const next = createSync();
    setSync(next);
    void next.load();
    return () => next.dispose();
    // createSync читает только перечисленные зависимости.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, path, debounceMs]);

  useEffect(() => {
    if (version !== undefined) sync.adoptVersion(version);
  }, [sync, version]);

  const state = useSyncExternalStore(sync.subscribe, sync.getState);

  return {
    state,
    edit: (text) => sync.edit(text),
    reload: () => void sync.load(),
    dismissConflict: () => sync.dismissConflict(),
    takeTheirs: () => sync.takeTheirs(),
    keepMine: () => sync.keepMine(),
  };
}
