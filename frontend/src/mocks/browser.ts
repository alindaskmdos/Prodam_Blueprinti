import { setupWorker } from 'msw/browser';
import { handlers, scenarioHandlers } from './handlers';

// `?scenarios=a,b` — альтернативные сценарии (handlers.ts) поверх обычных обработчиков.
export const worker = setupWorker(...scenarioHandlers(window.location.search), ...handlers);
