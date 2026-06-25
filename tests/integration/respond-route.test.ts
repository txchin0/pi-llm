import { describe, expect, it } from 'vitest';

import type { SurfaceSessionRegistry } from '../../src/surface/surfaceSessionRegistry.js';

type ParsedSseEvent = {
  event: string;
  data: Record<string, unknown>;
};

function parseSsePayload(payload: string): ParsedSseEvent[] {
  return payload
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split('\n');
      const event = lines.find((line) => line.startsWith('event: '));
      const data = lines.find((line) => line.startsWith('data: '));

      return {
        event: event?.slice('event: '.length) ?? '',
        data: JSON.parse(data?.slice('data: '.length) ?? '{}') as Record<string, unknown>,
      };
    });
}

describe('POST /v1/respond', () => {
  async function createApp() {
    const { buildServer } = await import('../../src/server/buildServer.js');
    return buildServer({
      now: () => '2026-06-09T12:00:00.000Z',
      requestIdFactory: () => 'req_test00000001',
      sessionIdFactory: () => 'sess_test00000001',
    });
  }

  it('streams a start event for valid first-turn requests', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/respond',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        user_id: 'web-user',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSsePayload(response.body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'start',
      data: {
        type: 'start',
        request_id: 'req_test00000001',
        user_id: 'web-user',
        session_id: 'sess_test00000001',
        started_at: '2026-06-09T12:00:00.000Z',
      },
    });

    await app.close();
  });

  it('reuses a supplied session_id in the start event', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/respond',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        user_id: 'web-user',
        session_id: 'sess_followup12345',
        message: 'hello again',
      },
    });

    const events = parseSsePayload(response.body);
    expect(events).toHaveLength(1);
    expect(events[0]?.data.session_id).toBe('sess_followup12345');

    await app.close();
  });

  it('streams a validation_error event for invalid requests', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/respond',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        user_id: '',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);

    const events = parseSsePayload(response.body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'error',
      data: {
        type: 'error',
        request_id: 'req_test00000001',
        code: 'validation_error',
      },
    });

    await app.close();
  });

  it('streams start then provider_error when surface session creation fails', async () => {
    const { buildServer } = await import('../../src/server/buildServer.js');
    const { createSurfaceRespondService } = await import(
      '../../src/surface/surfaceRespondService.js'
    );
    const providerError = 'Cannot reach Surface LLM at http://127.0.0.1:8080';

    const app = buildServer({
      service: createSurfaceRespondService({
        registry: {
          getOrCreate: () => Promise.reject(new Error(providerError)),
        } as unknown as SurfaceSessionRegistry,
      }),
      now: () => '2026-06-09T12:00:00.000Z',
      requestIdFactory: () => 'req_test00000001',
      sessionIdFactory: () => 'sess_test00000001',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/respond',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        user_id: 'web-user',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);

    const events = parseSsePayload(response.body);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'start',
      data: {
        type: 'start',
        request_id: 'req_test00000001',
        session_id: 'sess_test00000001',
      },
    });
    expect(events[1]).toMatchObject({
      event: 'error',
      data: {
        type: 'error',
        request_id: 'req_test00000001',
        code: 'provider_error',
        message: providerError,
      },
    });

    await app.close();
  });
});
