import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ListIntegrationsResponseSchema,
} from '../../src/contracts/integrations.js';
import { createFileIntegrationStore } from '../../src/integrations/store/fileIntegrationStore.js';
import { resolveUserIntegrationsPath } from '../../src/integrations/store/resolveUserIntegrationsPath.js';

describe('integrations routes', () => {
  let tempDir: string;
  let dataRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-llm-integrations-route-'));
    dataRoot = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createApp() {
    const { buildServer } = await import('../../src/server/buildServer.js');
    const integrationStore = createFileIntegrationStore({ dataRoot });
    return buildServer({
      integrationStore,
      requestIdFactory: () => 'req_test00000001',
    });
  }

  it('GET /v1/integrations returns registered integrations with defaults', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/integrations',
      query: { user_id: 'web-user' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const body = ListIntegrationsResponseSchema.parse(response.json());
    expect(body.integrations).toEqual([
      {
        id: 'web_search',
        label: 'Web Search',
        default_enabled: true,
        enabled: true,
      },
      {
        id: 'google_calendar',
        label: 'Google Calendar',
        default_enabled: false,
        enabled: false,
      },
    ]);

    await app.close();
  });

  it('PUT /v1/integrations toggles enabled state and persists config', async () => {
    const integrationStore = createFileIntegrationStore({ dataRoot });
    await integrationStore.set('web-user', 'web_search', {
      enabled: true,
      config: { apiKey: 'secret' },
    });

    const { buildServer } = await import('../../src/server/buildServer.js');
    const app = buildServer({
      integrationStore,
      requestIdFactory: () => 'req_test00000001',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/integrations',
      payload: {
        user_id: 'web-user',
        integrations: {
          web_search: { enabled: false },
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const body = ListIntegrationsResponseSchema.parse(response.json());
    expect(body.integrations[0]?.enabled).toBe(false);

    const path = resolveUserIntegrationsPath(dataRoot, 'web-user');
    const raw = await readFile(path, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      web_search: {
        enabled: false,
        config: { apiKey: 'secret' },
      },
    });

    await app.close();
  });

  it('GET /v1/integrations returns 400 for missing user_id', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/integrations',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('PUT /v1/integrations returns 400 for unknown integration id', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/integrations',
      payload: {
        user_id: 'web-user',
        integrations: {
          calendar: { enabled: true },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });

  it('PUT /v1/integrations returns 400 when config is included', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/integrations',
      payload: {
        user_id: 'web-user',
        integrations: {
          web_search: { enabled: false, config: { apiKey: 'nope' } },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });

    await app.close();
  });
});
