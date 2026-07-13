import {
  RespondSseEventSchema,
  type RespondSseEvent,
} from '../../../src/contracts/respond.js';

export type SseFrameIssue = {
  frame: string;
  issue: string;
};

export type ParsedSse = {
  events: RespondSseEvent[];
  issues: SseFrameIssue[];
};

/**
 * Parses an SSE payload from `POST /v1/respond` and validates every frame
 * against the respond contract. Invalid frames become issues instead of
 * throwing so a scenario can report exactly which frame broke the contract.
 */
export function parseSse(payload: string): ParsedSse {
  const events: RespondSseEvent[] = [];
  const issues: SseFrameIssue[] = [];

  for (const frame of payload.trim().split('\n\n').filter(Boolean)) {
    const dataLine = frame
      .split('\n')
      .find((line) => line.startsWith('data: '));
    if (dataLine === undefined) {
      issues.push({ frame, issue: 'frame has no data line' });
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(dataLine.slice('data: '.length));
    } catch {
      issues.push({ frame, issue: 'data line is not valid JSON' });
      continue;
    }

    const parsed = RespondSseEventSchema.safeParse(data);
    if (!parsed.success) {
      issues.push({ frame, issue: parsed.error.message });
      continue;
    }

    events.push(parsed.data);
  }

  return { events, issues };
}
