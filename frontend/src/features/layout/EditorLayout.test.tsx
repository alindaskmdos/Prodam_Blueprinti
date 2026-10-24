import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PanelTabs } from './PanelTabs';
import { EditorLayout } from './EditorLayout';
import { EditorHeader } from './EditorHeader';
import { resetLayoutState, revealArea, useLayoutStore } from './layoutStore';

function layout() {
  return (
    <EditorLayout
      header={<EditorHeader projectName="demo" version={1} entryPoint={null} />}
      left={<p>дерево</p>}
      canvas={<p>холст</p>}
      right={<PanelTabs title="Анализ" collapseArea="right" tabs={[{ id: 'a', title: 'Проблемы', component: () => <p>вкладка</p> }]} />}
      bottom={<p>низ</p>}
    />
  );
}

const rail = () => screen.queryByRole('button', { name: 'Развернуть панель: Анализ' });

describe('сворачивание панелей', () => {
  afterEach(() => resetLayoutState());

  it('кнопка «Свернуть» прячет панель и показывает полосу, клик по полосе разворачивает', () => {
    render(layout());
    expect(rail()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть панель: Анализ' }));
    expect(useLayoutStore.getState().collapsed.right).toBe(true);
    expect(rail()).toBeInTheDocument();
    expect(screen.getByText('вкладка')).toBeInTheDocument(); // содержимое не размонтируется: состояние вкладок сохраняется
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть панель: Анализ' }));
    expect(useLayoutStore.getState().collapsed.right).toBe(false);
    expect(rail()).toBeNull();
  });

  it('кнопки шапки и «Только схема» сворачивают всё и возвращают прежнее состояние', () => {
    render(layout());
    fireEvent.click(screen.getByRole('button', { name: 'Панель: Проект' }));
    expect(useLayoutStore.getState().collapsed).toEqual({ left: true, right: false, bottom: false });
    fireEvent.click(screen.getByRole('button', { name: 'Только схема' }));
    expect(useLayoutStore.getState().collapsed).toEqual({ left: true, right: true, bottom: true });
    expect(screen.getByText('холст')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Только схема' }));
    // вернулось то, что было открыто до режима: дерево осталось свёрнутым
    expect(useLayoutStore.getState().collapsed).toEqual({ left: true, right: false, bottom: false });
  });

  it('revealArea (showPanel) разворачивает свёрнутую панель', () => {
    render(layout());
    act(() => useLayoutStore.getState().setCollapsed('right', true));
    expect(rail()).toBeInTheDocument();
    act(() => revealArea('right'));
    expect(rail()).toBeNull();
    expect(useLayoutStore.getState().collapsed.right).toBe(false);
  });
});
