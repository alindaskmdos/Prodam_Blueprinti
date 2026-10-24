import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Schemas } from '../api';
import { createApiClient } from '../api';
import { resetAnalysisState, useAnalysisStore } from '../analysis-panel';
import { resetStructureState, resetTreeState, STRUCTURE_PANEL_ID, useStructureStore, useTreeStore } from '../project-tree';
import { fixtures } from '../../mocks/fixtures';
import { resetAppState, useAppStore } from '../../app/store';
import { CommandPalette } from './CommandPalette';
import { isPaletteHotkey } from './hotkey';
import { buildEntries, groupEntries, type PaletteCommand } from './entries';
import { searchEntries } from './search';

const client = createApiClient('http://localhost/api');
const tree = fixtures.tree as Schemas['ProjectTree'];
const analysis = fixtures.analysisMerge as Schemas['Analysis'];
const mergeId = 'com.demo.service.OrderService.merge~0';

function setup(commands: readonly PaletteCommand[]) {
  const runCommand = vi.fn((id: string, args?: Readonly<Record<string, string>>) => {
    void commands.find((c) => c.id === id)?.run(args);
  });
  render(<CommandPalette client={client} commands={commands} runCommand={runCommand} />);
  return runCommand;
}

const openByHotkey = async () => {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  return screen.findByPlaceholderText(/Класс, метод/);
};

// cmdk в jsdom требует ResizeObserver и scrollIntoView.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe('CommandPalette', () => {
  beforeEach(() => {
    resetAppState();
    resetTreeState();
    resetAnalysisState();
    useAppStore.getState().openProject('p-1', tree.version);
    useTreeStore.setState({ projectId: 'p-1', state: { kind: 'ok', tree } });
    useAnalysisStore.getState().setAnalysis('p-1', analysis);
  });

  it('хоткеи: Ctrl+K и Cmd+K открывают, Ctrl+Shift+P тоже, чужие сочетания — нет', async () => {
    expect(isPaletteHotkey({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(isPaletteHotkey({ key: 'K', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe(true);
    expect(isPaletteHotkey({ key: 'P', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })).toBe(true);
    expect(isPaletteHotkey({ key: 'p', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe(false);
    expect(isPaletteHotkey({ key: 'k', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false })).toBe(false);

    setup([]);
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
    await openByHotkey();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    expect(await screen.findByPlaceholderText(/Класс, метод/)).toBeInTheDocument();
  });

  it('Escape закрывает палитру', async () => {
    setup([]);
    const input = await openByHotkey();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
  });

  it('поиск метода и выбор открывают его (как клик в дереве)', async () => {
    setup([]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'merge' } });
    const item = await screen.findByRole('option', { name: /OrderService\.merge/ });
    fireEvent.click(item);
    expect(useAppStore.getState().selectedMethodId).toBe(mergeId);
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
  });

  it('выбор проблемы — как клик по карточке: метод, блок и подсветка issue', async () => {
    setup([]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'Вложенный цикл' } });
    fireEvent.click(await screen.findByRole('option', { name: /^Вложенный цикл/ }));
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBe('ISSUE-1');
    expect(s.selectedMethodId).toBe(mergeId);
    expect(s.selectedBlockId).toBe(`${mergeId}/body/1/body/2`);
    expect(s.highlight?.source).toBe('issue');
  });

  it('ноды выбранного метода: поиск по тексту и выбор подсвечивают блок', async () => {
    useAppStore.getState().selectMethod(mergeId);
    setup([]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'orders.size' } });
    const [node] = await screen.findAllByRole('option', { name: /orders\.size\(\)/ });
    if (!node) throw new Error('нет нод');
    fireEvent.click(node);
    const h = useAppStore.getState().highlight;
    expect(h?.source).toBe('canvas');
    expect(h?.blockId).toMatch(/^com\.demo\.service\.OrderService\.merge~0\/body\//);
  });

  it('команда из реестра выполняется; недоступная — нет; paletteHidden не показывается', async () => {
    const run = vi.fn();
    const blocked = vi.fn();
    setup([
      { id: 'test.run', title: 'Тестовая команда', group: 'Тест', shortcut: 'Ctrl+T', run },
      { id: 'test.off', title: 'Выключенная команда', isEnabled: () => false, run: blocked },
      { id: 'test.hidden', title: 'Скрытая команда', paletteHidden: true, run: vi.fn() },
    ]);
    await openByHotkey();
    expect(screen.queryByText('Скрытая команда')).not.toBeInTheDocument();
    expect(screen.getByText('Ctrl+T')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Выключенная команда/ }));
    expect(blocked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option', { name: /Тестовая команда/ }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
  });

  it('фикс проблемы запускает команду fix.apply с issueId и fixId', async () => {
    const runCommand = setup([]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'index-by-id' } });
    fireEvent.click(await screen.findByRole('option', { name: /Применить фикс «index-by-id»/ }));
    expect(runCommand).toHaveBeenCalledWith('fix.apply', { issueId: 'ISSUE-1', fixId: 'index-by-id' });
    await act(async () => undefined);
  });

  it('фикс неактивен, пока fix.apply недоступна (isEnabled false)', async () => {
    const run = vi.fn();
    const runCommand = setup([{ id: 'fix.apply', title: 'Фикс', paletteHidden: true, isEnabled: () => false, run }]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'index-by-id' } });
    const item = await screen.findByRole('option', { name: /Применить фикс «index-by-id»/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('после ввода выделен первый по score пункт; disabled-фикс пропускается', async () => {
    const run = vi.fn();
    setup([
      { id: 'fix.apply', title: 'Фикс', paletteHidden: true, isEnabled: () => false, run },
      { id: 'x.open', title: 'Открыть index-by-id', run },
    ]);
    const input = await openByHotkey();
    fireEvent.change(input, { target: { value: 'merge' } });
    const first = await screen.findByRole('option', { name: /OrderService\.merge/ });
    await vi.waitFor(() => expect(first).toHaveAttribute('aria-selected', 'true'));
    // Фикс «index-by-id» — первый по score, но неактивен: выделена команда после него.
    fireEvent.change(input, { target: { value: 'index-by-id' } });
    const fix = await screen.findByRole('option', { name: /Применить фикс «index-by-id»/ });
    const cmd = await screen.findByRole('option', { name: /Открыть index-by-id/ });
    await vi.waitFor(() => expect(cmd).toHaveAttribute('aria-selected', 'true'));
    expect(fix).toHaveAttribute('aria-selected', 'false');
  });

  it('Ctrl+K в поле ввода (Monaco, диалоги) не перехватывается; Ctrl+Shift+P — перехватывается', async () => {
    setup([]);
    const area = document.createElement('textarea');
    document.body.append(area);
    area.focus();
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    area.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();

    const shifted = new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    area.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(true);
    expect(await screen.findByPlaceholderText(/Класс, метод/)).toBeInTheDocument();
    area.remove();
  });

  it('Ctrl+K в поле самой палитры закрывает её', async () => {
    setup([]);
    const input = await openByHotkey();
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
  });

  it('Esc в палитре не всплывает до модалки под ней', async () => {
    setup([]);
    const underlying = vi.fn();
    window.addEventListener('keydown', underlying);
    const input = await openByHotkey();
    underlying.mockClear();
    fireEvent.keyDown(input, { key: 'Escape' });
    window.removeEventListener('keydown', underlying);
    expect(underlying).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/Класс, метод/)).not.toBeInTheDocument();
  });
});

