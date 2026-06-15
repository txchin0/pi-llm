import { describe, expect, it, vi } from 'vitest';

import { buildIntegrationSessionExtras } from '../../src/integrations/buildIntegrationSessionExtras.js';
import { resolveEnabledIntegrations } from '../../src/integrations/resolveEnabledIntegrations.js';
import { noopIntegrationStore } from '../../src/integrations/store/noopIntegrationStore.js';
import type { IntegrationDefinition } from '../../src/integrations/types.js';

const sessionShutdown = vi.fn(() => undefined);
const processShutdown = vi.fn(() => undefined);

const testIntegration: IntegrationDefinition = {
  id: 'test_integration',
  label: 'Test',
  defaultEnabled: false,
  tools: {
    surface: [
      {
        name: 'test_read',
        register(pi) {
          pi.registerTool({
            name: 'test_read',
            label: 'test_read',
            description: 'read',
            parameters: { type: 'object', properties: {} },
            execute() {
              return Promise.resolve({
                content: [{ type: 'text' as const, text: 'ok' }],
                details: {},
              });
            },
          });
        },
      },
    ],
    worker: [
      {
        name: 'test_write',
        register(pi) {
          pi.registerTool({
            name: 'test_write',
            label: 'test_write',
            description: 'write',
            parameters: { type: 'object', properties: {} },
            execute() {
              return Promise.resolve({
                content: [{ type: 'text' as const, text: 'ok' }],
                details: {},
              });
            },
          });
        },
      },
    ],
  },
  systemPrompt: {
    surface: 'Surface integration policy.',
    worker: 'Worker integration policy.',
  },
  onSessionShutdown: sessionShutdown,
  onProcessShutdown: processShutdown,
};

describe('buildIntegrationSessionExtras', () => {
  it('collects surface tool names and prompt fragments', () => {
    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'surface', { userId: 'user-a' });

    expect(extras.toolNames).toEqual(['test_read']);
    expect(extras.promptFragments).toEqual(['Surface integration policy.']);
  });

  it('collects worker tool names and prompt fragments', () => {
    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'worker', { userId: 'user-a' });

    expect(extras.toolNames).toEqual(['test_write']);
    expect(extras.promptFragments).toEqual(['Worker integration policy.']);
  });

  it('includes web_search for both roles when enabled by default', async () => {
    const enabled = await resolveEnabledIntegrations(noopIntegrationStore, 'user-a');
    const surfaceExtras = buildIntegrationSessionExtras(enabled, 'surface', { userId: 'user-a' });
    const workerExtras = buildIntegrationSessionExtras(enabled, 'worker', { userId: 'user-a' });

    expect(surfaceExtras.toolNames).toEqual(['web_search']);
    expect(workerExtras.toolNames).toEqual(['web_search']);
  });

  it('wires onSessionShutdown but not onProcessShutdown in the extension factory', async () => {
    sessionShutdown.mockClear();
    processShutdown.mockClear();

    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'surface', { userId: 'user-a' });

    const handlers = new Map<string, Array<() => Promise<void>>>();
    const pi = {
      registerTool: vi.fn(),
      on(event: string, handler: () => Promise<void>) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };

    void extras.extensionFactory(pi as never);
    await handlers.get('session_shutdown')?.[0]?.();

    expect(sessionShutdown).toHaveBeenCalledOnce();
    expect(processShutdown).not.toHaveBeenCalled();
  });
});
