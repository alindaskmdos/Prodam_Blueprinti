import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { blocksToGraph, HEAD_SUFFIX } from './blocksToGraph';
import { centerOnNode, FOCUS_DURATION_MS, flowNodeOfBlock, useFocusCenter, type CenterApi } from './focus';
import { toFlow } from './toFlow';

const M = 'com.demo.service.OrderService.merge~0';

/** Мок экземпляра React Flow: ноды с абсолютными координатами. */
function mockFlow(nodes: Record<string, { x: number; y: number; w: number; h: number }>, zoom = 0.5) {
  const setCenter = vi.fn(() => Promise.resolve(true));
  const rf: CenterApi = {
    getInternalNode: (id) => {
      const n = nodes[id];
      return n ? { internals: { positionAbsolute: { x: n.x, y: n.y } }, measured: { width: n.w, height: n.h } } : undefined;
    },
    setCenter,
    getZoom: () => zoom,
  };
  return { rf, setCenter };
}

describe('flowNodeOfBlock', () => {
  const graph = blocksToGraph(fixtures.methodViewMerge.root);
  const nodes = toFlow({
    nodes: graph.nodes.map((n) => ({ ...n, x: 0, y: 0, width: 10, height: 10 })),
    edges: [],
  }).nodes;

  it('лист — своя нода, контейнер — его заголовок, нет блока — null', () => {
    expect(flowNodeOfBlock(nodes, `${M}/body/0`)).toBe(`${M}/body/0`);
    expect(flowNodeOfBlock(nodes, `${M}/body/1/body/2`)).toBe(`${M}/body/1/body/2${HEAD_SUFFIX}`);
    expect(flowNodeOfBlock(nodes, 'other/method')).toBeNull();
  });
});

describe('centerOnNode', () => {
  it('центр ноды в абсолютных координатах, масштаб не меньше 1, анимация', () => {
    const { rf, setCenter } = mockFlow({ a: { x: 100, y: 200, w: 40, h: 20 } });
    expect(centerOnNode(rf, 'a', false)).toBe(true);
    expect(setCenter).toHaveBeenCalledWith(120, 210, { zoom: 1, duration: FOCUS_DURATION_MS });
  });

  it('prefers-reduced-motion — без анимации; крупный масштаб сохраняется', () => {
    const { rf, setCenter } = mockFlow({ a: { x: 0, y: 0, w: 10, h: 10 } }, 1.5);
    centerOnNode(rf, 'a', true);
    expect(setCenter).toHaveBeenCalledWith(5, 5, { zoom: 1.5, duration: 0 });
  });

  it('поля оверлеев: нода центрируется в свободной области (центр вида сдвинут)', () => {
    const { rf, setCenter } = mockFlow({ a: { x: 100, y: 200, w: 40, h: 20 } }, 1);
    const area = { size: { width: 800, height: 600 }, insets: { top: 60, right: 100, bottom: 0, left: 20 } };
    centerOnNode(rf, 'a', true, area);
    // сдвиг по x: (100 - 20) / 2 = 40, по y: (0 - 60) / 2 = -30
    expect(setCenter).toHaveBeenCalledWith(160, 180, { zoom: 1, duration: 0 });
  });

  it('нет ноды — false, setCenter не вызывается', () => {
    const { rf, setCenter } = mockFlow({});
    expect(centerOnNode(rf, 'a', true)).toBe(false);
    expect(setCenter).not.toHaveBeenCalled();
  });
});

describe('useFocusCenter — выбор проблемы центрирует схему', () => {
  const nodes = { a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 100, y: 100, w: 10, h: 10 } };

  it('новый seq → центрирование один раз; та же цель с тем же seq — повторно не двигает', () => {
    const { rf, setCenter } = mockFlow(nodes);
    const done = { current: null as number | null };
    const { rerender } = renderHook(({ target, seq }) => useFocusCenter(rf, target, seq, done), {
      initialProps: { target: null as string | null, seq: null as number | null },
    });
    expect(setCenter).not.toHaveBeenCalled();

    rerender({ target: 'a', seq: 1 });
    expect(setCenter).toHaveBeenCalledTimes(1);
    expect(setCenter.mock.calls[0]?.slice(0, 2)).toEqual([5, 5]);
    rerender({ target: 'a', seq: 1 });
    expect(setCenter).toHaveBeenCalledTimes(1);

    // Повторный выбор той же проблемы — новый seq.
    rerender({ target: 'a', seq: 2 });
    expect(setCenter).toHaveBeenCalledTimes(2);
    rerender({ target: 'b', seq: 3 });
    expect(setCenter).toHaveBeenLastCalledWith(105, 105, expect.anything());
  });

  it('блока ещё нет (дерево другого метода грузится) — центрирует, когда нода появилась', () => {
    const { rf, setCenter } = mockFlow(nodes);
    const done = { current: null as number | null };
    const { rerender } = renderHook(({ target, seq }) => useFocusCenter(rf, target, seq, done), {
      initialProps: { target: null as string | null, seq: 5 as number | null },
    });
    expect(setCenter).not.toHaveBeenCalled();
    rerender({ target: 'b', seq: 5 });
    expect(setCenter).toHaveBeenCalledTimes(1);
    expect(done.current).toBe(5);
  });

  it('цель есть при первом показе схемы — её показал начальный fitView, setCenter не нужен', () => {
    const { rf, setCenter } = mockFlow(nodes);
    const done = { current: null as number | null };
    const { rerender } = renderHook(({ target, seq }) => useFocusCenter(rf, target, seq, done), {
      initialProps: { target: 'a' as string | null, seq: 7 as number | null },
    });
    expect(setCenter).not.toHaveBeenCalled();
    expect(done.current).toBe(7);
    rerender({ target: 'a', seq: 8 });
    expect(setCenter).toHaveBeenCalledTimes(1);
  });
});
