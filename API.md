# API Contract — ts-llm-frontend

This document describes the HTTP API that **pi-llm** must implement to work with the sibling [ts-llm-frontend](../ts-llm-frontend) chat client ("Ember"). The contract is derived from the frontend source (`src/api/types.ts`, `src/api/client.ts`, `src/state/useChat.ts`) and the reference server in [ts-llm](../ts-llm) (`src/contracts/respond.ts`, `src/server/routes/respond.ts`).

The frontend calls **one endpoint**. Everything else (static files, reverse proxy) is handled by Vite in dev or `proxy.mjs` in production.

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/respond` | Send a user message; stream the assistant response via SSE |

No other routes are used by the frontend today. The reference `ts-llm` server also exposes `/v1/dream`; Ember does not call it.

Optional endpoints mentioned in [DESIGN.md](./DESIGN.md) (health, tasks, memory index) are **not** required for the frontend.

---

## Deployment assumptions

| Setting | Default | Notes |
|---------|---------|-------|
| Backend URL | `http://127.0.0.1:3000` | Override via `VITE_TS_LLM_TARGET` (dev) or `TS_LLM_TARGET` (prod proxy) |
| CORS | None | Browser talks to the frontend origin; `/v1/*` is reverse-proxied to the agent server |
| Auth | None | No auth headers from the browser in MVP |

SSE responses must not be buffered. Production nginx example:

