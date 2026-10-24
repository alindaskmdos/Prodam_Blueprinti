import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resetAnalysisState, useAnalysisStore } from '../analysis-panel/analysisStore';
import { issueTooltip } from '../analysis-panel/format';
import { fixtures } from '../../mocks/fixtures';
import { IssueBadge } from './nodes';

const issue = fixtures.analysisMerge.issues[0];
if (!issue) throw new Error('нет проблемы в фикстуре');

describe('«!» на ноде (FE-43)', () => {
  beforeEach(resetAnalysisState);

  it('подсказка — русское название правила, серьёзность и текст каждой проблемы, а не id', () => {
    const second = {
      ...issue,
      id: 'StringConcatInLoop:x~0:1:1',
      rule: 'StringConcatInLoop',
      severity: 'low' as const,
      message: 'Склейка в цикле',
    };
    useAnalysisStore.setState({ analysis: { ...fixtures.analysisMerge, issues: [issue, second] } });
    render(<IssueBadge issues={[issue.id, second.id]} />);
    const tip = screen.getByText('!').getAttribute('title') ?? '';
    expect(tip).toContain(issue.message);
    expect(tip).toContain('Склейка в цикле');
    expect(tip).toContain('Конкатенация строк в цикле · низкая');
    expect(tip).not.toContain(second.id);
  });

  it('проблемы нет в анализе — название правила из id', () => {
    expect(issueTooltip(['ExpensiveCallInLoop:com.demo.service.InventoryService.reserve~0:24:35'])).toBe(
      'Дорогой вызов в цикле',
    );
  });
});
