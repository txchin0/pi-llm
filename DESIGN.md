# Personal Assistant — Solution Design

## 1. Overview

### 1.1 Purpose

A personal assistant that prioritizes fast conversational interaction while deferring heavier or write-oriented work to a background process. The user interacts through a familiar chat interface. A low-latency surface agent handles immediate dialogue and read-only lookups. A separate worker agent executes deferred tasks when the system is idle.

### 1.2 Design Principles

- **Latency first for chat.** The surface agent responds quickly without extended reasoning.
- **Separation of concerns.** Read and write capabilities are split across two agents with distinct tool sets.
- **Defer, don't block.** Write operations and multi-step work are queued rather than holding the user in a long-running turn.
- **User-scoped isolation.** All data, memory, and file access are confined to a single user's namespace.
- **Server as control plane.** The TypeScript server orchestrates agents, enforces permissions, and owns persistent state. Agents do not get unrestricted direct access to the filesystem or external services.

### 1.3 High-Level Architecture

The system consists of four major components:

1. **TypeScript server** — receives user messages, manages sessions, streams responses, runs the task queue, and executes tools on behalf of agents.
2. **Surface agent** — Pi harness agent for real-time chat, read-only filesystem and domain tools, and task scheduling.
3. **Task queue** — FIFO store of deferred work items consumed during idle periods.
4. **Worker agent** — Pi harness agent with write access for calendar and memory (via scoped filesystem tools).

The user always communicates with the surface agent. The worker agent is never directly addressed by the user.

---

## 2. TypeScript Server

### 2.1 Role

The server is the orchestrator and trust boundary. It exposes the chat API, invokes Pi harness sessions, routes custom tool calls through a permission-checked gateway, persists conversation and task state, and manages the user memory workspace on disk.

### 2.2 Responsibilities

- Accept inbound user messages over HTTP or WebSocket.
- Maintain per-user conversation history and session identifiers.
- Create Pi harness agent sessions with a system prompt set once at session start (memory index, stable instructions).
- Inject volatile context such as current time into each user message rather than mutating the system prompt (preserves KV cache).
- Create and run Pi harness agent sessions for surface and worker roles, each scoped to the user's memory workspace as cwd.
- Subscribe to Pi harness event streams and forward assistant text deltas and tool-call events to the client.
- Enqueue tasks when the surface agent calls the schedule-task tool.
- Run the background worker loop that dequeues and processes tasks.
- Enforce sandbox rules on every tool invocation.
- Store and serve task status for optional user queries.

### 2.3 Non-Responsibilities

The server does not perform LLM reasoning itself. Filesystem access is mediated by Pi built-in tools scoped to the memory workspace; calendar and search are mediated by custom tools. It does not merge surface and worker agent sessions into a single conversation thread.

### 2.4 Deployment Assumptions (MVP)

- Single-user or locally trusted deployment.
- One server process hosts chat handling and the worker loop.
- User data lives on local disk under a predictable directory structure.
- API keys for LLM providers are configured server-side, not by the client.

---

## 3. Surface Agent

### 3.1 Role

The surface agent is the user's conversational interface. It answers questions, performs quick read-only lookups, and triages intent. When a request requires a write or a tool the surface agent does not have, it schedules a background task and confirms that deferral to the user.

### 3.2 Pi Harness Configuration

- Implemented via the Pi coding harness SDK using an in-process agent session.
- Thinking level set to off to minimize latency.
- Session cwd set to the user's memory workspace so all filesystem operations act on memory directly.
- Built-in read-only filesystem tools enabled: read, ls, grep, and find. Write-oriented built-ins (write, edit, bash) are excluded.
- Custom tools for domain operations that are not filesystem-backed: calendar read, web search, and schedule-task.
- Separate session instance from the worker agent, with its own system prompt and tool registry.

### 3.3 System Prompt Contents

The surface agent system prompt is created once when the session starts and is not rebuilt on subsequent turns. Rebuilding it each turn would invalidate the provider KV cache and add latency. It includes:

