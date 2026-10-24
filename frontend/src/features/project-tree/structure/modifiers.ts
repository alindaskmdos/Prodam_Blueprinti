/** Модификаторы в формах: видимость (одна) + флаги; порядок при сборке — канонический для Java. */

export const VISIBILITIES = ['public', 'protected', 'private', ''] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const ORDER = [
  'public',
  'protected',
  'private',
  'abstract',
  'default',
  'static',
  'final',
  'sealed',
  'non-sealed',
  'transient',
  'volatile',
  'synchronized',
  'native',
  'strictfp',
];

export const CLASS_FLAGS = ['abstract', 'static', 'final', 'sealed', 'non-sealed', 'strictfp'];
export const FIELD_FLAGS = ['static', 'final', 'transient', 'volatile'];
export const METHOD_FLAGS = ['abstract', 'default', 'static', 'final', 'synchronized', 'native', 'strictfp'];

export function visibilityOf(modifiers: readonly string[] | undefined): Visibility {
  return VISIBILITIES.find((v) => v !== '' && modifiers?.includes(v)) ?? '';
}

/** Флаги без видимости. */
export function flagsOf(modifiers: readonly string[] | undefined): string[] {
  return (modifiers ?? []).filter((m) => !VISIBILITIES.includes(m as Visibility));
}

/** Видимость + флаги в каноническом порядке (неизвестные — в конце, как были). */
export function joinModifiers(visibility: Visibility, flags: readonly string[]): string[] {
  const all = [...(visibility ? [visibility] : []), ...flags];
  const rank = (m: string) => {
    const i = ORDER.indexOf(m);
    return i === -1 ? ORDER.length : i;
  };
  return [...new Set(all)].sort((a, b) => rank(a) - rank(b));
}
