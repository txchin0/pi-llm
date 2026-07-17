import { describe, expect, it } from 'vitest';

import type { SystemPromptInputs } from '../../src/agent/readWorkspaceSnapshot.js';
import type { WorkspaceSnapshot } from '../../src/agent/readWorkspaceSnapshot.js';
import { buildWorkerSystemPrompt } from '../../src/worker/buildWorkerSystemPrompt.js';

const emptyWorkspaceSnapshot: WorkspaceSnapshot = {
  indexMarkdown: '',
  conventionsMarkdown: '',
  fileListing: [],
  fieldTruncation: {
    index: false,
    conventions: false,
    fileListing: false,
  },
};

/** Builds SystemPromptInputs for worker prompt tests. */
function systemPromptInputs(
  promptFragments: string[] = [],
  workspace: WorkspaceSnapshot = emptyWorkspaceSnapshot,
): SystemPromptInputs {
  return {
    promptFragments,
    workerCapabilities: [],
    workspace,
  };
}

describe('buildWorkerSystemPrompt', () => {
  it('appends integration guidance when provided', () => {
    const prompt = buildWorkerSystemPrompt(
      systemPromptInputs(['Confirm writes with the user policy.']),
    );
    expect(prompt).toContain('Confirm writes with the user policy.');
  });

  it('includes conventions, index, and file listing sections', () => {
    const prompt = buildWorkerSystemPrompt(
      systemPromptInputs([], {
        ...emptyWorkspaceSnapshot,
        indexMarkdown: '- `profile.md` — user facts',
        conventionsMarkdown: '# worker conventions',
        fileListing: ['conventions.md', 'index.md'],
      }),
    );

    expect(prompt).toContain('# worker conventions');
    expect(prompt).toContain('profile.md');
    expect(prompt).toContain('conventions.md');
    expect(prompt).toContain('Memory conventions you MUST follow');
  });

  it('includes working rules and OUTCOME contract from §7.2', () => {
    const prompt = buildWorkerSystemPrompt(systemPromptInputs());

    expect(prompt).toContain('Trust the snapshot');
    expect(prompt).toContain('Never record the same fact in two places');
    expect(prompt).toContain('Read a file immediately before you edit it');
    expect(prompt).toContain('OUTCOME: done');
    expect(prompt).toContain('OUTCOME: failed');
    expect(prompt).toContain('# Working rules');
    expect(prompt).toContain('# Result format');
  });

  it('points at conventions.md instead of the old index schema', () => {
    const prompt = buildWorkerSystemPrompt(systemPromptInputs());
    expect(prompt).toContain('conventions.md');
    expect(prompt).not.toContain('topics, titles, summaries, tags');
  });
});