- Brief stable user context (name, preferences) if known.
- A memory index snapshot: list of topic paths with short descriptions, not full file contents. This reflects memory at session start; the agent uses ls, grep, and read to discover changes during the session.
- Instructions on how memory is laid out in the workspace and when to use filesystem tools vs custom tools.
- Explicit guidance to use schedule-task for any write or unsupported operation.
- Tone and behavior guidelines (concise, honest about deferral, no false completion).

Volatile context such as current date and time is not part of the system prompt. The server prepends or attaches it to each inbound user message so the agent always has accurate time without mutating the cached system prompt.

### 3.4 Available Tools (MVP)

| Tool | Type | Access | Purpose |
|------|------|--------|---------|
| read | Pi built-in | Read | Read a memory topic file |
| ls | Pi built-in | Read | List topics and directories in memory |
| grep | Pi built-in | Read | Search across memory file contents |
| find | Pi built-in | Read | Locate files by name or pattern in memory |
| Calendar read | Custom | Read | View upcoming events and availability |
| Web search | Custom | Read | Retrieve external information |
| schedule_task | Custom (Pi extension) | Queue write | Enqueue work for the worker agent |

`web_search` and `schedule_task` are registered in `src/surface/extensions/surfaceExtension.ts` via a per-session extension factory.

### 3.5 Behavioral Rules

- Prefer answering from filesystem reads and the memory index before scheduling work.
- Never claim a write operation is complete unless `schedule_task` was called successfully for that work.
- When scheduling, give the user a clear confirmation in natural language.
- Keep responses short unless the user asks for detail.
- If uncertain whether a task is needed, ask a brief clarifying question rather than queueing unnecessarily.

### 3.6 Streaming

The server subscribes to Pi harness events and streams to the client:

- Text deltas as the assistant response is generated.
- Tool execution start, progress, and end events so the user can see what the agent is looking up (e.g. which memory files are being read or searched).

Tool events are also logged server-side for observability.

---

## 4. Worker Agent

### 4.1 Role

The worker agent executes tasks dequeued from the task queue. It has write access to calendar and memory. Memory writes are performed via Pi built-in filesystem tools against the same memory workspace the surface agent reads from. It may use extended reasoning and multi-step tool use because it runs outside the user's live chat path.

### 4.2 Pi Harness Configuration

- Separate agent session from the surface agent.
- Thinking level may be low or medium depending on task complexity.
- Session cwd set to the user's memory workspace (identical scope to the surface agent).
- Built-in filesystem tools enabled: read, write, edit, ls, grep, and find. Bash is excluded unless a specific task requires it post-MVP.
- Custom tools for calendar read/write and web search only.
- A fresh task-scoped session per dequeued task to avoid context bleed between unrelated jobs.

### 4.3 System Prompt Contents

Set once when the worker session is created for the task. Includes:

- Task description and server-built `context.turns` conversation excerpt from the queue entry.
- Memory index snapshot and instructions on memory layout (same format as surface agent).
- Instructions to complete the task, update memory by reading and writing markdown topic files (and updating the index file when topics are created or summaries change), and produce a structured result summary.

### 4.4 Available Tools (MVP)

| Tool | Type | Access | Purpose |
|------|------|--------|---------|
| read | Pi built-in | Read | Read memory topic files or index |
| write | Pi built-in | Write | Create new topic files |
| edit | Pi built-in | Write | Append or patch atomic notes in existing topics |
| ls | Pi built-in | Read | Navigate memory directory structure |
| grep | Pi built-in | Read | Search memory contents |
| find | Pi built-in | Read | Locate files in memory |
| Calendar read | Custom | Read | Check context before writing |
| Calendar write | Custom | Write | Create, update, or delete events |
| Web search | Custom | Read | Research before making writes |

### 4.5 Output

Each completed task stores a structured result on the task record: success or failure, summary text, and any identifiers created (e.g. calendar event id, memory file path updated). The surface agent may reference completed tasks on the user's next message.

