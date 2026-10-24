import { describe, expect, it } from 'vitest';
import treeJson from '@contract/fixtures/tree.json';
import projectJson from '@contract/fixtures/project.json';
import errorConflictJson from '@contract/fixtures/error.conflict.json';
import { server } from '../../mocks/server';
import { scenarios } from '../../mocks/handlers';
import { createApiClient } from './client';

const client = createApiClient('http://localhost/api');

describe('api client через MSW', () => {
  it('получает фикстуру tree.json', async () => {
    const { data, error, response } = await client.GET('/projects/{projectId}/tree', {
      params: { path: { projectId: 'p-1' } },
    });
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data).toEqual(treeJson);
  });

  it('получает фикстуру project.json', async () => {
    const { data } = await client.GET('/projects/{projectId}', { params: { path: { projectId: 'p-1' } } });
    expect(data).toEqual(projectJson);
  });

  it('отдаёт /health по схеме', async () => {
    const { data } = await client.GET('/health');
    expect(data).toMatchObject({ status: 'UP', docker: expect.any(Boolean), llm: expect.any(Boolean) });
  });

  it('409 приходит как error с телом error.conflict.json', async () => {
    server.use(scenarios.conflictOnBlocks);
    const { data, error, response } = await client.PUT('/projects/{projectId}/methods/{methodId}/blocks', {
      params: { path: { projectId: 'p-1', methodId: 'com.demo.service.OrderService.merge~0' } },
      body: { version: 0, root: { id: 'b', kind: 'method', fields: {}, children: [] } as never },
    });
    expect(data).toBeUndefined();
    expect(response.status).toBe(409);
    expect(error).toEqual(errorConflictJson);
  });
});
