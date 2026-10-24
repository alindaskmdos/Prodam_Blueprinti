import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import umlJson from '@contract/fixtures/uml.demo.json';
import treeJson from '@contract/fixtures/tree.json';
import { resetAppState, useAppStore } from '../../app/store';
import { server } from '../../mocks/server';
import { createApiClient, type Schemas } from '../api';
import { CANVAS_METHOD_TAB } from '../layout';
import { resetTreeState, useTreeStore } from '../project-tree';
import { layoutDiagram } from './diagramLayout';
import { resetDiagrams, useDiagramsStore } from './diagramsStore';
import { classLocation, goToClass, goToMethod } from './navigation';
import { umlToGraph } from './umlGraph';
import { UmlView } from './UmlView';

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
});

describe('переход диаграмма → редактор (стор)', () => {
  it('класс: выбран в дереве (selectedClass), метод сброшен, открыта вкладка кода', () => {
    useAppStore.getState().openProject('p-1', 1);
    useAppStore.getState().selectMethod('x.Y.z~0');
    const span = { file: 'src/A.java', startLine: 3, endLine: 9 };
    goToClass({ id: 'a.A', path: 'src/A.java', span });
    const s = useAppStore.getState();
    expect(s.selectedClass).toEqual({ id: 'a.A', path: 'src/A.java', span });
    expect(s.selectedMethodId).toBeNull();
    expect(s.classSelectSeq).toBe(1);
    expect(s.activePanels.bottom).toBe('bottom.code');
  });

  it('метод: selectedMethodId = UmlMember.id, холст — схема метода, класс сброшен', () => {
    useAppStore.getState().openProject('p-1', 1);
    goToClass({ id: 'a.A', path: 'src/A.java', span: null });
    useAppStore.getState().showPanel('canvas', 'canvas.uml');
    goToMethod('a.A.run~0');
    const s = useAppStore.getState();
    expect(s.selectedMethodId).toBe('a.A.run~0');
    expect(s.selectedClass).toBeNull();
    expect(s.activePanels.canvas).toBe(CANVAS_METHOD_TAB);
    expect(s.activePanels.bottom).toBe('bottom.code');
  });

  it('classLocation: span из UML, иначе из дерева по fqn, иначе только файл', () => {
    expect(classLocation('com.demo.service.OrderService', 'fallback.java')).toEqual({
      id: 'com.demo.service.OrderService',
      path: 'fallback.java',
      span: null,
    });
    useTreeStore.setState({ projectId: 'p-1', state: { kind: 'ok', tree: treeJson as unknown as Schemas['ProjectTree'] } });
    expect(classLocation('com.demo.service.OrderService')?.span).toEqual({
      file: 'src/com/demo/service/OrderService.java',
      startLine: 11,
      endLine: 139,
    });
    useDiagramsStore.setState({ uml: { key: 'p-1#1', projectId: 'p-1', status: 'ok', data: uml, message: null } });
    const main = uml.classes.find((c) => c.id === 'com.demo.Main');
    expect(classLocation('com.demo.Main')).toEqual({ id: 'com.demo.Main', path: main?.path, span: main?.span });
    expect(classLocation('nope')).toBeNull();
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

  it('рисует карточки, клик по классу → selectedClass со span, клик по методу → схема метода', async () => {
    useAppStore.getState().openProject('p-1', 1);
    render(<UmlView client={client} />);
    const cards = await screen.findAllByTestId('uml-class', {}, { timeout: 10_000 });
    expect(cards).toHaveLength(uml.classes.length);

    const main = cards.find((c) => c.dataset.classId === 'com.demo.Main');
    if (!main) throw new Error('нет карточки Main');
    expect(within(main).getByText('Main')).toBeInTheDocument();
    expect(within(main).getByText('catalog: Catalog')).toBeInTheDocument();
    expect(within(main).getAllByLabelText('private').length).toBeGreaterThan(0);
    // Рёбра (и подписи «эвристика») в jsdom не рисуются — нет размеров нод; их данные проверяет umlGraph.test.ts.

    fireEvent.click(within(main).getByTitle(/com\.demo\.Main — открыть в редакторе/));
    await waitFor(() => expect(useAppStore.getState().selectedClass?.id).toBe('com.demo.Main'), { timeout: 3000 });
    const mainCls = uml.classes.find((c) => c.id === 'com.demo.Main');
    expect(useAppStore.getState().selectedClass?.span).toEqual(mainCls?.span);

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
