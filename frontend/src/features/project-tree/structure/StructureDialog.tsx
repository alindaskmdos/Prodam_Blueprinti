import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTreeStore } from '../treeStore';
import { simpleName, type MemberKind } from './edits';
import { CLASS_KEYWORDS, type ClassKeyword } from './headers';
import { isJavaIdentifier } from './javaText';
import { createClass, createMember, deleteDeclaration } from './ops';
import { findClass, findMethod, firstFileOf } from './resolve';
import { closeStructureDialog, useStructureStore, type DeleteTarget, type StructureDialog as Dialog } from './structureStore';
import { TypeInput } from './TypeInput';
import styles from './Structure.module.css';

/** Диалоги «Новый класс / поле / конструктор / метод» и подтверждение удаления; открыт, пока `dialog` не null. */
export function StructureDialog() {
  const dialog = useStructureStore((s) => s.dialog);
  const saving = useStructureStore((s) => s.saving);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeStructureDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  if (!dialog) return null;
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && !saving && closeStructureDialog()}>
      <DialogBody key={JSON.stringify(dialog)} dialog={dialog} />
    </div>
  );
}

const MEMBER_TITLE: Record<MemberKind, string> = { field: 'Новое поле', constructor: 'Новый конструктор', method: 'Новый метод' };

function DialogBody({ dialog }: { dialog: Dialog }) {
  const tree = useTreeStore((s) => (s.state.kind === 'ok' ? s.state.tree : null));
  const saving = useStructureStore((s) => s.saving);
  const error = useStructureStore((s) => s.error);
  const [name, setName] = useState('');
  const [type, setType] = useState(dialog.kind === 'new-member' && dialog.member === 'method' ? 'void' : '');
  const [kind, setKind] = useState<ClassKeyword>('class');
  const packages = tree?.packages.map((p) => p.name) ?? [];
  const [pkg, setPkg] = useState(dialog.kind === 'new-class' ? (dialog.pkg ?? packages[0] ?? '') : '');

  if (!tree) return null;

  let title: string;
  let body: ReactNode = null;
  let problem: string | null = null;
  let submitText = 'Создать';
  let run: () => Promise<boolean>;

  if (dialog.kind === 'delete') {
    const what = describeDelete(tree, dialog.target);
    title = `Удалить ${what.label}?`;
    submitText = 'Удалить';
    body = (
      <p className={styles.note}>
        Объявление <span className={styles.mono}>{what.name}</span> (с аннотациями и javadoc) будет вырезано из{' '}
        <span className={styles.mono}>{fileName(dialog.target.ref.path)}</span>. Использования в других местах не меняются.
      </p>
    );
    run = () => deleteDeclaration(dialog.target);
  } else if (dialog.kind === 'new-member') {
    const cls = findClass(tree, dialog.ref)?.cls;
    const member = dialog.member;
    title = `${MEMBER_TITLE[member]} в ${cls ? simpleName(cls.name) : '?'}`;
    if (member === 'constructor') {
      body = (
        <p className={styles.note}>
          Конструктор без параметров с пустым телом. Параметры добавьте в форме свойств после создания.
        </p>
      );
    } else {
      problem =
        !type.trim() ? (member === 'field' ? 'Укажите тип' : 'Укажите тип результата') : !isJavaIdentifier(name.trim()) ? 'Укажите допустимое имя Java' : null;
      if (cls && member === 'field' && cls.fields.some((f) => f.name === name.trim())) problem = `Поле «${name.trim()}» уже есть`;
      body = (
        <>
          <label className={styles.fld}>
            {member === 'field' ? 'Тип' : 'Возвращает'}
            <TypeInput value={type} onChange={setType} withVoid={member !== 'field'} />
          </label>
          <label className={styles.fld}>
            Имя
            <input className={styles.inp} value={name} spellCheck={false} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <p className={styles.note}>
            {member === 'field'
              ? 'Поле вставится после последнего поля класса.'
              : 'Метод вставится в конец класса; тело — return значения по умолчанию для типа, чтобы код компилировался.'}
          </p>
        </>
      );
    }
    run = () => createMember(dialog.ref, member, type, name);
  } else {
    title = 'Новый класс';
    const path = targetFile(tree, pkg);
    const exists = tree.packages.find((p) => p.name === pkg)?.files.some((f) => f.classes.some((c) => c.name === name.trim()));
    problem = !path
      ? 'В пакете нет файлов'
      : !isJavaIdentifier(name.trim())
        ? 'Укажите допустимое имя Java'
        : exists
          ? `Класс «${name.trim()}» уже есть в пакете`
          : null;
    body = (
      <>
        <label className={styles.fld}>
          Пакет
          <select className={styles.inp} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            {packages.map((p) => (
              <option key={p} value={p}>
                {p || '(пакет по умолчанию)'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.fld}>
          Вид
          <select className={styles.inp} value={kind} onChange={(e) => setKind(e.target.value as ClassKeyword)}>
            {CLASS_KEYWORDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.fld}>
          Имя
          <input className={styles.inp} value={name} spellCheck={false} autoFocus onChange={(e) => setName(e.target.value)} />
        </label>
        {path && (
          <p className={styles.note}>
            Класс добавится непубличным в конец файла <span className={styles.mono}>{fileName(path)}</span>: создать отдельный
            файл существующий API (PUT files) не позволяет.
          </p>
        )}
      </>
    );
    run = () => (path ? createClass(path, kind, name) : Promise.resolve(false));
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saving || problem) return;
    void run().then((ok) => {
      if (ok) closeStructureDialog();
    });
  };

  return (
    <form role="dialog" aria-modal="true" aria-label={title} className={styles.dialog} onSubmit={submit}>
      <div className={styles.dialogTitle}>{title}</div>
      {body}
      {error && (
        <div className={styles.error} role="alert">
          {error.line !== undefined ? `Строка ${error.line}: ` : ''}
          {error.message}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={closeStructureDialog} disabled={saving}>
          Отмена
        </button>
        <button
          type="submit"
          className={`${styles.btn} ${dialog.kind === 'delete' ? styles.btnDanger : styles.btnPrimary}`}
          disabled={saving || problem !== null}
          title={problem ?? undefined}
        >
          {saving ? 'Сохранение…' : submitText}
        </button>
      </div>
    </form>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Файл для нового класса: файл выбранного класса, если он в этом пакете, иначе первый файл пакета. */
function targetFile(tree: Parameters<typeof firstFileOf>[0], pkg: string): string | null {
  const sel = useStructureStore.getState().selection;
  if (sel && tree.packages.find((p) => p.name === pkg)?.files.some((f) => f.path === sel.ref.path)) return sel.ref.path;
  return firstFileOf(tree, pkg);
}

function describeDelete(tree: Parameters<typeof firstFileOf>[0], target: DeleteTarget): { label: string; name: string } {
  if (target.kind === 'class') return { label: 'класс', name: simpleName(target.ref.name) };
  if (target.kind === 'field') return { label: 'поле', name: target.field };
  const found = findMethod(tree, target.methodId);
  return { label: found?.isConstructor ? 'конструктор' : 'метод', name: found?.method.signature ?? target.methodId };
}
