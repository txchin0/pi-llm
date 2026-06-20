import { performance } from 'node:perf_hooks';

import { resolveUserMemoryWorkspace } from '../src/config/agentLlm.js';
import { env } from '../src/config/env.js';
import {
  createSurfaceLlmRuntime,
  surfaceAgentConfig,
} from '../src/config/surfaceAgent.js';
import { createSurfaceSession } from '../src/surface/createSurfaceSession.js';

const t0 = performance.now();
const { authStorage, modelRegistry, model } =
  createSurfaceLlmRuntime(surfaceAgentConfig);
const ws = resolveUserMemoryWorkspace(env.DATA_ROOT, 'timing-user');
const session = await createSurfaceSession({
  userMemoryWorkspace: ws,
  dataRoot: env.DATA_ROOT,
  model,
  authStorage,
  modelRegistry,
  surfaceAgentConfig,
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
