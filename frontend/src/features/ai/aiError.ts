import type { Schemas } from '../api';

/** Текст ошибки ИИ-вызова: message бэка; для 429 — плюс «через N с» из details.retryAfterSec, если его ещё нет в тексте. */
export function aiErrorText(error: Schemas['Error'] | undefined, status: number): string {
  if (!error) return `HTTP ${status}`;
  const retry = error.details?.retryAfterSec;
  if (typeof retry === 'number' && !error.message.includes(String(retry))) {
    return `${error.message}. Повторите через ${retry} с.`;
  }
  return error.message;
}
