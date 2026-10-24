import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import cycleJson from '@contract/fixtures/dependencies.cycle.json';
import demoJson from '@contract/fixtures/dependencies.demo.json';
import { resetAppState, useAppStore } from '../../app/store';
import { scenarios } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { resetTreeState } from '../project-tree';
import { cycleLabel, depsFlow, depsToGraph } from './depsGraph';
import { resetDiagrams } from './diagramsStore';
import { DependenciesView } from './DependenciesView';
import styles from './Diagrams.module.css';

const cycle = cycleJson as unknown as Schemas['DependencyGraph'];
const demo = demoJson as unknown as Schemas['DependencyGraph'];
const client = createApiClient('http://localhost/api');

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
});

beforeEach(() => {
  resetAppState();
  resetDiagrams();
  resetTreeState();
});

describe('depsToGraph / depsFlow — ответ GET dependencies → ноды и рёбра', () => {
  const layout = { positions: new Map(), routes: new Map() };
  const ui = { hovered: null, matches: null, selectedId: null, flyingId: null, onClick: () => undefined };

  it('узлы и рёбра цикла помечены; рёбра цикла — красные (тон cycle), остальные обычные', () => {
    const model = depsToGraph(cycle);
    expect(model.nodes.map((n) => [n.id, n.inCycle])).toEqual([
      ['com.shop.Cart', true],
      ['com.shop.Pricing', true],
      ['com.shop.Item', false],
    ]);
    const { nodes, edges } = depsFlow(model, layout, ui);
    expect(nodes.map((n) => n.data.inCycle)).toEqual([true, true, false]);
    expect(Object.fromEntries(edges.map((e) => [e.id, e.data?.tone]))).toEqual({
      'com.shop.Cart->com.shop.Pricing': 'cycle',
      'com.shop.Pricing->com.shop.Cart': 'cycle',
      'com.shop.Cart->com.shop.Item': 'base',
    });
    expect(edges.every((e) => e.data?.end === 'arrow')).toBe(true);
  });

  it('наведение: рёбра узла подсвечены (цикл остаётся красным), остальные приглушены', () => {
    const model = depsToGraph(cycle);
    const { nodes, edges } = depsFlow(model, layout, { ...ui, hovered: 'com.shop.Item' });
    expect(nodes.map((n) => n.data.state)).toEqual(['normal', 'dim', 'active']);
    expect(edges.map((e) => e.data?.tone)).toEqual(['dim', 'dim', 'active']);
    const both = depsFlow(model, layout, { ...ui, hovered: 'com.shop.Cart' });
    expect(both.edges.map((e) => e.data?.tone)).toEqual(['cycle', 'cycle', 'active']);
  });

  it('демо без циклов: все рёбра обычные; подпись цикла', () => {
    const model = depsToGraph(demo);
    expect(model.nodes.some((n) => n.inCycle)).toBe(false);
    expect(model.edges.length).toBeGreaterThan(0);
    const c = cycle.cycles[0];
    if (!c) throw new Error('нет цикла');
    expect(cycleLabel(c, cycle.nodes)).toBe('Cart → Pricing → Cart');
  });
});

describe('DependenciesView (MSW)', () => {
  it('циклы красным, список циклов → Issue CyclicDependency, клик по узлу → класс в редакторе', async () => {
    server.use(scenarios.dependenciesCycle);
    useAppStore.getState().openProject('p-1', 2);
    render(<DependenciesView client={client} />);
    const nodes = await screen.findAllByTestId('dep-node', {}, { timeout: 10_000 });
    expect(nodes).toHaveLength(3);
    const cart = nodes.find((n) => n.dataset.classId === 'com.shop.Cart');
    const item = nodes.find((n) => n.dataset.classId === 'com.shop.Item');
    expect(cart?.className).toContain(styles.depCycle);
    expect(item?.className).not.toContain(styles.depCycle);

    const list = screen.getByTestId('cycle-list');
    expect(within(list).getByText('Циклы: 1')).toBeInTheDocument();
    fireEvent.click(within(list).getByText('Cart → Pricing → Cart'));
    let s = useAppStore.getState();
    expect(s.selectedIssueId).toBe('ISSUE-7');
    expect(s.selectedBlockId).toBeNull();
    expect(s.activePanels.right).toBe('analysis.problems');
    expect(s.activePanels.bottom).toBe('bottom.code');

    if (!item) throw new Error('нет узла Item');
    fireEvent.click(item);
    await waitFor(() => expect(useAppStore.getState().selectedClass?.id).toBe('com.shop.Item'), { timeout: 3000 });
    s = useAppStore.getState();
    // span в UML/дереве нет — открывается файл узла без прокрутки.
    expect(s.selectedClass).toEqual({ id: 'com.shop.Item', path: 'src/com/shop/Item.java', span: null });
    expect(s.selectedIssueId).toBeNull();
  }, 20_000);

  it('без циклов — «Циклических зависимостей нет»', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<DependenciesView client={client} />);
    await screen.findAllByTestId('dep-node', {}, { timeout: 10_000 });
    expect(screen.getByText('Циклических зависимостей нет')).toBeInTheDocument();
  }, 20_000);
});