describe('buildEntries / groupEntries', () => {
  beforeEach(() => resetAppState());

  it('без данных пустые группы не создаются', () => {
    const entries = buildEntries({ tree: null, analysis: null, root: null, commands: [], runCommand: vi.fn() });
    expect(entries).toEqual([]);
    expect(groupEntries(entries)).toEqual([]);
  });

  it('из дерева — классы, поля и методы; из анализа — проблемы и фиксы', () => {
    const entries = buildEntries({ tree, analysis, root: null, commands: [], runCommand: vi.fn() });
    expect(groupEntries(entries).map((g) => g.group)).toEqual(['Исправления', 'Проблемы', 'Методы', 'Классы', 'Поля']);
  });

  it('класс и поле ведут на общий выбор класса (дерево, «Свойства», код), а не на первый метод', () => {
    resetStructureState();
    useAppStore.getState().openProject('p-1', 1);
    const entries = buildEntries({ tree, analysis: null, root: null, commands: [], runCommand: vi.fn() });
    const ref = { path: 'src/com/demo/service/OrderService.java', name: 'OrderService' };
    entries.find((e) => e.id === `class:${ref.path}:OrderService`)?.run();
    expect(useStructureStore.getState().selection).toEqual({ kind: 'class', ref });
    expect(useAppStore.getState().selectedMethodId).toBeNull();
    expect(useAppStore.getState().activePanels.right).toBe(STRUCTURE_PANEL_ID);
    expect(useAppStore.getState().activePanels.bottom).toBe('bottom.code');
    entries.find((e) => e.id === `field:${ref.path}:OrderService.orders`)?.run();
    expect(useStructureStore.getState().selection).toEqual({ kind: 'field', ref, field: 'orders' });
  });

  it('класс без методов тоже попадает в палитру', () => {
    const t = {
      version: 1,
      packages: [{ name: 'p', files: [{ path: 'E.java', classes: [{ name: 'Empty', kind: 'class', fields: [], constructors: [], methods: [] }] }] }],
    } as unknown as Schemas['ProjectTree'];
    const entries = buildEntries({ tree: t, analysis: null, root: null, commands: [], runCommand: vi.fn() });
    expect(entries.map((e) => e.id)).toEqual(['class:E.java:Empty']);
  });
});

