import { describe, expect, it } from 'vitest';

import type { SystemPromptInputs } from '../../src/agent/readWorkspaceSnapshot.js';
import type { WorkspaceSnapshot } from '../../src/agent/readWorkspaceSnapshot.js';
import { buildSurfaceSystemPrompt } from '../../src/surface/buildSurfaceSystemPrompt.js';

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

/** Builds SystemPromptInputs for surface prompt tests. */
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

describe('buildSurfaceSystemPrompt', () => {
  it('appends integration guidance when provided', () => {
    const prompt = buildSurfaceSystemPrompt(
      systemPromptInputs(['Use calendar read tools carefully.']),
    );
    expect(prompt).toContain('Use calendar read tools carefully.');
  });

  it('includes index and file listing sections but not conventions', () => {
    const prompt = buildSurfaceSystemPrompt(
      systemPromptInputs([], {
        ...emptyWorkspaceSnapshot,
        indexMarkdown: '- `profile.md` — user facts',
        conventionsMarkdown: '# secret conventions',
        fileListing: ['index.md', 'profile.md'],
      }),
    );

    expect(prompt).toContain('profile.md');
    expect(prompt).toContain('index.md');
    expect(prompt).not.toContain('secret conventions');
    expect(prompt).not.toContain('Memory conventions');
  });

  it('uses empty index fallback when index is missing', () => {
    const prompt = buildSurfaceSystemPrompt(systemPromptInputs());
    expect(prompt).toContain('(memory is currently empty)');
  });
});
