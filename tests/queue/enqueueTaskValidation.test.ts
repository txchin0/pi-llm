import { describe, expect, it } from 'vitest';

import { EnqueueTaskInputSchema } from '../../src/queue/taskTypes.js';

describe('EnqueueTaskInputSchema', () => {
  it('rejects empty description', () => {
    const result = EnqueueTaskInputSchema.safeParse({
      userId: 'web-user',
      description: '',
      context: { turns: [] },
    });

    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only description', () => {
    const result = EnqueueTaskInputSchema.safeParse({
      userId: 'web-user',
      description: '   ',
      context: { turns: [] },
    });

    expect(result.success).toBe(false);
  });

  it('accepts a valid enqueue payload', () => {
    const result = EnqueueTaskInputSchema.safeParse({
      userId: 'web-user',
      sessionId: 'sess_test00000001',
      description: 'Update Alice profile with vegetarian preference',
      context: {
        turns: [{ role: 'user', content: 'Alice is vegetarian' }],
      },
    });

    expect(result.success).toBe(true);
  });
});