describe('searchEntries: ранжирование', () => {
  beforeEach(() => resetAppState());

  const m = (cls: string, name: string) => ({
    id: `${cls}.${name}~0`,
    name,
    signature: `${name}()`,
    issueCount: 0,
  });
  const cls = (name: string, methods: string[]) => ({
    name,
    kind: 'class' as const,
    fields: [],
    constructors: [],
    methods: methods.map((n) => m(name, n)),
  });
  const demoTree = {
    version: 1,
    packages: [
      {
        name: 'com.demo',
        files: [
          { path: 'src/ReportService.java', classes: [cls('ReportService', ['fullReport', 'report'])] },
          { path: 'src/OrderService.java', classes: [cls('OrderService', ['find', 'merge'])] },
          { path: 'src/PricingService.java', classes: [cls('PricingService', ['flat'])] },
        ],
      },
    ],
  } as unknown as Schemas['ProjectTree'];
  const demoAnalysis = {
    ...analysis,
    issues: [
      {
        id: 'i1',
        rule: 'StringConcatInLoop',
        severity: 'warning',
        confidence: 'high',
        span: { file: 'src/ReportService.java', startLine: 3, startCol: 0, endLine: 3, endCol: 1 },
        blockId: 'b1',
        message: 'Конкатенация строк «report» в цикле',
        fixes: ['string-builder'],
      },
    ],
  } as unknown as Schemas['Analysis'];
  const commands: PaletteCommand[] = [{ id: 'fix.apply', title: 'Применить фикс', paletteHidden: true, run: vi.fn() }];
  const all = () => buildEntries({ tree: demoTree, analysis: demoAnalysis, root: null, commands, runCommand: vi.fn() });
  const titles = (q: string) => searchEntries(all(), q).flatMap((g) => g.entries.map((e) => e.title));

  it('«fullReport»: первым метод, без подпоследовательностей', () => {
    const res = titles('fullReport');
    expect(res[0]).toBe('ReportService.fullReport');
    expect(res).not.toContain('OrderService.find');
    expect(res).not.toContain('PricingService.flat');
    expect(res.some((t) => t.startsWith('Применить фикс'))).toBe(false);
  });

  it('регистр не важен, префикс после «Класс.» и camelCase-инициалы', () => {
    expect(titles('FULLREPORT')[0]).toBe('ReportService.fullReport');
    expect(titles('ReportService.fu')[0]).toBe('ReportService.fullReport');
    expect(titles('fR')[0]).toBe('ReportService.fullReport');
  });

  it('«string-builder»: фикс первым', () => {
    const groups = searchEntries(all(), 'string-builder');
    expect(groups[0]?.group).toBe('Исправления');
    expect(groups[0]?.entries[0]?.id).toBe('fix:i1:string-builder');
  });

  it('при равном score навигация выше действий', () => {
    const groups = searchEntries(all(), 'report');
    expect(groups[0]?.group).toBe('Методы');
    expect(groups[0]?.entries[0]?.title).toBe('ReportService.report');
    expect(groups.findIndex((g) => g.group === 'Исправления')).toBeGreaterThan(0);
  });

  it('префикс члена выше префикса «Класс.член»', () => {
    const t = {
      ...demoTree,
      packages: [
        {
          name: 'com.demo',
          files: [
            { path: 'a.java', classes: [cls('ReportService', ['find'])] },
            { path: 'b.java', classes: [cls('OrderService', ['reportX'])] },
          ],
        },
      ],
    } as unknown as Schemas['ProjectTree'];
    const entries = buildEntries({ tree: t, analysis: null, root: null, commands: [], runCommand: vi.fn() });
    const res = searchEntries(entries, 'report').flatMap((g) => g.entries).map((e) => e.title);
    expect(res.indexOf('OrderService.reportX')).toBeLessThan(res.indexOf('ReportService.find'));
  });

  it('инициалы слабее подстроки и не работают по «Класс.член»', () => {
    const t = {
      ...demoTree,
      packages: [
        {
          name: 'com.demo',
          files: [{ path: 'a.java', classes: [cls('ReportService', ['fullReport', 'users', 'rest'])] }],
        },
      ],
    } as unknown as Schemas['ProjectTree'];
    const entries = buildEntries({ tree: t, analysis: null, root: null, commands: [], runCommand: vi.fn() });
    const rs = searchEntries(entries, 'rs').flatMap((g) => g.entries).map((e) => e.title);
    expect(rs[0]).toBe('ReportService.users');
    expect(rs).not.toContain('ReportService.fullReport');
    const fr = searchEntries(entries, 'fR').flatMap((g) => g.entries).map((e) => e.title);
    expect(fr).toEqual(['ReportService.fullReport']);
  });

  it('пустой запрос — прежний порядок групп', () => {
    expect(groupEntries(all()).map((g) => g.group)).toEqual(['Исправления', 'Проблемы', 'Методы', 'Классы']);
  });
});
