# diagrams

Диаграммы проекта (ТЗ §14а.1) во вкладках центральной зоны рядом со «схемой метода». React Flow + ELK (общий воркер `getElk` из editor-nodes). Код — в ленивом чанке: `index.ts` отдаёт только обёртки `UmlTab` (`lazyTabs.tsx`, Suspense), регистрация — `src/app/panels.ts` (`area: 'canvas'`), команда палитры `view.uml`.

- `UmlView` — `GET /projects/{id}/uml` (`useDiagram`, `diagramsStore.ts`: кэш по `projectId#version`, перезагрузка при смене версии, старая диаграмма видна до ответа). Карточка `ClassCard`: стереотип kind, имя + typeParams, поля «name: Type» (JDK — только текстом), конструкторы, методы; видимость значком + − # ~, static подчёркнут, abstract курсивом.
- Рёбра (`edges.tsx`, `edgeGeometry.ts`): ломаные ELK, UML-маркеры — наследование полый треугольник, реализация пунктир + треугольник, ассоциация стрелка, зависимость пунктир + стрелка, агрегация/композиция полый/залитый ромб у целого; кратность у конца, `heuristic` — подпись «эвристика». Легенда внизу.
- `umlGraph.ts` (чистые): `umlToGraph` (наследование — обратным ребром, родитель выше; связи к чужим классам отбрасываются), `cardSize` (= CSS), `visibilityOf`, `memberText`, `matchClasses`, `neighborsOf`. `umlFlow.ts` — модель + раскладка + наведение/поиск → ноды и рёбра React Flow. `diagramLayout.ts` — `toElk`/`fromElk`/`layoutDiagram`.
- Наведение на карточку подсвечивает её связи, остальное приглушено. Поиск класса (Enter — к первому), Fit View, мини-карта.
- Переход в редактор (`navigation.ts`): `useFlyTo` — карточка подсвечивается, камера летит к ней (`setCenter` с duration; при prefers-reduced-motion — сразу), затем `goToClass` (store `selectClass`: класс выделен в дереве, вкладка «Код Java» с прокруткой к span класса) или `goToMethod` (`selectMethod(UmlMember.id)`, холст — схема метода, Monaco на методе как FE-35). `classLocation(id)` — span класса из UML / дерева.

Тесты: `umlGraph.test.ts` (преобразования, нотация, наведение, раскладка), `UmlView.test.tsx` (MSW `uml.demo.json`: ELK без перекрытий, карточки, клик → стор, поиск, версия, ошибка). `npm test`.
