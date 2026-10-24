import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import treeJson from '@contract/fixtures/tree.json';
import { resetAppState, useAppStore } from '../../app/store';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { CANVAS_METHOD_TAB } from '../layout';
import { resetStructureState, resetTreeState, STRUCTURE_PANEL_ID, useStructureStore, useTreeStore } from '../project-tree';
import { layoutDiagram } from './diagramLayout';
import { resetDiagrams } from './diagramsStore';
import { goToClass, goToMethod } from './navigation';
import { umlToGraph } from './umlGraph';
import { UmlView } from './UmlView';
import styles from './Diagrams.module.css';

const uml = umlJson as unknown as Schemas['UmlDiagram'];
const client = createApiClient('http://localhost/api');

// React Flow в jsdom требует ResizeObserver и DOMMatrixReadOnly.
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
  resetStructureState();
});

const tree = treeJson as unknown as Schemas['ProjectTree'];
const ORDER_SERVICE = 'com.demo.service.OrderService';

function loadTree() {
  useTreeStore.setState({ projectId: 'p-1', state: { kind: 'ok', tree } });
}

describe('переход диаграмма → редактор (общий выбор класса FE-10)', () => {
  it('класс: выбран в дереве, «Свойства» и «Код Java» открыты, проблема снята; нет в дереве — false', () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    useAppStore.getState().selectIssue({ issueId: 'ISSUE-7' });
    expect(goToClass(ORDER_SERVICE)).toBe(true);
    const st = useStructureStore.getState();
    expect(st.selection).toEqual({ kind: 'class', ref: { path: 'src/com/demo/service/OrderService.java', name: 'OrderService' } });
    expect(st.selectSeq).toBe(1);
    const s = useAppStore.getState();
    expect(s.selectedIssueId).toBeNull();
    expect(s.activePanels.right).toBe(STRUCTURE_PANEL_ID);
    expect(s.activePanels.bottom).toBe('bottom.code');
    expect(goToClass(ORDER_SERVICE)).toBe(true);
    expect(useStructureStore.getState().selectSeq).toBe(2);
    expect(goToClass('com.demo.Nope')).toBe(false);
  });

  it('метод: selectedMethodId = UmlMember.id, холст — схема метода, выбор класса снят', () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    goToClass(ORDER_SERVICE);
    useAppStore.getState().showPanel('canvas', 'canvas.uml');
    goToMethod(`${ORDER_SERVICE}.merge~0`);
    const s = useAppStore.getState();
    expect(s.selectedMethodId).toBe(`${ORDER_SERVICE}.merge~0`);
    expect(useStructureStore.getState().selection).toBeNull();
    expect(s.activePanels.canvas).toBe(CANVAS_METHOD_TAB);
    expect(s.activePanels.bottom).toBe('bottom.code');
  });
});

describe('UmlView (MSW, uml.demo.json)', () => {
  it('ELK раскладывает карточки фикстуры без перекрытий', async () => {
    const g = umlToGraph(uml);
    const layout = await layoutDiagram(g.nodes, g.edges);
    const boxes = g.nodes.map((n) => ({ ...n, ...(layout.positions.get(n.id) ?? { x: NaN, y: NaN }) }));
    for (const a of boxes) {
      expect(Number.isFinite(a.x)).toBe(true);
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
    expect(layout.routes.size).toBe(g.edges.length);
  }, 15_000);

  it('рисует карточки, клик по классу → общий выбор класса, клик по методу → схема метода', async () => {
    useAppStore.getState().openProject('p-1', 1);
    loadTree();
    render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    expect(cards).toHaveLength(uml.classes.length);

    const main = cards.find((c) => c.dataset.classId === 'com.demo.Main');
    if (!main) throw new Error('нет карточки Main');
    expect(within(main).getByText('Main')).toBeInTheDocument();
    expect(within(main).getByText('catalog: Catalog')).toBeInTheDocument();
    expect(within(main).getAllByLabelText('private').length).toBeGreaterThan(0);
    // Рёбра (и подписи «эвристика») в jsdom не рисуются — нет размеров нод; их данные проверяет umlGraph.test.ts.

    const order = cards.find((c) => c.dataset.classId === ORDER_SERVICE);
    if (!order) throw new Error('нет карточки OrderService');
    fireEvent.click(within(order).getByTitle(/OrderService — открыть в редакторе/));
    await waitFor(() => expect(useStructureStore.getState().selection?.ref.name).toBe('OrderService'), { timeout: 3000 });
    expect(useAppStore.getState().activePanels.right).toBe(STRUCTURE_PANEL_ID);
    // Выбранная карточка подсвечена (общий выбор → FQN).
    await waitFor(() => expect(order.className).toContain(styles.cardSelected));

    const method = main.querySelector('[data-member-id="com.demo.Main.main~0"]');
    if (!method) throw new Error('нет метода main');
    fireEvent.click(method);
    await waitFor(() => expect(useAppStore.getState().selectedMethodId).toBe('com.demo.Main.main~0'), { timeout: 3000 });
    expect(useAppStore.getState().activePanels.canvas).toBe(CANVAS_METHOD_TAB);
  }, 20_000);

  it('поиск: число найденных; смена версии проекта перезагружает диаграмму', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/projects/:projectId/uml', () => {
        calls++;
        return HttpResponse.json(uml);
      }),
    );
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Найти класс…'), { target: { value: 'order' } });
    expect(screen.getByText(/найдено: \d+/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Найти класс…'), { target: { value: 'zzz' } });
    expect(screen.getByText('не найдено')).toBeInTheDocument();
    expect(calls).toBe(1);
    act(() => useAppStore.getState().setVersion(2));
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getAllByTestId('uml-class')).toHaveLength(uml.classes.length);
  }, 20_000);

  it('ошибка загрузки — сообщение', async () => {
    server.use(http.get('*/api/projects/:projectId/uml', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'нет проекта' }, { status: 404 })));
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('нет проекта');
  });
});
