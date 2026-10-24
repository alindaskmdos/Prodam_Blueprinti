import { useEffect, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import type { ApiClient, Schemas } from '../api';
import { useAnalysisStore } from '../analysis-panel';
import { useTreeStore } from '../project-tree';
import { useAppStore } from '../../app/store';
import { buildEntries, groupEntries, type PaletteCommand } from './entries';
import styles from './CommandPalette.module.css';

interface Props {
  client: ApiClient;
  commands: readonly PaletteCommand[];
  runCommand: (id: string, args?: Readonly<Record<string, string>>) => void;
  onClose: () => void;
}

/** Корень блоков выбранного метода для поиска по нодам; грузится при открытии палитры. */
function useMethodRoot(client: ApiClient, projectId: string | null, methodId: string | null): Schemas['Block'] | null {
  const [loaded, setLoaded] = useState<{ key: string; root: Schemas['Block'] } | null>(null);
  const key = projectId && methodId ? `${projectId}|${methodId}` : null;

  useEffect(() => {
    if (!projectId || !methodId || !key) return;
    let cancelled = false;
    client
      .GET('/projects/{projectId}/methods/{methodId}/blocks', { params: { path: { projectId, methodId } } })
      .then(({ data }) => {
        if (!cancelled && data) setLoaded({ key, root: data.root });
      })
      // Нет блоков — просто нет группы «Ноды»; остальная палитра работает.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, projectId, methodId, key]);

  return key !== null && loaded?.key === key ? loaded.root : null;
}

/** Окно палитры: cmdk с нечётким поиском по командам и данным проекта. Грузится лениво при первом открытии. */
export default function PaletteDialog({ client, commands, runCommand, onClose }: Props) {
  const projectId = useAppStore((s) => s.projectId);
  const methodId = useAppStore((s) => s.selectedMethodId);
  const treeState = useTreeStore((s) => (s.projectId === projectId ? s.state : null));
  const analysis = useAnalysisStore((s) => s.analysis);
  const root = useMethodRoot(client, projectId, methodId);
  const tree = treeState?.kind === 'ok' ? treeState.tree : null;

  // isEnabled команд читается при построении: пересобираем на смену данных, пока палитра открыта.
  const groups = useMemo(
    () => groupEntries(buildEntries({ tree, analysis, root, commands, runCommand })),
    [tree, analysis, root, commands, runCommand],
  );

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Command
        className={styles.palette}
        label="Командная палитра"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            // Палитра может быть поверх модалки: Esc закрывает только её.
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <Command.Input className={styles.input} placeholder="Класс, метод, нода, проблема или команда" autoFocus />
        <Command.List className={styles.list}>
          {groups.map(({ group, entries }) => (
            <Command.Group key={group} heading={group}>
              {entries.map((entry) => (
                <Command.Item
                  key={entry.id}
                  value={entry.id}
                  keywords={[entry.title, ...(entry.hint ? [entry.hint] : []), ...entry.keywords]}
                  disabled={entry.disabled}
                  className={styles.item}
                  onSelect={() => {
                    onClose();
                    entry.run();
                  }}
                >
                  <span className={styles.title}>{entry.title}</span>
                  {entry.hint && <span className={styles.hint}>{entry.hint}</span>}
                  {entry.shortcut && <kbd className={styles.shortcut}>{entry.shortcut}</kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
