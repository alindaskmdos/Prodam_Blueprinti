import { useId, useMemo } from 'react';
import { useTreeStore } from '../treeStore';
import styles from './Structure.module.css';

const PRIMITIVES = ['int', 'long', 'double', 'boolean', 'char', 'byte', 'short', 'float'];
const JDK = [
  'String',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'Byte',
  'Short',
  'Object',
  'Number',
  'BigDecimal',
  'BigInteger',
  'LocalDate',
  'LocalDateTime',
  'Instant',
  'UUID',
  'List<>',
  'ArrayList<>',
  'Map<,>',
  'HashMap<,>',
  'LinkedHashMap<,>',
  'Set<>',
  'HashSet<>',
  'LinkedHashSet<>',
  'Optional<>',
  'Collection<>',
  'Iterable<>',
  'Deque<>',
  'Queue<>',
  'Runnable',
  'Comparable<>',
];

/**
 * Подсказки типа: примитивы, частые JDK-типы, классы проекта (из дерева). `void` — только для типа результата.
 * Своё значение вводится как раньше — datalist лишь подсказывает.
 */
function typeSuggestions(projectClasses: readonly string[], withVoid = false): string[] {
  return [...new Set([...PRIMITIVES, ...(withVoid ? ['void'] : []), ...JDK, ...projectClasses])];
}

/** Имена классов проекта: вложенный `Outer$Inner` → `Outer.Inner`. */
function useProjectClasses(): string[] {
  const state = useTreeStore((s) => s.state);
  return useMemo(
    () =>
      state.kind === 'ok'
        ? state.tree.packages.flatMap((p) => p.files.flatMap((f) => f.classes.map((c) => c.name.replace(/\$/g, '.'))))
        : [],
    [state],
  );
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  bad?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Тип результата метода: добавляет `void`. */
  withVoid?: boolean;
  /** Список через запятую (implements): подсказки подставляются после последней запятой. */
  list?: boolean;
}

/** Нативный `<input list>` + `<datalist>` для ввода типа (поле, результат, параметр, компонент record, extends, implements). */
export function TypeInput({ value, onChange, disabled, bad, placeholder, ariaLabel, autoFocus, withVoid, list }: Props) {
  const id = useId();
  const classes = useProjectClasses();
  const options = useMemo(() => {
    const all = typeSuggestions(classes, withVoid);
    if (!list) return all;
    const cut = value.lastIndexOf(',') + 1;
    const head = value.slice(0, cut) + (cut > 0 ? ' ' : '');
    return all.map((o) => head + o);
  }, [classes, withVoid, list, value]);
  return (
    <>
      <input
        className={bad ? `${styles.inp} ${styles.inpBad}` : styles.inp}
        list={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
