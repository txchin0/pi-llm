import { describe, expect, it, vi } from 'vitest';

import { buildIntegrationSessionExtras } from '../../src/integrations/buildIntegrationSessionExtras.js';
import type { OAuthService } from '../../src/integrations/oauth/oauthService.js';
import { unconfiguredOAuthService } from '../../src/integrations/oauth/unconfiguredOAuthService.js';
import { resolveEnabledIntegrations } from '../../src/integrations/resolveEnabledIntegrations.js';
import type { IntegrationContext, IntegrationDefinition } from '../../src/integrations/types.js';
import { createEmptyIntegrationStore } from '../helpers/emptyIntegrationStore.js';

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

let surfaceOAuthCtx: IntegrationContext | undefined;
let workerOAuthCtx: IntegrationContext | undefined;

const oauthIntegration: IntegrationDefinition = {
  id: 'oauth_test',
  label: 'OAuth Test',
  defaultEnabled: true,
  oauth: {
    providerId: 'google',
    scopes: {
      surface: ['calendar.readonly'],
      worker: ['calendar.events'],
    },
  },
  tools: {
    surface: [
      {
        name: 'oauth_read',
        register(_pi, ctx) {
          surfaceOAuthCtx = ctx;
        },
      },
    ],
    worker: [
      {
        name: 'oauth_write',
        register(_pi, ctx) {
          workerOAuthCtx = ctx;
        },
      },
    ],
  },
};

function createStubOAuthService(): OAuthService & {
  getAccessToken: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(),
    handleCallback: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    getStatus: vi.fn(),
    disconnect: vi.fn(),
  };
}

const extrasInput = (userId: string, oauthService: OAuthService = unconfiguredOAuthService) => ({
  userId,
  oauthService,
});

describe('buildIntegrationSessionExtras', () => {
  it('collects surface tool names and prompt fragments', () => {
    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'surface', extrasInput('user-a'));

    expect(extras.toolNames).toEqual(['test_read']);
    expect(extras.promptFragments).toEqual(['Surface integration policy.']);
  });

  it('collects worker tool names and prompt fragments', () => {
    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'worker', extrasInput('user-a'));

    expect(extras.toolNames).toEqual(['test_write']);
    expect(extras.promptFragments).toEqual(['Worker integration policy.']);
  });

  it('includes web_search for both roles when enabled by default', async () => {
    const enabled = await resolveEnabledIntegrations(createEmptyIntegrationStore(), 'user-a');
    const surfaceExtras = buildIntegrationSessionExtras(
      enabled,
      'surface',
      extrasInput('user-a'),
    );
    const workerExtras = buildIntegrationSessionExtras(
      enabled,
      'worker',
      extrasInput('user-a'),
    );

    expect(surfaceExtras.toolNames).toEqual(['web_search']);
    expect(workerExtras.toolNames).toEqual(['web_search']);
  });

  it('wires onSessionShutdown but not onProcessShutdown in the extension factory', async () => {
    sessionShutdown.mockClear();
    processShutdown.mockClear();

    const enabled = [{ definition: testIntegration, config: {} }];
    const extras = buildIntegrationSessionExtras(enabled, 'surface', extrasInput('user-a'));

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

  it('binds getAccessToken for oauth integrations with role-specific scopes', async () => {
    const oauthService = createStubOAuthService();
    const enabled = [
      { definition: oauthIntegration, config: {} },
      { definition: testIntegration, config: {} },
    ];

    const surfaceExtras = buildIntegrationSessionExtras(
      enabled,
      'surface',
      extrasInput('user-oauth', oauthService),
    );
    const workerExtras = buildIntegrationSessionExtras(
      enabled,
      'worker',
      extrasInput('user-oauth', oauthService),
    );

    const pi = { registerTool: vi.fn(), on: vi.fn() };
    void surfaceExtras.extensionFactory(pi as never);
    void workerExtras.extensionFactory(pi as never);

    expect(surfaceOAuthCtx).toBeDefined();
    expect(workerOAuthCtx).toBeDefined();
    expect(surfaceOAuthCtx!.getAccessToken).toBeTypeOf('function');
    expect(workerOAuthCtx!.getAccessToken).toBeTypeOf('function');

    await surfaceOAuthCtx!.getAccessToken!();
    expect(oauthService.getAccessToken).toHaveBeenCalledWith(
      'user-oauth',
      'google',
      ['calendar.readonly'],
    );

    await workerOAuthCtx!.getAccessToken!();
    expect(oauthService.getAccessToken).toHaveBeenCalledWith(
      'user-oauth',
      'google',
      ['calendar.events'],
    );
  });

  it('does not bind getAccessToken for integrations without oauth', () => {
    const oauthService = createStubOAuthService();
    const captured: { ctx?: IntegrationContext } = {};
    const plainIntegration: IntegrationDefinition = {
      ...testIntegration,
      tools: {
        surface: [
          {
            name: 'plain_read',
            register(_pi, ctx) {
              captured.ctx = ctx;
            },
          },
        ],
      },
    };

    const extras = buildIntegrationSessionExtras(
      [{ definition: plainIntegration, config: {} }],
      'surface',
      extrasInput('user-plain', oauthService),
    );

    const pi = { registerTool: vi.fn(), on: vi.fn() };
    void extras.extensionFactory(pi as never);

    expect(captured.ctx?.getAccessToken).toBeUndefined();
    expect(oauthService.getAccessToken).not.toHaveBeenCalled();
  });
});
