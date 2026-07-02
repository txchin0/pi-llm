# Adding integrations

This module is the single place to declare optional, per-user capabilities (search, calendar, todo, etc.) that contribute tools and prompt guidance to the **surface** and **worker** agents.

Use `web_search` (`src/integrations/webSearch/`) as the reference implementation.

## Mental model

Each integration is one `IntegrationDefinition` that can contribute:

| Contribution | Surface agent | Worker agent |
|---|---|---|
| Tools | Read / query actions | Write / mutate actions |
| System-prompt guidance | Optional cross-tool policy | Optional cross-tool policy |
| Per-user config | Credentials, endpoints, etc. | Same store, same shape |

**Core platform tools** (filesystem sandbox, `schedule_task`) live in `src/surface/extensions/` and `src/worker/extensions/`. They are always on and are **not** integrations.

Integrations are resolved **per user** at session creation time:

```
IntegrationStore (integrations.json)
  → resolveEnabledIntegrations(store, userId)
  → buildIntegrationSessionExtras(enabled, role, ctx)
  → buildRoleAgentSession (via createSurfaceSession / createWorkerSession)
```

Resolution happens in:

- `SurfaceSessionRegistry.getOrCreate` (surface)
- `workerTaskService.runTask` (worker)

Session factories receive a plain `EnabledIntegration[]` list and do not touch the store directly.

## Surface vs worker

Follow the existing role split:

- **Surface** — read-only. Expose query tools (`read_calendar`, `list_todos`). Defer writes via `schedule_task`.
- **Worker** — write-capable. Expose mutation tools (`add_event`, `create_todo`).

An integration does not need tools on both roles. Use `Partial<Record<AgentLlmRole, IntegrationToolSpec[]>>` and omit the role you do not need:

```typescript
tools: {
  surface: [readCalendarToolSpec],
  worker: [addEventToolSpec],
}
```

The same tool name may appear on both roles of **one** integration (as `web_search` does). It must not collide with base tools or another integration's tool names.

## Per-user enablement

State is stored at:

```
{DATA_ROOT}/users/{userId}/integrations.json
```

Shape:

```json
{
  "calendar": {
    "enabled": true,
    "config": {
      "accessToken": "..."
    }
  }
}
```

Rules:

- `enabled` in the file overrides `defaultEnabled` on the definition.
- Missing file → defaults apply (`defaultEnabled` per integration).
- Unknown integration ids in the file are ignored.
- Invalid `config` → logged, falls back to `{}`.

### HTTP API

