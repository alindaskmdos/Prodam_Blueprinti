import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { blocksToGraph } from './blocksToGraph';
import { getElk, layoutGraph, resetElkForTests, type Positioned } from './layout';
import { toFlow } from './toFlow';
import { allKindsMethod, b } from './testTree';

describe('layoutGraph (ELK)', () => {
  it('раскладывает все kind: дети внутри родителя, цепочка сверху вниз, соседи не пересекаются', async () => {
    const graph = blocksToGraph(allKindsMethod());
    const { nodes } = await layoutGraph(graph);
    expect(nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
    const byId = new Map(nodes.map((n) => [n.id, n]));

    for (const n of nodes) {
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
      if (n.parentId) {
        const p = byId.get(n.parentId) as Positioned;
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.width).toBeLessThanOrEqual(p.width + 0.5);
        expect(n.y + n.height).toBeLessThanOrEqual(p.height + 0.5);
      }
    }

    // Последовательные рёбра идут сверху вниз (источник выше цели).
    for (const e of graph.edges) {
      const s = byId.get(e.source) as Positioned;
      const t = byId.get(e.target) as Positioned;
      expect(s.y + s.height).toBeLessThanOrEqual(t.y + 0.5);
    }

    // Ноды одного уровня не перекрываются.
    const groups = new Map<string, Positioned[]>();
    for (const n of nodes) groups.set(n.parentId ?? '', [...(groups.get(n.parentId ?? '') ?? []), n]);
    for (const siblings of groups.values()) {
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          const a = siblings[i] as Positioned;
          const c = siblings[j] as Positioned;
          const overlap = a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
          expect(overlap, `${a.id} × ${c.id}`).toBe(false);
        }
      }
    }
  });

  it('toFlow: только просмотр — без перетаскивания, соединения и удаления; стрелки с наконечником', async () => {
    const view = fixtures.methodViewMerge;
    const flow = toFlow(await layoutGraph(blocksToGraph(view.root, { methodBadge: view.complexity })));
    for (const n of flow.nodes) {
      expect(n.draggable).toBe(false);
      expect(n.connectable).toBe(false);
      expect(n.deletable).toBe(false);
    }
    for (const e of flow.edges) {
      expect(e.reconnectable).toBe(false);
      expect(e.deletable).toBe(false);
      expect(e.markerEnd).toBeDefined();
    }
    const inner = flow.nodes.find((n) => n.id === 'com.demo.service.OrderService.merge~0/body/1/body/2');
    expect(inner?.parentId).toBe('com.demo.service.OrderService.merge~0/body/1');
  });

  describe('getElk', () => {
    afterEach(() => {
      vi.doUnmock('elkjs/lib/elk.bundled.js');
      vi.unstubAllGlobals();
      resetElkForTests();
    });

    it('неудача создания не кэшируется: следующий вызов пробует снова', async () => {
      resetElkForTests();
      vi.doMock('elkjs/lib/elk.bundled.js', () => {
        throw new Error('нет ELK');
      });
      await expect(getElk()).rejects.toThrow();
      vi.doUnmock('elkjs/lib/elk.bundled.js');
      vi.resetModules();
      const elk = await getElk();
      expect(typeof elk.layout).toBe('function');
    });

    it('воркер не создаётся — уходит на bundled в основном потоке', async () => {
      resetElkForTests();
      // Конструктор Worker, который падает (как при запрете CSP).
      vi.stubGlobal(
        'Worker',
        vi.fn(() => {
          throw new Error('CSP');
        }),
      );
      const elk = await getElk();
      const laid = await elk.layout({ id: 'r', children: [{ id: 'a', width: 10, height: 10 }] });
      expect(laid.children?.[0]?.width).toBe(10);
    });
  });
});

