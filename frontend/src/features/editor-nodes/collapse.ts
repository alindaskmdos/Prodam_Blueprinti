import type { BlockPath } from './blockEdit';
import { isContainer, type Block } from './kinds';

/**
 * Сворачивание контейнеров (FE-06) — состояние вида на клиенте, на сервер не уходит.
 * Ключ контейнера — Block.id (нет id — путь в дереве). Переопределения пользователя хранятся по ключу;
 * без переопределения контейнер свёрнут, если Block.collapsed === true или его глубина больше COLLAPSE_DEPTH.
 * (Бэк всегда присылает collapsed: false — дефолт контракта, поэтому правило глубины от него не зависит.)
 */
export const COLLAPSE_DEPTH = 3;

/** Переопределения пользователя: ключ контейнера → свёрнут ли. */
export type CollapseOverrides = Readonly<Record<string, boolean>>;

/** Ключ блока для состояния сворачивания. */
export function blockKey(block: Block, path: BlockPath): string {
  return block.id || path;
}

export interface ContainerEntry {
  key: string;
  path: BlockPath;
  /** Глубина вложенности контейнеров: контейнер в теле метода — 1, внутри него — 2 и т.д. */
  depth: number;
  block: Block;
}

/** Все контейнеры дерева в префиксном порядке. */
export function containerEntries(root: Block): ContainerEntry[] {
  const out: ContainerEntry[] = [];
  const visit = (block: Block, path: BlockPath, depth: number) => {
    const own = isContainer(block) ? depth + 1 : depth;
    if (isContainer(block)) out.push({ key: blockKey(block, path), path, depth: own, block });
    for (const [slot, items] of Object.entries(block.slots ?? {})) {
      items.forEach((child, i) => visit(child, `${path}/${slot}/${i}`, own));
    }
  };
  visit(root, 'root', 0);
  return out;
}

/**
 * Ключи контейнеров в слоте `slot` блока `parent` (вместе с вложенными). Block.id позиционный: после вставки,
 * удаления или ↑↓ в слоте блоки получают id соседей, поэтому переопределения этих ключей сбрасываются.
 */
export function keysInSlot(root: Block, parent: BlockPath, slot: string): string[] {
  const prefix = `${parent}/${slot}/`;
  return containerEntries(root)
    .filter((c) => c.path.startsWith(prefix))
    .map((c) => c.key);
}

/** Начальное состояние контейнера без переопределения. */
export function defaultCollapsed(block: Block, depth: number): boolean {
  return block.collapsed === true || depth > COLLAPSE_DEPTH;
}

function isUnder(path: BlockPath, ancestor: BlockPath): boolean {
  return path.startsWith(`${ancestor}/`);
}

/**
 * Пути свёрнутых контейнеров. forcedOpen — пути, которые должны быть видны (открытый редактор, красная нода,
 * неотправленная вставка): их предки не сворачиваются (см. lockedPaths).
 */
export function collapsedPaths(
  root: Block,
  overrides: CollapseOverrides,
  forcedOpen: readonly BlockPath[] = [],
): Set<BlockPath> {
  const out = new Set<BlockPath>();
  for (const c of containerEntries(root)) {
    const collapsed = overrides[c.key] ?? defaultCollapsed(c.block, c.depth);
    if (collapsed && !forcedOpen.some((p) => isUnder(p, c.path))) out.add(c.path);
  }
  return out;
}

/** Пути контейнеров, которые нельзя свернуть сейчас: внутри них forcedOpen. */
export function lockedPaths(root: Block, forcedOpen: readonly BlockPath[]): Set<BlockPath> {
  const out = new Set<BlockPath>();
  if (forcedOpen.length === 0) return out;
  for (const c of containerEntries(root)) {
    if (forcedOpen.some((p) => isUnder(p, c.path))) out.add(c.path);
  }
  return out;
}

/** Путь блока по id; нет — null. */
export function pathOfBlockId(root: Block, id: string): BlockPath | null {
  let found: BlockPath | null = null;
  const visit = (block: Block, path: BlockPath) => {
    if (found !== null) return;
    if (block.id === id) {
      found = path;
      return;
    }
    for (const [slot, items] of Object.entries(block.slots ?? {})) items.forEach((c, i) => visit(c, `${path}/${slot}/${i}`));
  };
  visit(root, 'root');
  return found;
}

/**
 * Ключи свёрнутых предков блока blockId — их надо развернуть, чтобы нода блока появилась на схеме
 * (сам блок, если он свёрнутый контейнер, виден — его не разворачиваем). Блока нет или он виден — [].
 */
export function revealKeys(root: Block, blockId: string, collapsed: ReadonlySet<BlockPath>): string[] {
  const path = pathOfBlockId(root, blockId);
  if (path === null) return [];
  return containerEntries(root)
    .filter((c) => collapsed.has(c.path) && isUnder(path, c.path))
    .map((c) => c.key);
}

/** Все проблемы поддерева (сам блок и вложенные) без повторов — бейдж свёрнутого контейнера. */
export function subtreeIssues(block: Block): string[] {
  const out = new Set<string>();
  const visit = (b: Block) => {
    for (const i of b.issues ?? []) out.add(i);
    for (const items of Object.values(b.slots ?? {})) items.forEach(visit);
  };
  visit(block);
  return [...out];
}

/** «6 блоков», «1 блок», «3 блока». */
export function blocksLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'блок' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'блока' : 'блоков';
  return `${n} ${word}`;
}