Enablement toggles are exposed over HTTP. Credentials and other `config` fields are **not** on the wire — edit `integrations.json` directly or use env fallbacks (e.g. `EXA_API_KEY` for `web_search`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/integrations?user_id=...` | List registered integrations with `id`, `label`, `default_enabled`, and effective `enabled` |
| `PUT` | `/v1/integrations` | Bulk enable/disable: body `{ user_id, integrations: { "<id>": { enabled: boolean } } }` |

`PUT` preserves existing stored `config` for each touched integration. Omitted integration ids are left unchanged.

Surface sessions cache integration state at creation. If a user toggles an integration via HTTP, they need a new `session_id` or LRU eviction before the surface agent sees the change. Worker tasks always resolve fresh state per task.

For local testing without HTTP, edit `integrations.json` directly or use `IntegrationStore.set` in tests.

## Step-by-step: add a new integration

### 1. Create a module directory

```
src/integrations/myIntegration/
  index.ts          # IntegrationDefinition export
  myReadTool.ts     # surface tool (optional)
  myWriteTool.ts    # worker tool (optional)
  client.ts         # API client, MCP wrapper, etc.
```

Keep all integration-specific code inside `src/integrations/`. Do not import from `src/surface/` or `src/worker/`.

### 2. Define tool specs

Each tool is an `IntegrationToolSpec`:

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { IntegrationContext, IntegrationToolSpec } from '../types.js';

export type MyIntegrationConfig = {
  apiKey?: string;
};

export const myReadToolSpec: IntegrationToolSpec = {
  name: 'read_my_data',
  register(pi: ExtensionAPI, ctx: IntegrationContext<MyIntegrationConfig>) {
    pi.registerTool({
      name: 'read_my_data',
      label: 'read_my_data',
      description: 'Read data from My Service.',
      promptSnippet: 'Read data from My Service',
      promptGuidelines: [
        'Use read_my_data when the user asks about ...',
      ],
      parameters: Type.Object({
        query: Type.String({ description: 'What to look up' }),
      }),
      async execute(_toolCallId, params, signal) {
        // Use ctx.userId, ctx.config, ctx.log
        return {
          content: [{ type: 'text' as const, text: '...' }],
          details: {},
        };
      },
    });
  },
};
```

Pi requires every custom tool to be **both**:

1. Registered via `pi.registerTool` (in your `register` function), and
2. Listed in the `createAgentSession({ tools })` allowlist.

The framework handles (2) automatically from your `IntegrationToolSpec.name` entries. You only implement (1).

### 3. Export the definition

```typescript
import type { IntegrationDefinition } from '../types.js';
import { myReadToolSpec } from './myReadTool.js';
import { myWriteToolSpec } from './myWriteTool.js';

function parseMyConfig(raw: Record<string, unknown>): MyIntegrationConfig {
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : undefined;
  return apiKey ? { apiKey } : {};
}

export const myIntegration: IntegrationDefinition = {
  id: 'my_integration',
  label: 'My Integration',
  defaultEnabled: false,
  tools: {
    surface: [myReadToolSpec],
    worker: [myWriteToolSpec],
  },
  parseConfig: parseMyConfig,
  // Optional cross-tool policy (not tool usage — see "Prompt channels" below)
  systemPrompt: {
    surface: 'When reading My Service data, prefer concise summaries.',
    worker: 'Confirm destructive My Service writes in the task result summary.',
  },
};
```

### 4. Register in the registry

Add your definition to `DEFINITIONS` in `src/integrations/registry.ts`:

```typescript
import { myIntegration } from './myIntegration/index.js';

const DEFINITIONS = [webSearchIntegration, myIntegration] as const;
```

`validateRegistry()` runs at server startup and throws if:

- A tool name collides with a base tool (`read`, `write`, `edit`, `ls`, `grep`, `find`, `schedule_task`)
- Two integrations declare the same tool name

No changes are needed in `createSurfaceSession`, `createWorkerSession`, or the extensions beyond registering in the registry.

### 5. Add tests

| Test file | What to cover |
|---|---|
| `tests/integrations/myIntegration/` | Tool behavior, client, config parsing |
| `tests/integrations/registry.test.ts` | Registry still validates (implicit if you only add a valid integration) |
| `tests/integrations/buildIntegrationSessionExtras.test.ts` | Per-role tool names and prompt fragments, if non-trivial |

Use `createEmptyIntegrationStore()` from `tests/helpers/emptyIntegrationStore.ts` when you need defaults, or a mock `IntegrationStore` to test enable/disable overrides.

## `IntegrationDefinition` fields

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Stable key in `integrations.json` |
| `label` | yes | Human-readable name (for future UI) |
| `defaultEnabled` | yes | Used when the user has no stored state |
| `tools` | yes | Per-role `IntegrationToolSpec[]` (partial) |
| `parseConfig` | no | Validate/normalize stored `config`; throw on invalid shape |
| `systemPrompt` | no | Per-role cross-tool policy appended to the system prompt |
| `onSessionShutdown` | no | Per-session cleanup (session-scoped resources only) |
| `onProcessShutdown` | no | Process-wide cleanup (shared clients, connection pools) |

### `IntegrationContext` passed to `register`

```typescript
{
  userId: string;
  role: 'surface' | 'worker';
  config: unknown;  // output of parseConfig, or {}
  log?: AppLogger;
}
```

Use `config` for per-user credentials. Fall back to env vars only when appropriate (see `web_search` + `EXA_API_KEY`).

## Prompt channels

Two separate mechanisms — do not duplicate guidance:

| Channel | Where | Use for |
|---|---|---|
| Tool-level | `promptSnippet`, `promptGuidelines` on `pi.registerTool` | How to use **this** tool |
| Integration-level | `systemPrompt` on `IntegrationDefinition` | Cross-tool policy (OAuth rules, safety, deferral behavior) |

`web_search` intentionally has no integration-level `systemPrompt` because the tool guidelines already cover usage.

Integration-level fragments are joined via `formatIntegrationGuidance` and appended in `buildSurfaceSystemPrompt` / `buildWorkerSystemPrompt`.

## Lifecycle: session vs process shutdown

Choose the right hook for shared resources:

| Hook | When it runs | Use for |
|---|---|---|
| `onSessionShutdown` | Each Pi session ends | Per-session handles, temp state |
| `onProcessShutdown` | SIGTERM / SIGINT in `src/index.ts` | **Shared** clients (MCP pools, DB pools) |

**Do not** put shared-client teardown in `onSessionShutdown`. One surface session shutting down must not break other live sessions. `web_search` uses `onProcessShutdown: closeExaMcp` for this reason.

## Reserved tool names

Do not use these as integration tool names (enforced at startup):

```
read, write, edit, ls, grep, find, schedule_task
```

## Checklist

- [ ] New directory under `src/integrations/<name>/`
- [ ] `IntegrationDefinition` with unique `id` and non-colliding tool names
- [ ] Tools split correctly between `surface` (read) and `worker` (write)
- [ ] `parseConfig` validates stored credentials
- [ ] `register` uses `ctx.config` and `ctx.log` (no `console.*`)
- [ ] Shared clients use `onProcessShutdown`, not `onSessionShutdown`
- [ ] Added to `DEFINITIONS` in `registry.ts`
- [ ] Tests added; `npm test`, `npm run typecheck`, `npm run lint` pass
- [ ] `defaultEnabled` set intentionally (`true` only for always-on integrations like `web_search`)

## Example: calendar (future)

```
src/integrations/calendar/
  index.ts
  readCalendarTool.ts    # surface: read_calendar
  addEventTool.ts        # worker: add_event
  calendarClient.ts
```

```typescript
export const calendarIntegration: IntegrationDefinition = {
  id: 'calendar',
  label: 'Calendar',
  defaultEnabled: false,
  tools: {
    surface: [readCalendarToolSpec],
    worker: [addEventToolSpec],
  },
  parseConfig: parseCalendarConfig,
};
```

User enables it by writing to `integrations.json`:

```json
{
  "calendar": {
    "enabled": true,
    "config": { "provider": "google", "accessToken": "..." }
  }
}
```
