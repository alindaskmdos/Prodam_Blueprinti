import { lazy, Suspense } from 'react';
import { PanelStub } from '../layout';

// Диаграммы — отдельный чанк: код вкладок грузится при первом открытии, основной бандл не растёт.
const LazyUml = lazy(() => import('./UmlView'));

/** Вкладка «UML» центральной зоны (реестр panels.ts). */
export function UmlTab() {
  return (
    <Suspense fallback={<PanelStub text="Загрузка UML…" />}>
      <LazyUml />
    </Suspense>
  );
}
