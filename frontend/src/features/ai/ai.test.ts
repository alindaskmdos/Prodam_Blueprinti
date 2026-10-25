import { describe, expect, it } from 'vitest';
import { fixtures } from '../../mocks/fixtures';
import { aiErrorText } from './aiError';
import { hasAiFeature } from './capabilities';

describe('aiErrorText', () => {
  it('message без числа retryAfterSec → число дописывается', () => {
    const e = { code: 'RATE_LIMITED' as const, message: 'Слишком много запросов', details: { retryAfterSec: 40 } };
    expect(aiErrorText(e, 429)).toBe('Слишком много запросов. Повторите через 40 с.');
  });

  it('фикстура rate-limited: число уже в message — не дублируется', () => {
    expect(aiErrorText(fixtures.errorRateLimited, 429)).toBe(fixtures.errorRateLimited.message);
  });

  it('нет тела ошибки → HTTP-статус', () => {
    expect(aiErrorText(undefined, 503)).toBe('HTTP 503');
  });
});

describe('hasAiFeature', () => {
  it('llm=false, пустые features, нет функции или не загружено → кнопки нет', () => {
    expect(hasAiFeature(fixtures.capabilitiesOff, 'explain')).toBe(false);
    expect(hasAiFeature(null, 'explain')).toBe(false);
    expect(hasAiFeature({ ...fixtures.capabilitiesOn, features: ['fix'] }, 'explain')).toBe(false);
    expect(hasAiFeature({ ...fixtures.capabilitiesOn, llm: false }, 'fix')).toBe(false);
  });

  it('llm=true и функция в features → кнопка есть', () => {
    for (const f of fixtures.capabilitiesOn.features) expect(hasAiFeature(fixtures.capabilitiesOn, f)).toBe(true);
  });
});
