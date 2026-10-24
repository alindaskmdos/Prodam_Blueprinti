import { useState } from 'react';
import type { ApiClient, Schemas } from '../api';
import { useAppStore } from '../../app/store';
import { useProjectTree } from './useProjectTree';
import { StructureDialog } from './structure/StructureDialog';
import { openStructureDialog, selectStructure, useStructureStore } from './structure/structureStore';
import styles from './ProjectTree.module.css';

type ClassNode = Schemas['ClassNode'];
type MethodNode = Schemas['MethodNode'];

interface ProjectTreeProps {
  client: ApiClient;
  projectId: string;
}

/**
 * Дерево проекта: пакеты → классы → поля, конструкторы, методы. Клик по методу выбирает его (схема на холсте),
 * по классу/полю — открывает его форму во вкладке «Свойства» (FE-10). «+» в шапке — новый класс.
 */
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
        <span className={styles.headerTools}>
          {fileCount !== null && <span className={styles.headerNote}>{filesLabel(fileCount)}</span>}
          {state.kind === 'ok' && (
            <button
              type="button"
              className={styles.headerBtn}
              aria-label="Новый класс"
              title="Новый класс"
              onClick={() => openStructureDialog({ kind: 'new-class', pkg: null })}
            >
              +
            </button>
          )}
        </span>
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
                              path={file.path}
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
      <StructureDialog />
    </section>
  );
}

function ClassItem({ cls, path, open, onToggle }: { cls: ClassNode; path: string; open: boolean; onToggle: () => void }) {
  const selection = useStructureStore((s) => s.selection);
  const mine = selection !== null && selection.ref.path === path && selection.ref.name === cls.name;
  const classSelected = mine && selection.kind === 'class';
  const ref = { path, name: cls.name };
  return (
    <li>
      <div className={`${styles.row} ${styles.depth1} ${styles.split} ${classSelected ? styles.selected : ''}`}>
        <button
          type="button"
          className={styles.caretBtn}
          aria-expanded={open}
          aria-label={`${open ? 'Свернуть' : 'Развернуть'} ${cls.name}`}
          onClick={onToggle}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className={styles.splitMain}
          aria-pressed={classSelected}
          title="Свойства класса"
          onClick={() => selectStructure({ kind: 'class', ref })}
        >
          <span>{cls.name}</span>
          {cls.kind !== 'class' && <span className={styles.kind}>{cls.kind}</span>}
          {hasIssues(cls) && <span className={styles.issueDot} aria-label="есть проблемы" />}
        </button>
      </div>
      {open && (
        <ul className={styles.list}>
          {cls.fields.map((f) => {
            const selected = mine && selection.kind === 'field' && selection.field === f.name;
            return (
              <li key={`f:${f.name}`}>
                <button
                  type="button"
                  className={`${styles.row} ${styles.depth2} ${styles.field} ${selected ? styles.selected : ''}`}
                  title={f.type}
                  aria-pressed={selected}
                  onClick={() => selectStructure({ kind: 'field', ref, field: f.name })}
                >
                  <span className={styles.letter}>f</span>
                  {f.name}
                </button>
              </li>
            );
          })}
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