---

## 5. Task Queue

### 5.1 Role

The task queue decouples user-facing latency from background execution. It is a FIFO store of work items created by the surface agent's `schedule_task` tool.

### 5.2 Task Structure

Each task includes:

- Unique identifier (`task_{hex}`, server-generated).
- `user_id` — owning user (server-injected, not a tool parameter).
- `description` — free-form text from the surface agent's `schedule_task` call (sole agent-facing parameter).
- `context` — server-built JSON, not provided by the agent (see §5.7).
- `session_id` — optional link to the originating conversation thread (server-injected).
- Status, timestamps, retry count, result, and error message.

Reserved for later bricks: `task_type`, priority, and structured context fields beyond the conversation excerpt.

**`context` shape (current):**

```json
{
  "turns": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

At enqueue time the server snapshots the last N user/assistant turn pairs from the Pi session (`TASK_CONTEXT_TURN_LIMIT`, default 3). Volatile time prefixes added by the server to user messages are stripped before storage.

### 5.3 Lifecycle

```
pending → running → completed
                 → failed (after retries exhausted)
```

### 5.4 Processing Model

**Not yet implemented:** the worker loop and idle detection below are design targets; enqueue and persistence are live.

- One task is dequeued and processed per idle window in MVP to avoid starving chat.
- Idle is defined as no active surface agent request within a configurable timeout (e.g. 30 seconds), or on a periodic poll interval as a fallback.
- If a task is running, no new task starts until it finishes.
- Failed tasks retry up to a fixed limit with the same payload; permanent failures are recorded for optional surfacing to the user.

### 5.5 Idempotency

Worker execution should be safe to retry. Write tools should check for existing resources (duplicate reminders, already-created events) before creating new ones.

### 5.6 User Visibility

The surface agent can answer questions about pending or recently completed tasks via a read tool or server API wrapping task list state. MVP may defer explicit "what's in my queue?" support if not essential.

### 5.7 Current implementation (pi-llm)

| Piece | Location |
|-------|----------|
| Types and validation | `src/queue/taskTypes.ts` |
| Queue port | `src/queue/taskQueue.ts` |
| Drizzle schema + migration | `src/queue/schema.ts`, `drizzle/` |
| SQLite repository | `src/queue/sqliteTaskQueue.ts` |
| Conversation excerpt builder | `src/queue/extractRecentTurns.ts` |
| Task service | `src/tasks/taskService.ts` |
| Tasks HTTP route | `src/server/routes/tasks.ts`, `src/tasks/listTasksController.ts` |
| Surface tool | `src/surface/extensions/scheduleTaskTool.ts`, registered in `surfaceExtension.ts` |
| Bootstrap wiring | `src/index.ts` creates queue; `SurfaceSessionRegistry` passes queue into session factory |

Persistence: single SQLite database at `{DATA_ROOT}/tasks.sqlite`. New tasks are inserted with `status: pending`. Logging: `task.enqueued` at info (`task_id`, `user_id`, `session_id`); `description` and `context` at debug only.

---

## 6. Memory System

### 6.1 Concept

Memory is the agent workspace. There is no separate "memory store" and "file workspace" — they are the same directory tree on disk. Pi harness built-in filesystem tools are how agents interact with memory: the surface agent reads via read, ls, grep, and find; the worker agent additionally writes and edits files.

Memory is organized like a personal wiki: topics as markdown files, an index for fast discovery, and atomic notes within each file. The index gives agents enough awareness to know where to look without loading everything into context; full content is loaded on demand via read.

### 6.2 Storage Layout

Per user, a single memory workspace root under the user's data namespace:

- An index file at the workspace root listing all topics with path, title, short summary, tags, and last-updated timestamp.
- Topic files as markdown, optionally grouped in subfolders (people, projects, preferences, etc.).
- Optional subdirectories for worker-managed content (e.g. reminders) if useful.

Both Pi agent sessions use this directory as their session cwd. Sandboxing ensures neither agent can access paths outside this root.

### 6.3 Index

The index is the primary map for agents. A snapshot is included in each agent's system prompt at session creation. Full topic content is never preloaded; agents use read to load files and grep/find to search.

The worker agent is responsible for keeping index summaries reasonably accurate when it creates or edits topics, by editing the index file directly.

### 6.4 Topic File Format

Each topic file has a title and a notes section composed of atomic bullet points: one fact or observation per line. Notes are appended rather than rewritten wholesale when possible. Cross-references to other topics or reminders may use lightweight wiki-style links.

### 6.5 Read and Write Semantics

All memory access goes through Pi built-in filesystem tools scoped to the workspace:

- **Read (surface and worker):** read for file contents; grep for content search; find and ls for discovery.
- **Write (worker only):** write to create new topic files; edit to append atomic notes or apply patches to existing content.
- **Index maintenance (worker):** edit or write on the index file when adding topics or updating summaries.

### 6.6 Search (MVP)

grep and find over the workspace. Semantic or embedding-based search is out of scope for MVP.

---

## 7. Tool Gateway and Sandboxing

### 7.1 Trust Model

Agents run inside the Pi harness. Filesystem access is provided by Pi built-in tools scoped to the user's memory workspace via session cwd and tool registration. Custom tools (calendar, web search, `schedule_task`) are implemented server-side. `web_search` and `schedule_task` run inside the surface Pi extension today; a dedicated gateway module may consolidate permission checks later.

### 7.2 Enforcement Layers

1. **Tool registration.** Surface and worker sessions are created with disjoint tool sets. The surface agent receives read-only built-ins; write and edit are omitted. The worker receives full filesystem built-ins for memory.
2. **Cwd scoping.** Both agents have session cwd set to the user's memory workspace. Pi built-in tools resolve paths relative to this root.
3. **Gateway for custom tools.** Calendar, web search, and `schedule_task` execute in server code with permission checks. `schedule_task` is surface-only and is registered only on surface sessions.
4. **Path hardening.** The server rejects workspace roots outside the user's data namespace. Path traversal and symlink escape within tool arguments are blocked.
5. **Audit logging.** Tool name, user, timestamp, and outcome are logged for debugging and accountability.

### 7.3 Permission Matrix

| Capability | Surface Agent | Worker Agent |
|------------|---------------|--------------|
| Read memory (read, ls, grep, find) | Yes | Yes |
| Write memory (write, edit) | No | Yes |
| Read calendar | Yes | Yes |
| Write calendar | No | Yes |
| Web search | Yes | Yes |
| Schedule task | Yes | No |
| Bash | No | No (MVP) |
| Paths outside memory workspace | No | No |

### 7.4 Pi Harness Isolation

Each agent session is configured independently. The server never shares a single session between surface and worker roles. API keys and model configuration are server-managed; agents do not read credential files.

---

## 8. Pi Harness Integration

### 8.1 Package Choice

Use the Pi coding harness SDK (`@earendil-works/pi-coding-agent`) embedded in the same Node.js process as the server. This provides agent sessions, model registry, authentication storage, custom tool definitions, and event streaming without subprocess RPC for MVP.

Lower-level `pi-agent-core` may be considered later if the coding-agent layer adds unnecessary weight, but the coding-agent SDK is the default integration path.

### 8.2 Session Model

- **Surface:** Long-lived session per user conversation, or per chat session id, reused across turns. Message history accumulates in the Pi session.
- **Worker:** Short-lived session per dequeued task. System prompt and initial message describe the task. Session is discarded or archived after completion.

### 8.3 Tools: Built-in vs Custom

**Built-in (Pi harness):** Filesystem tools operate directly on the memory workspace via session cwd. No custom wrappers needed for memory read or write — memory is the workspace.

**Custom (server / Pi extension):** calendar read, calendar write, and web search are Pi custom tools. `schedule_task` is a Pi extension tool whose execute handler enqueues to SQLite and builds `context` from session history.

### 8.4 Event Handling

The server subscribes to Pi harness events for each prompt run:

- Text deltas for streaming to the client.
- Tool execution start, update, and end events for streaming to the client and server-side logging.
- Agent end for run completion and cleanup.

### 8.5 Model and Auth

- Models resolved via Pi model registry and provider API keys stored in environment variables or Pi auth storage.
- Surface agent uses a fast model with thinking disabled.
- Worker agent may use the same or a more capable model with thinking enabled.

### 8.6 Alternative: RPC Mode

Pi also supports subprocess RPC mode for language-agnostic or isolated integration. This is not recommended for MVP because the SDK provides tighter control over per-agent tool sets and lower overhead. RPC remains an option if process isolation becomes a requirement.

---

## 9. Calendar

### 9.1 Abstraction

Calendar access is hidden behind read and write tools. The underlying provider (local JSON store, CalDAV, or Google Calendar API) is an implementation detail behind the gateway.

### 9.2 Surface Usage

Read-only: upcoming events, events on a date, free/busy checks to inform scheduling suggestions.

### 9.3 Worker Usage

Create, update, and delete events based on task context. Store provider-specific event identifiers in the task result for idempotent retries.

### 9.4 MVP Scope

A minimal local or single-provider integration is sufficient. Multi-calendar aggregation and complex recurrence are post-MVP.

---

## 10. Web Search

### 10.1 Role

Allows both agents to retrieve current external information not stored in memory.

### 10.2 Usage

- Surface: quick factual answers during chat.
- Worker: research before writing memory or calendar entries when task context is incomplete.

### 10.3 Gateway

Search is executed server-side with API keys held by the server. Results are summarized or truncated before return to the agent to control context size.

---

## 11. Session and Conversation Management

### 11.1 User Sessions

The server assigns a session identifier per conversation thread. Messages are stored server-side and passed into the Pi surface session as history for continuity.

### 11.2 Context Limits

As conversations grow, older turns may be summarized or pruned from the Pi session context. The memory workspace remains the durable store for long-term facts; chat history is for conversational continuity only.

### 11.3 Linking Tasks to Conversation

When the surface agent schedules a task, the server may attach the session id and message id. The worker prompt includes a short excerpt so background work retains conversational context without the full thread.

### 11.4 Completed Task Feedback

When a user sends a new message, the server may inject a brief system note listing tasks completed since the last turn (e.g. "Reminder set for tomorrow at 6pm"). MVP may use a simpler model: the surface agent reads recent completed tasks via a tool when relevant.

---

## 12. API Design

### 12.1 Chat

- Accept user message and optional session id.
- Stream assistant response as server-sent events or WebSocket frames.
- Return session id for continuation.

### 12.2 Tasks (Optional MVP)

- List tasks with status filter (`GET /v1/tasks`).
- Get single task by id.

In the single-user MVP, `user_id` is passed as a query parameter and is trusted (no auth gate). Multi-user deployments must authenticate the caller and derive `user_id` server-side.

### 12.3 Memory Index (Optional MVP)

- Expose index for debugging or a future UI; primary consumption is via the system prompt snapshot at session creation.

### 12.4 Health

- Liveness endpoint for deployment checks.

---

## 13. Data Storage

### 13.1 User Data Root

All per-user data under a single root:

- Memory workspace (markdown topics, index, and subdirectories — this is also the Pi session cwd).
- Task queue persistence.
- Conversation history (if not held only in Pi session files).

### 13.2 Task Persistence

SQLite at `{DATA_ROOT}/tasks.sqlite` (Drizzle + better-sqlite3): tasks, status, timestamps, JSON `context`, results, retry counts.

### 13.3 Pi Session Persistence

Surface conversations may use Pi in-memory session management for MVP or Pi's session manager for persistence across server restarts. Worker sessions remain ephemeral per task.

---

## 14. Security and Privacy

### 14.1 Authentication

Every `/v1` route except `POST /v1/auth/*` and the OAuth `start`/`callback` pair requires
`Authorization: Bearer <access JWT>`. Accounts are `user_id` + password
(self-serve `POST /v1/auth/register`; rate limiting is a later concern — the seam is the
auth route registration). Passwords are hashed with scrypt behind a `PasswordHasher`
interface (`src/auth/passwordHasher.ts`) so a move to argon2id or a managed IdP is a swap.

Tokens (`src/auth/`):

- **Access JWT** — HS256, ~15 min TTL, signed with `AUTH_JWT_SECRET` (required in prod,
  fails fast at startup). Claims: `sub` (user id), `iat`, `exp`, `typ: "access"`.
- **Refresh token** — opaque `rt_…` value, 30 day TTL, stored as a SHA-256 hash in the
  `refresh_tokens` table (same SQLite file as tasks). Rotated on every
  `POST /v1/auth/refresh`; a just-rotated token stays usable for a 60 s grace window
  because two Android clients (WebView + native assistant) share one pair and can race.
  Reuse beyond the grace window, revocation (`POST /v1/auth/logout`), and expiry all 401.
  Multiple live refresh tokens per user are allowed (one per login).

  **Accepted tradeoff:** within the grace window a rotated token is not consumed, so
  replaying it repeatedly mints a fresh pair each time (no per-token cap). A stolen
  refresh token can therefore spawn several live sessions during those 60 s. We accept
  this to keep the Android two-client race from logging users out; the exposure is bounded
  by the short window and by `logout` revoking a session. Revisit (cap re-issues per
  rotated token, or shorten the window) if refresh-token theft becomes a concern.

The authenticated identity is the only source of `user_id`: the bearer pre-handler
(`src/server/authenticate.ts`) attaches it to the request, and a `user_id` still present
in a request body or query string is accepted but ignored.

### 14.2 Data Isolation

Strict per-user path prefix on all tool operations, scoped by the authenticated user id. No cross-user reads or writes.

### 14.3 Secret Handling

Environment variables or Pi auth storage for LLM and search API keys, plus `AUTH_JWT_SECRET` for access token signing. No secrets in memory files or task payloads. Refresh tokens are stored hashed, never raw.

### 14.4 Future Considerations

Encryption at rest, network exposure controls, registration abuse controls (rate limiting/invites), and OAuth-based login against a managed IdP. The KDF and token logic sit behind small interfaces to keep that a swap, not a rewrite.

### 14.5 OAuth Connect

`GET /v1/oauth/:providerId/start` is a top-level browser navigation and cannot carry an
Authorization header, so it consumes a **connect token**: the frontend calls the
authenticated `POST /v1/oauth/connect-token`, which mints a single-use ~60 s token bound
server-side to the user (`src/integrations/oauth/connectTokenStore.ts`, in-memory,
single-process — same semantics as callback state). `start` validates and consumes it,
derives `userId`, and binds it into signed OAuth state; `user_id` is never trusted from
the query. `status`/`disconnect` are ordinary bearer-authenticated routes. Callback state
is stored in-memory (single-process only; restart mid-flow requires re-connecting).

---

## 15. MVP Scope

### 15.1 In Scope

- Chat API with streaming responses.
- Surface agent with thinking off, read-only Pi filesystem tools, `web_search`, and `schedule_task`.
- FIFO task queue persistence and enqueue via `schedule_task` (worker loop pending).
- Worker agent with Pi write/edit filesystem tools for memory and custom calendar write tools.
- Memory workspace with index and markdown topic files.
- Tool gateway with role-based permissions.
- Pi harness SDK integration for both agents.
- Basic web search.
- Single-user local deployment.

### 15.2 Out of Scope (Initial Release)

- Push notifications and proactive outbound messages.
- Priority queues and scheduled task execution times.
- Embedding-based memory search.
- Multi-user authentication and authorization.
- Voice interface.
- Sub-agents or plan mode inside Pi.
- RPC subprocess integration.
- Full calendar provider matrix.

---

## 16. End-to-End Flows

### 16.1 Simple Chat

User sends message. Server attaches current time to the message. Surface agent responds using grep/read against memory or general knowledge. Response and any tool activity stream to client.

### 16.2 Deferred Reminder

User asks to set a reminder. Surface agent may read calendar for context. Surface agent calls `schedule_task` with a description. Server enqueues a `pending` task (with recent conversation turns in `context`) and surface confirms deferral. After idle, worker runs, writes calendar event and optionally edits memory files. Task marked completed.

### 16.3 Memory Recall

User asks about a person or topic. Surface agent consults the index from its system prompt, then uses grep or read to load relevant topic files. Surface responds from file content without worker involvement. Tool calls stream to the user as they occur.

### 16.4 Memory Update via Chat

User states a new fact ("Alice is vegetarian"). Surface agent schedules a memory-update task. Worker uses edit to append an atomic note to people/alice and edits the index to refresh the topic summary.

---

## 17. Operational Concerns

### 17.1 Failure Modes

- LLM provider outage: return error to user; do not dequeue tasks until service recovers or retries exhaust.
- Tool failure: worker records error on task; optional user notification on next chat.
- Server restart: task queue and memory workspace persist; in-flight task may retry from pending or failed state depending on crash timing.

### 17.2 Observability

Structured logs for chat requests, tool invocations, task state transitions, and Pi agent errors. Correlation id linking user message to scheduled task to worker run.

### 17.3 Configuration

Environment-driven settings: idle timeout, retry limits, model ids, data root path, provider selection for calendar and search, `TASK_CONTEXT_TURN_LIMIT` (conversation turns snapshotted into queued tasks, default 3), `SURFACE_SESSION_CACHE_LIMIT` (max cached surface sessions before LRU eviction of idle sessions, default 50).

**Surface LLM health checks (intentional duplication):** bootstrap logs a warning via `createRoleAgentLlmRuntime('surface').warnEndpoint()` when the configured model endpoint is unreachable; each new surface session also calls `validateAgentLlmEndpoint(config, 'surface')` and fails fast if the endpoint is down. Startup warning aids ops visibility; per-session validation catches endpoint drift between server start and first use of a new `session_id`.

---

## 18. Future Enhancements

- Priority and scheduled execution (run task at specific time).
- Proactive notifications when worker completes important tasks.
- Embedding search over memory content.
- Multi-user support with auth and encrypted storage.
- Pi extensions or skills packaged as reusable capabilities.
- Dedicated memory maintenance worker (consolidate duplicate notes, refresh stale summaries).
- User-facing task and memory management UI.

---

## 19. Open Decisions

| Topic | Options | Recommendation |
|-------|---------|----------------|
| Chat transport | SSE vs WebSocket | SSE for MVP simplicity |
| Conversation storage | Server DB vs Pi session files | Server-owned history with Pi session per thread |
| Idle detection | Timeout vs fixed interval | Event-driven timeout after last chat activity |
| Worker history | Per-task session vs shared worker session | Per-task session |
| Calendar backend | Local JSON vs CalDAV vs Google | Simplest available provider for MVP |
| Task feedback to user | Injected context vs tool on demand | Inject brief completion notes on next turn |
| Volatile context delivery | User message prefix vs tool | Prefix time (and similar) onto each user message |

---

## 20. Glossary

| Term | Definition |
|------|------------|
| Surface agent | Low-latency Pi harness agent handling live user chat |
| Worker agent | Background Pi harness agent executing queued tasks |
| Task queue | FIFO store of deferred work items |
| Memory / workspace | User-scoped directory of markdown topic files and index; Pi session cwd for both agents |
| Tool gateway | Server layer that executes and permission-checks all agent tool calls |
| schedule_task | Surface-only Pi extension tool that enqueues work for the worker |
| Atomic note | Single bullet-point fact within a memory topic file |
| Idle window | Period with no active chat request when the worker may run |
