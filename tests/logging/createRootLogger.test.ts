import { Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { createChildLogger } from '../../src/logging/createChildLogger.js';
import { createRootLogger } from '../../src/logging/createRootLogger.js';
import {
  logInboundMessage,
  logRespondSseEvent,
} from '../../src/logging/logRespondEvent.js';

function createCaptureLogger(level: string) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const logger = createRootLogger({
    level,
    pretty: false,
    destination: stream,
  });

  return {
    logger,
    getLines() {
      return chunks.map((chunk) => JSON.parse(chunk) as Record<string, unknown>);
    },
  };
}

describe('createRootLogger', () => {
  afterEach(() => {
    // No shared state to reset.
  });

  it('produces no output at silent level', () => {
    const { logger, getLines } = createCaptureLogger('silent');

    logger.info({ event: 'server.started' }, 'should not appear');

    expect(getLines()).toHaveLength(0);
  });
});

describe('createChildLogger', () => {
  it('merges context fields into log output', () => {
    const { logger, getLines } = createCaptureLogger('info');
    const child = createChildLogger(logger, {
      component: 'respond.route',
      request_id: 'req_test00000001',
    });

    child.info({ event: 'respond.request.completed' }, 'done');

    expect(getLines()[0]).toMatchObject({
      component: 'respond.route',
      request_id: 'req_test00000001',
      event: 'respond.request.completed',
      msg: 'done',
    });
  });
});

describe('logInboundMessage', () => {
  it('includes full message at debug', () => {
    const { logger, getLines } = createCaptureLogger('debug');

    logInboundMessage(logger, { message: 'hello world' });

    expect(getLines()[0]).toMatchObject({
      event: 'respond.request.received',
      message: 'hello world',
    });
    expect(getLines()[0]).not.toHaveProperty('message_length');
  });

  it('includes only message_length at info', () => {
    const { logger, getLines } = createCaptureLogger('info');

    logInboundMessage(logger, { message: 'hello world' });

    expect(getLines()[0]).toMatchObject({
      event: 'respond.request.received',
      message_length: 11,
    });
    expect(getLines()[0]).not.toHaveProperty('message');
  });
});

describe('logRespondSseEvent', () => {
  it('includes tool input at debug', () => {
    const { logger, getLines } = createCaptureLogger('debug');

    logRespondSseEvent(logger, {
      type: 'tool_call',
      request_id: 'req_test00000001',
      session_id: 'sess_test00000001',
      step: 1,
      tool_call_id: 'call_abc',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });

    expect(getLines()[0]).toMatchObject({
      event: 'tool.call',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });
  });

  it('omits tool input at info', () => {
    const { logger, getLines } = createCaptureLogger('info');

    logRespondSseEvent(logger, {
      type: 'tool_call',
      request_id: 'req_test00000001',
      session_id: 'sess_test00000001',
      step: 1,
      tool_call_id: 'call_abc',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });

    expect(getLines()[0]).toMatchObject({
      event: 'tool.call',
      tool_name: 'calendar_read',
    });
    expect(getLines()[0]).not.toHaveProperty('input');
  });
});
