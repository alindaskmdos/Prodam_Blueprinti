import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BlockSync, type BlockSyncOptions, type BlockSyncState } from './blockSync';

/**
 * React-обёртка над BlockSync: один экземпляр на (client, projectId, methodId).
 * Колбэки читаются через ref — их смена не пересоздаёт синхронизацию; новая version извне берётся, если новее.
 */
export function useBlockSync(options: BlockSyncOptions): { sync: BlockSync; state: BlockSyncState } {
  const { client, projectId, methodId, version } = options;
  const callbacks = useRef(options);
  callbacks.current = options;

  const [sync, setSync] = useState(() => createSync());
  function createSync(): BlockSync {
    return new BlockSync({
      client,
      projectId,
      methodId,
      version: callbacks.current.version,
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
  }, [client, projectId, methodId]);

  useEffect(() => {
    if (version !== undefined && version !== null) sync.adoptVersion(version);
  }, [sync, version]);

  const state = useSyncExternalStore(sync.subscribe, sync.getState);
  return { sync, state };
}