describe('layoutGraph — с местами вставки (FE-08)', () => {
  it('ноды «+» внутри своих групп, без перекрытий с соседями', async () => {
    const graph = blocksToGraph(allKindsMethod(), { insertable: true });
    const { nodes } = await layoutGraph(graph);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const groups = new Map<string, Positioned[]>();
    for (const n of nodes) {
      if (n.parentId) {
        const p = byId.get(n.parentId) as Positioned;
        expect(n.x + n.width).toBeLessThanOrEqual(p.width + 0.5);
        expect(n.y + n.height).toBeLessThanOrEqual(p.height + 0.5);
      }
      groups.set(n.parentId ?? '', [...(groups.get(n.parentId ?? '') ?? []), n]);
    }
    for (const siblings of groups.values()) {
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          const a = siblings[i] as Positioned;
          const c = siblings[j] as Positioned;
          const overlap = a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
          expect(overlap, `${a.id} × ${c.id}`).toBe(false);
        }
      }
    }
  });
});

describe('layoutGraph — switch с множеством case (FE-29)', () => {
  const MAX_WIDTH = 900;
  const switchOf = (n: number) =>
    b('method', { signature: 'void f()' }, {
      body: [
        b('switch', { selector: 'x' }, {
          cases: Array.from({ length: n }, (_, i) => b('case', { label: String(i) }, { body: [b('expr', { text: `run${i}()` })] })),
        }),
      ],
    });

  it('16 case не раскладываются в одну строку: ширина switch не больше порога, ветки столбцом', async () => {
    const { nodes } = await layoutGraph(blocksToGraph(switchOf(16)));
    const sw = nodes.find((n) => n.type === 'container' && n.data.kind === 'switch') as Positioned;
    expect(sw.width).toBeLessThanOrEqual(MAX_WIDTH);
    const slots = nodes.filter((n) => n.type === 'container' && n.data.kind === 'case');
    expect(slots).toHaveLength(16);
    expect(new Set(slots.map((s) => Math.round(s.x))).size).toBe(1);
    expect(sw.height).toBeGreaterThan(sw.width);
  });

  it('switch с несколькими case по-прежнему в строку', async () => {
    const { nodes } = await layoutGraph(blocksToGraph(switchOf(2)));
    const sw = nodes.find((n) => n.type === 'container' && n.data.kind === 'switch') as Positioned;
    const slots = nodes.filter((n) => n.type === 'container' && n.data.kind === 'case');
    expect(slots).toHaveLength(2);
    expect(sw.width).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => Math.round(s.y))).size).toBe(1);
  });
});

describe('layoutGraph — веер без «+» и catch (FE-29)', () => {
  const caseBlocks = (n: number) =>
    Array.from({ length: n }, (_, i) => b('case', { label: String(i) }, { body: [b('expr', { text: `run${i}()` })] }));

  it('try с 5 catch раскладывается столбцом', async () => {
    const catches = Array.from({ length: 5 }, (_, i) => b('catch', { type: `E${i}`, var: 'e' }, { body: [b('expr', { text: `h${i}()` })] }));
    const root = b('method', { signature: 'void f()' }, {
      body: [b('try', {}, { body: [b('expr', { text: 'run()' })], catches })],
    });
    const { nodes } = await layoutGraph(blocksToGraph(root));
    const cs = nodes.filter((n) => n.type === 'container' && n.data.kind === 'catch');
    expect(cs).toHaveLength(5);
    expect(new Set(cs.map((c) => Math.round(c.x))).size).toBe(1);
  });

  it('3 case в режиме правки («+ case» не в счёте) остаются в строке', async () => {
    const root = b('method', { signature: 'void f()' }, { body: [b('switch', { selector: 'x' }, { cases: caseBlocks(3) })] });
    const { nodes } = await layoutGraph(blocksToGraph(root, { insertable: true }));
    const cs = nodes.filter((n) => n.type === 'container' && n.data.kind === 'case');
    expect(new Set(cs.map((c) => Math.round(c.y))).size).toBe(1);
  });
});
