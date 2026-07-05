import { describe, expect, it } from 'vitest';

import { RespondRequestSchema } from '../../src/contracts/respond.js';

describe('RespondRequestSchema', () => {
  it('accepts first-turn and follow-up payloads', () => {
    expect(
      RespondRequestSchema.parse({
        user_id: 'user-123',
        message: 'Hello there',
      }),
    ).toMatchObject({
      user_id: 'user-123',
      message: 'Hello there',
    });

    expect(
      RespondRequestSchema.parse({
        user_id: 'user-123',
        session_id: 'sess_1234567890ab',
        message: 'Welcome back',
      }),
    ).toMatchObject({
      user_id: 'user-123',
      session_id: 'sess_1234567890ab',
      message: 'Welcome back',
    });
  });

  it('accepts optional boolean thinking-stream opt-in values', () => {
    expect(
      RespondRequestSchema.parse({
        user_id: 'user-123',
        message: 'Show the work',
        show_thinking: true,
      }),
    ).toMatchObject({ show_thinking: true });

    expect(
      RespondRequestSchema.parse({
        user_id: 'user-123',
        message: 'Keep thoughts private',
        show_thinking: false,
      }),
    ).toMatchObject({ show_thinking: false });

    expect(
      RespondRequestSchema.parse({
        user_id: 'user-123',
        message: 'Default behavior',
      }),
    ).not.toHaveProperty('show_thinking');
  });

  it('rejects non-boolean thinking-stream opt-in values', () => {
    expect(
      RespondRequestSchema.safeParse({
        user_id: 'user-123',
        message: 'Show the work',
        show_thinking: 'true',
      }).success,
    ).toBe(false);
  });

  it('accepts payloads without user_id (identity comes from the token)', () => {
    expect(
      RespondRequestSchema.safeParse({
        message: 'Hello there',
      }).success,
    ).toBe(true);
  });

  it('rejects empty messages and malformed session ids', () => {
    expect(
      RespondRequestSchema.safeParse({
        user_id: 'user-123',
        message: '',
      }).success,
    ).toBe(false);

    expect(
      RespondRequestSchema.safeParse({
        user_id: 'user-123',
        session_id: 'bad-session',
        message: 'Hello there',
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      RespondRequestSchema.safeParse({
        user_id: 'user-123',
        message: 'Hello there',
        extra: true,
      }).success,
    ).toBe(false);
  });
});