```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

---

## `POST /v1/respond`

### Request

```
POST /v1/respond
Content-Type: application/json
Accept: text/event-stream
```

Body (strict — no extra fields):

```json
{
  "user_id": "web-user",
  "message": "hello",
  "session_id": "sess_abc123def456",
  "show_thinking": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `user_id` | yes | Non-empty trimmed string. Scopes all server-side state. UI default: `"web-user"`. |
| `message` | yes | Non-empty trimmed string. |
| `session_id` | no | Omit on the first turn. Server issues one in the `start` event; client reuses it on follow-ups. Format: `sess_` + at least 12 alphanumeric characters (`/^sess_[A-Za-z0-9]{12,}$/`). |
| `show_thinking` | no | When `true`, server may emit `thinking_delta` events. Frontend currently always sends `true`. |

### Response

**HTTP 200** with a streaming body. Validation and session errors are delivered as SSE `error` events inside the stream, not as 4xx JSON responses.

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

### SSE wire format

Each event has an `event:` line (matching the JSON `type`) and a `data:` line containing stringified JSON:

```
event: start
data: {"type":"start","request_id":"req_...","user_id":"web-user","session_id":"sess_...","started_at":"2026-06-09T12:00:00.000Z"}

event: delta
data: {"type":"delta","text":"Hello"}

```

The client parses `data:` as JSON and validates the `type` field. Non-JSON `data` is surfaced as an `unknown` event (reserved for future features such as TTS audio).

**ID formats** (reference server):

- `request_id`: `req_` + at least 12 alphanumeric characters
- `session_id`: `sess_` + at least 12 alphanumeric characters

---

## SSE event types

### `start`

Always first on a successful turn. Client stores `session_id` for subsequent messages.

```json
{
  "type": "start",
  "request_id": "req_abc123def456",
  "user_id": "web-user",
  "session_id": "sess_def456abc123",
  "started_at": "2026-06-09T12:00:00.000Z"
}
```

### `delta`

Normal assistant output (rendered as markdown). Many events per turn; client appends `text`.

```json
{
  "type": "delta",
  "text": "partial token or chunk"
}
```

### `thinking_delta`

Reasoning text, only when `show_thinking: true`. Shown in a separate collapsible panel, not mixed with `delta`.

```json
{
  "type": "thinking_delta",
  "text": "reasoning chunk"
}
```

### `tool_call`

Tool invocation started.

```json
{
  "type": "tool_call",
  "request_id": "req_...",
  "session_id": "sess_...",
  "step": 0,
  "tool_call_id": "call_...",
  "tool_name": "grep",
  "input": {}
}
```

- `step`: non-negative integer
- `input`: arbitrary JSON

### `tool_result`

Tool completed.

```json
{
  "type": "tool_result",
  "request_id": "req_...",
  "session_id": "sess_...",
  "step": 0,
  "tool_call_id": "call_...",
  "tool_name": "grep",
  "output": {},
  "is_error": false
}
```

When `is_error` is `true`, **`error_code` and `error_message` are required**:

```json
{
  "is_error": true,
  "error_code": "tool_execution_error",
  "error_message": "Tool execution failed."
}
```

### `usage`

Token counts. Optional; emitted near end of turn.

```json
{
  "type": "usage",
  "request_id": "req_...",
  "usage": {
    "input_tokens": 142,
    "output_tokens": 96,
    "total_tokens": 238
  }
}
```

### `final`

Turn complete.

```json
{
  "type": "final",
  "request_id": "req_...",
  "finish_reason": "stop",
  "completed_at": "2026-06-09T12:00:05.000Z"
}
```

`finish_reason` values: `stop` | `length` | `content-filter` | `tool-calls` | `error` | `unknown`

Reference server emits `final` then `usage`. The frontend mock emits `usage` then `final`. Either order is fine.

### `error`

Terminal failure inside the SSE stream.

```json
{
  "type": "error",
  "request_id": "req_...",
  "code": "validation_error",
  "message": "Human-readable message"
}
```

Known error codes from the reference server:

| Code | When |
|------|------|
| `validation_error` | Invalid request body |
| `session_not_found` | Unknown `session_id` |
| `session_user_mismatch` | `session_id` belongs to a different `user_id` |
| `provider_error` | LLM / provider failure |

---

## Typical event sequence

Successful turn:

```
start
  → thinking_delta × N          (if show_thinking)
  → (tool_call → tool_result)*  (zero or more tool rounds)
  → delta × N                   (streaming answer)
  → final
  → usage                       (optional)
```

If the stream ends without `final` or `error`, the frontend marks the turn complete anyway.

---

## Client behavior

1. **Session continuity** — First message omits `session_id`. After `start`, every follow-up includes it. "New chat" clears the client-side session; server should treat a missing `session_id` as a new conversation.
2. **Abort** — Client passes `AbortSignal` to `fetch`. On abort, the turn is marked `aborted`.
3. **No client-side history** — Only `user_id` and theme preference persist in `localStorage`. Conversation state is server-owned per session.
4. **HTTP errors** — Non-2xx responses (server down, bad gateway) surface as connection errors. Application-level failures use SSE `error` events at HTTP 200.
5. **Unknown events** — Future event types (e.g. `audio` for TTS) are ignored by the UI but not dropped by the transport layer.

---

## Reference implementations

| Location | Purpose |
|----------|---------|
| `ts-llm-frontend/src/api/types.ts` | Frontend TypeScript types |
| `ts-llm-frontend/src/api/client.ts` | SSE streaming client |
| `ts-llm-frontend/mock-server.mjs` | Minimal mock for UI dev without a backend |
| `ts-llm/src/contracts/respond.ts` | Canonical Zod schemas |
| `ts-llm/src/server/routes/respond.ts` | Route handler + SSE headers |
| `ts-llm/src/server/writeSseEvent.ts` | SSE frame formatting |
| `ts-llm/src/runtime/liveRequestOrchestrator.ts` | Event generation logic |

---

## Implementation checklist for pi-llm

- [x] `POST /v1/respond` accepting the JSON body above
- [x] SSE streaming with all eight event types
- [x] Per-user, per-session conversation state (`user_id` + `session_id`)
- [x] Tool lifecycle events (`tool_call` / `tool_result`) during agent runs
- [x] Unbuffered SSE (no response buffering through proxies)
- [x] Listen on port 3000 by default (or document proxy env override)
- [x] Surface `web_search` and `schedule_task` tools (see [DESIGN.md](DESIGN.md) §5.7)
- [ ] Worker loop consuming queued tasks
- [ ] Task list HTTP API / frontend queue view
