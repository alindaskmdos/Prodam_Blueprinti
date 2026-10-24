import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
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
  const tree = useTreeStore((s) => s.state);
  if (!selection || selection.kind !== 'class' || tree.kind !== 'ok') return null;
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

/**
 * Общий переход «диаграмма → редактор» (UML и граф зависимостей). Должен вызываться внутри ReactFlowProvider.
 * `fly(nodeId, then)`: камера плавно летит к ноде (setCenter с duration), затем `then()` — переход.
 * При prefers-reduced-motion — без анимации, переход сразу.
 */
export function useFlyTo(): (nodeId: string, then: () => void) => void {
  const rf = useReactFlow();
  return useCallback(
    (nodeId, then) => {
      const node = rf.getInternalNode(nodeId);
      const reduced = prefersReducedMotion();
      if (!node || reduced) {
        then();
        return;
      }
      const { x, y } = node.internals.positionAbsolute;
      const w = node.measured?.width ?? node.width ?? 0;
      const h = node.measured?.height ?? node.height ?? 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        then();
      };
      // setCenter обещает завершение анимации; таймер — страховка (вкладка в фоне, d3 без кадров).
      void Promise.resolve(rf.setCenter(x + w / 2, y + h / 2, { zoom: Math.max(rf.getZoom(), FLY_ZOOM), duration: FLY_MS })).then(
        finish,
        finish,
      );
      window.setTimeout(finish, FLY_MS + 120);
    },
    [rf],
  );
}

/** Fit View с плавной анимацией (без неё при prefers-reduced-motion). Внутри ReactFlowProvider. */
export function useFitView(): () => void {
  const rf = useReactFlow();
  return useCallback(() => {
    void rf.fitView({ padding: 0.12, duration: prefersReducedMotion() ? 0 : 450 });
  }, [rf]);
}
