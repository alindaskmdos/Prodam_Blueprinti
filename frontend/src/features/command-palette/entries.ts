import type { Schemas } from '../api';
import { KIND_META, blockText, type Block, type BlockKind } from '../editor-nodes';
import { useAppStore } from '../../app/store';

type Tree = Schemas['ProjectTree'];
type Analysis = Schemas['Analysis'];
type ClassNode = Schemas['ClassNode'];

/** Описание команды реестра (`app/commands.ts`) — структурно, чтобы фича не зависела от app. */
export interface PaletteCommand {
  id: string;
  title: string;
  group?: string;
  shortcut?: string;
  /** true — команда принимает параметры из UI и в палитре сама по себе не показывается (напр. fix.apply). */
  paletteHidden?: boolean;
  isEnabled?: () => boolean;
  run: (args?: Readonly<Record<string, string>>) => void | Promise<void>;
}

export type EntryGroup = 'Команды' | 'Исправления' | 'Проблемы' | 'Ноды' | 'Методы' | 'Классы' | 'Поля';

/** Порядок групп в палитре. */
export const GROUP_ORDER: readonly EntryGroup[] = ['Команды', 'Исправления', 'Проблемы', 'Ноды', 'Методы', 'Классы', 'Поля'];

/** Один пункт палитры: что показать и что сделать по Enter. */
export interface PaletteEntry {
  /** Уникален в палитре (префикс по группе). */
  id: string;
  group: EntryGroup;
  title: string;
  /** Пояснение справа от заголовка (сигнатура, файл, тип поля). */
  hint?: string;
  shortcut?: string;
  disabled?: boolean;
  /** Слова для нечёткого поиска помимо заголовка. */
  keywords: string[];
  run: () => void;
}

export interface EntrySources {
  tree: Tree | null;
  analysis: Analysis | null;
  /** Корень дерева блоков выбранного метода (GET blocks); null — метод не выбран или ещё не загружен. */
  root: Block | null;
  commands: readonly PaletteCommand[];
  /** Запуск команды реестра с параметрами (fix.apply). */
  runCommand: (id: string, args?: Readonly<Record<string, string>>) => void;
}

/** Первый метод класса (конструкторы раньше методов, как в дереве): класс и поле открывают его файл. */
function firstMethodId(cls: ClassNode): string | null {
  return cls.constructors[0]?.id ?? cls.methods[0]?.id ?? null;
}

/** Все блоки поддерева в порядке обхода, без самого корня (метод — отдельная группа). */
function descendants(root: Block): Block[] {
  const out: Block[] = [];
  const walk = (block: Block) => {
    for (const slot of Object.values(block.slots ?? {})) {
      for (const child of slot) {
        out.push(child);
        walk(child);
      }
    }
  };
  walk(root);
  return out;
}

function commandEntries(commands: readonly PaletteCommand[]): PaletteEntry[] {
  return commands
    .filter((c) => !c.paletteHidden)
    .map((c) => ({
      id: `cmd:${c.id}`,
      group: 'Команды' as const,
      title: c.title,
      hint: c.group,
      shortcut: c.shortcut,
      disabled: c.isEnabled ? !c.isEnabled() : false,
      keywords: [c.id, ...(c.group ? [c.group] : [])],
      run: () => void c.run(),
    }));
}

function treeEntries(tree: Tree): PaletteEntry[] {
  const { selectMethod } = useAppStore.getState();
  const out: PaletteEntry[] = [];
  for (const pkg of tree.packages) {
    for (const file of pkg.files) {
      for (const cls of file.classes) {
        const open = firstMethodId(cls);
        // Класс без методов открывать нечем (в контракте нет «выбранного класса») — в палитру не попадает.
        if (open) {
          out.push({
            id: `class:${file.path}:${cls.name}`,
            group: 'Классы',
            title: cls.name,
            hint: file.path,
            keywords: [cls.kind, pkg.name],
            run: () => selectMethod(open),
          });
        }
        for (const f of cls.fields) {
          if (!open) continue;
          out.push({
            id: `field:${file.path}:${cls.name}.${f.name}`,
            group: 'Поля',
            title: `${cls.name}.${f.name}`,
            hint: f.type,
            keywords: [f.name, f.type],
            run: () => selectMethod(open),
          });
        }
        for (const m of [...cls.constructors, ...cls.methods]) {
          out.push({
            id: `method:${m.id}`,
            group: 'Методы',
            title: `${cls.name}.${m.name}`,
            hint: m.signature,
            keywords: [m.signature, m.id],
            run: () => selectMethod(m.id),
          });
        }
      }
    }
  }
  return out;
}

function issueEntries(
  analysis: Analysis,
  commands: readonly PaletteCommand[],
  runCommand: EntrySources['runCommand'],
): PaletteEntry[] {
  // Доступность фикса — как у команды fix.apply (нет Docker, идёт прогон).
  const fixCommand = commands.find((c) => c.id === 'fix.apply');
  const fixDisabled = fixCommand?.isEnabled ? !fixCommand.isEnabled() : false;
  const { selectIssue } = useAppStore.getState();
  const out: PaletteEntry[] = [];
  for (const issue of analysis.issues) {
    const line = `${issue.span.file.split('/').pop()}:${issue.span.startLine}`;
    out.push({
      id: `issue:${issue.id}`,
      group: 'Проблемы',
      title: issue.message,
      hint: line,
      keywords: [issue.rule, issue.severity, issue.span.file],
      // Как клик по карточке проблемы (FE-05): метод, нода на схеме, строка в коде.
      run: () => selectIssue({ issueId: issue.id, methodId: issue.methodId, blockId: issue.blockId }),
    });
    for (const fixId of issue.fixes) {
      out.push({
        id: `fix:${issue.id}:${fixId}`,
        group: 'Исправления',
        title: `Применить фикс «${fixId}»: ${issue.message}`,
        hint: line,
        disabled: fixDisabled,
        keywords: [issue.rule, fixId],
        run: () => runCommand('fix.apply', { issueId: issue.id, fixId }),
      });
    }
  }
  return out;
}

function blockEntries(root: Block): PaletteEntry[] {
  const { setHighlight } = useAppStore.getState();
  const out: PaletteEntry[] = [];
  for (const block of descendants(root)) {
    const text = blockText(block).trim();
    if (!text) continue;
    const kind = KIND_META[block.kind as BlockKind]?.title;
    const span = block.span ?? null;
    out.push({
      id: `block:${block.id}`,
      group: 'Ноды',
      title: text,
      hint: kind,
      keywords: kind ? [kind] : [],
      // Как клик по ноде (FE-05): подсветка на холсте и строк в редакторе кода.
      run: () => setHighlight({ source: 'canvas', blockId: block.id, span }),
    });
  }
  return out;
}

/** Все пункты палитры по загруженным данным; пустые источники не дают пунктов. */
export function buildEntries({ tree, analysis, root, commands, runCommand }: EntrySources): PaletteEntry[] {
  return [
    ...commandEntries(commands),
    ...(analysis ? issueEntries(analysis, commands, runCommand) : []),
    ...(root ? blockEntries(root) : []),
    ...(tree ? treeEntries(tree) : []),
  ];
}

/** Пункты по группам в порядке GROUP_ORDER; пустые группы опущены. */
export function groupEntries(entries: readonly PaletteEntry[]): { group: EntryGroup; entries: PaletteEntry[] }[] {
  return GROUP_ORDER.map((group) => ({ group, entries: entries.filter((e) => e.group === group) })).filter(
    (g) => g.entries.length > 0,
  );
}
