import type { EntryGroup, PaletteEntry } from './entries';

/**
 * Баллы совпадения: чем больше, тем выше пункт. Подпоследовательности букв (нечёткий поиск cmdk)
 * не засчитываются вовсе: «fullReport» не должен находить OrderService.find.
 */
export const SCORE = {
  exact: 100,
  /** Префикс имени члена/класса: «full» → fullReport. */
  prefix: 80,
  /** Префикс полного «Класс.член»: «report» → ReportService.find. */
  qualifiedPrefix: 75,
  nameSubstring: 60,
  /** Запрос — начальные буквы слов имени члена/класса (не «Класс.член»): «fR» → fullReport. Слабее подстроки. */
  initials: 55,
  descriptionSubstring: 30,
} as const;

/** Навигация выигрывает у действий при равном score; порядок — и порядок групп при равенстве. */
const NAV_ORDER: readonly EntryGroup[] = ['Методы', 'Классы', 'Поля', 'Ноды', 'Проблемы', 'Команды', 'Исправления'];
const isNavigation = (g: EntryGroup) => g !== 'Команды' && g !== 'Исправления';

/** Слова имени: границы camelCase и небуквенных символов. */
function words(name: string): string[] {
  return name
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function scoreName(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return SCORE.exact;
  // Имя с точкой — «Класс.член»: префикс слабее префикса самого имени члена (оно идёт в names отдельно).
  const qualified = n.includes('.');
  if (n.startsWith(q)) return qualified ? SCORE.qualifiedPrefix : SCORE.prefix;
  if (n.includes(q)) return SCORE.nameSubstring;
  if (!qualified && q.length >= 2) {
    const initials = words(name)
      .map((w) => w[0])
      .join('')
      .toLowerCase();
    if (initials.startsWith(q)) return SCORE.initials;
  }
  return 0;
}

/** Score одного слова запроса по пункту; 0 — не подходит. */
function scoreToken(entry: PaletteEntry, q: string): number {
  let best = 0;
  for (const name of entry.names) best = Math.max(best, scoreName(name, q));
  if (best > 0) return best;
  const description = [entry.title, entry.hint ?? '', ...entry.keywords];
  return description.some((d) => d.toLowerCase().includes(q)) ? SCORE.descriptionSubstring : 0;
}

/** Score пункта: все слова запроса должны совпасть, итог — худшее из них. 0 — пункт не показывается. */
export function scoreEntry(entry: PaletteEntry, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  let total = Infinity;
  for (const t of tokens) {
    const s = scoreToken(entry, t);
    if (s === 0) return 0;
    total = Math.min(total, s);
  }
  return total;
}

export interface SearchGroup {
  group: EntryGroup;
  entries: PaletteEntry[];
}

/**
 * Поиск по пунктам: пункты внутри группы по убыванию score, группы — по лучшему score; при равенстве
 * навигация выше действий, поэтому «Исправления» не бывают первыми, если есть не худшее навигационное совпадение.
 */
export function searchEntries(entries: readonly PaletteEntry[], query: string): SearchGroup[] {
  const byGroup = new Map<EntryGroup, { entry: PaletteEntry; score: number; index: number }[]>();
  entries.forEach((entry, index) => {
    const score = scoreEntry(entry, query);
    if (score === 0) return;
    const list = byGroup.get(entry.group) ?? [];
    list.push({ entry, score, index });
    byGroup.set(entry.group, list);
  });
  const groups = [...byGroup.entries()].map(([group, list]) => {
    list.sort((a, b) => b.score - a.score || a.index - b.index);
    return { group, best: list[0]?.score ?? 0, entries: list.map((x) => x.entry) };
  });
  groups.sort(
    (a, b) =>
      b.best - a.best ||
      Number(isNavigation(b.group)) - Number(isNavigation(a.group)) ||
      NAV_ORDER.indexOf(a.group) - NAV_ORDER.indexOf(b.group),
  );
  return groups.map(({ group, entries: es }) => ({ group, entries: es }));
}
