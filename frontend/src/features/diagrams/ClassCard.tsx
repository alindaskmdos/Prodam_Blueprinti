import { Handle, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { Fragment, type KeyboardEvent, type MouseEvent } from 'react';
import {
  cardMembers,
  hasMembers,
  KIND_ICON,
  nameScale,
  nameSegments,
  VISIBILITY_SIGN,
  visibilityOf,
  type CardLevel,
  type MemberRow,
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
  /** Подробность карточки: свёрнута (по умолчанию) / развёрнута / с private. */
  level: CardLevel;
  /** Класс выбран (общий выбор класса project-tree). */
  selected: boolean;
  /** Идёт «полёт» камеры к карточке перед переходом в редактор. */
  flying: boolean;
  /** Общий для диаграммы предел увеличения имени (`nameFit`): при отдалении имена всех карточек одного размера. */
  nameFit: number;
  onClassClick: (cls: UmlClass) => void;
  onMemberClick: (cls: UmlClass, member: UmlMember) => void;
  /** Сменить уровень подробности карточки (шеврон, «показать private»). */
  onLevel: (cls: UmlClass, level: CardLevel) => void;
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

/**
 * Карточка класса UML: значок kind, имя одной строкой и пакет. Шеврон разворачивает члены упрощённо —
 * поля `name`, методы `name()` (кликабельны → схема метода), private — по кнопке «показать».
 */
export function ClassCard({ data }: NodeProps<ClassCardNode>) {
  const { cls, state, level, selected, flying, nameFit, onClassClick, onMemberClick, onLevel } = data;
  const icon = KIND_ICON[cls.kind];
  const expandable = hasMembers(cls);
  const open = expandable && level !== 'compact';
  // Отдаление: имя крупнее (обратно масштабу, одинаково у всех карточек), переносы — по camelCase.
  const scale = useStore((s) => nameScale(s.transform[2], nameFit, open));
  const scaled = scale > 1;
  const className = [
    styles.card,
    STATE_CLASS[state] ?? '',
    selected ? styles.cardSelected : '',
    flying ? styles.cardFlying : '',
    scaled ? styles.cardScaled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stop = (e: MouseEvent) => e.stopPropagation();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClassClick(cls);
    }
  };

  return (
    <div
      className={className}
      data-testid="uml-class"
      data-class-id={cls.id}
      style={{ ['--kind' as string]: icon.color, ...(scaled ? { ['--name-scale' as string]: scale } : {}) }}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={styles.handle} isConnectable={false} />
      <div className={`${styles.cardHeader} ${open ? styles.cardHeaderOpen : ''}`}>
        <div
          className={`${styles.headMain} nodrag`}
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
            <span className={`${styles.className} ${cls.modifiers.includes('abstract') ? styles.isAbstract : ''}`}>
              {nameSegments(cls.name).map((seg, i) => (
                <Fragment key={i}>
                  {i > 0 && <wbr />}
                  {seg}
                </Fragment>
              ))}
              {cls.typeParams && <span className={styles.typeParams}>{cls.typeParams}</span>}
            </span>
            {cls.package && <span className={styles.packageName}>{cls.package}</span>}
          </span>
        </div>
        {expandable && (
          <button
            type="button"
            className={`${styles.chevron} nodrag nopan`}
            aria-expanded={open}
            aria-label={open ? `Свернуть ${cls.name}` : `Развернуть ${cls.name}`}
            title={open ? 'Свернуть' : 'Развернуть: поля и методы'}
            onClick={(e) => {
              stop(e);
              onLevel(cls, open ? 'compact' : 'expanded');
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M 3 4.5 L 6 7.5 L 9 4.5" />
            </svg>
          </button>
        )}
      </div>
      {open && !scaled && <CardBody cls={cls} level={level} onMemberClick={onMemberClick} onLevel={onLevel} />}
    </div>
  );
}

function CardBody({ cls, level, onMemberClick, onLevel }: Pick<ClassCardData, 'cls' | 'level' | 'onMemberClick' | 'onLevel'>) {
  const { fields, methods, privateCount } = cardMembers(cls, level);
  const text = (r: MemberRow) => (
    <>
      <Vis modifiers={r.modifiers} owner={cls.kind} />
      <span className={styles.rowText}>{r.label}</span>
    </>
  );
  return (
    <div className={`${styles.cardBody} nowheel`} data-testid="uml-members">
      {fields.map((r) => (
        <div key={r.key} className={rowClass(r.modifiers, styles.row)} title={r.title}>
          {text(r)}
        </div>
      ))}
      {fields.length > 0 && methods.length > 0 && <div className={styles.separator} aria-hidden="true" />}
      {methods.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`${rowClass(r.modifiers, styles.row)} ${styles.memberButton} nodrag nopan`}
          title={r.title}
          data-member-id={r.method?.id}
          onClick={(e) => {
            e.stopPropagation();
            if (r.method) onMemberClick(cls, r.method);
          }}
        >
          {text(r)}
        </button>
      ))}
      {privateCount > 0 && (
        <button
          type="button"
          className={`${styles.row} ${styles.privateToggle} nodrag nopan`}
          onClick={(e) => {
            e.stopPropagation();
            onLevel(cls, level === 'all' ? 'expanded' : 'all');
          }}
        >
          {level === 'all' ? `скрыть private (${privateCount})` : `ещё ${privateCount} private`}
        </button>
      )}
    </div>
  );
}
