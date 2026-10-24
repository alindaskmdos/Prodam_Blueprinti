import { beforeEach, describe, expect, it } from 'vitest';
import { revealFor } from '../features/editor-code';
import { resetAppState, useAppStore } from './store';

const FILE = 'src/A.java';
const span = (s: number, e: number) => ({ file: FILE, startLine: s, endLine: e });

describe('store.highlight — подсветка строка ↔ нода (FE-05)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 1);
  });

  it('selectIssue → highlight issue с новым seq на каждый выбор, даже той же проблемы', () => {
    const { selectIssue } = useAppStore.getState();
    selectIssue({ issueId: 'I', methodId: 'm', blockId: 'm/body/0' });
    const first = useAppStore.getState().highlight;
    expect(first).toMatchObject({ source: 'issue', blockId: 'm/body/0', span: null });
    selectIssue({ issueId: 'I', methodId: 'm', blockId: 'm/body/0' });
    const second = useAppStore.getState().highlight;
    expect(second?.seq).toBeGreaterThan(first?.seq ?? Infinity);
  });

  it('selectMethod, openProject другого проекта и снятие выбора проблемы сбрасывают подсветку проблемы', () => {
    const s = useAppStore.getState();
    s.selectIssue({ issueId: 'I', methodId: 'm', blockId: 'b' });
    s.selectIssue(null);
    expect(useAppStore.getState().highlight).toBeNull();

    s.setHighlight({ source: 'canvas', blockId: 'b', span: span(1, 2) });
    s.selectIssue(null);
    expect(useAppStore.getState().highlight?.source).toBe('canvas');
    s.selectMethod('other');
    expect(useAppStore.getState().highlight).toBeNull();

    s.setHighlight({ source: 'code', span: span(3, 3) });
    s.openProject('p-2');
    expect(useAppStore.getState().highlight).toBeNull();
  });

  it('без циклов: событие редактора не возвращается в редактор, событие холста доходит до него один раз', () => {
    const s = useAppStore.getState();
    // Курсор в Monaco → store (code). Редактору подсвечивать нечего (revealFor → null) — ответной записи нет.
    s.setHighlight({ source: 'code', span: span(5, 5) });
    const fromCode = useAppStore.getState().highlight;
    expect(revealFor(fromCode, FILE)).toBeNull();

    // Клик по ноде → store (canvas) → редактор подсвечивает span блока; повторный рендер с тем же событием — тот же seq.
    s.setHighlight({ source: 'canvas', blockId: 'b', span: span(4, 9) });
    const fromCanvas = useAppStore.getState().highlight;
    expect(revealFor(fromCanvas, FILE)).toEqual({ startLine: 4, endLine: 9, seq: fromCanvas?.seq });
    expect(revealFor(fromCanvas, 'src/Other.java')).toBeNull();
  });
});

describe('revealFor', () => {
  it('issue — span проблемы, если он в этом файле', () => {
    const h = { source: 'issue' as const, span: null, seq: 3 };
    expect(revealFor(h, FILE, span(10, 12))).toEqual({ startLine: 10, endLine: 12, seq: 3 });
    expect(revealFor(h, FILE, null)).toBeNull();
    expect(revealFor(h, 'src/B.java', span(10, 12))).toBeNull();
    expect(revealFor(null, FILE, span(1, 1))).toBeNull();
  });
});

describe('store.selectClass — выбор класса из диаграмм (FE-16)', () => {
  beforeEach(() => {
    resetAppState();
    useAppStore.getState().openProject('p-1', 1);
  });

  it('класс сбрасывает метод/проблему/подсветку; метод и проблема сбрасывают класс; seq растёт', () => {
    const s = useAppStore.getState();
    s.selectMethod('a.A.m~0');
    s.setHighlight({ source: 'code', span: span(1, 1) });
    s.selectClass({ id: 'a.A', path: FILE, span: span(2, 9) });
    let st = useAppStore.getState();
    expect(st.selectedClass?.id).toBe('a.A');
    expect(st.selectedMethodId).toBeNull();
    expect(st.highlight).toBeNull();
    s.selectClass({ id: 'a.A', path: FILE, span: span(2, 9) });
    expect(useAppStore.getState().classSelectSeq).toBe(2);

    s.selectMethod('a.A.m~0');
    expect(useAppStore.getState().selectedClass).toBeNull();
    s.selectClass({ id: 'a.A', path: FILE, span: null });
    s.selectIssue({ issueId: 'ISSUE-7' });
    st = useAppStore.getState();
    expect(st.selectedClass).toBeNull();
    expect(st.selectedIssueId).toBe('ISSUE-7');
    s.selectClass({ id: 'a.A', path: FILE, span: null });
    s.openProject('p-2');
    expect(useAppStore.getState().selectedClass).toBeNull();
  });
});
