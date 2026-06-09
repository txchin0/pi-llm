# Pi Coding Agent SDK — Investigation Report

**Package:** `@earendil-works/pi-coding-agent` (v0.79.0 in this repo)  
**Related packages:** `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`  
**Prepared for:** pi-llm integration work  
**Date:** June 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Package Ecosystem & Installation](#2-package-ecosystem--installation)
3. [Architecture Overview](#3-architecture-overview)
4. [Core Entry Points](#4-core-entry-points)
5. [AgentSession — Lifecycle & API](#5-agentsession--lifecycle--api)
6. [Prompting, Queueing & Streaming](#6-prompting-queueing--streaming)
7. [Event System](#7-event-system)
8. [Resource Loading (DefaultResourceLoader)](#8-resource-loading-defaultresourceloader)
9. [Models, Auth & Thinking Levels](#9-models-auth--thinking-levels)
10. [Tools — Built-in, Custom & Extensions](#10-tools--built-in-custom--extensions)
11. [Extensions](#11-extensions)
12. [Skills, Context Files & Prompt Templates](#12-skills-context-files--prompt-templates)
13. [Session Management & Tree Model](#13-session-management--tree-model)
14. [Settings Management](#14-settings-management)
15. [AgentSessionRuntime — Session Replacement](#15-agentsessionruntime--session-replacement)
16. [Run Modes (Interactive, Print, RPC)](#16-run-modes-interactive-print-rpc)
17. [SDK vs RPC vs CLI](#17-sdk-vs-rpc-vs-cli)
18. [Example Walkthrough (All 13 SDK Examples)](#18-example-walkthrough-all-13-sdk-examples)
19. [Implications for pi-llm](#19-implications-for-pi-llm)
20. [Pitfalls & Best Practices](#20-pitfalls--best-practices)
21. [Reference Links](#21-reference-links)

---

## 1. Executive Summary

The Pi Coding Agent SDK exposes programmatic access to Pi's full agent stack: LLM calls, tool execution, extensions, skills, session persistence, compaction, retries, and event streaming. It is designed for **in-process Node.js embedding** — the same layer that powers Pi's interactive TUI, print mode, and RPC mode.

For pi-llm, the SDK is the correct integration path (confirmed in [DESIGN.md](../DESIGN.md) §8). The server should:

- Create **separate `AgentSession` instances** for surface (read-only, thinking off) and worker (write-capable, per-task) agents.
- Subscribe to **`AgentSessionEvent`** streams and map them to the project's SSE contract (`delta`, `thinking_delta`, `tool_call`, `tool_result`, etc.).
- Use **`DefaultResourceLoader` overrides** or a custom `ResourceLoader` to control system prompts without rebuilding them every turn (KV cache preservation).
- Register **custom tools** via `defineTool()` + `customTools` for calendar, search, and schedule-task.
- Scope filesystem access via **`cwd`** (user memory workspace) + **`tools` allowlist**.

Two API tiers matter:

| Tier | When to use |
|------|-------------|
| `createAgentSession()` | Single session, straightforward embedding (pi-llm MVP) |
| `createAgentSessionRuntime()` | Session replacement flows (`newSession`, `switchSession`, `fork`, `importFromJsonl`) |

pi-llm likely needs only `createAgentSession()` initially, with `SessionManager.inMemory()` or persistent sessions per user thread.

---

## 2. Package Ecosystem & Installation

```bash
npm install @earendil-works/pi-coding-agent
```

The SDK ships inside the main package — no separate SDK package. It re-exports from:

| Package | Role |
|---------|------|
| `@earendil-works/pi-coding-agent` | Session factory, tools, extensions, resource loading, run modes |
| `@earendil-works/pi-agent-core` | Core `Agent` class, message types, thinking levels, tool protocol |
| `@earendil-works/pi-ai` | Provider models (`getModel`), API calls, `ImageContent` |
| `@earendil-works/pi-tui` | Terminal UI (only needed for `InteractiveMode`) |

**Primary import surface:**

```typescript
import {
  AuthStorage,
  createAgentSession,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  defineTool,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { getModel } from "@earendil-works/pi-ai";
```

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Your Application (pi-llm server)                           │
│  - HTTP/SSE API                                             │
│  - Custom tool gateway                                      │
│  - Event → SSE mapping                                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  createAgentSession() / AgentSessionRuntime                 │
│  - prompt(), steer(), followUp()                            │
│  - subscribe(AgentSessionEvent)                             │
│  - compaction, retry, model cycling                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ResourceLoader    SessionManager    SettingsManager
  (extensions,      (JSONL tree,      (compaction, retry,
   skills, prompts)  persistence)      thinking defaults)
        │                  │
        ▼                  ▼
  ExtensionRunner     Agent (pi-agent-core)
  - registerTool      - state.messages
  - registerCommand   - LLM turns + tool loop
  - event hooks
        │
        ▼
  Built-in Tools (read, bash, edit, write, grep, find, ls)
  + customTools + extension tools
        │
        ▼
  ModelRegistry + AuthStorage → pi-ai providers
```

**Key design insight:** `AgentSession` is shared across all Pi run modes. Modes (TUI, print, RPC) are thin I/O layers on top. pi-llm builds its own I/O layer (SSE) directly on `AgentSession`.

---

## 4. Core Entry Points

### 4.1 `createAgentSession(options?)`

The main factory. Returns `CreateAgentSessionResult`:

```typescript
interface CreateAgentSessionResult {
  session: AgentSession;
  extensionsResult: LoadExtensionsResult;  // extensions, errors, runtime
  modelFallbackMessage?: string;           // if restored session used fallback model
}
```

**`CreateAgentSessionOptions` (installed v0.79.0):**

| Option | Default | Notes |
|--------|---------|-------|
| `cwd` | `process.cwd()` | Project discovery + tool path root |
| `agentDir` | `~/.pi/agent` | Global config, auth, sessions |
| `authStorage` | `AuthStorage.create()` | Credential resolution |
| `modelRegistry` | `ModelRegistry.create(authStorage)` | Built-in + custom models |
| `model` | settings → first available | Explicit model recommended for servers |
| `thinkingLevel` | settings → `'medium'` | Clamped to model capabilities |
| `scopedModels` | — | Models for cycling (Ctrl+P in TUI) |
| `noTools` | — | `"all"` or `"builtin"` to suppress defaults |
| `tools` | `["read","bash","edit","write"]` | Allowlist when provided |
| `excludeTools` | — | Denylist applied after allowlist |
| `customTools` | `[]` | `defineTool()` definitions |
| `resourceLoader` | `DefaultResourceLoader` | Extensions, skills, prompts, AGENTS.md |
| `sessionManager` | `SessionManager.create(cwd)` | Persistence |
| `settingsManager` | `SettingsManager.create(cwd, agentDir)` | Compaction, retry, etc. |
| `sessionStartEvent` | — | Metadata for extension startup |

### 4.2 Minimal Quick Start

```typescript
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

session.subscribe((event) => {
  if (event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
session.dispose();
```

**Always call `session.dispose()`** when done to remove listeners and disconnect from the agent.

---

## 5. AgentSession — Lifecycle & API

`AgentSession` manages agent lifecycle, message history, model state, compaction, retries, and event streaming. Access the underlying `Agent` via `session.agent`.

### 5.1 Key Properties

| Property / Method | Description |
|-------------------|-------------|
| `session.agent` | Core `Agent` from pi-agent-core |
| `session.agent.state` | `messages`, `model`, `thinkingLevel`, `systemPrompt`, `tools`, `streamingMessage`, `errorMessage` |
| `session.messages` | All messages including custom types |
| `session.model` | Current model (may be undefined) |
| `session.thinkingLevel` | Current thinking level |
| `session.isStreaming` | Whether a response is in progress |
| `session.systemPrompt` | Effective system prompt (includes per-turn extension mods) |
| `session.sessionFile` | Path to JSONL session file, or `undefined` for in-memory |
| `session.sessionId` | Session identifier |
| `session.getActiveToolNames()` | Currently enabled tools |
| `session.getAllTools()` | Full tool metadata |
| `session.setActiveToolsByName(names)` | Change tools (takes effect next turn) |

### 5.2 Prompting Methods

| Method | Purpose |
|--------|---------|
| `prompt(text, options?)` | Main entry — handles extension commands, template expansion, queueing |
| `steer(text, images?)` | Queue steering message during streaming |
| `followUp(text, images?)` | Queue message for after agent fully stops |
| `sendUserMessage(content, options?)` | Always triggers a turn |
| `sendCustomMessage(message, options?)` | Extension-style custom messages |
| `abort()` | Abort current operation, wait for idle |

### 5.3 Model & Thinking Control

| Method | Purpose |
|--------|---------|
| `setModel(model)` | Set model (validates auth, persists) |
| `setThinkingLevel(level)` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `cycleModel(direction?)` | Cycle scoped or available models |
| `cycleThinkingLevel()` | Cycle thinking levels |
| `supportsThinking()` | Whether current model supports reasoning |

### 5.4 Compaction & Retry

| Method | Purpose |
|--------|---------|
| `compact(customInstructions?)` | Manual context compaction |
| `abortCompaction()` | Cancel in-progress compaction |
| `setAutoCompactionEnabled(enabled)` | Toggle auto-compaction |
| `setAutoRetryEnabled(enabled)` | Toggle auto-retry on provider errors |
| `abortRetry()` | Cancel in-progress retry |

### 5.5 Session Tree Navigation

| Method | Purpose |
|--------|---------|
| `navigateTree(targetId, options?)` | In-place branch navigation within same session file |
| `getUserMessagesForForking()` | List user messages for fork UI |
| `exportToJsonl(outputPath?)` | Export current branch to JSONL |
| `exportToHtml(outputPath?)` | Export session to HTML |

### 5.6 Extension Binding

```typescript
await session.bindExtensions({
  uiContext,           // optional — for TUI
  mode,                // extension mode
  commandContextActions,
  abortHandler,
  shutdownHandler,
  onError,
});
```

**Critical:** After `AgentSessionRuntime` replaces the session (`newSession`, `switchSession`, etc.), you must **re-subscribe** to events and **re-call `bindExtensions()`** on the new `runtime.session`.

### 5.7 Direct Agent State Mutation

```typescript
// Replace messages (branching, restoration)
session.agent.state.messages = messages; // copies top-level array

// Replace tools
session.agent.state.tools = tools;

// Wait for agent to finish
await session.agent.waitForIdle();
```

Use sparingly — prefer session APIs for normal flows.

---

## 6. Prompting, Queueing & Streaming

### 6.1 `PromptOptions`

```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean;   // default: true
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";  // required if streaming
  source?: InputSource;              // default: "interactive"
  preflightResult?: (success: boolean) => void;
}
```

### 6.2 Behavior Rules

| Input type | During streaming? | Behavior |
|------------|-----------------|----------|
| Normal text | No | Sent immediately, `prompt()` resolves when run completes |
| Normal text | Yes, no `streamingBehavior` | **Throws** — must use `steer`/`followUp` or set option |
| Normal text | Yes, `streamingBehavior: "steer"` | Queued for delivery after current turn's tool calls |
| Normal text | Yes, `streamingBehavior: "followUp"` | Queued until agent fully stops |
| Extension command (`/mycommand`) | Always | Executes immediately via extension handler |
| Prompt template (`/templatename`) | — | Expanded to file content before send/queue |
| Skill command (`/skill:name`) | — | Expanded to skill content |

### 6.3 `preflightResult` Semantics

- Called **once per `prompt()`** before resolution.
- `true` = prompt accepted, queued, or handled immediately.
- `false` = preflight rejected (e.g., validation failure).
- Failures **after** acceptance come through the event stream, not `preflightResult(false)`.
- `prompt()` still resolves only after the **full accepted run finishes**, including retries.

### 6.4 `steer()` vs `followUp()`

| | `steer()` | `followUp()` |
|---|-----------|--------------|
| Delivery timing | After current assistant turn finishes tool calls, before next LLM call | Only when agent has no more tool calls or steering messages |
| Extension commands | **Errors** — use `prompt()` instead | **Errors** — use `prompt()` instead |
| Template/skill expansion | Yes | Yes |

### 6.5 Steering & Follow-up Modes

- `session.setSteeringMode("all" | "one-at-a-time")`
- `session.setFollowUpMode("all" | "one-at-a-time")`
- `session.getSteeringMessages()` / `getFollowUpMessages()` for UI display
- `queue_update` events fire when queue changes

---

## 7. Event System

Subscribe via `session.subscribe(listener)` — returns unsubscribe function.

### 7.1 Event Types

| Event | When | Key fields |
|-------|------|------------|
| `message_update` | Streaming assistant output | `assistantMessageEvent`: `text_delta`, `thinking_delta`, etc. |
| `message_start` | New message starting | — |
| `message_end` | Message complete | — |
| `tool_execution_start` | Tool begins | `toolName`, tool call id |
| `tool_execution_update` | Streaming tool output | partial results |
| `tool_execution_end` | Tool completes | `isError`, `result` |
| `agent_start` | Agent begins processing | — |
| `agent_end` | Agent finished | `messages` (new), `willRetry` |
| `turn_start` | One LLM response + tools begins | — |
| `turn_end` | Turn complete | `message`, `toolResults` |
| `queue_update` | Steering/follow-up queue changed | `steering`, `followUp` |
| `compaction_start` / `compaction_end` | Context compaction | `reason`, `result`, `aborted` |
| `auto_retry_start` / `auto_retry_end` | Provider retry | `attempt`, `success` |
| `session_info_changed` | Session name changed | `name` |
| `thinking_level_changed` | Thinking level changed | `level` |

### 7.2 pi-llm SSE Mapping (recommended)

| Pi event | pi-llm SSE event |
|----------|------------------|
| `message_update` + `text_delta` | `{ type: "delta", text }` |
| `message_update` + `thinking_delta` | `{ type: "thinking_delta", text }` (if `show_thinking`) |
| `tool_execution_start` | `{ type: "tool_call", ... }` |
| `tool_execution_end` | `{ type: "tool_result", ... }` |
| `agent_end` (no `willRetry`) | `{ type: "final", finish_reason }` |
| Provider usage (from turn/session stats) | `{ type: "usage", usage }` |

Use `session.getSessionStats()` or `session.getContextUsage()` for token/cost data at end of run.

### 7.3 Session Persistence Side Effect

`AgentSession` **automatically persists messages on `message_end`** when using a persistent `SessionManager`. Multiple subscribers are supported.

---

## 8. Resource Loading (DefaultResourceLoader)

`DefaultResourceLoader` discovers and supplies everything that shapes the agent's context and capabilities.

### 8.1 Discovery Paths

**`cwd` (project-local):**

| Resource | Path |
|----------|------|
| Extensions | `.pi/extensions/` |
| Skills | `.pi/skills/`, `.agents/skills/` (cwd + ancestors up to git root) |
| Prompt templates | `.pi/prompts/` |
| Context files | `AGENTS.md` (walk up from cwd) |
| Settings | `.pi/settings.json` |
| Session naming | derived from cwd |

**`agentDir` (global, default `~/.pi/agent`):**

| Resource | Path |
|----------|------|
| Extensions | `extensions/` |
| Skills | `skills/`, `~/.agents/skills/` |
| Prompts | `prompts/` |
| Context | `AGENTS.md` |
| Settings | `settings.json` |
| Custom models | `models.json` |
| Credentials | `auth.json` |
| Sessions | `sessions/` |

When a **custom `ResourceLoader`** is passed, `cwd`/`agentDir` no longer control discovery — but they still affect session naming and tool path resolution.

### 8.2 Override Hooks

All overrides on `DefaultResourceLoader` require **`await loader.reload()`** before `createAgentSession()`.

| Override | Purpose |
|----------|---------|
| `systemPromptOverride(base)` | Replace or transform base system prompt |
| `appendSystemPromptOverride(base)` | Control appended instructions (e.g., skip `APPEND_SYSTEM.md`) |
| `skillsOverride(current)` | Filter, merge, or replace skills |
| `agentsFilesOverride(current)` | Inject virtual `AGENTS.md` content |
| `promptsOverride(current)` | Add custom slash commands |
| `extensionsOverride(base)` | Replace extension discovery |
| `extensionFactories` | Inline extension functions |
| `additionalExtensionPaths` | Extra extension file paths |
| `noExtensions`, `noSkills`, etc. | Disable discovery categories |

### 8.3 Full Control Pattern (Example 12)

Implement the `ResourceLoader` interface directly for zero discovery:

```typescript
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "You are a minimal assistant.",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
};
```

This is ideal for pi-llm when you want **no accidental discovery** of the server's own `.pi/` or `AGENTS.md`.

### 8.4 Event Bus (Cross-Extension Communication)

```typescript
import { createEventBus, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

const eventBus = createEventBus();
const loader = new DefaultResourceLoader({ eventBus });
await loader.reload();

eventBus.on("my-extension:status", (data) => console.log(data));
```

---

## 9. Models, Auth & Thinking Levels

### 9.1 Model Resolution

```typescript
import { getModel } from "@earendil-works/pi-ai";

// Built-in model (no API key check)
const opus = getModel("anthropic", "claude-opus-4-5");

// Registry lookup (includes models.json custom models)
const custom = modelRegistry.find("my-provider", "my-model");

// Only models with valid credentials
const available = await modelRegistry.getAvailable();
```

**Model selection order when not specified:**

1. Restore from session (if continuing)
2. Default from settings
3. First available model with valid API key

### 9.2 API Key Resolution (AuthStorage)

Priority (highest first):

1. **Runtime overrides** — `authStorage.setRuntimeApiKey(provider, key)` (not persisted)
2. **Stored credentials** — `auth.json` (API keys or OAuth tokens)
3. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
4. **Fallback resolver** — custom provider keys from `models.json`

```typescript
// Server-side pattern for pi-llm
const authStorage = AuthStorage.create("/path/to/auth.json");
authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY!);
const modelRegistry = ModelRegistry.create(authStorage);

// Built-in models only (no models.json)
const simpleRegistry = ModelRegistry.inMemory(authStorage);
```

### 9.3 Thinking Levels

Values: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`

- Clamped to model capabilities automatically.
- Surface agent: `thinkingLevel: "off"` (per DESIGN.md).
- Worker agent: `low` or `medium`.
- Thinking output streams via `message_update` with `thinking_delta` events.

---

## 10. Tools — Built-in, Custom & Extensions

### 10.1 Built-in Tool Names

`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

**Defaults when `tools` omitted:** `read`, `bash`, `edit`, `write`

### 10.2 Tool Configuration Options

```typescript
// Read-only (surface agent pattern)
tools: ["read", "grep", "find", "ls"]

// Disable all tools
noTools: "all"

// Disable built-ins but keep extension/custom tools
noTools: "builtin"

// Allowlist + deny one
tools: ["read", "bash", "grep", "schedule_task"],
excludeTools: ["bash"]
```

**Important:** If you pass `tools`, you must **include custom tool names** explicitly:

```typescript
tools: ["read", "grep", "schedule_task"],
customTools: [scheduleTaskTool],
```

### 10.3 Custom `cwd` Scoping

Built-in tools are constructed for the session's `cwd`. For pi-llm:

```typescript
const userWorkspace = `/data/users/${userId}/memory`;

const { session } = await createAgentSession({
  cwd: userWorkspace,
  tools: ["read", "grep", "find", "ls"],
  sessionManager: SessionManager.inMemory(userWorkspace),
});
```

This is the primary sandbox mechanism — tools resolve paths relative to `cwd`.

### 10.4 Custom Tools via `defineTool()`

```typescript
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const scheduleTaskTool = defineTool({
  name: "schedule_task",
  label: "Schedule Task",
  description: "Enqueue background work for the worker agent",
  parameters: Type.Object({
    task_type: Type.String(),
    description: Type.String(),
  }),
  execute: async (_toolCallId, params) => ({
    content: [{ type: "text", text: `Task queued: ${params.description}` }],
    details: { task_type: params.task_type },
  }),
});
```

- Use **TypeBox** (`typebox`) for parameter schemas.
- `execute` returns `{ content: [...], details: {} }`.
- `details` can carry structured data for your gateway/logging.
- The `edit` tool's `details` includes both `diff` (TUI) and `patch` (unified diff for SDK consumers).

### 10.5 Tool Factories (Advanced)

For custom runtimes, low-level factories are exported:

```typescript
createCodingTools, createReadOnlyTools,
createReadTool, createBashTool, createEditTool, createWriteTool,
createGrepTool, createFindTool, createLsTool
```

---

## 11. Extensions

Extensions are TypeScript modules loaded by `ResourceLoader` that hook into the agent lifecycle.

### 11.1 Discovery

- `~/.pi/agent/extensions/`
- `<cwd>/.pi/extensions/`
- Paths in `settings.json` `"extensions"` array
- `additionalExtensionPaths` on `DefaultResourceLoader`
- `extensionFactories` for inline extensions

### 11.2 Extension File Shape

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async () => { /* ... */ });

  pi.on("tool_call", async (event) => {
    // Return { block: true, reason: "..." } to block execution
    return undefined;
  });

  pi.registerTool({ name: "my_tool", /* ... */ });
  pi.registerCommand("mycommand", { description: "...", handler: async (args, ctx) => { } });
}
```

### 11.3 Extension Capabilities

- Register tools (`pi.registerTool`)
- Register slash commands (`pi.registerCommand`)
- Subscribe to lifecycle events (`agent_start`, `agent_end`, `tool_call`, `before_provider_request`, etc.)
- Block or modify tool calls
- Communicate via `pi.events` event bus
- Send messages via `pi.sendMessage()` (used by extension commands)

### 11.4 Extension vs Custom Tools

| Approach | Best for |
|----------|----------|
| `defineTool()` + `customTools` | Server-owned tools with simple execute handlers (pi-llm gateway tools) |
| Extensions | Cross-cutting concerns, blocking, logging, packaging reusable capabilities |
| `pi.registerTool()` in extension | Tools that need extension context/lifecycle |

For pi-llm MVP, **custom tools via `defineTool()`** are simpler than file-based extensions.

---

## 12. Skills, Context Files & Prompt Templates

### 12.1 Skills

Skills are specialized instruction blocks injected into the system prompt.

```typescript
const loader = new DefaultResourceLoader({
  skillsOverride: (current) => ({
    skills: [...current.skills.filter(s => s.name.includes("search")), customSkill],
    diagnostics: current.diagnostics,
  }),
});
```

Invoke via `/skill:name` in prompts (expanded before sending).

### 12.2 Context Files (AGENTS.md)

Walk-up discovery from `cwd`. Override to inject virtual guidelines:

```typescript
agentsFilesOverride: (current) => ({
  agentsFiles: [
    ...current.agentsFiles,
    { path: "/virtual/AGENTS.md", content: "# Guidelines\n..." },
  ],
}),
```

For pi-llm: inject memory index snapshot and behavioral rules here **at session creation**, not per-turn.

### 12.3 Prompt Templates (Slash Commands)

File-based templates invoked as `/templatename`:

```typescript
promptsOverride: (current) => ({
  prompts: [...current.prompts, deployTemplate],
  diagnostics: current.diagnostics,
}),
```

Expanded by `prompt()` when `expandPromptTemplates: true` (default).

---

## 13. Session Management & Tree Model

Sessions are stored as **JSONL files** with a **tree structure** (`id` / `parentId` linking). This enables branching, forking, and in-place navigation.

### 13.1 SessionManager Factories

```typescript
SessionManager.inMemory(cwd?)           // No persistence
SessionManager.create(cwd, sessionDir?) // New persistent session
SessionManager.continueRecent(cwd)      // Resume most recent or create new
SessionManager.open("/path/to/session.jsonl")
```

### 13.2 Listing Sessions

```typescript
const projectSessions = await SessionManager.list(cwd);
const allSessions = await SessionManager.listAll(cwd);
```

### 13.3 Tree API

```typescript
const sm = SessionManager.open("/path/to/session.jsonl");

sm.getEntries();           // All entries (excludes header)
sm.getTree();              // Full tree
sm.getPath();              // Root → current leaf
sm.getLeafEntry();         // Current leaf
sm.getEntry(id);
sm.getChildren(id);
sm.getLabel(id);
sm.appendLabelChange(id, "checkpoint");
sm.branch(entryId);        // Move leaf to earlier entry
sm.branchWithSummary(id, "Summary...");
sm.createBranchedSession(leafId);  // Extract path to new file
```

### 13.4 Session Entry Types

| Type | Purpose |
|------|---------|
| `session` (header) | Metadata: id, cwd, timestamp, parentSession |
| `message` | Agent message |
| `thinking_level_change` | Thinking level change |
| `model_change` | Model switch |
| `compaction` | Context compaction summary |
| `branch_summary` | Abandoned branch summary |
| `custom` | Extension state (not in LLM context) |
| `custom_message` | Extension-injected LLM context |
| `label` | User bookmarks |
| `session_info` | Display name |

### 13.5 pi-llm Session Strategy

| Agent | Session model |
|-------|---------------|
| Surface | Long-lived per user conversation; `SessionManager.inMemory()` or persistent per `sess_*` id |
| Worker | Short-lived per task; `SessionManager.inMemory(cwd)`; dispose after completion |

Map pi-llm `sess_*` identifiers to Pi `sessionId` / `sessionFile` in server state — they are separate concepts.

---

## 14. Settings Management

```typescript
// Load merged global + project settings
const settingsManager = SettingsManager.create(cwd, agentDir);

// Override for server deployment
settingsManager.applyOverrides({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
});

// In-memory for tests
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: false },
});
```

**Settings merge:** Global (`~/.pi/agent/settings.json`) + project (`<cwd>/.pi/settings.json`). Project overrides global; nested objects merge keys.

**Persistence semantics:**

- Setters update in-memory immediately; disk writes are async.
- Call `await settingsManager.flush()` before exit or test assertions.
- Check `settingsManager.drainErrors()` for I/O failures (not logged by Pi).

**Recommended pi-llm overrides:**

- Surface: `compaction: { enabled: true }` (long conversations), `retry: { enabled: true }`
- Worker: `compaction: { enabled: false }` (short task sessions)

---

## 15. AgentSessionRuntime — Session Replacement

Use when you need to **replace the active session** and rebuild cwd-bound services — the same layer as Pi's built-in `/new`, `/resume`, `/fork`, `/import`.

### 15.1 Factory Pattern

```typescript
const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd, sessionManager, sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({
      services, sessionManager, sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});
```

### 15.2 Replacement Methods

| Method | Purpose |
|--------|---------|
| `runtime.newSession()` | Fresh session |
| `runtime.switchSession(path)` | Open saved session |
| `runtime.fork(entryId, { position: "before" \| "at" })` | Fork from user entry |
| `runtime.importFromJsonl(path, cwdOverride?)` | Import JSONL |
| `runtime.dispose()` | Tear down |

### 15.3 Rebind Pattern (Critical)

```typescript
let session = runtime.session;
let unsubscribe = session.subscribe(handler);

await runtime.newSession();

unsubscribe();
session = runtime.session;
await session.bindExtensions({});
unsubscribe = session.subscribe(handler);
```

**Rules:**

- `runtime.session` changes after replacement operations.
- Event subscriptions are per-session — must re-subscribe.
- Extensions must re-bind on new session.
- Creation/replacement failures **throw** — handle in app layer.
- Diagnostics available on `runtime.diagnostics`.

pi-llm likely does **not** need `AgentSessionRuntime` for MVP unless implementing multi-thread resume/fork in the API.

---

## 16. Run Modes (Interactive, Print, RPC)

The SDK exports ready-made run modes built on `AgentSessionRuntime`:

| Mode | Export | Use case |
|------|--------|----------|
| Interactive TUI | `InteractiveMode` | Full terminal UI |
| Print | `runPrintMode(runtime, options)` | Single-shot stdout output |
| RPC | `runRpcMode(runtime)` | JSONL stdin/stdout protocol |

These are **optional** for pi-llm — you build a custom mode on `AgentSession` directly.

### 16.1 Print Mode

```typescript
await runPrintMode(runtime, {
  mode: "text",
  initialMessage: "Hello",
  initialImages: [],
  messages: ["Follow up"],
});
```

### 16.2 RPC Mode

JSON commands on stdin, responses + events on stdout. See [RPC docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md).

CLI equivalent: `pi --mode rpc --no-session`

---

## 17. SDK vs RPC vs CLI

| Criterion | SDK (in-process) | RPC (subprocess) |
|-----------|------------------|------------------|
| Type safety | Full TypeScript | JSON protocol |
| Process isolation | Shared process | Separate process |
| Tool customization | `defineTool`, `tools` allowlist | Limited to CLI flags |
| State access | Direct `session.agent.state` | `get_state`, `get_messages` commands |
| Overhead | Lower | Subprocess + JSON serialization |
| Other languages | Node/TS only | Any language |
| Per-agent tool sets | Easy (separate sessions) | One process per config |

**pi-llm recommendation:** SDK in-process (DESIGN.md §8.6). RPC is a fallback for language isolation.

---

## 18. Example Walkthrough (All 13 SDK Examples)

Source: [examples/sdk/](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/sdk)

| # | File | Teaches |
|---|------|---------|
| 01 | `01-minimal.ts` | Zero-config: `createAgentSession()`, subscribe, `prompt()`, `dispose()` |
| 02 | `02-custom-model.ts` | `getModel()`, `modelRegistry.find()`, `getAvailable()`, `thinkingLevel` |
| 03 | `03-custom-prompt.ts` | `systemPromptOverride`, `appendSystemPromptOverride`, skip `APPEND_SYSTEM.md` |
| 04 | `04-skills.ts` | `skillsOverride`, filter/merge skills, `createSyntheticSourceInfo` |
| 05 | `05-tools.ts` | Read-only allowlist, custom cwd + `SessionManager.inMemory(cwd)` |
| 06 | `06-extensions.ts` | `additionalExtensionPaths`, `extensionFactories`, extension file template |
| 07 | `07-context-files.ts` | `agentsFilesOverride`, virtual `AGENTS.md` injection |
| 08 | `08-prompt-templates.ts` | `promptsOverride`, custom `/deploy` slash command |
| 09 | `09-api-keys-and-oauth.ts` | Custom auth paths, `setRuntimeApiKey`, `ModelRegistry.inMemory` |
| 10 | `10-settings.ts` | `applyOverrides`, `flush()`, `drainErrors()`, `SettingsManager.inMemory` |
| 11 | `11-sessions.ts` | in-memory, persistent, `continueRecent`, `list`, `open` |
| 12 | `12-full-control.ts` | Custom `ResourceLoader`, no discovery, full explicit config |
| 13 | `13-session-runtime.ts` | `AgentSessionRuntime`, rebind after `newSession`/`switchSession` |

**Run locally (from pi-coding-agent package):**

```bash
cd node_modules/@earendil-works/pi-coding-agent
npx tsx examples/sdk/01-minimal.ts
```

---

## 19. Implications for pi-llm

Based on [DESIGN.md](../DESIGN.md) and the current stub in `src/runtime/respondOrchestrator.ts`:

### 19.1 Surface Agent Session Setup (Target)

```typescript
const authStorage = AuthStorage.create(agentDir);
authStorage.setRuntimeApiKey(provider, process.env.API_KEY!);
const modelRegistry = ModelRegistry.create(authStorage);

const loader = new DefaultResourceLoader({
  cwd: userMemoryWorkspace,
  agentDir,
  systemPromptOverride: () => buildSurfaceSystemPrompt(user), // set once
  appendSystemPromptOverride: () => [],  // no accidental appends
  agentsFilesOverride: () => ({ agentsFiles: [] }),  // or inject memory index
  noExtensions: true,  // unless needed
});
await loader.reload();

const model = getModel("anthropic", "claude-sonnet-4-20250514");

const { session } = await createAgentSession({
  cwd: userMemoryWorkspace,
  model,
  thinkingLevel: "off",
  tools: ["read", "ls", "grep", "find"],
  customTools: [calendarReadTool, webSearchTool, scheduleTaskTool],
  authStorage,
  modelRegistry,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(userMemoryWorkspace),
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3 },
  }),
});
```

### 19.2 User Message Enrichment

Per DESIGN.md §3.3 and §11.2 — prepend volatile context to each user message, **not** the system prompt:

```typescript
const enrichedMessage = `[Current time: ${now}]\n\n${request.message}`;
await session.prompt(enrichedMessage);
```

### 19.3 RespondHandler Implementation Sketch

The `RespondHandler` interface in `src/runtime/respondHandoff.ts` should:

1. Obtain or create a per-`session_id` `AgentSession`.
2. Subscribe to events before calling `prompt()`.
3. Map Pi events → `RespondSseEvent` contract in `src/contracts/respond.ts`.
4. Unsubscribe / keep session alive based on lifecycle policy.
5. Handle `session.abort()` on client disconnect (Fastify `onClose`).

### 19.4 Worker Agent Session Setup (Target)

```typescript
const { session } = await createAgentSession({
  cwd: userMemoryWorkspace,
  model: workerModel,
  thinkingLevel: "medium",
  tools: ["read", "write", "edit", "ls", "grep", "find"],
  customTools: [calendarReadTool, calendarWriteTool, webSearchTool],
  sessionManager: SessionManager.inMemory(userMemoryWorkspace),
  // task-specific system prompt via resourceLoader override
});

await session.prompt(buildWorkerTaskPrompt(task));
// ... wait for agent_end ...
session.dispose();
```

### 19.5 Session ID Mapping

| pi-llm | Pi SDK |
|--------|--------|
| `sess_*` (server-issued) | Map in server registry → `AgentSession` instance |
| — | `session.sessionId` (Pi internal) |
| — | `session.sessionFile` (JSONL path if persistent) |

Keep a `Map<SessionId, AgentSession>` (or pool) in the server runtime layer.

---

## 20. Pitfalls & Best Practices

### Pitfalls

1. **Rebuilding system prompt every turn** — invalidates KV cache; set once via `ResourceLoader`, inject volatile data into user messages.
2. **Forgetting `await loader.reload()`** — overrides don't take effect.
3. **Prompting during streaming without `streamingBehavior`** — throws; pi-llm should reject concurrent prompts per session or queue them.
4. **Not re-subscribing after `AgentSessionRuntime` replacement** — silent event loss.
5. **Custom tools not in `tools` allowlist** — tool won't be exposed to the model.
6. **Mismatched `cwd` and `SessionManager.inMemory(cwd)`** — path confusion in sessions.
7. **Assuming `prompt()` resolves on first token** — it resolves after the full run including tool loops and retries.
8. **Default discovery picking up server project's `.pi/` or `AGENTS.md`** — use Example 12 pattern or explicit `noExtensions` / overrides.
9. **Not calling `dispose()`** — listener leaks on session teardown.
10. **Using `steer()`/`followUp()` with extension commands** — throws; use `prompt()`.

### Best Practices

1. **Explicit configuration** for production servers (Example 12 pattern).
2. **`AuthStorage.setRuntimeApiKey()`** for env-based secrets (not persisted to disk).
3. **`SettingsManager.inMemory()`** in tests; `drainErrors()` in production.
4. **One `AgentSession` per role per user** — never share surface/worker sessions.
5. **Map events at subscription boundary** — keep Pi types out of HTTP layer.
6. **`session.abort()`** on client disconnect.
7. **`modelRegistry.getAvailable()`** at startup for health checks.
8. **Log `extensionsResult.errors`** on session creation.
9. **Use `getSessionStats()`** for usage/cost reporting.
10. **Pin `@earendil-works/pi-coding-agent` version** — API evolves with Pi releases.

---

## 21. Reference Links

### Official Documentation

| Resource | URL |
|----------|-----|
| SDK documentation | [packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) |
| SDK examples (13 files) | [packages/coding-agent/examples/sdk/](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/sdk) |
| SDK examples README | [examples/sdk/README.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/README.md) |
| Extensions API | [packages/coding-agent/docs/extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) |
| RPC mode protocol | [packages/coding-agent/docs/rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) |
| Session format | [packages/coding-agent/docs/session-format.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md) |
| Pi repository | [github.com/earendil-works/pi](https://github.com/earendil-works/pi) |
| npm package | [@earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) |

### Local Copies (installed package)

| Resource | Path in node_modules |
|----------|---------------------|
| SDK examples | `node_modules/@earendil-works/pi-coding-agent/examples/sdk/` |
| Type definitions | `node_modules/@earendil-works/pi-coding-agent/dist/` |
| AgentSession API | `dist/core/agent-session.d.ts` |
| SDK factory | `dist/core/sdk.d.ts` |
| Resource loader | `dist/core/resource-loader.d.ts` |

### pi-llm Project Docs

| Resource | Path |
|----------|------|
| Solution design | [DESIGN.md](../DESIGN.md) |
| SSE respond contract | [src/contracts/respond.ts](../src/contracts/respond.ts) |
| Orchestrator (stub) | [src/runtime/respondOrchestrator.ts](../src/runtime/respondOrchestrator.ts) |

---

*This report reflects Pi Coding Agent SDK v0.79.0 as installed in pi-llm. Re-verify against upstream docs when upgrading the package.*
