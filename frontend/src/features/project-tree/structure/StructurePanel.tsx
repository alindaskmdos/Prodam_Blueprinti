import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Schemas } from '../../api';
import { useAppStore } from '../../../app/store';
import { getTreeClient, useTreeStore } from '../treeStore';
import { readClassHeader, readFieldDecl, readMethodHeader, simpleName } from './edits';
import { CLASS_KEYWORDS, type ClassKeyword } from './headers';
import { isJavaIdentifier, splitTopLevel } from './javaText';
import {
  CLASS_FLAGS,
  FIELD_FLAGS,
  METHOD_FLAGS,
  VISIBILITIES,
  flagsOf,
  joinModifiers,
  visibilityOf,
  type Visibility,
} from './modifiers';
import { saveClass, saveField, saveMethod } from './ops';
import { findClass, findMethod, type ClassRef, type FoundClass, type FoundMethod } from './resolve';
import { openStructureDialog, useStructureStore } from './structureStore';
import styles from './Structure.module.css';

type Tree = Schemas['ProjectTree'];
type FieldNode = Schemas['ClassNode']['fields'][number];

/**
 * Вкладка «Свойства» (ТЗ §7): форма выбранного в дереве класса/поля, иначе — выбранного метода/конструктора.
 * Форма пересоздаётся на каждую версию дерева — после сохранения показывает новые значения.
 */
export function StructurePanel() {
  const state = useTreeStore((s) => s.state);
  const selection = useStructureStore((s) => s.selection);
  const methodId = useAppStore((s) => s.selectedMethodId);

  if (state.kind !== 'ok') return <p className={styles.stub}>Загрузка дерева проекта…</p>;
  const tree = state.tree;
  if (selection) {
    const found = findClass(tree, selection.ref);
    if (!found) return <p className={styles.stub}>Класс не найден в дереве проекта</p>;
    if (selection.kind === 'class') {
      return <ClassForm key={`c:${found.path}:${found.cls.name}:${tree.version}`} found={found} tree={tree} />;
    }
    const field = found.cls.fields.find((f) => f.name === selection.field);
    if (!field) return <p className={styles.stub}>Поле не найдено в дереве проекта</p>;
    return (
      <FieldForm key={`f:${found.path}:${found.cls.name}:${field.name}:${tree.version}`} found={found} field={field} tree={tree} />
    );
  }
  if (methodId) {
    const found = findMethod(tree, methodId);
    if (!found) return <p className={styles.stub}>Метод не найден в дереве проекта</p>;
    return <MethodForm key={`m:${methodId}:${tree.version}`} found={found} tree={tree} />;
  }
  return <p className={styles.stub}>Выберите класс, поле или метод в дереве проекта — здесь откроется форма его свойств</p>;
}

// ---------- общее ----------

type FileTextState = { kind: 'loading' } | { kind: 'ok'; text: string } | { kind: 'error'; message: string };

