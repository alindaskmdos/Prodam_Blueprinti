import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import analysisJson from '@contract/fixtures/analysis.merge.json';
import { createApiClient, type Schemas } from '../api';
import { PanelTabs } from '../layout';
import { server } from '../../mocks/server';
import { fixtures } from '../../mocks/fixtures';
import { scenarios } from '../../mocks/handlers';
import { panelsIn } from '../../app/panels';
import { resetAppState, useAppStore } from '../../app/store';
import { resetAnalysisState, useAnalysisStore } from './analysisStore';
import { MetricsTab, ProblemsTab } from './AnalysisTabs';
import { formatOps, groupByScope, issuesSummary, parseN, ruleTitle, sortBySeverity, splitIssues } from './format';

const client = createApiClient('http://localhost/api');
const [high, low] = analysisJson.issues;
if (!high || !low) throw new Error('analysis.merge.json: нужны две проблемы');

function issueIds(): (string | null)[] {
  return screen.getAllByTestId('issue').map((el) => el.getAttribute('data-issue-id'));
}

function issue(over: Partial<Schemas['Issue']>): Schemas['Issue'] {
  const base = fixtures.analysisMerge.issues[0];
  if (!base) throw new Error('нет проблемы в фикстуре');
  return { ...base, ...over };
}

