import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW для Vitest (node). Подключается в src/test/setup.ts. */
export const server = setupServer(...handlers);
