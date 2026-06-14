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
    write(chunk: Buffer | string, _encoding, callback) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      chunks.push(text);
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
    const capture = createCaptureLogger('silent');

    capture.logger.info({ event: 'server.started' }, 'should not appear');

    expect(capture.getLines()).toHaveLength(0);
  });
});

describe('createChildLogger', () => {
  it('merges context fields into log output', () => {
    const capture = createCaptureLogger('info');
    const child = createChildLogger(capture.logger, {
      component: 'respond.route',
      request_id: 'req_test00000001',
    });

    child.info({ event: 'respond.request.completed' }, 'done');

    expect(capture.getLines()[0]).toMatchObject({
      component: 'respond.route',
      request_id: 'req_test00000001',
      event: 'respond.request.completed',
      msg: 'done',
    });
  });
});

describe('logInboundMessage', () => {
  it('includes full message at debug', () => {
    const capture = createCaptureLogger('debug');

    logInboundMessage(capture.logger, { message: 'hello world' });

    expect(capture.getLines()[0]).toMatchObject({
      event: 'respond.request.received',
      message: 'hello world',
    });
    expect(capture.getLines()[0]).not.toHaveProperty('message_length');
  });

  it('includes only message_length at info', () => {
    const capture = createCaptureLogger('info');

    logInboundMessage(capture.logger, { message: 'hello world' });

    expect(capture.getLines()[0]).toMatchObject({
      event: 'respond.request.received',
      message_length: 11,
    });
    expect(capture.getLines()[0]).not.toHaveProperty('message');
  });
});

describe('logRespondSseEvent', () => {
  it('includes tool input at debug', () => {
    const capture = createCaptureLogger('debug');

    logRespondSseEvent(capture.logger, {
      type: 'tool_call',
      request_id: 'req_test00000001',
      session_id: 'sess_test00000001',
      step: 1,
      tool_call_id: 'call_abc',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });

    expect(capture.getLines()[0]).toMatchObject({
      event: 'tool.call',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });
  });

  it('omits tool input at info', () => {
    const capture = createCaptureLogger('info');

    logRespondSseEvent(capture.logger, {
      type: 'tool_call',
      request_id: 'req_test00000001',
      session_id: 'sess_test00000001',
      step: 1,
      tool_call_id: 'call_abc',
      tool_name: 'calendar_read',
      input: { date: '2026-06-10' },
    });

    expect(capture.getLines()[0]).toMatchObject({
      event: 'tool.call',
      tool_name: 'calendar_read',
    });
    expect(capture.getLines()[0]).not.toHaveProperty('input');
  });
});
