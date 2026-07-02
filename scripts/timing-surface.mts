import { performance } from 'node:perf_hooks';

import {
  createRoleAgentLlmRuntime,
  resolveUserMemoryWorkspace,
} from '../src/config/agentLlm.js';
import { env } from '../src/config/env.js';
import { unconfiguredOAuthService } from '../src/integrations/oauth/unconfiguredOAuthService.js';
import { createSurfaceSession } from '../src/surface/createSurfaceSession.js';

const t0 = performance.now();
const {
  config: agentConfig,
  authStorage,
  modelRegistry,
  model,
} = createRoleAgentLlmRuntime('surface');
const ws = resolveUserMemoryWorkspace(env.DATA_ROOT, 'timing-user');
const session = await createSurfaceSession({
  userId: 'timing-user',
  sessionId: 'sess_timing00000',
  userMemoryWorkspace: ws,
  dataRoot: env.DATA_ROOT,
  model,
  authStorage,
  modelRegistry,
  agentConfig,
  taskQueue: {
    enqueue: () => Promise.reject(new Error('not used')),
    getById: () => Promise.resolve(null),
    listByUser: () => Promise.resolve([]),
  },
  contextTurnLimit: 3,
  enabledIntegrations: [],
  oauthService: unconfiguredOAuthService,
});
console.log('create ms', (performance.now() - t0).toFixed(0));

const t1 = performance.now();
const promptPromise = session.prompt('hi');
setTimeout(() => {
  console.log('still waiting at', (performance.now() - t1).toFixed(0), 'ms');
}, 5000);
await promptPromise;
console.log('prompt ms', (performance.now() - t1).toFixed(0));
session.dispose();
