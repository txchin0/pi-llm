import { describe, expect, it } from 'vitest';

import type { RespondSseEvent } from '../../src/contracts/respond.js';
import { RespondController } from '../../src/respond/respondController.js';
import type { RespondService } from '../../src/respond/respondService.js';

async function collectEvents(
  controller: RespondController,
  rawRequest: unknown,
): Promise<RespondSseEvent[]> {
  const events: RespondSseEvent[] = [];
  for await (const event of controller.handle(rawRequest, {
    requestId: 'req_test00000001',
  })) {
    events.push(event);
  }
  return events;
}

describe('RespondController', () => {
  it('yields validation_error for invalid requests', async () => {
    const controller = new RespondController({
      now: () => '2026-06-09T12:00:00.000Z',
    });

    const events = await collectEvents(controller, {
      user_id: '',
      message: 'hello',
    });

    expect(events).toEqual([
      {
        type: 'error',
        request_id: 'req_test00000001',
        code: 'validation_error',
        message:
          'Request body must include user_id, message, and an optional server-issued session_id.',
      },
    ]);
  });

  it('yields start then delegates to the service', async () => {
    const service: RespondService = {
      async *handleTurn() {
        await Promise.resolve();
        yield { type: 'delta', text: 'hi' };
      },
    };

    const controller = new RespondController({
      service,
      now: () => '2026-06-09T12:00:00.000Z',
      sessionIdFactory: () => 'sess_test00000001',
    });

    const events = await collectEvents(controller, {
      user_id: 'web-user',
      message: 'hello',
    });

    expect(events).toEqual([
      {
        type: 'start',
        request_id: 'req_test00000001',
        user_id: 'web-user',
        session_id: 'sess_test00000001',
        started_at: '2026-06-09T12:00:00.000Z',
      },
      { type: 'delta', text: 'hi' },
    ]);
  });

  it('reuses a supplied session_id in the start event', async () => {
    const controller = new RespondController({
      now: () => '2026-06-09T12:00:00.000Z',
    });

    const events = await collectEvents(controller, {
      user_id: 'web-user',
      session_id: 'sess_followup12345',
      message: 'hello again',
    });

    expect(events[0]).toMatchObject({
      type: 'start',
      session_id: 'sess_followup12345',
    });
  });

  it('yields internal_error when the service throws after start', async () => {
    const service: RespondService = {
      async *handleTurn() {
        throw new Error('service contract violation');
      },
    };

    const controller = new RespondController({
      service,
      now: () => '2026-06-09T12:00:00.000Z',
      sessionIdFactory: () => 'sess_test00000001',
    });

    const events = await collectEvents(controller, {
      user_id: 'web-user',
      message: 'hello',
    });

    expect(events).toEqual([
      {
        type: 'start',
        request_id: 'req_test00000001',
        user_id: 'web-user',
        session_id: 'sess_test00000001',
        started_at: '2026-06-09T12:00:00.000Z',
      },
      {
        type: 'error',
        request_id: 'req_test00000001',
        code: 'internal_error',
        message: 'service contract violation',
      },
    ]);
  });
});
