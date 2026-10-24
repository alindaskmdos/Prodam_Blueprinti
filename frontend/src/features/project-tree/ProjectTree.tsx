import { useState } from 'react';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';
import { useProjectTree } from './useProjectTree';
import styles from './ProjectTree.module.css';

type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];

interface ProjectTreeProps {
  client: ApiClient;
  projectId: string;
}

/** Дерево проекта (только просмотр): пакеты → классы → поля, конструкторы, методы. Клик по методу выбирает его. */
export function ProjectTree({ client, projectId }: ProjectTreeProps) {
  const state = useProjectTree(client, projectId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const fileCount = state.kind === 'ok' ? state.tree.packages.reduce((n, p) => n + p.files.length, 0) : null;

  return (
    <section className={styles.panel} aria-label="Проект">
      <div className={styles.header}>
        Проект
        {fileCount !== null && <span className={styles.headerNote}>{filesLabel(fileCount)}</span>}
      </div>
      <div className={styles.body}>
        {state.kind === 'loading' && <p className={styles.note}>Загрузка дерева…</p>}
        {state.kind === 'error' && (
          <p role="alert" className={styles.error}>
            Не удалось загрузить дерево: {state.message}
          </p>
        )}
        {state.kind === 'ok' && (
          <ul className={styles.list} data-testid="project-tree">
            {state.tree.packages.map((pkg) => {
              const pkgKey = `p:${pkg.name}`;
              const open = !collapsed.has(pkgKey);
              return (
                <li key={pkgKey}>
                  <button
                    type="button"
                    className={styles.row}
                    aria-expanded={open}
                    onClick={() => toggle(pkgKey)}
                  >
                    <span className={styles.caret}>{open ? '▾' : '▸'}</span>
                    <span className={styles.pkg}>{pkg.name || '(пакет по умолчанию)'}</span>
                  </button>
                  {open && (
                    <ul className={styles.list}>
                      {pkg.files.flatMap((file) =>
                        file.classes.map((cls) => {
                          const clsKey = `c:${file.path}:${cls.name}`;
                          return (
                            <ClassItem
                              key={clsKey}
                              cls={cls}
                              open={!collapsed.has(clsKey)}
                              onToggle={() => toggle(clsKey)}
                            />
                          );
                        }),
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ClassItem({ cls, open, onToggle }: { cls: ClassNode; open: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" className={`${styles.row} ${styles.depth1}`} aria-expanded={open} onClick={onToggle}>
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        <span>{cls.name}</span>
        {cls.kind !== 'class' && <span className={styles.kind}>{cls.kind}</span>}
        {hasIssues(cls) && <span className={styles.issueDot} aria-label="есть проблемы" />}
      </button>
      {open && (
        <ul className={styles.list}>
          {cls.fields.map((f) => (
            <li key={`f:${f.name}`} className={`${styles.row} ${styles.depth2} ${styles.field}`} title={f.type}>
              <span className={styles.letter}>f</span>
              {f.name}
            </li>
          ))}
          {cls.constructors.map((m) => (
            <MethodItem key={m.id} method={m} letter="c" />
          ))}
          {cls.methods.map((m) => (
            <MethodItem key={m.id} method={m} letter="m" />
          ))}
        </ul>
      )}
    </li>
  );
}

function MethodItem({ method, letter }: { method: MethodNode; letter: 'm' | 'c' }) {
  const selected = useAppStore((s) => s.selectedMethodId === method.id);
  const selectMethod = useAppStore((s) => s.selectMethod);

  return (
    <li>
      <button
        type="button"
        className={`${styles.row} ${styles.depth2} ${selected ? styles.selected : ''}`}
        aria-pressed={selected}
        title={method.signature}
        data-method-id={method.id}
        onClick={() => selectMethod(method.id)}
      >
        <span className={styles.letter}>{letter}</span>
        <span>{method.name}</span>
        {method.complexity && (
          <span className={method.issueCount > 0 ? `${styles.badge} ${styles.badgeHot}` : styles.badge}>
            {method.complexity}
          </span>
        )}
        {!method.complexity && method.issueCount > 0 && (
          <span className={styles.issueDot} aria-label={`проблем: ${method.issueCount}`} />
        )}
      </button>
    </li>
  );
}

function hasIssues(cls: ClassNode): boolean {
  return [...cls.methods, ...cls.constructors].some((m) => m.issueCount > 0);
}

function filesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} файл`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} файла`;
  return `${n} файлов`;
}
