import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAppStore, type ClassSelection } from '../../app/store';
import type { Schemas } from '../api';
import { CANVAS_METHOD_TAB } from '../layout';
import { prefersReducedMotion } from '../editor-nodes';
import { useTreeStore } from '../project-tree';
import { useDiagramsStore } from './diagramsStore';

/** Вкладка кода в нижней зоне (panels.ts). */
const CODE_TAB = 'bottom.code';

/**
 * Класс → редактор: выбор класса в дереве проекта (`selectedClass`) и вкладка «Код Java» с прокруткой
 * к span класса. Диаграмма остаётся открытой.
 */
export function goToClass(target: ClassSelection): void {
  const app = useAppStore.getState();
  app.selectClass(target);
  app.showPanel('bottom', CODE_TAB);
}

/** Метод/конструктор (UmlMember.id = MethodId) → схема метода на холсте и Monaco на методе (как FE-35). */
export function goToMethod(methodId: string): void {
  const app = useAppStore.getState();
  app.selectMethod(methodId);
  app.showPanel('bottom', CODE_TAB);
  app.showPanel('canvas', CANVAS_METHOD_TAB);
}

/** Классы дерева проекта (с вложенными, если они есть в файле). */
function* treeClasses(tree: Schemas['ProjectTree']): Generator<{ cls: Schemas['ClassNode']; path: string }> {
  for (const pkg of tree.packages) for (const file of pkg.files) for (const cls of file.classes) yield { cls, path: file.path };
}

/**
 * Где класс в коде: span из UML (если загружен), иначе ClassNode.span из дерева по fqn, иначе — только файл
 * (`fallbackPath`, напр. DependencyGraph.nodes[].path) без прокрутки.
 */
export function classLocation(id: string, fallbackPath: string | null = null): ClassSelection | null {
  const uml = useDiagramsStore.getState().uml.data?.classes.find((c) => c.id === id);
  if (uml) return { id, path: uml.path, span: uml.span };
  const tree = useTreeStore.getState().state;
  if (tree.kind === 'ok') {
    for (const { cls, path } of treeClasses(tree.tree)) {
      if (cls.fqn === id) return { id, path, span: cls.span ?? null };
    }
  }
  return fallbackPath ? { id, path: fallbackPath, span: null } : null;
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
