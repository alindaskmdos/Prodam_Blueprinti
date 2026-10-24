import { describe, expect, it } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { gateSteps, NOT_DETAILED, parseUnifiedDiff, verdictOf } from './gate';

describe('parseUnifiedDiff', () => {
  it('fix.applied.json: файл, ханк, счётчики и номера строк новой версии', () => {
    const d = parseUnifiedDiff(fixtures.fixApplied.diff);
    expect(d.files).toEqual(['src/com/demo/service/OrderService.java']);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(3);
    const firstCtx = d.lines.find((l) => l.kind === 'ctx');
    expect(firstCtx).toEqual({ kind: 'ctx', text: '    public int merge() {', line: 37 });
    const firstAdd = d.lines.find((l) => l.kind === 'add');
    expect(firstAdd?.line).toBe(38);
    expect(d.lines.find((l) => l.kind === 'del')?.line).toBeNull();
  });

  it('пустой diff → нет строк', () => {
    expect(parseUnifiedDiff(undefined).lines).toEqual([]);
  });
});

describe('verdictOf / gateSteps', () => {
  it('applied + green → подтверждено, все шаги ок', () => {
    expect(verdictOf(fixtures.fixApplied)).toEqual({ kind: 'confirmed' });
    const steps = gateSteps(fixtures.fixApplied, 'index-by-key');
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'skip']);
    expect(steps[0]?.detail).toBe('OrderService.java');
    expect(steps[2]?.detail).toBe('2 из 2');
  });

  it('rejected с verify → причина дословно, провален шаг IO-тестов', () => {
    expect(verdictOf(fixtures.fixRejected)).toEqual({
      kind: 'rejected',
      reason: 'исправление не подтверждено: тест merge не проходит после фикса',
    });
    const steps = gateSteps(fixtures.fixRejected, 'f');
    expect(steps.map((s) => s.status)).toEqual(['ok', 'ok', 'fail', 'skip']);
    expect(steps[2]?.detail).toBe('1 из 2 · merge');
  });

  it('rejected без verify → шаги не угадываются: все «сервер не детализировал», причина дословно', () => {
    for (const reason of [
      'исправление не подтверждено: код не компилируется после фикса: x',
      'исправление не подтверждено: фикс неприменим к X',
    ]) {
      const r = { applied: false, version: 3, reason };
      const steps = gateSteps(r, 'f');
      expect(steps.map((s) => s.status)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
      expect(steps.every((s) => s.detail === NOT_DETAILED)).toBe(true);
      expect(verdictOf(r)).toEqual({ kind: 'rejected', reason });
    }
  });

  it('applied без verify → патч и компиляция ок, тесты не детализированы, без выдуманной причины', () => {
    const r = { applied: true, version: 4, diff: fixtures.fixApplied.diff };
    expect(gateSteps(r, 'f').map((s) => s.status)).toEqual(['ok', 'ok', 'unknown', 'unknown']);
    const v = verdictOf(r);
    expect(v.kind).toBe('incomplete');
    expect(v.kind === 'incomplete' && v.reason).toBe('Сервер не прислал результат проверки тестами.');
    // С reason от сервера — он дословно.
    expect(verdictOf({ ...r, reason: 'применено, проверка неполная: шум' })).toEqual({
      kind: 'incomplete',
      reason: 'применено, проверка неполная: шум',
    });
  });

  it('applied без тестов → неполная проверка, reason дословно', () => {
    const r = { applied: true, version: 4, reason: 'подтверждена компиляция, тестов нет', verify: { status: 'incomplete' as const, results: [] } };
    expect(verdictOf(r)).toEqual({ kind: 'incomplete', reason: 'подтверждена компиляция, тестов нет' });
  });

  it('«подтверждено» только при verify.status = green', () => {
    const red = { applied: true, version: 4, verify: { status: 'red' as const, results: [] } };
    expect(verdictOf(red).kind).toBe('incomplete');
  });

  it('пока ответа нет — все шаги выполняются', () => {
    expect(verdictOf(null)).toEqual({ kind: 'running' });
    expect(gateSteps(null, 'f').every((s) => s.status === 'running')).toBe(true);
  });
});
