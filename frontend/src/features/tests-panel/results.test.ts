import { describe, expect, it } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import type { Schemas } from '../api';
import {
  aggregateStatus,
  diffLines,
  firstDiffLine,
  newTest,
  orphanResults,
  parseLineList,
  resultsFor,
  splitLines,
  statusText,
} from './results';

describe('results', () => {
  it('splitLines убирает только завершающую пустую строку', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines(undefined)).toEqual([]);
  });

  it('diffLines: отличие, шумные и игнорируемые строки, разная длина', () => {
    const rows = diffLines('a\nb\nc\nd\n', 'a\nX\nY\n', [3], [4]);
    expect(rows.map((r) => r.kind)).toEqual(['same', 'diff', 'noisy', 'ignored']);
    expect(rows[3]).toMatchObject({ expected: 'd', actual: null });
    expect(firstDiffLine(rows)).toBe(2);
  });

  it('verify.red.json: merge отличается со строки 1', () => {
    const merge = fixtures.verifyRed.results.find((r) => r.name === 'merge');
    if (!merge) throw new Error('verify.red.json: нет merge');
    const rows = diffLines(merge.expected, merge.actual, merge.noisyLines);
    expect(firstDiffLine(rows)).toBe(1);
  });

  it('resultsFor: IO по имени, JUnit по классу и FQN.метод', () => {
    const results = [
      ...fixtures.verifyRed.results,
      { name: 'com.demo.service.OrderServiceTest.mergeCountsMergedOrders', type: 'junit' as const, status: 'passed' as const, durationMs: 5 },
    ];
    expect(resultsFor({ name: 'merge', type: 'io' }, results).map((r) => r.status)).toEqual(['failed']);
    const junit = resultsFor(fixtures.testJunit, results);
    expect(junit).toHaveLength(2);
    expect(aggregateStatus(junit)).toBe('compile_error');
    expect(orphanResults([fixtures.testJunit, ...fixtures.project.tests], results).map((r) => r.name)).toEqual(['basic']);
  });

  it('resultsFor JUnit: без ложных совпадений по пакету и методу, Outer$Inner — по Outer', () => {
    const r = (name: string) => ({ name, type: 'junit' as const, status: 'passed' as const, durationMs: 1 });
    const results = [
      r('com.demo.service.OrderServiceTest.mergeCounts'),
      r('com.demo.Outer$Inner.works'),
    ];
    // Сегмент пакета.
    expect(resultsFor({ name: 'service', type: 'junit' }, results)).toEqual([]);
    expect(resultsFor({ name: 'demo', type: 'junit' }, results)).toEqual([]);
    // Имя метода.
    expect(resultsFor({ name: 'mergeCounts', type: 'junit' }, results)).toEqual([]);
    // Класс — предпоследний сегмент.
    expect(resultsFor({ name: 'OrderServiceTest', type: 'junit' }, results).map((x) => x.name)).toEqual([
      'com.demo.service.OrderServiceTest.mergeCounts',
    ]);
    expect(resultsFor({ name: 'Outer', type: 'junit' }, results)).toHaveLength(1);
    expect(resultsFor({ name: 'Outer$Inner', type: 'junit' }, results)).toHaveLength(1);
    expect(resultsFor({ name: 'Inner', type: 'junit' }, results)).toEqual([]);
  });

  it('aggregateStatus: статус вне контракта → unknown, не passed', () => {
    const r = (status: string) => ({ name: 'x', type: 'io', status, durationMs: 1 }) as Schemas['TestResult'];
    expect(aggregateStatus([r('passed'), r('skipped')])).toBe('unknown');
    expect(aggregateStatus([r('passed')])).toBe('passed');
    expect(aggregateStatus([r('skipped'), r('failed')])).toBe('failed');
    expect(statusText('skipped')).toBe('неизвестно');
  });

  it('parseLineList и newTest', () => {
    expect(parseLineList('6, 3 3;x -1')).toEqual([3, 6]);
    expect(newTest('io', ['new-test']).name).toBe('new-test-2');
    expect(newTest('junit', []).source).toContain('class NewTest');
  });
});
