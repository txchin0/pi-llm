import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const integrationExtensionFactory = vi.fn();
  const roleExtensionFactory = vi.fn();

  return {
    ensureUserWorkspace: vi.fn().mockResolvedValue(undefined),
    createAgentResourceLoader: vi.fn().mockResolvedValue({ resourceLoader: true }),
    createPiAgentSession: vi.fn().mockResolvedValue({
      session: { id: 'sess_test' },
      extensionsResult: { errors: [] },
    }),
    settingsInMemory: vi.fn().mockReturnValue({ settingsManager: true }),
    sessionManagerInMemory: vi.fn().mockReturnValue({ sessionManager: true }),
    assertToolAllowlistSync: vi.fn(),
    buildIntegrationSessionExtras: vi.fn().mockReturnValue({
      toolNames: ['integration_tool'],
      extensionFactory: integrationExtensionFactory,
      promptFragments: ['integration fragment'],
    }),
    integrationExtensionFactory,
    roleExtensionFactory,
  };
});

vi.mock('../../src/agent/ensureUserWorkspace.js', () => ({
  ensureUserWorkspace: mocks.ensureUserWorkspace,
}));

vi.mock('../../src/agent/createAgentResourceLoader.js', () => ({
  createAgentResourceLoader: mocks.createAgentResourceLoader,
}));

vi.mock('../../src/integrations/assertToolAllowlistSync.js', () => ({
  assertToolAllowlistSync: mocks.assertToolAllowlistSync,
}));

vi.mock('../../src/integrations/buildIntegrationSessionExtras.js', () => ({
  buildIntegrationSessionExtras: mocks.buildIntegrationSessionExtras,
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: mocks.createPiAgentSession,
  SettingsManager: { inMemory: mocks.settingsInMemory },
  SessionManager: { inMemory: mocks.sessionManagerInMemory },
}));

import { buildRoleAgentSession } from '../../src/agent/buildRoleAgentSession.js';
import { SURFACE_BASE_TOOLS, WORKER_BASE_TOOLS } from '../../src/integrations/baseTools.js';
import { unconfiguredOAuthService } from '../../src/integrations/oauth/unconfiguredOAuthService.js';
import { createRootLogger } from '../../src/logging/createRootLogger.js';

const baseOptions = {
  userId: 'user-a',
  userMemoryWorkspace: '/data/users/user-a/memory',
  dataRoot: '/data',
  model: { id: 'test-model' } as never,
  authStorage: {} as never,
  modelRegistry: {} as never,
  thinkingLevel: 'off' as const,
  enabledIntegrations: [],
  oauthService: unconfiguredOAuthService,
};

describe('buildRoleAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPiAgentSession.mockResolvedValue({
      session: { id: 'sess_test' },
      extensionsResult: { errors: [] },
    });
  });

  it('seeds the workspace before creating the Pi session', async () => {
    const callOrder: string[] = [];
    mocks.ensureUserWorkspace.mockImplementation(() => {
      callOrder.push('ensureUserWorkspace');
      return Promise.resolve();
    });
    mocks.createPiAgentSession.mockImplementation(() => {
      callOrder.push('createPiAgentSession');
      return Promise.resolve({
        session: { id: 'sess_test' },
        extensionsResult: { errors: [] },
      });
    });

    await buildRoleAgentSession({
      ...baseOptions,
      role: 'worker',
      spec: {
        baseTools: WORKER_BASE_TOOLS,
        buildSystemPrompt: (fragments) => `worker:${fragments.join(',')}`,
        settings: { compaction: { enabled: false }, retry: { enabled: false } },
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'worker.extension.load_error',
          message: 'worker extension failed to load',
        },
      },
    });

    expect(callOrder).toEqual(['ensureUserWorkspace', 'createPiAgentSession']);
  });

  it('asserts tool allowlist sync with spec base tools', async () => {
    await buildRoleAgentSession({
      ...baseOptions,
      role: 'surface',
      spec: {
        baseTools: SURFACE_BASE_TOOLS,
        buildSystemPrompt: () => 'surface prompt',
        settings: {
          compaction: { enabled: false },
          retry: { enabled: true, maxRetries: 2 },
        },
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'surface.extension.load_error',
          message: 'surface extension failed to load',
        },
      },
    });

    expect(mocks.assertToolAllowlistSync).toHaveBeenCalledWith(
      SURFACE_BASE_TOOLS,
      ['integration_tool'],
    );
  });

  it('passes spec settings to SettingsManager.inMemory', async () => {
    const surfaceSettings = {
      compaction: { enabled: false as const },
      retry: { enabled: true, maxRetries: 2 },
    };

    await buildRoleAgentSession({
      ...baseOptions,
      role: 'surface',
      spec: {
        baseTools: SURFACE_BASE_TOOLS,
        buildSystemPrompt: () => 'surface prompt',
        settings: surfaceSettings,
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'surface.extension.load_error',
          message: 'surface extension failed to load',
        },
      },
    });

    expect(mocks.settingsInMemory).toHaveBeenCalledWith(surfaceSettings);

    mocks.settingsInMemory.mockClear();

    const workerSettings = {
      compaction: { enabled: false as const },
      retry: { enabled: false },
    };

    await buildRoleAgentSession({
      ...baseOptions,
      role: 'worker',
      spec: {
        baseTools: WORKER_BASE_TOOLS,
        buildSystemPrompt: () => 'worker prompt',
        settings: workerSettings,
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'worker.extension.load_error',
          message: 'worker extension failed to load',
        },
      },
    });

    expect(mocks.settingsInMemory).toHaveBeenCalledWith(workerSettings);
  });

  it('concatenates role and integration extension factories for the resource loader', async () => {
    await buildRoleAgentSession({
      ...baseOptions,
      role: 'worker',
      spec: {
        baseTools: WORKER_BASE_TOOLS,
        buildSystemPrompt: (fragments) => `worker:${fragments.join(',')}`,
        settings: { compaction: { enabled: false }, retry: { enabled: false } },
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'worker.extension.load_error',
          message: 'worker extension failed to load',
        },
      },
    });

    expect(mocks.createAgentResourceLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'worker:integration fragment',
        extensionFactories: [
          mocks.roleExtensionFactory,
          mocks.integrationExtensionFactory,
        ],
      }),
    );
  });

  it('logs extension load errors with spec event and message', async () => {
    const log = createRootLogger({ level: 'silent', pretty: false });
    const warn = vi.spyOn(log, 'warn');
    mocks.createPiAgentSession.mockResolvedValue({
      session: { id: 'sess_test' },
      extensionsResult: {
        errors: [{ path: '/ext/bad.js', error: 'load failed' }],
      },
    });

    await buildRoleAgentSession({
      ...baseOptions,
      role: 'surface',
      log,
      spec: {
        baseTools: SURFACE_BASE_TOOLS,
        buildSystemPrompt: () => 'surface prompt',
        settings: {
          compaction: { enabled: false },
          retry: { enabled: true, maxRetries: 2 },
        },
        roleExtensionFactories: [mocks.roleExtensionFactory],
        extensionLoadError: {
          event: 'surface.extension.load_error',
          message: 'surface extension failed to load',
        },
      },
    });

    expect(warn).toHaveBeenCalledWith(
      {
        event: 'surface.extension.load_error',
        path: '/ext/bad.js',
        error: 'load failed',
      },
      'surface extension failed to load',
    );
  });
});