describe('панель анализа', () => {
  beforeEach(() => {
    resetAppState();
    resetAnalysisState();
    useAppStore.getState().openProject('p-1');
  });

  it('три вкладки реестра на фикстуре analysis.merge.json', async () => {
    render(<PanelTabs title="Анализ" tabs={panelsIn('right')} />);

    // Проблемы: только confidence high, оценка операций из opsBefore/opsAfter.
    expect(await screen.findByText(high.message)).toBeInTheDocument();
    expect(screen.queryByText(low.message)).not.toBeInTheDocument();
    expect(screen.getByText('высокая')).toBeInTheDocument();
    expect(screen.getByText(ruleTitle(high.rule))).toBeInTheDocument();
    expect(screen.queryByText(high.rule)).not.toBeInTheDocument();
    expect(screen.getByTestId('issues-summary')).toHaveTextContent('можно исправить автоматически: 1');
    expect(screen.getByText('OrderService.merge:44')).toBeInTheDocument();
    expect(screen.getByText('index-by-id')).toBeInTheDocument();
    const ops = screen.getByTestId('ops');
    expect(ops).toHaveTextContent('≈10⁸ → ≈10⁴ операций при n = 10 000');
    expect(screen.getByTestId('ops-estimate')).toHaveTextContent('асимптотическая оценка, не замер');
    // В карточке — та же оценка с n и подписью.
    expect(screen.getByTestId('issue-ops')).toHaveTextContent(
      '≈10⁸ → ≈10⁴ операций при n = 10 000 · асимптотическая оценка',
    );
    expect(screen.queryByText(/в \d+ раз/)).not.toBeInTheDocument();

    // Предупреждения: confidence low → «возможно», без автоисправления.
    fireEvent.click(screen.getByRole('tab', { name: 'Предупреждения' }));
    expect(screen.getByText(low.message)).toBeInTheDocument();
    expect(screen.queryByText(high.message)).not.toBeInTheDocument();
    expect(screen.getByText('возможно')).toBeInTheDocument();
    expect(screen.getByTestId('issues-summary')).toHaveTextContent('низкая уверенность, без автоисправления');
    expect(screen.getByText('Низкая уверенность · без автоисправления')).toBeInTheDocument();

    // Метрики: MethodMetrics.
    fireEvent.click(screen.getByRole('tab', { name: 'Метрики' }));
    const table = screen.getByRole('table', { name: 'Метрики методов' });
    const metric = analysisJson.metrics[0];
    if (!metric) throw new Error('нет метрик в фикстуре');
    const row = within(table).getByRole('row', { name: /OrderService\.merge/ });
    expect(row).toHaveTextContent(String(metric.lines));
    expect(row).toHaveTextContent(String(metric.maxNesting));
    expect(row).toHaveTextContent(metric.complexity);
    fireEvent.click(row);
    expect(useAppStore.getState().selectedMethodId).toBe(metric.methodId);
  });

  it('проблемы отсортированы по серьёзности: high → medium → low', async () => {
    const analysis: Schemas['Analysis'] = {
      ...fixtures.analysisMerge,
      issues: [
        issue({ id: 'L', severity: 'low', message: 'низкая' }),
        issue({ id: 'M', severity: 'medium', message: 'средняя' }),
        issue({ id: 'H', severity: 'high', message: 'высокая' }),
        issue({ id: 'W', severity: 'high', confidence: 'low', message: 'предупреждение', fixes: [] }),
      ],
    };
    server.use(http.get('*/api/projects/:projectId/analysis', () => HttpResponse.json(analysis)));
    render(<ProblemsTab client={client} />);

    await screen.findAllByTestId('issue');
    expect(issueIds()).toEqual(['H', 'M', 'L']);
  });

  const A = 'com.demo.A.run~0';
  const mid = (id: string, methodId: string) => issue({ id, methodId, severity: 'high', message: id });

  it('порядок: текущий метод, затем методы его класса, затем остальное; внутри групп порядок прежний', async () => {
    const analysis: Schemas['Analysis'] = {
      ...fixtures.analysisMerge,
      issues: [
        mid('other1', 'com.demo.B.go~0'),
        mid('cls1', 'com.demo.A.stop~0'),
        mid('cur1', A),
        mid('other2', 'com.demo.C.go~0'),
        mid('cls2', 'com.demo.A.walk~0'),
        mid('cur2', A),
      ],
    };
    server.use(http.get('*/api/projects/:projectId/analysis', () => HttpResponse.json(analysis)));
    // Без открытого метода — прежний порядок, подзаголовков нет.
    const { unmount } = render(<ProblemsTab client={client} />);
    await screen.findAllByTestId('issue');
    expect(issueIds()).toEqual(['other1', 'cls1', 'cur1', 'other2', 'cls2', 'cur2']);
    expect(screen.queryByTestId('scope-heading')).not.toBeInTheDocument();
    unmount();

    act(() => useAppStore.getState().selectMethod(A));
    render(<ProblemsTab client={client} />);
    await screen.findAllByTestId('issue');
    expect(issueIds()).toEqual(['cur1', 'cur2', 'cls1', 'cls2', 'other1', 'other2']);
    expect(screen.getAllByTestId('scope-heading').map((e) => e.textContent)).toEqual([
      'Этот метод',
      'Этот класс',
      'Остальное',
    ]);
  });

  it('метрики: текущий метод, его класс, остальное', async () => {
    const m = (methodId: string) => ({ methodId, complexity: 'O(n)', lines: 5, maxNesting: 1 });
    const analysis: Schemas['Analysis'] = {
      ...fixtures.analysisMerge,
      metrics: [m('com.demo.B.go~0'), m('com.demo.A.stop~0'), m(A)],
    };
    server.use(http.get('*/api/projects/:projectId/analysis', () => HttpResponse.json(analysis)));
    act(() => useAppStore.getState().selectMethod(A));
    render(<MetricsTab client={client} />);
    await screen.findByRole('table', { name: 'Метрики методов' });
    const rows = screen.getAllByRole('row').map((r) => r.getAttribute('title'));
    expect(rows.filter(Boolean)).toEqual([A, 'com.demo.A.stop~0', 'com.demo.B.go~0']);
  });

  it('клик по проблеме выставляет в store methodId, issueId и blockId', async () => {
    render(<ProblemsTab client={client} />);
    const card = (await screen.findByText(high.message)).closest('button');
    if (!card) throw new Error('карточка не кнопка');
    expect(card).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(card);

    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBe(high.id);
    expect(s.selectedBlockId).toBe(high.blockId);
    expect(s.selectedMethodId).toBe(high.methodId);
    expect(card).toHaveAttribute('aria-pressed', 'true');

    // Выбор другого метода в дереве снимает выбор проблемы.
    act(() => useAppStore.getState().selectMethod('com.demo.Other.run~0'));
    expect(useAppStore.getState().selectedIssueId).toBeNull();
    expect(useAppStore.getState().selectedBlockId).toBeNull();
  });

  it('смена n делает новый запрос GET analysis?n=…', async () => {
    const requested: (string | null)[] = [];
    server.use(
      http.get('*/api/projects/:projectId/analysis', ({ request }) => {
        const n = new URL(request.url).searchParams.get('n');
        requested.push(n);
        return HttpResponse.json({ ...fixtures.analysisMerge, n: Number(n) });
      }),
    );
    render(<ProblemsTab client={client} />);
    await screen.findByText(high.message);
    expect(requested).toEqual(['10000']);

    const input = screen.getByRole('textbox', { name: 'n' });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(input);
    expect(requested).toEqual(['10000']);

    fireEvent.change(input, { target: { value: '1 000 000' } });
    fireEvent.submit(input);
    await waitFor(() => expect(requested).toEqual(['10000', '1000000']));
    expect(useAnalysisStore.getState().n).toBe(1_000_000);
    await waitFor(() => expect(screen.getByTestId('ops')).toHaveTextContent('операций при n = 1 000 000'));
    expect(screen.getByTestId('issue-ops')).toHaveTextContent('операций при n = 1 000 000');
  });

  it('CyclicDependency без methodId/blockId (analysis.cycle.json): карточка рисуется, клик → проблема выбрана, вкладка кода', async () => {
    server.use(scenarios.analysisCycle);
    useAppStore.getState().selectMethod('com.demo.Other.run~0');
    render(<ProblemsTab client={client} />);
    const cycle = fixtures.analysisCycle.issues[0];
    if (!cycle) throw new Error('нет проблемы в analysis.cycle.json');
    const text = await screen.findByText(cycle.message);
    // Место — файл span (methodId нет).
    expect(screen.getByText('Cart.java:5')).toBeInTheDocument();
    const card = text.closest('button');
    if (!card) throw new Error('карточка не кнопка');
    fireEvent.click(card);
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBe('ISSUE-7');
    expect(s.selectedBlockId).toBeNull();
    expect(s.highlight).toMatchObject({ source: 'issue', blockId: null });
    expect(s.activePanels.bottom).toBe('bottom.code');
  });

  it('проблема без methodId: метод не меняется, blockId чужого метода не ставится', () => {
    useAppStore.getState().selectMethod('com.demo.Other.run~0');
    useAppStore.getState().selectIssue({ issueId: 'X', blockId: 'some/block' });
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBe('X');
    expect(s.selectedBlockId).toBeNull();
    expect(s.selectedMethodId).toBe('com.demo.Other.run~0');
  });

  it('setAnalysis берёт n из анализа: повторный запрос с этим n не нужен', async () => {
    const requested: (string | null)[] = [];
    server.use(
      http.get('*/api/projects/:projectId/analysis', ({ request }) => {
        requested.push(new URL(request.url).searchParams.get('n'));
        return HttpResponse.json(fixtures.analysisMerge);
      }),
    );
    const store = useAnalysisStore.getState();
    store.setAnalysis('p-1', { ...fixtures.analysisMerge, n: 500 });
    expect(useAnalysisStore.getState().loadedFor).toEqual({ projectId: 'p-1', n: 500 });
    await store.load(client, 'p-1', fixtures.analysisMerge.version, 500);
    expect(requested).toEqual([]);
    await store.load(client, 'p-1', fixtures.analysisMerge.version, 10000);
    expect(requested).toEqual(['10000']);
  });

  it('ошибка перезагрузки при старом анализе — признак устаревших данных', async () => {
    render(<ProblemsTab client={client} />);
    await screen.findByText(high.message);
    expect(screen.queryByTestId('analysis-stale')).not.toBeInTheDocument();

    server.use(scenarios.analysisNotFound);
    act(() => useAppStore.getState().setVersion(analysisJson.version + 1));

    expect(await screen.findByTestId('analysis-stale')).toHaveTextContent('устаревшие данные');
    expect(screen.getByText(high.message)).toBeInTheDocument();
  });

  it('ошибка загрузки показывается сообщением', async () => {
    server.use(scenarios.analysisNotFound);
    render(<ProblemsTab client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Проект не найден');
  });
});

describe('format', () => {
  it('groupByScope: без текущего метода порядок не меняется; метод без id — в «Остальное»', () => {
    const items = [{ m: 'a.B.x~0' }, { m: undefined }, { m: 'a.B.y~0' }, { m: 'a.C.x~0' }];
    const by = (cur: string | null) => groupByScope(items, (i) => i.m, cur).map((g) => [g.key, g.items.map((i) => i.m)]);
    expect(by(null)).toEqual([['rest', ['a.B.x~0', undefined, 'a.B.y~0', 'a.C.x~0']]]);
    expect(by('a.B.y~0')).toEqual([
      ['method', ['a.B.y~0']],
      ['class', ['a.B.x~0']],
      ['rest', [undefined, 'a.C.x~0']],
    ]);
  });

  it('ruleTitle: русское название по id, неизвестный id — как есть', () => {
    expect(ruleTitle('NestedLoopSameCollection')).toBe('Вложенный цикл по одной коллекции');
    expect(ruleTitle('StringConcatInLoop')).toBe('Конкатенация строк в цикле');
    expect(ruleTitle('UnusedLocalVariable')).toBe('UnusedLocalVariable');
  });

  it('issuesSummary: счётчик со склонением и число авто-исправимых', () => {
    const fixable = issue({ fixes: ['f'] });
    const plain = issue({ fixes: [] });
    expect(issuesSummary('problems', [fixable, plain, plain])).toBe('3 проблемы · можно исправить автоматически: 1');
    expect(issuesSummary('problems', Array(12).fill(plain))).toContain('12 проблем ·');
    expect(issuesSummary('warnings', [plain])).toBe('1 предупреждение · низкая уверенность, без автоисправления');
  });

  it('formatOps — порядок готового числа из контракта', () => {
    expect(formatOps(100_000_000)).toBe('≈10⁸');
    expect(formatOps(10_000)).toBe('≈10⁴');
    expect(formatOps(20_000)).toBe('≈2·10⁴');
    expect(formatOps(96_000)).toBe('≈10⁵');
    expect(formatOps(350)).toBe('≈350');
  });

  it('parseN — целое ≥ 1, пробелы допускаются', () => {
    expect(parseN('10 000')).toBe(10000);
    expect(parseN('0')).toBeNull();
    expect(parseN('1.5')).toBeNull();
    expect(parseN('')).toBeNull();
  });

  it('sortBySeverity не меняет вход, splitIssues делит по confidence', () => {
    const input = [issue({ id: 'a', severity: 'low' }), issue({ id: 'b', severity: 'high' })];
    expect(sortBySeverity(input).map((i) => i.id)).toEqual(['b', 'a']);
    expect(input.map((i) => i.id)).toEqual(['a', 'b']);
    const { problems, warnings } = splitIssues(fixtures.analysisMerge.issues);
    expect(problems.map((i) => i.id)).toEqual([high.id]);
    expect(warnings.map((i) => i.id)).toEqual([low.id]);
  });
});