/** Текст файла (GET files) той же версии, что дерево: проверить, что заголовок разбирается и нет комментариев. */
function useFileText(path: string, version: number): FileTextState {
  const projectId = useTreeStore((s) => s.projectId);
  const [state, setState] = useState<FileTextState>({ kind: 'loading' });
  useEffect(() => {
    const client = getTreeClient();
    if (!client || !projectId) return;
    let alive = true;
    client
      .GET('/projects/{projectId}/files', { params: { path: { projectId }, query: { path } } })
      .then(({ data, error, response }) => {
        if (!alive) return;
        if (data) setState({ kind: 'ok', text: data.text });
        else setState({ kind: 'error', message: error?.message ?? `HTTP ${response.status}` });
      })
      .catch((e: unknown) => alive && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [projectId, path, version]);
  return state;
}

/** Причина «только чтение» или предупреждение о комментариях по разбору текста. */
function useTextCheck<T extends { hasComments: boolean }>(
  path: string,
  tree: Tree,
  read: (text: string) => T | string,
): { readOnly: string | null; comments: boolean } {
  const file = useFileText(path, tree.version);
  return useMemo(() => {
    if (file.kind !== 'ok') return { readOnly: null, comments: false };
    const parsed = read(file.text);
    return typeof parsed === 'string' ? { readOnly: parsed, comments: false } : { readOnly: null, comments: parsed.hasComments };
    // read зависит только от узла дерева, а он меняется вместе с tree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, tree]);
}

const NO_BOUNDS = 'Бэк не прислал границы заголовка (headerStart/headerEnd) — форма только для чтения';

function Warnings({ readOnly, comments }: { readOnly: string | null; comments: boolean }) {
  return (
    <>
      {readOnly && (
        <div className={styles.warn} role="status">
          {readOnly}
        </div>
      )}
      {!readOnly && comments && (
        <div className={styles.warn} role="status">
          В заголовке есть комментарии — при сохранении формы они пропадут.
        </div>
      )}
    </>
  );
}

function VisibilityChips({ value, onChange, disabled }: { value: Visibility; onChange: (v: Visibility) => void; disabled: boolean }) {
  return (
    <fieldset className={styles.fld} disabled={disabled}>
      <legend>Видимость</legend>
      <div className={styles.chips}>
        {VISIBILITIES.map((v) => (
          <label key={v || 'package'} className={styles.ck}>
            <input type="radio" checked={value === v} onChange={() => onChange(v)} />
            {v || 'пакет'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function FlagChips({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  const extra = value.filter((f) => !options.includes(f));
  return (
    <fieldset className={styles.fld} disabled={disabled}>
      <legend>Модификаторы</legend>
      <div className={styles.chips}>
        {[...options, ...extra].map((f) => (
          <label key={f} className={styles.ck}>
            <input
              type="checkbox"
              checked={value.includes(f)}
              onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))}
            />
            {f}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  bad,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  bad?: boolean;
  placeholder?: string;
}) {
  return (
    <label className={styles.fld}>
      {label}
      <input
        className={bad ? `${styles.inp} ${styles.inpBad}` : styles.inp}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
        aria-invalid={bad || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Annotations({ list }: { list: string[] | undefined }) {
  if (!list || list.length === 0) return null;
  return (
    <div className={styles.note}>
      Аннотации (сохраняются как есть): <span className={styles.mono}>{list.join(' ')}</span>
    </div>
  );
}

/** Сохранить / Отменить + ошибка записи (422 — со строкой). */
function SaveBar({ dirty, problem, readOnly, onReset }: { dirty: boolean; problem: string | null; readOnly: boolean; onReset: () => void }) {
  const saving = useStructureStore((s) => s.saving);
  const error = useStructureStore((s) => s.error);
  const dialogOpen = useStructureStore((s) => s.dialog !== null);
  return (
    <>
      {dirty && problem && <div className={styles.note}>{problem}</div>}
      {error && !dialogOpen && (
        <div className={styles.error} role="alert">
          {error.line !== undefined ? `Строка ${error.line}: ` : ''}
          {error.message}
        </div>
      )}
      {!readOnly && (
        <div className={styles.btnRow}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!dirty || problem !== null || saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button type="button" className={styles.btn} disabled={!dirty || saving} onClick={onReset}>
            Отменить
          </button>
        </div>
      )}
    </>
  );
}

function FormShell({
  icon,
  iconClass,
  title,
  subtitle,
  onSubmit,
  children,
}: {
  icon: string;
  iconClass?: string;
  title: string;
  subtitle: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className={styles.panel} onSubmit={submit} aria-label={title}>
      <div className={styles.title}>
        <span className={`${styles.icon} ${iconClass ?? ''}`}>{icon}</span>
        <span>{title}</span>
      </div>
      <div className={styles.subtitle}>{subtitle}</div>
      {children}
    </form>
  );
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const splitList = (s: string) => splitTopLevel(s);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function nameProblem(name: string, what: string): string | null {
  if (!name.trim()) return `Укажите ${what}`;
  return isJavaIdentifier(name.trim()) ? null : `«${name.trim()}» — недопустимое имя Java`;
}

// ---------- класс ----------

interface ClassValues {
  name: string;
  kind: ClassKeyword;
  visibility: Visibility;
  flags: string[];
  typeParams: string;
  extends: string;
  implements: string;
}

function ClassForm({ found, tree }: { found: FoundClass; tree: Tree }) {
  const { cls, path } = found;
  const ref: ClassRef = { path, name: cls.name };
  const check = useTextCheck(path, tree, (text) => readClassHeader(text, cls));
  const readOnly = !cls.headerStart || !cls.headerEnd ? NO_BOUNDS : check.readOnly;
  const initial: ClassValues = {
    name: simpleName(cls.name),
    kind: cls.kind,
    visibility: visibilityOf(cls.modifiers),
    flags: flagsOf(cls.modifiers),
    typeParams: cls.typeParams ?? '',
    extends: cls.extends ?? '',
    implements: (cls.implements ?? []).join(', '),
  };
  const [v, setV] = useState(initial);
  const set = (patch: Partial<ClassValues>) => setV((prev) => ({ ...prev, ...patch }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const problem = nameProblem(v.name, 'имя класса');
  const ro = readOnly !== null;
  const canExtend = v.kind === 'class' || v.kind === 'interface';
  const canImplement = v.kind !== 'interface';
  const canCtor = cls.kind === 'class' || cls.kind === 'enum';

  const submit = () => {
    if (ro || problem) return;
    void saveClass(ref, {
      modifiers: joinModifiers(v.visibility, v.flags),
      keyword: v.kind,
      name: v.name,
      typeParams: v.typeParams,
      extends: canExtend ? v.extends : '',
      implements: canImplement ? splitList(v.implements) : [],
    });
  };

  const sub = [cls.modifiers?.join(' '), cls.kind, cls.implements?.length ? `implements ${cls.implements.join(', ')}` : '', fileName(path)]
    .filter(Boolean)
    .join(' · ');

  return (
    <FormShell icon={cls.kind[0]?.toUpperCase() ?? 'C'} iconClass={styles.iconClass} title={`Свойства класса ${simpleName(cls.name)}`} subtitle={sub} onSubmit={submit}>
      <Warnings readOnly={readOnly} comments={check.comments} />
      <TextField label="Имя" value={v.name} onChange={(name) => set({ name })} disabled={ro} bad={dirty && problem !== null} />
      <label className={styles.fld}>
        Вид
        <select className={styles.inp} value={v.kind} disabled={ro} onChange={(e) => set({ kind: e.target.value as ClassKeyword })}>
          {CLASS_KEYWORDS.map((k) => (
            <option key={k} value={k} disabled={(k === 'record') !== (cls.kind === 'record')}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {v.kind !== cls.kind && <div className={styles.note}>Меняется только ключевое слово — тело класса не переписывается.</div>}
      <VisibilityChips value={v.visibility} onChange={(visibility) => set({ visibility })} disabled={ro} />
      <FlagChips options={CLASS_FLAGS} value={v.flags} onChange={(flags) => set({ flags })} disabled={ro} />
      <TextField label="Параметры типа" value={v.typeParams} onChange={(typeParams) => set({ typeParams })} disabled={ro} placeholder="<T>" />
      {canExtend && <TextField label="extends" value={v.extends} onChange={(e) => set({ extends: e })} disabled={ro} />}
      {canImplement && (
        <TextField label="implements" value={v.implements} onChange={(i) => set({ implements: i })} disabled={ro} placeholder="Runnable, Comparable<T>" />
      )}
      <Annotations list={cls.annotations} />
      {dirty && v.name.trim() !== initial.name && (
        <div className={styles.note}>
          Переименование меняет только объявление. Имя файла, конструкторы и использования в других файлах не обновляются — это
          рефакторинг, он появится позже.
        </div>
      )}
      <SaveBar dirty={dirty} problem={problem} readOnly={ro} onReset={() => setV(initial)} />
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} disabled={!cls.headerEnd} onClick={() => openStructureDialog({ kind: 'new-member', member: 'field', ref })}>
          + Поле
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!cls.headerEnd || !canCtor}
          title={canCtor ? undefined : `У ${cls.kind} конструктор без параметров не добавляется`}
          onClick={() => openStructureDialog({ kind: 'new-member', member: 'constructor', ref })}
        >
          + Конструктор
        </button>
        <button type="button" className={styles.btn} disabled={!cls.headerEnd} onClick={() => openStructureDialog({ kind: 'new-member', member: 'method', ref })}>
          + Метод
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={!cls.headerStart || !cls.headerEnd}
          onClick={() => openStructureDialog({ kind: 'delete', target: { kind: 'class', ref } })}
        >
          Удалить класс
        </button>
      </div>
    </FormShell>
  );
}

// ---------- поле ----------

interface FieldValues {
  type: string;
  name: string;
  visibility: Visibility;
  flags: string[];
}

function FieldForm({ found, field, tree }: { found: FoundClass; field: FieldNode; tree: Tree }) {
  const { cls, path } = found;
  const ref: ClassRef = { path, name: cls.name };
  const check = useTextCheck(path, tree, (text) => readFieldDecl(text, cls, field));
  const shared = field.span && cls.fields.some((f) => f !== field && f.span?.startLine === field.span?.startLine && f.span?.endLine === field.span?.endLine);
  const readOnly = !field.span
    ? 'Бэк не прислал span поля — форма только для чтения'
    : shared
      ? 'Поле объявлено вместе с другими (`int a, b;`) — только чтение'
      : check.readOnly;
  const initial: FieldValues = {
    type: field.type,
    name: field.name,
    visibility: visibilityOf(field.modifiers),
    flags: flagsOf(field.modifiers),
  };
  const [v, setV] = useState(initial);
  const set = (patch: Partial<FieldValues>) => setV((prev) => ({ ...prev, ...patch }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const problem = !v.type.trim() ? 'Укажите тип' : nameProblem(v.name, 'имя поля');
  const ro = readOnly !== null;

  const submit = () => {
    if (ro || problem) return;
    void saveField(ref, field.name, { modifiers: joinModifiers(v.visibility, v.flags), type: v.type, name: v.name });
  };

  return (
    <FormShell
      icon="f"
      iconClass={styles.iconField}
      title={`Свойства поля ${field.name}`}
      subtitle={`${simpleName(cls.name)} · ${fileName(path)}${field.span ? `:${field.span.startLine}` : ''}`}
      onSubmit={submit}
    >
      <Warnings readOnly={readOnly} comments={check.comments} />
      <TextField label="Тип" value={v.type} onChange={(type) => set({ type })} disabled={ro} bad={dirty && !v.type.trim()} />
      <TextField label="Имя" value={v.name} onChange={(name) => set({ name })} disabled={ro} bad={dirty && nameProblem(v.name, '') !== null} />
      <VisibilityChips value={v.visibility} onChange={(visibility) => set({ visibility })} disabled={ro} />
      <FlagChips options={FIELD_FLAGS} value={v.flags} onChange={(flags) => set({ flags })} disabled={ro} />
      <div className={styles.note}>Инициализатор и аннотации не меняются формой — правьте их в коде.</div>
      <SaveBar dirty={dirty} problem={problem} readOnly={ro} onReset={() => setV(initial)} />
      <div className={styles.btnRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={!field.span || Boolean(shared)}
          onClick={() => openStructureDialog({ kind: 'delete', target: { kind: 'field', ref, field: field.name } })}
        >
          Удалить поле
        </button>
      </div>
    </FormShell>
  );
}

// ---------- метод / конструктор ----------

interface ParamRow {
  key: number;
  type: string;
  name: string;
}

interface MethodValues {
  name: string;
  returnType: string;
  typeParams: string;
  visibility: Visibility;
  flags: string[];
  params: ParamRow[];
  throws: string;
}

let paramKey = 0;

function MethodForm({ found, tree }: { found: FoundMethod; tree: Tree }) {
  const { cls, path, method, isConstructor } = found;
  const ref: ClassRef = { path, name: cls.name };
  const check = useTextCheck(path, tree, (text) => readMethodHeader(text, method));
  const readOnly = !method.headerStart || !method.headerEnd ? NO_BOUNDS : check.readOnly;
  const initial = useMemo<MethodValues>(
    () => ({
      name: method.name,
      returnType: method.returnType ?? '',
      typeParams: method.typeParams ?? '',
      visibility: visibilityOf(method.modifiers),
      flags: flagsOf(method.modifiers),
      params: (method.params ?? []).map((p) => ({ key: ++paramKey, type: p.type, name: p.name })),
      throws: (method.throws ?? []).join(', '),
    }),
    [method],
  );
  const [v, setV] = useState(initial);
  const set = (patch: Partial<MethodValues>) => setV((prev) => ({ ...prev, ...patch }));
  const strip = (x: MethodValues) => ({ ...x, params: x.params.map((p) => [p.type, p.name]) });
  const dirty = JSON.stringify(strip(v)) !== JSON.stringify(strip(initial));
  const ro = readOnly !== null;
  const kindWord = isConstructor ? 'конструктора' : 'метода';

  const problem = useMemo(() => {
    if (!isConstructor) {
      const n = nameProblem(v.name, 'имя метода');
      if (n) return n;
      if (!v.returnType.trim()) return 'Укажите тип результата (void — если нет)';
    }
    const names = new Set<string>();
    for (const [i, p] of v.params.entries()) {
      if (!p.type.trim()) return `Параметр ${i + 1}: укажите тип`;
      const n = nameProblem(p.name, `имя параметра ${i + 1}`);
      if (n) return n;
      if (names.has(p.name.trim())) return `Параметр «${p.name.trim()}» повторяется`;
      names.add(p.name.trim());
    }
    return null;
  }, [v, isConstructor]);

  const setParam = (i: number, patch: Partial<ParamRow>) =>
    set({ params: v.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...v.params];
    const [row] = next.splice(i, 1);
    if (row) next.splice(i + d, 0, row);
    set({ params: next });
  };

  const submit = () => {
    if (ro || problem) return;
    void saveMethod(ref, method.id, {
      modifiers: joinModifiers(v.visibility, isConstructor ? [] : v.flags),
      typeParams: v.typeParams,
      returnType: v.returnType,
      name: isConstructor ? method.name : v.name,
      params: v.params.map((p) => ({ type: p.type, name: p.name })),
      throws: splitList(v.throws),
    });
  };

  const subtitle = `${simpleName(cls.name)} · ${fileName(path)}${method.span ? `:${method.span.startLine}` : ''}`;
  const unchanged = !sameList(
    v.params.map((p) => p.name),
    initial.params.map((p) => p.name),
  );

  return (
    <FormShell icon={isConstructor ? 'c' : 'm'} title={`Свойства ${kindWord} ${method.name}`} subtitle={subtitle} onSubmit={submit}>
      <Warnings readOnly={readOnly} comments={check.comments} />
      <TextField
        label="Имя"
        value={v.name}
        onChange={(name) => set({ name })}
        disabled={ro || isConstructor}
        bad={dirty && !isConstructor && nameProblem(v.name, '') !== null}
      />
      {!isConstructor && (
        <TextField label="Возвращает" value={v.returnType} onChange={(returnType) => set({ returnType })} disabled={ro} bad={dirty && !v.returnType.trim()} />
      )}
      <TextField label="Параметры типа" value={v.typeParams} onChange={(typeParams) => set({ typeParams })} disabled={ro} placeholder="<T>" />
      <VisibilityChips value={v.visibility} onChange={(visibility) => set({ visibility })} disabled={ro} />
      {!isConstructor && <FlagChips options={METHOD_FLAGS} value={v.flags} onChange={(flags) => set({ flags })} disabled={ro} />}
      <fieldset className={styles.fld} disabled={ro}>
        <legend>Параметры</legend>
        {v.params.map((p, i) => (
          <div key={p.key} className={styles.param}>
            <input
              className={styles.inp}
              aria-label={`Тип параметра ${i + 1}`}
              value={p.type}
              spellCheck={false}
              onChange={(e) => setParam(i, { type: e.target.value })}
            />
            <input
              className={styles.inp}
              aria-label={`Имя параметра ${i + 1}`}
              value={p.name}
              spellCheck={false}
              onChange={(e) => setParam(i, { name: e.target.value })}
            />
            <button type="button" className={`${styles.btn} ${styles.ib}`} aria-label={`Параметр ${i + 1} выше`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.ib}`}
              aria-label={`Параметр ${i + 1} ниже`}
              disabled={i === v.params.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.ib}`}
              aria-label={`Удалить параметр ${i + 1}`}
              onClick={() => set({ params: v.params.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className={styles.btn}
            onClick={() => set({ params: [...v.params, { key: ++paramKey, type: '', name: '' }] })}
          >
            + параметр
          </button>
        </div>
      </fieldset>
      <TextField label="throws" value={v.throws} onChange={(throws) => set({ throws })} disabled={ro} placeholder="IOException" />
      <Annotations list={method.annotations} />
      {dirty && (v.name !== initial.name || unchanged) && (
        <div className={styles.note}>
          Меняется только объявление. Вызовы в других файлах обновит рефакторинг — он появится позже.
        </div>
      )}
      <SaveBar dirty={dirty} problem={problem} readOnly={ro} onReset={() => setV(initial)} />
      <div className={styles.btnRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={!method.headerStart || !method.headerEnd}
          onClick={() => openStructureDialog({ kind: 'delete', target: { kind: 'method', ref, methodId: method.id } })}
        >
          Удалить {isConstructor ? 'конструктор' : 'метод'}
        </button>
      </div>
    </FormShell>
  );
}
