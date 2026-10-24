import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow, useStoreApi } from '@xyflow/react';
import { useAppStore } from '../../app/store';
import { CANVAS_METHOD_TAB } from '../layout';
import { prefersReducedMotion } from '../editor-nodes';
import { findClass, fqnOf, selectClass, useStructureStore, useTreeStore } from '../project-tree';

/** Вкладка кода в нижней зоне (panels.ts). */
const CODE_TAB = 'bottom.code';

/**
 * Класс → редактор через общий выбор класса FE-10 (`selectClass` из project-tree): класс выделен в дереве,
 * открыта его форма «Свойства», вкладка «Код Java» прокручена к span класса. Класса нет в дереве — false.
 */
export function goToClass(fqn: string): boolean {
  return selectClass(fqn);
}

/** FQN класса, выбранного в общем выборе (дерево/UML/граф/палитра); не класс — null. */
export function useSelectedClassFqn(): string | null {
  const selection = useStructureStore((s) => s.selection);
  const projectId = useAppStore((s) => s.projectId);
  const tree = useTreeStore((s) => (s.projectId === projectId ? s.state : null));
  if (!selection || selection.kind !== 'class' || tree?.kind !== 'ok') return null;
  const found = findClass(tree.tree, selection.ref);
  return found ? fqnOf(found) : null;
}

/** Метод/конструктор (UmlMember.id = MethodId) → схема метода на холсте и Monaco на методе (как FE-35). */
export function goToMethod(methodId: string): void {
  const app = useAppStore.getState();
  app.selectMethod(methodId);
  app.showPanel('bottom', CODE_TAB);
  app.showPanel('canvas', CANVAS_METHOD_TAB);
}

/**
 * Цикл зависимостей → его Issue CyclicDependency (cycles[].issueId): выбор проблемы (без метода и blockId —
 * схема не меняется), вкладка «Проблемы» и код по span проблемы.
 */
export function goToCycleIssue(issueId: string): void {
  const app = useAppStore.getState();
  app.selectIssue({ issueId });
  app.showPanel('right', 'analysis.problems');
  app.showPanel('bottom', CODE_TAB);
}

/** Длительность «полёта» к карточке перед переходом в редактор. */
export const FLY_MS = 520;
const FLY_ZOOM = 1.15;

/** Сверху холста — панель поиска/легенда, снизу — кнопки масштаба: карточка не должна уходить под них. */
const TOP_INSET = 64;
const BOTTOM_INSET = 24;

/**
 * Куда навести камеру, чтобы карточка `box` при масштабе `zoom` была видна в окне `viewport`: целиком — по центру
 * свободной полосы между панелями; не помещается — верх карточки (заголовок и первые члены) под верхней панелью.
 */
export function flyTarget(
  box: { x: number; y: number; width: number; height: number },
  zoom: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const free = viewport.height - TOP_INSET - BOTTOM_INSET;
  if (box.height * zoom <= free) {
    // Центр свободной полосы смещён вверх на (BOTTOM_INSET − TOP_INSET) / 2 относительно центра окна.
    return { x: cx, y: box.y + box.height / 2 + (BOTTOM_INSET - TOP_INSET) / 2 / zoom };
  }
  return { x: cx, y: box.y + (viewport.height / 2 - TOP_INSET) / zoom };
}

/**
 * Общий переход «диаграмма → редактор» (UML и граф зависимостей). Должен вызываться внутри ReactFlowProvider.
 * `fly(nodeId, then)`: камера плавно летит к ноде (setCenter с duration), затем `then()` — переход.
 * При prefers-reduced-motion — без анимации, переход сразу. Размонтирование (смена вкладки) или смена проекта
 * во время полёта отменяют переход: `then()` не вызывается.
 */
export function useFlyTo(): (nodeId: string, then: () => void, onCancel?: () => void) => void {
  const rf = useReactFlow();
  const store = useStoreApi();
  const pending = useRef<{ cancelled: boolean; timer: number; onCancel?: () => void } | null>(null);
  const projectId = useAppStore((s) => s.projectId);
  const cancel = useCallback(() => {
    const token = pending.current;
    if (token) {
      token.cancelled = true;
      window.clearTimeout(token.timer);
      pending.current = null;
      token.onCancel?.();
    }
  }, []);
  useEffect(() => cancel, [cancel, projectId]);
  return useCallback(
    (nodeId, then, onCancel) => {
      cancel();
      const node = rf.getInternalNode(nodeId);
      if (!node || prefersReducedMotion()) {
        then();
        return;
      }
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured?.width ?? node.width ?? 0;
      const height = node.measured?.height ?? node.height ?? 0;
      const zoom = Math.max(rf.getZoom(), FLY_ZOOM);
      const { width: vw, height: vh } = store.getState();
      const target = flyTarget({ x, y, width, height }, zoom, { width: vw, height: vh });
      const token: { cancelled: boolean; timer: number; onCancel?: () => void } = { cancelled: false, timer: 0, onCancel };
      const finish = () => {
        if (token.cancelled) return;
        token.cancelled = true;
        window.clearTimeout(token.timer);
        if (pending.current === token) pending.current = null;
        then();
      };
      // setCenter обещает завершение анимации; таймер — страховка (вкладка в фоне, d3 без кадров).
      token.timer = window.setTimeout(finish, FLY_MS + 120);
      pending.current = token;
      void Promise.resolve(rf.setCenter(target.x, target.y, { zoom, duration: FLY_MS })).then(finish, finish);
    },
    [rf, store, cancel],
  );
}

/** Поля Fit View: сверху — панель поиска, чтобы верхний ряд карточек не лежал под ней. */
export const FIT_PADDING = { top: '76px', right: '24px', bottom: '24px', left: '24px' } as const;

/** Fit View с плавной анимацией (без неё при prefers-reduced-motion). Внутри ReactFlowProvider. */
export function useFitView(): () => void {
  const rf = useReactFlow();
  return useCallback(() => {
    void rf.fitView({ padding: FIT_PADDING, duration: prefersReducedMotion() ? 0 : 450 });
  }, [rf]);
}
