import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { KeyboardEvent, MouseEvent } from 'react';
import {
  cardSections,
  fieldText,
  KIND_ICON,
  memberText,
  stereotypeOf,
  VISIBILITY_SIGN,
  visibilityOf,
  type UmlClass,
  type UmlMember,
  type Visibility,
} from './umlGraph';
import styles from './Diagrams.module.css';

/** Состояние карточки на диаграмме. */
export type CardState = 'normal' | 'dim' | 'active' | 'match';

export interface ClassCardData extends Record<string, unknown> {
  cls: UmlClass;
  state: CardState;
  /** Класс выбран (общий выбор класса project-tree). */
  selected: boolean;
  /** Идёт «полёт» камеры к карточке перед переходом в редактор. */
  flying: boolean;
  onClassClick: (cls: UmlClass) => void;
  onMemberClick: (cls: UmlClass, member: UmlMember) => void;
}

export type ClassCardNode = Node<ClassCardData, 'umlClass'>;

const VIS_CLASS: Record<Visibility, string | undefined> = {
  public: styles.visPublic,
  private: styles.visPrivate,
  protected: styles.visProtected,
  package: styles.visPackage,
};

const VIS_TITLE: Record<Visibility, string> = {
  public: 'public',
  private: 'private',
  protected: 'protected',
  package: 'package-private',
};

function Vis({ modifiers, owner }: { modifiers: readonly string[]; owner: UmlClass['kind'] }) {
  const v = visibilityOf(modifiers, owner);
  return (
    <span className={`${styles.vis} ${VIS_CLASS[v] ?? ''}`} title={VIS_TITLE[v]} aria-label={VIS_TITLE[v]}>
      {VISIBILITY_SIGN[v]}
    </span>
  );
}

function rowClass(modifiers: readonly string[], base: string | undefined): string {
  return [base, modifiers.includes('static') ? styles.isStatic : '', modifiers.includes('abstract') ? styles.isAbstract : '']
    .filter(Boolean)
    .join(' ');
}

const STATE_CLASS: Record<CardState, string | undefined> = {
  normal: undefined,
  dim: styles.cardDim,
  active: styles.cardActive,
  match: styles.cardMatch,
};

/** Карточка класса UML в стиле приложения: стереотип, имя, поля, конструкторы, методы (кликабельны). */
export function ClassCard({ data }: NodeProps<ClassCardNode>) {
  const { cls, state, selected, flying, onClassClick, onMemberClick } = data;
  const icon = KIND_ICON[cls.kind];
  const stereotype = stereotypeOf(cls);
  const sections = cardSections(cls);
  const className = [
    styles.card,
    STATE_CLASS[state] ?? '',
    selected ? styles.cardSelected : '',
    flying ? styles.cardFlying : '',
  ]
    .filter(Boolean)
    .join(' ');

  const member = (m: UmlMember) => (e: MouseEvent) => {
    e.stopPropagation();
    onMemberClick(cls, m);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClassClick(cls);
    }
  };

  return (
    <div className={className} data-testid="uml-class" data-class-id={cls.id} style={{ ['--kind' as string]: icon.color }}>
      <Handle type="target" position={Position.Top} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} isConnectable={false} />
      <div
        className={`${styles.cardHeader} nodrag`}
        role="button"
        tabIndex={0}
        title={`${cls.id} — открыть в редакторе`}
        onClick={() => onClassClick(cls)}
        onKeyDown={onKey}
      >
        <span className={styles.kindIcon} aria-label={cls.kind}>
          {icon.letter}
        </span>
        <span className={styles.headText}>
          {stereotype && <span className={styles.stereotype}>{stereotype}</span>}
          <span className={styles.className}>
            {cls.name}
            {cls.typeParams && <span className={styles.typeParams}>{cls.typeParams}</span>}
          </span>
        </span>
      </div>
      {sections.map((s) => (
        <div key={s.key} className={styles.section}>
          <div className={styles.sectionTitle}>{s.title}</div>
          {s.key === 'fields' &&
            cls.fields.map((f) => (
              <div key={f.name} className={rowClass(f.modifiers, styles.row)} title={`${f.modifiers.join(' ')} ${f.type} ${f.name}`.trim()}>
                <Vis modifiers={f.modifiers} owner={cls.kind} />
                <span className={styles.rowText}>{fieldText(f)}</span>
              </div>
            ))}
          {(s.key === 'constructors' ? cls.constructors : s.key === 'methods' ? cls.methods : []).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`${rowClass(m.modifiers, styles.row)} ${styles.memberButton} nodrag nopan`}
              title={`${m.signature} — открыть схему`}
              data-member-id={m.id}
              onClick={member(m)}
            >
              <Vis modifiers={m.modifiers} owner={cls.kind} />
              <span className={styles.rowText}>{memberText(m.signature)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
