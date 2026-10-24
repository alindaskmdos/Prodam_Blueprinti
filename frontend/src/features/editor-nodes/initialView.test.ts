import { describe, expect, it } from 'vitest';
import { MIN_READABLE_ZOOM, TOP_BAR_INSET, computeInitialView, graphBounds } from './initialView';

const size = { width: 1000, height: 600 };

describe('graphBounds', () => {
  it('складывает смещения родительских групп', () => {
    const b = graphBounds([
      { id: 'g', position: { x: 100, y: 50 }, width: 300, height: 400 },
      { id: 'n', parentId: 'g', position: { x: 10, y: 20 }, width: 100, height: 40 },
    ]);
    expect(b).toEqual({ x: 100, y: 50, width: 300, height: 400 });
  });
  it('пустая схема — null', () => {
    expect(graphBounds([])).toBeNull();
  });
});

describe('computeInitialView', () => {
  it('небольшая схема — обычный fitView', () => {
    expect(computeInitialView({ x: 0, y: 0, width: 600, height: 400 }, size)).toEqual({ mode: 'fit' });
  });
  it('неизвестный размер холста или пустая схема — fitView', () => {
    expect(computeInitialView({ x: 0, y: 0, width: 300, height: 6000 }, null)).toEqual({ mode: 'fit' });
    expect(computeInitialView(null, size)).toEqual({ mode: 'fit' });
  });
  it('высокая узкая схема: масштаб не ниже порога, верх виден, схема по центру', () => {
    const v = computeInitialView({ x: 50, y: 20, width: 300, height: 6000 }, size);
    expect(v.mode).toBe('top');
    if (v.mode !== 'top') return;
    expect(v.viewport.zoom).toBeGreaterThanOrEqual(MIN_READABLE_ZOOM);
    expect(v.viewport.zoom).toBeLessThanOrEqual(1);
    const top = 20 * v.viewport.zoom + v.viewport.y;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(size.height / 2);
    const cx = (50 + 150) * v.viewport.zoom + v.viewport.x;
    expect(cx).toBeCloseTo(size.width / 2);
  });
  it('очень широкая и высокая схема: масштаб = порог, левый край (нода метода) виден', () => {
    const v = computeInitialView({ x: 0, y: 0, width: 5000, height: 8000 }, size);
    expect(v.mode).toBe('top');
    if (v.mode !== 'top') return;
    expect(v.viewport.zoom).toBe(MIN_READABLE_ZOOM);
    expect(v.viewport.x).toBeGreaterThanOrEqual(0);
  });
  it('поля оверлеев: верх схемы начинается ниже верхней панели', () => {
    const insets = { top: TOP_BAR_INSET, right: 0, bottom: 0, left: 0 };
    const v = computeInitialView({ x: 50, y: 20, width: 300, height: 6000 }, size, MIN_READABLE_ZOOM, insets);
    expect(v.mode).toBe('top');
    if (v.mode !== 'top') return;
    expect(20 * v.viewport.zoom + v.viewport.y).toBeGreaterThanOrEqual(TOP_BAR_INSET);
    expect(computeInitialView({ x: 0, y: 0, width: 600, height: 400 }, size, MIN_READABLE_ZOOM, insets)).toEqual({ mode: 'fit' });
  });
  it('занятая правая часть (мини-карта) не перекрывает схему', () => {
    const insets = { top: 0, right: 300, bottom: 0, left: 0 };
    const v = computeInitialView({ x: 0, y: 0, width: 300, height: 6000 }, size, MIN_READABLE_ZOOM, insets);
    expect(v.mode).toBe('top');
    if (v.mode !== 'top') return;
    expect(300 * v.viewport.zoom + v.viewport.x).toBeLessThanOrEqual(size.width - insets.right);
  });
});
