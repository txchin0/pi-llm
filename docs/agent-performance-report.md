# Agent Performance Report — Surface & Worker Prompts, Workspace Design

**Date:** 2026-07-10
**Scope:** System-prompt design, workspace layout, and the supporting wiring for the surface and worker agents, with the goal of making pi-llm a better personal assistant.
**Audience:** An implementer who has not read this conversation. Every recommendation includes exact file paths, exact replacement text, and the reasoning behind it so nothing has to be guessed.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Method and evidence sources](#2-method-and-evidence-sources)
3. [How prompts are assembled today (as-built architecture)](#3-how-prompts-are-assembled-today-as-built-architecture)
4. [Findings](#4-findings) (F1–F10, each with evidence and root cause)
5. [Recommendations](#5-recommendations) (R1–R8, each with exact spec)
6. [New workspace template — full file contents](#6-new-workspace-template--full-file-contents)
7. [Full replacement prompt texts](#7-full-replacement-prompt-texts)
8. [Code changes — precise specification](#8-code-changes--precise-specification)
9. [Configuration recommendations](#9-configuration-recommendations)
10. [Tests to add and update](#10-tests-to-add-and-update)
11. [Migration of existing workspaces](#11-migration-of-existing-workspaces)
12. [Implementation order and acceptance criteria](#12-implementation-order-and-acceptance-criteria)
13. [Explicit non-goals — do NOT do these](#13-explicit-non-goals--do-not-do-these)
14. [Documentation updates](#14-documentation-updates)

---

## 1. Executive summary

The single biggest issue is that **DESIGN.md §3.3 and §4.3 were never implemented**. The design calls for both agents' system prompts to contain a memory-index snapshot, memory-layout instructions, and stable user context. What is actually shipped is two ~7-line prompts (`src/surface/buildSurfaceSystemPrompt.ts`, `src/worker/buildWorkerSystemPrompt.ts`) containing none of that.

The consequences are directly observable in the live data under `data/users/web-user/`:

- A trivial task ("Add a note: I hate mushrooms") burned **~9,300 thinking deltas exploring the workspace and timed out** (120 s), then needed a retry (`worker-traces/task_685eb787bae325a2-attempt-0.jsonl`).
- Facts are **duplicated across three overlapping files** in inconsistent voice ("I like hamburgers" appears in both `user.md` and `user_preferences.md`; food preferences also live in `notes.md`).
- The **index is inconsistent** (Topic column mixes `user_preferences`, `user.md`, `health`) and **incomplete** (`book.txt`, a large prose file, is unindexed and pollutes every `grep`).
- The surface agent **scheduled an impossible task** ("Send an email to the user's brother") because its prompt says to defer "any action you cannot complete with read-only tools"; the worker spent 17 tool calls searching for an email address and gave up.
- **Failures are invisible**: that email task and a "calendar not connected" failure are both stored as `status: completed` with the apology buried in the `result` text, which the surface agent has no tool to read and which is never injected into the conversation. The user never finds out.
- By contrast, **calendar tasks complete in exactly one tool call**, because `calendar_write` has a thorough tool description with parameter-level guidance. This is the proof that prompt/context quality — not model capability — is the bottleneck.

The recommendations, in one sentence each:

| # | Recommendation | Effect |
|---|---|---|
| R1 | Inject a workspace snapshot (index + conventions + file listing) into both agents' system prompts | Kills the per-task discovery tax (5–10 tool calls, thousands of thinking tokens) |
| R2 | Rewrite the surface system prompt: persona, memory-first rule, worker capability list, proactive memory capture, self-contained task descriptions, time-prefix explanation | Better answers, no impossible tasks, memory that grows without being asked |
| R3 | Rewrite the worker system prompt with hard conventions (voice, dedup, naming, edit discipline, tool budget) and a machine-parseable `OUTCOME:` contract | Cheaper, deterministic memory writes; failure becomes machine-readable |
| R4 | Extend the worker *task* prompt: retry context on re-attempts, outcome-format reminder | Idempotent retries, consistent results |
| R5 | Parse `OUTCOME:` in the worker loop; mark declared failures as `failed` without retry | Task records become truthful |
| R6 | Add a surface `task_status` tool | "Did you set my reminder?" becomes answerable; failures reach the user |
| R7 | Redesign the workspace template: `conventions.md`, `profile.md`, list-format index, folder layout, documents convention | Self-describing, deduplicating, small-model-editable memory |
| R8 | Update `schedule_task` tool description; add `workerCapability` metadata to integrations | The deferral boundary becomes explicit and accurate |

---

## 2. Method and evidence sources

Everything below was verified against the working tree at commit `3fb563b` (branch `main`). Sources examined:

**Design and docs:** `DESIGN.md`, `CONTEXT.md`, `AGENTS.md`, `API.md`, `todo.md`, `src/integrations/README.md`.

**Prompt construction:** `src/surface/buildSurfaceSystemPrompt.ts`, `src/worker/buildWorkerSystemPrompt.ts`, `src/worker/buildWorkerTaskPrompt.ts`, `src/integrations/formatIntegrationGuidance.ts`, `src/surface/extensions/surfaceExtension.ts` (tool-level guidance), integration `systemPrompt` fragments in `src/integrations/googleCalendar/index.ts` and `src/integrations/googleTasks/index.ts`.

**Session wiring:** `src/agent/buildRoleAgentSession.ts`, `src/agent/createAgentResourceLoader.ts`, `src/agent/ensureUserWorkspace.ts`, `src/surface/createSurfaceSession.ts`, `src/surface/surfaceSessionRegistry.ts`, `src/worker/createWorkerSession.ts`, `src/agent/piMessageText.ts` (time-prefix enrichment), `src/surface/surfaceRespondService.ts`.

**Queue and worker loop:** `src/queue/taskQueue.ts`, `src/queue/taskTypes.ts`, `src/queue/extractRecentTurns.ts`, `src/worker/workerLoop.ts`, `src/worker/workerTaskService.ts`.

**Config:** `src/config/env.ts`, `src/config/agentLlm.ts`, `src/integrations/baseTools.ts`.

**Live behavioral evidence:** the real user workspace `data/users/web-user/memory/` (6 files), all 12 worker run traces in `data/users/web-user/worker-traces/*.jsonl`, and the task records in `data/tasks.sqlite`.

---

## 3. How prompts are assembled today (as-built architecture)

Understanding the assembly pipeline is required before changing it, because the prompt an agent actually sees comes from **three channels**, only one of which lives in the prompt-builder files.

### 3.1 Channel 1 — role system prompt

`buildRoleAgentSession` (`src/agent/buildRoleAgentSession.ts:51`) receives a role `spec` containing `buildSystemPrompt`. The flow is:

1. `ensureUserWorkspace(options.userMemoryWorkspace)` — seeds the workspace from `templates/user-memory/` if `index.md` is missing (line 56). **The workspace therefore always exists before the prompt is built.**
2. `buildIntegrationSessionExtras(...)` collects, per enabled integration and role: tool names, an extension factory, and `promptFragments` (the `systemPrompt.surface` / `systemPrompt.worker` strings from each `IntegrationDefinition`).
3. `spec.buildSystemPrompt(integrationExtras.promptFragments)` produces the final system-prompt string (line 74).
4. The string is handed to `createAgentResourceLoader` → `DefaultResourceLoader({ systemPrompt, noContextFiles: true, noSkills: true, ... })`, so **no CLAUDE.md/AGENTS.md-style context files are loaded from the workspace** — the string built in step 3 is the entire role prompt.

### 3.2 Channel 2 — tool-level guidance

Tools registered via `pi.registerTool({ description, promptSnippet, promptGuidelines, parameters })` contribute their descriptions and guidelines into the model's context through the Pi harness's own tool-prompt assembly. This is why `calendar_write` performs so well: `src/integrations/googleCalendar/calendarWriteTool.ts` carries four `promptGuidelines` lines and per-parameter descriptions (e.g. `reminderMinutes`, `skipDuplicateCheck`). `src/integrations/README.md` ("Prompt channels") documents the rule: tool-level = how to use *this* tool; integration-level = cross-tool policy. Preserve this separation.

### 3.3 Channel 3 — per-message volatile context

`enrichUserMessage` (`src/agent/piMessageText.ts:30`) prepends `[Current time: <ISO>]\n\n` to every inbound surface user message; `buildWorkerTaskPrompt` puts the same prefix on the worker task prompt. `stripEnrichedUserMessagePrefix` removes it when history is extracted into task context (`extractRecentTurns`). **The regex `TIME_PREFIX_PATTERN` at `piMessageText.ts:5` couples these functions — if you change the prefix format, change all three together.**

### 3.4 Session lifecycles (matters for caching)

- **Surface:** long-lived, one Pi session per `session_id`, LRU-cached (`SurfaceSessionRegistry`, cap `SURFACE_SESSION_CACHE_LIMIT` = 50). The system prompt is built **once at session creation** and never rebuilt — this preserves the llama.cpp KV cache. Anything injected into the surface system prompt may be **stale for the life of the session**; that is accepted by design (DESIGN.md §3.3).
- **Worker:** fresh session per dequeued task (`createWorkerSession` called inside `workerTaskService.runTask`). The system prompt is therefore rebuilt per task, so a workspace snapshot in the worker's system prompt is always fresh. Pi-internal retry is disabled for the worker (queue owns retries); compaction is disabled for both roles.

### 3.5 Models and budget

Both agents talk to local llama.cpp OpenAI-compatible endpoints (`src/config/agentLlm.ts`). Defaults: context window **8,192 tokens**, maxTokens 2,048, surface thinking **off**, worker thinking **low**. Every token added to a prompt is real latency on local hardware, and the total budget is small. All prompt texts in §7 were written against this budget; §9 recommends raising the worker's window.

---

## 4. Findings

Each finding lists evidence, root cause, and impact. The recommendation column refers to §5.

| ID | Finding | Fixed by |
|----|---------|----------|
| F1 | Neither prompt contains the memory index snapshot or layout instructions required by DESIGN.md §3.3/§4.3 | R1, R2, R3 |
| F2 | Worker pays a huge "discovery tax" per task; one task timed out purely on exploration | R1, R3 |
| F3 | Memory is degrading: duplicate facts, inconsistent voice, inconsistent index, unindexed large file | R3, R7 |
| F4 | Surface schedules impossible tasks; worker capabilities are nowhere stated | R2, R8 |
| F5 | Declared failures are stored as `completed`; user never learns of failures | R5, R6 |
| F6 | Surface cannot answer "did you do it?" — no task visibility | R6 |
| F7 | Edit churn: repeated failed `edit` cycles against markdown tables | R3, R7 |
| F8 | Retries re-run the identical prompt with no knowledge of the prior failure | R4 |
| F9 | Surface has no persona, no user identity, no explanation of the time prefix | R2 |
| F10 | Memory only grows when the user explicitly says "make a note" | R2 |

### F1 — The designed prompt content was never implemented

`buildSurfaceSystemPrompt.ts` emits six sentences; `buildWorkerSystemPrompt.ts` emits eight. DESIGN.md §3.3 specifies the surface prompt should include "Brief stable user context", "A memory index snapshot: list of topic paths with short descriptions", and "Instructions on how memory is laid out"; §4.3 specifies the same index snapshot for the worker. None of this exists in code. The surface agent does not even know `index.md` exists — the word "index" does not appear in its prompt.

### F2 — Discovery tax and the timeout

Traces (tool calls extracted from `worker-traces/*.jsonl`):

| Task | Tool calls | Thinking deltas | Outcome |
|---|---|---|---|
| "Add a note: I hate mushrooms" (attempt 0) | `ls, read×2, read, grep, read×2` — **7 calls, zero writes** | **9,314** | **Timed out at 120 s**, requeued |
| same (attempt 1) | `ls, read×2, edit×3` | 830 | done |
| "Append '- I also like Bananas' to user.md" | 12 calls incl. 4 `edit`, 6 `read` | 2,145 | done |
| "Create note 'I am allergic to nuts'" | 9 calls | 2,180 | done |
| "Make a note to check on the mother…" | **17 calls** (`ls×5, grep×3, find×3, write, edit, read×2…`) | 2,016 | done |
| "Create a Google Calendar event … 'Sleep' … 10-minute reminder" | **1 call** (`calendar_write`) | 350 | done |

Every memory task starts blind: `ls` to find files, several `read`s to learn the index format and file contents, then writing. The calendar tasks skip all of that because the tool description already tells the model everything. Injecting the index snapshot and conventions (R1) gives memory tasks the same head start.

### F3 — Memory degradation in the live workspace

`data/users/web-user/memory/` after ~3 weeks of light use:

- `user.md`: `- The user's name is bob.` / `- I like hamburgers.` / `- I also like Bananas` — third person and first person mixed in one file.
- `user_preferences.md`: `- I like hamburgers.` — duplicate of the fact in `user.md`.
- `notes.md`: `I like mac and cheese, I hate mushrooms` (no bullets, no dates) plus an unrelated note about childbirth.
- `health.md`: `I am allergic to nuts.` — no heading, first person.
- `index.md` Topic column values: `user_preferences`, `notes`, `user.md`, `health` — three different naming styles, because no convention is stated anywhere and the seeded table (`templates/user-memory/index.md`) is an empty header giving no example row.
- `book.txt`: a ~7 KB short story, **absent from the index**, matching greps for common words. The "send an email" worker grepped the workspace 5 times; each grep potentially returns story text into an 8 K context.

Root cause: the worker has no conventions to follow, so each task-time improvisation is different. This is a prompt/workspace problem, not a model problem.

### F4 — Impossible tasks get scheduled

Surface prompt line 8: *"Use schedule_task … when the user needs a write, calendar change, or any action you cannot complete with read-only tools."* Under that rule, "email my brother" is correctly deferred — the rule is wrong, not the model. The worker's toolset (memory files + calendar/tasks writes + web search) is stated nowhere in the surface's context. Result: task `task_b310e9ac5ba5680f` — 17 tool calls of futile memory search, then a polite refusal stored where nobody looks.

### F5 — Failures recorded as success

`workerLoop.processTask` (`src/worker/workerLoop.ts:131-135`) calls `markCompleted(task.id, result)` whenever `runTask` resolves — and `runTask` resolves whenever the LLM run ends without a transport error. So these are `status: completed` in `tasks.sqlite`:

- `task_b310e9ac5ba5680f` ("send email"): result = "I am unable to complete this task because I cannot find any information regarding your brother's email address…"
- `task_a774ec75aedc23ee` ("dishes 22:00"): result = "…it failed because your Google Calendar [is not connected]…"

Nothing distinguishes success from failure except English prose. R5 introduces a machine-parseable outcome line.

### F6 — No feedback loop to the user

`SURFACE_BASE_TOOLS` = `read, ls, grep, find, schedule_task`. There is no task-read tool, and `surfaceRespondService.handleTurn` injects nothing about completed tasks into the next turn (DESIGN.md §11.4 unimplemented). A user who asks "did you add the reminder?" gets a hallucinated or evasive answer. The `TaskQueue` port already exposes `listByUser(userId, { statuses, limit })` — the tool is cheap to add (R6).

### F7 — Edit churn

Traces show `edit, edit, read, edit` and `write … read … write` sequences on nearly every memory task (e.g. `task_045d853f8452e3a2`: 17 calls including 3 edits and 2 writes for one note). Two contributing causes: (a) the model edits without reading the file immediately beforehand, so its `old_string` guesses go stale; (b) the index is a **markdown table**, and column-aligned tables are the worst-case format for exact-string edits by small models. R3 adds edit discipline to the prompt; R7 changes the index to a line-per-file list format where "append one line" is the common operation.

### F8 — Blind retries

`WorkerLoop` requeues with the same payload; `buildWorkerTaskPrompt(task, now)` ignores `task.retryCount` and `task.errorMessage`. Attempt 1 of the mushroom task had no idea attempt 0 existed or why it died, and no warning to check for partially-applied changes. `TaskRecord` already carries both fields — R4 puts them in the prompt.

### F9 — No persona, no user identity, unexplained time prefix

"You are a concise personal assistant." is the entire persona. The user's own `todo.md` lists "system prompt update - personality" as planned work. The `[Current time: …]` prefix arrives on every message with no explanation of what it is or that it should not be echoed back.

### F10 — Memory is passive

Every memory write in the task history was an explicit user command ("make a note…", "append … to the user.md file" — the user is literally dictating file operations). A personal assistant should capture durable facts from natural conversation ("my brother's birthday is in March" → memory task) without being commanded. That behavior must be prompted; it is currently absent.

---

## 5. Recommendations

### R1 — Inject a workspace snapshot into both system prompts

Build a `WorkspaceSnapshot` (index contents + conventions contents + file listing) in `buildRoleAgentSession` **after** `ensureUserWorkspace` and pass it to `buildSystemPrompt`. Exact code spec in §8.1–8.2. Prompt placement in §7.

- **Surface:** snapshot is taken once at session creation. Staleness during a session is accepted (DESIGN.md §3.3 already says so); the prompt text explicitly tells the agent the snapshot may be stale and to use `ls`/`grep`/`read` for current state. **Do not rebuild the surface prompt per turn — that would invalidate the KV cache** (the entire reason the current design builds it once).
- **Worker:** sessions are per-task, so the snapshot is always fresh. Same mechanism, no special casing.
- **Size caps** (defend the 8 K window): index ≤ 4,000 chars, conventions ≤ 3,000 chars, file listing ≤ 200 entries; truncate with an explicit `…(truncated)` marker so the model knows to `ls` for the rest. Caps are constants in code, not env vars.

### R2 — Rewrite the surface system prompt

Full text in §7.1. The functional additions, each mapped to a finding:

1. **Persona + tone** (F9): named role, warm-direct-concise style contract.
2. **Time-prefix explanation** (F9): what `[Current time: …]` is, use it for all date math, never mention it.
3. **Memory-first rule** (F1): before answering anything about the user/their people/preferences/past events, consult the injected index, then `grep`/`read`. Never claim ignorance before checking.
4. **Worker capability list** (F4): an explicit, generated bullet list of what the worker can do (base memory-write capability + one line per enabled integration via the new `workerCapability` field, §8.5). Followed by the hard rule: outside this list → tell the user honestly, never schedule.
5. **Proactive memory capture** (F10): when the user shares a durable fact, schedule a memory-update task unprompted and say so briefly.
6. **Self-contained task descriptions** (F8-adjacent): worker sees only description + last `TASK_CONTEXT_TURN_LIMIT` (3) turns; therefore resolve relative times to absolute ISO datetimes using the time prefix, include every needed fact, name the target file when known.
7. **Honest deferral** (existing rule, kept): never claim work is done; after scheduling, say it is queued.
8. **task_status usage** (F6): when the user asks about scheduled/completed work, call `task_status` and relay outcomes including failures.

### R3 — Rewrite the worker system prompt

Full text in §7.2. Functional content:

1. **Framing** — one task, then stop; the task was written by the assistant on the user's behalf; the user never sees this session, only the result summary.
2. **Injected snapshot + "trust the snapshot"** (F2): do not re-explore with `ls`/`find` unless the snapshot is insufficient. This single line eliminates most of the discovery tax.
3. **Dedup rule** (F3): grep/check the index for an existing home for a fact before creating a file; a fact lives in exactly one file.
4. **Edit discipline** (F7): read a file immediately before editing it; smallest change that completes the task; prefer appending.
5. **Index maintenance** (F3): after any create/edit, update that file's line in `index.md` (format defined in conventions).
6. **Tool budget** (F2): if >10 tool calls without clear progress, stop and report failure with the blocker.
7. **Fail fast** (F4/F5): missing info, no tool, service not connected → stop immediately and report failure; do not improvise or exhaustively search.
8. **`OUTCOME:` contract** (F5): final message must begin `OUTCOME: done` or `OUTCOME: failed - <reason>`, then 1–3 lines of what changed with paths/ids. Machine-parsed by R5.

### R4 — Extend the worker task prompt

Full text in §7.3. Changes to `buildWorkerTaskPrompt`:

- Keep: time prefix, `Task:` line, conversation excerpt.
- Add: when `task.retryCount > 0`, a "Previous attempt" section containing `task.errorMessage` plus an idempotency warning ("check whether the previous attempt already made partial changes; do not duplicate notes or events").
- Add: a one-line reminder of the OUTCOME format (reinforcement at the point of action; small models comply far better when format requirements appear in the final message).

### R5 — Parse `OUTCOME:` in the worker loop

Spec in §8.4. `parseWorkerOutcome(summary)` extracts the outcome line; `WorkerLoop.processTask` then:

- `done` → `markCompleted` (unchanged path).
- `failed` → `markFailed(task.id, reason)` **without retry**. Rationale: a model-declared failure ("no email tool exists", "no info in memory") is deterministic — retrying the identical prompt seconds later wastes 30–120 s of GPU time and cannot succeed. Transient failures (transport errors, timeouts) still throw and keep the existing retry path.
- No `OUTCOME:` line found → treat as `done` for backwards compatibility, log a `worker.outcome.missing` warning so prompt compliance can be monitored.

### R6 — Add a surface `task_status` tool

Spec in §8.6. Registered in `surfaceExtension.ts` next to `schedule_task` (the deps object already carries `taskQueue` and `userId`); added to `SURFACE_BASE_TOOLS`. Returns the user's recent tasks with status and result/error first line. This is deliberately the *pull* model (DESIGN.md §5.6 / §11.4 offered both); the *push* model (injecting "completed since last turn" notes into the next user message) is a good later enhancement but requires per-session notification bookkeeping — do not build it in this pass.

### R7 — Redesign the workspace template

Full file contents in §6. Summary of decisions and their reasons:

1. **`conventions.md`** — the memory rules live *in the workspace* and are injected verbatim into both prompts. Policy lives in an editable file; mechanism lives in code. A user (or future maintenance agent) can tune conventions without a deploy, and the workspace is self-describing to any agent that reads it.
2. **`profile.md`** — a seeded skeleton for identity/key-people/standing-preferences. Gives the surface agent one canonical first place to look and the worker one canonical place to put core facts (fixes the `user.md` vs `user_preferences.md` split).
3. **Index becomes a flat list, not a table** — one line per file: `` - `path.md` — summary (updated YYYY-MM-DD) ``. Rationale (F7): appending/replacing a single line is the easiest possible `edit` operation; markdown tables demand column discipline that small local models reliably fumble, as the live index shows.
4. **Folder layout** — `people/`, `preferences/`, `projects/`, `notes/`, `documents/` declared in conventions. Folders are *not* seeded as empty directories (the template copier `seedFromTemplate` copies files only); the worker creates them on demand. **Implementation assumption to verify:** Pi's built-in `write` tool creates parent directories. If it does not, seed each folder with an empty `.keep` file in the template instead.
5. **Documents convention** — long source material (like `book.txt`) goes in `documents/`, must be indexed with a one-line summary, and agents are told not to grep or fully read documents unless the task is about that document (protects the 8 K window).
6. **`ensureUserWorkspace` re-seeds missing files** — spec in §8.3, so existing users receive `conventions.md`/`profile.md` without touching their existing `index.md`.

### R8 — Update `schedule_task` and add capability metadata

- Replace the `schedule_task` `description`/`promptGuidelines` in `surfaceExtension.ts` (text in §7.4) to carry the self-containment requirements at the point of use.
- Add optional `workerCapability?: string` to `IntegrationDefinition` (`src/integrations/types.ts`); set it on `google_calendar` and `google_tasks` (§8.5); collect in `buildIntegrationSessionExtras`; render into the surface prompt's capability list. Web search gets **no** capability line — research is not a deferral target, and listing it would invite "search the web later" tasks.

---

## 6. New workspace template — full file contents

Replace/extend `templates/user-memory/` with exactly these three files. (The existing `index.md` template is replaced.)

### 6.1 `templates/user-memory/index.md`

```markdown
# Memory index

One line per file in this workspace. Format (see conventions.md):
- `path/from/root.md` — one-line summary (updated YYYY-MM-DD)

- `profile.md` — Core facts about the user; not yet filled in.
- `conventions.md` — The rules for this memory workspace. Do not move or delete.
```

Notes for the implementer: seeded lines intentionally omit the `(updated …)` suffix because the template is static; conventions instruct the worker to add/refresh the date whenever it touches a file. Do not generate dates at seed time.

### 6.2 `templates/user-memory/conventions.md`

```markdown
# Memory conventions

These rules govern every file in this workspace. The assistant (read-only) and
the worker (read/write) must both follow them.

## Layout

- `index.md` — index of every file here; one line per file. Keep it accurate.
- `profile.md` — core facts about the user: identity, key people, standing
  preferences that affect daily assistance. Check here first.
- `people/<first-name>.md` — one file per person in the user's life.
- `preferences/<area>.md` — likes and dislikes grouped by area
  (e.g. `preferences/food.md`, `preferences/entertainment.md`).
- `projects/<name>.md` — ongoing goals, plans, and projects.
- `notes/<topic>.md` — anything that fits nowhere else.
- `documents/<name>.<ext>` — long source material (stories, articles, pasted
  text). Do not grep or fully read documents unless the task is about that
  document; rely on the index summary instead.

## Writing rules

- Write facts in third person about the user: `- 2026-07-10: Bob is allergic
  to nuts.` Never first person.
- One fact per bullet, prefixed with the ISO date it was recorded.
- Append new bullets; do not rewrite existing bullets except to correct them.
  When correcting, replace the bullet rather than adding a contradicting one.
- A fact lives in exactly one file. If it could fit two, put it in the more
  specific one. Cross-reference with `[[path/to/other-file.md]]` when useful.
- File names: lowercase kebab-case with `.md` extension.

## Index format

One line per file, exactly:

- `path/from/root.md` — one-line summary (updated YYYY-MM-DD)

Whenever you create or change a file: add its line, or update its summary (if
the meaning changed) and its date (always).
```

### 6.3 `templates/user-memory/profile.md`

```markdown
# Profile

Core facts about the user. The worker fills this in as facts are learned.

## Identity

(name, pronouns, location, timezone — add bullets as learned)

## Key people

(family, partner, close friends — one bullet each; give a person their own
`people/<name>.md` file once there are 3+ facts about them, and link it here)

## Standing preferences

(only preferences that affect daily assistance — e.g. scheduling habits,
communication style; topical likes/dislikes go in `preferences/`)
```

---

## 7. Full replacement prompt texts

These are verbatim. Placeholders in `{curlyBraces}` are substituted by code (§8). Wherever a placeholder may be empty, the substitution rule is stated. Keep the exact wording unless you have a measured reason to change it — several lines are load-bearing (called out below).

### 7.1 Surface system prompt — `buildSurfaceSystemPrompt`

```text
You are the user's personal assistant. Be warm, direct, and concise. Prefer
short answers unless the user asks for detail. Never invent facts about the
user; what you know about them lives in the memory workspace described below.

# Time
Every user message begins with a server-added prefix like
[Current time: 2026-07-10T18:30:00+10:00]. Treat it as the current date and
time for all reasoning about dates, times, and relative expressions like
"tomorrow". Never mention or repeat the prefix itself.

# Memory
Your working directory is the user's private memory workspace: markdown topic
files plus an index at index.md. Your filesystem tools (read, ls, grep, find)
are read-only and scoped to this workspace.

Memory conventions (contents of conventions.md):
{conventionsMarkdown}

Snapshot of index.md taken when this session started (files may have changed
since; use your tools to see current state):
{indexMarkdown}

Files in the workspace at session start:
{fileListing}

Memory rules:
- Before answering any question about the user, their preferences, their
  people, their plans, or anything they may have told you before, check
  memory first: consult the index above, then grep or read the relevant
  topic file. Never say you don't know or don't remember until you have
  checked.
- Do not read files under documents/ in full; rely on their index summaries.

# Deferred work
You cannot write or change anything yourself. A background worker executes
writes as queued tasks, and its ONLY capabilities are:
{workerCapabilities}

Deferral rules:
- When the user asks for something within those capabilities, call
  schedule_task, then tell the user the work has been queued — not done.
- When the user shares a lasting fact worth remembering (a preference, an
  allergy, a relationship, an important date, an ongoing project), call
  schedule_task to record it in memory even if they did not ask, and briefly
  mention you'll remember it. Do not schedule tasks for small talk or
  transient details.
- If a request is outside the worker's capabilities, say plainly that you
  cannot do that yet. Never schedule a task for it and never imply it will
  happen.
- Write every task description so it stands alone: the worker sees only your
  description plus the last few conversation turns. Include every fact the
  worker needs, convert relative dates and times to absolute ones using the
  current-time prefix, and name the target memory file when you know it.
- Never state or imply that a write has happened. Only the worker performs
  writes, and only after this conversation's turn ends.

# Task status
Use task_status when the user asks whether something was done, what is
pending, or refers to work you scheduled earlier. Report failures honestly,
including the reason the worker gave.
```

**Substitution rules:**

- `{conventionsMarkdown}` — trimmed contents of `<workspace>/conventions.md`, capped at 3,000 chars. If the file is missing or empty, substitute the literal line: `(conventions.md is missing — fall back to cautious reads and tell the worker, via task descriptions, to follow index.md's format)`.
- `{indexMarkdown}` — trimmed contents of `<workspace>/index.md`, capped at 4,000 chars; when truncated append `\n…(index truncated — read index.md for the rest)`. If missing/empty: `(memory is currently empty)`.
- `{fileListing}` — one relative path per line (forward slashes), sorted, max 200 entries; when truncated append `…(more files exist — use ls)`.
- `{workerCapabilities}` — bullet list. Always starts with the base line:
  `- Remember things: create or edit markdown topic files in the memory workspace (facts, preferences, notes, lists).`
  followed by one `- {workerCapability}` line per enabled integration that defines the field (§8.5). This list is per-user (depends on enabled integrations) but stable for the session — consistent with everything else in the prompt.
- Integration `promptFragments` (existing behavior) are appended after all of the above, joined by blank lines via `formatIntegrationGuidance`, unchanged.

**Load-bearing lines:** "Never say you don't know … until you have checked" (fixes F1's recall failure); the capability list + "Never schedule a task for it" (fixes F4); "convert relative dates and times to absolute ones" (the worker has no reliable access to the original utterance time beyond 3 turns).

### 7.2 Worker system prompt — `buildWorkerSystemPrompt`

```text
You are the background worker for a personal assistant. You execute exactly
one queued task and then stop. The user never speaks to you directly: the
task description was written by the assistant on the user's behalf, and the
only thing the user may ever see is your final result summary.

# Memory workspace
Your working directory is the user's private memory workspace: markdown topic
files plus an index at index.md. You have read and write filesystem tools
(read, write, edit, ls, grep, find) scoped to this workspace.

Memory conventions you MUST follow (contents of conventions.md):
{conventionsMarkdown}

Current index.md:
{indexMarkdown}

Files currently in the workspace:
{fileListing}

# Working rules
- Trust the snapshot above. Do not re-explore the workspace with ls or find
  unless the snapshot is insufficient for this task.
- Before creating a new file, check the index and grep for an existing topic
  that should hold this information. Prefer extending an existing file.
  Never record the same fact in two places.
- Read a file immediately before you edit it, then make the smallest change
  that completes the task — usually appending one dated bullet.
- After creating or changing any file, update its line in index.md as the
  conventions describe.
- Work in as few steps as possible. If you have made more than 10 tool calls
  without clear progress, stop and report failure describing what blocked
  you.
- If the task cannot be done — information is missing, no tool exists for
  it, or an external service is not connected — do not improvise and do not
  search exhaustively. Stop and report failure with the exact reason.

# Result format
Your final message MUST begin with exactly one of these two lines:
OUTCOME: done
OUTCOME: failed - <one-line reason>
followed by one to three short lines describing what changed: file paths
created or edited, calendar event ids, task ids. Nothing else.
```

**Substitution rules:** identical to §7.1 for the three workspace placeholders. Integration `promptFragments` appended after, unchanged (this keeps the calendar/tasks idempotency guidance that already works).

**Load-bearing lines:** "Trust the snapshot… Do not re-explore" (F2 — this is the line that eliminates the timeout class); "Never record the same fact in two places" (F3); "Read a file immediately before you edit it" (F7); the OUTCOME format (F5 — must match the parser in §8.4 exactly, including the spelling `OUTCOME:` uppercase with colon).

### 7.3 Worker task prompt — `buildWorkerTaskPrompt`

```text
[Current time: {now}]

Task: {task.description}
{retrySection}
{conversationSection}
Complete this task now using your tools. Your final message must begin with
"OUTCOME: done" or "OUTCOME: failed - <reason>".
```

**Substitution rules:**

- `{now}` — unchanged from today (`formatNowInTimezone()` output).
- `{retrySection}` — empty when `task.retryCount === 0`. Otherwise (note the surrounding blank lines):

```text

A previous attempt at this task failed with: {task.errorMessage ?? 'unknown error'}
Before redoing work, check whether the previous attempt already made partial
changes (an existing note, event, or index line) and do not duplicate them.
```

- `{conversationSection}` — empty when `task.context.turns` is empty. Otherwise:

```text

Recent conversation between the user and the assistant, for context only —
the Task line above is authoritative:
{turns as `user: …` / `assistant: …` lines, exactly as today}
```

### 7.4 `schedule_task` tool registration — replacement strings

In `src/surface/extensions/surfaceExtension.ts`, replace the `description`, `promptSnippet`, and `promptGuidelines` values (the `parameters` and `execute` are unchanged):

```ts
description:
  'Queue background work for the worker agent. The worker can edit memory files and use the write-capable integrations listed in your instructions — nothing else.',
promptSnippet: 'Schedule deferred background work',
promptGuidelines: [
  'Only schedule work the worker can actually do (see the capability list in your instructions). If the request is outside those capabilities, tell the user honestly instead.',
  'Make the description self-contained: include every fact needed, convert relative dates/times to absolute ones, and name the target memory file when known. The worker sees only this description and the last few turns.',
  'After a successful call, tell the user the work is queued — never that it is done.',
],
```

Also update the `description` inside `scheduleTaskParameters` (`src/surface/extensions/scheduleTaskTool.ts:12`) to:

```ts
description:
  'Self-contained instruction for the worker: what to do, every fact needed, absolute dates/times, and the target memory file if known',
```

### 7.5 `task_status` tool registration — full strings

```ts
description:
  "List the user's recent background tasks with status and result, newest first.",
promptSnippet: 'Check scheduled background work',
promptGuidelines: [
  'Use task_status when the user asks whether scheduled work was done, what is pending, or about anything you deferred earlier.',
  "Relay failures honestly, including the worker's stated reason.",
],
```

---

## 8. Code changes — precise specification

### 8.1 New module: `src/agent/readWorkspaceSnapshot.ts`

```ts
export type WorkspaceSnapshot = {
  /** Trimmed contents of index.md, capped; '' when missing. */
  indexMarkdown: string;
  /** Trimmed contents of conventions.md, capped; '' when missing. */
  conventionsMarkdown: string;
  /** Sorted relative file paths (forward slashes), capped; excludes nothing else. */
  fileListing: string[];
  /** True when any field was truncated by its cap. */
  truncated: boolean;
};

export const INDEX_SNAPSHOT_MAX_CHARS = 4_000;
export const CONVENTIONS_MAX_CHARS = 3_000;
export const FILE_LISTING_MAX_ENTRIES = 200;

export async function readWorkspaceSnapshot(workspacePath: string): Promise<WorkspaceSnapshot>;
```

Behavior:

- Read `index.md` and `conventions.md` with `readFile(..., 'utf8')`; on `ENOENT` use `''`; rethrow other errors.
- File listing via `readdir(workspacePath, { recursive: true, withFileTypes: true })`, files only, paths made relative with forward slashes (`relative(...).replaceAll('\\', '/')`), sorted lexicographically, sliced to the cap.
- Truncation: slice contents to the cap **at a line boundary** (drop the partial last line) and set `truncated`. The "(truncated)" marker text is added by the prompt builders (§7 substitution rules), not here — this module returns data only.

### 8.2 Signature change: `AgentSessionRoleSpec.buildSystemPrompt`

In `src/agent/buildRoleAgentSession.ts`:

```ts
export type SystemPromptInputs = {
  promptFragments: string[];
  workerCapabilities: string[];
  workspace: WorkspaceSnapshot;
};

export type AgentSessionRoleSpec = {
  // ...unchanged fields...
  buildSystemPrompt: (inputs: SystemPromptInputs) => string;
};
```

Inside `buildRoleAgentSession`, after `ensureUserWorkspace` and `buildIntegrationSessionExtras`:

```ts
const workspace = await readWorkspaceSnapshot(options.userMemoryWorkspace);
// ...
systemPrompt: spec.buildSystemPrompt({
  promptFragments: integrationExtras.promptFragments,
  workerCapabilities: integrationExtras.workerCapabilities,
  workspace,
}),
```

Update both prompt builders to the new signature:

- `buildSurfaceSystemPrompt(inputs: SystemPromptInputs): string` — renders §7.1. It uses `workerCapabilities` (prefixed with the base memory-capability line, which is a constant in this file) and appends `formatIntegrationGuidance(inputs.promptFragments)` at the end exactly as today.
- `buildWorkerSystemPrompt(inputs: SystemPromptInputs): string` — renders §7.2; ignores `workerCapabilities`; appends fragments as today.

Update the two `spec` literals in `createSurfaceSession.ts` / `createWorkerSession.ts` only if type inference requires it (the property values stay `buildSurfaceSystemPrompt` / `buildWorkerSystemPrompt`).

### 8.3 `ensureUserWorkspace` re-seeds missing template files

In `src/agent/ensureUserWorkspace.ts`, **delete the first early-return** (the `if (await pathExists(indexPath)) return;` at the top of `ensureUserWorkspace`, lines 101–104). Keep everything else, including the post-`mkdir` sentinel re-check — change that re-check from `return` to *continuing into* `seedFromTemplate` as well. Net behavior: every call runs `seedFromTemplate`, which already skips files that exist. Result: existing workspaces gain `conventions.md` and `profile.md` on the next session creation, and nobody's `index.md` is ever overwritten. The template directory is tiny; the extra `readdir` per session creation is negligible. Update the function's doc comment to say: "Seeds any template files missing from the user memory workspace; never overwrites existing files."

(Consequence to verify in tests: the race-handling in `seedFromTemplate` is unchanged and still applies.)

### 8.4 Outcome parsing: `src/worker/parseWorkerOutcome.ts` + loop change

```ts
export type WorkerReportedOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; reason: string }
  | { kind: 'missing' };

const OUTCOME_PATTERN = /^OUTCOME:\s*(done|failed)\s*(?:[-–—:]\s*(.*))?\s*$/im;

/** Parses the worker's self-reported OUTCOME line from its final summary. */
export function parseWorkerOutcome(summary: string): WorkerReportedOutcome {
  const match = OUTCOME_PATTERN.exec(summary);
  if (match === null) return { kind: 'missing' };
  if (match[1].toLowerCase() === 'done') return { kind: 'done' };
  return { kind: 'failed', reason: match[2]?.trim() || 'worker reported failure without a reason' };
}
```

Notes: `im` flags — match any line, case-insensitive on `done|failed` (the literal `OUTCOME:` is matched case-insensitively too; that is acceptable). Accept `-`, `–`, `—`, or `:` as the reason separator because small models vary.

In `WorkerLoop.processTask` (`src/worker/workerLoop.ts`), replace the success branch:

```ts
const result = await this.workerTaskService.runTask(task, abortController.signal);
const outcome = parseWorkerOutcome(result);

if (outcome.kind === 'failed') {
  await this.taskQueue.markFailed(task.id, outcome.reason);
  this.log?.warn(
    { event: 'worker.task.reported_failed', task_id: task.id, user_id: task.userId, reason: outcome.reason },
    'worker reported task failure',
  );
  return;
}

if (outcome.kind === 'missing') {
  this.log?.warn(
    { event: 'worker.outcome.missing', task_id: task.id, user_id: task.userId },
    'worker summary missing OUTCOME line; treating as completed',
  );
}

await this.taskQueue.markCompleted(task.id, result);
// existing worker.task.completed log
```

**Deliberate decisions, do not change without reason:** (a) a reported `failed` skips the retry loop entirely — model-declared impossibility is deterministic; the `catch` block (transport errors, timeouts, aborts) keeps the existing retry behavior untouched. (b) `missing` is treated as completed so old-style summaries keep working; the warning gives a compliance signal. (c) Store the **full summary** as the result on completion (unchanged) — only the routing decision uses the parsed outcome.

### 8.5 Capability metadata on integrations

`src/integrations/types.ts` — add to `IntegrationDefinition`:

```ts
/**
 * One sentence describing what the worker can do with this integration,
 * rendered into the surface agent's deferral-capability list.
 * Omit for integrations that should not be deferral targets (e.g. web search).
 */
workerCapability?: string;
```

Set values:

- `src/integrations/googleCalendar/index.ts`: `workerCapability: 'Manage Google Calendar: create, update, or delete events, including popup reminders before events.'`
- `src/integrations/googleTasks/index.ts`: `workerCapability: 'Manage Google Tasks: create, update, or complete todos.'`
- `src/integrations/webSearch/index.ts`: **do not add the field.**

`src/integrations/buildIntegrationSessionExtras.ts` — add `workerCapabilities: string[]` to `IntegrationSessionExtras`; populate in the same loop that collects `promptFragments`:

```ts
const capability = definition.workerCapability;
if (capability !== undefined && capability.trim().length > 0) {
  workerCapabilities.push(capability.trim());
}
```

Collect it for **both roles** (harmless for the worker, which ignores it) — do not add role-conditional logic here.

### 8.6 `task_status` tool

1. `src/integrations/baseTools.ts` — add `'task_status'` to `SURFACE_BASE_TOOLS` (after `schedule_task`). `ALL_BASE_TOOL_NAMES` updates automatically.
2. New file `src/surface/extensions/taskStatusTool.ts`:

```ts
import { Type } from 'typebox';
import type { TaskQueue } from '../../queue/taskQueue.js';
import type { TaskListRecord } from '../../queue/taskTypes.js';

export const taskStatusParameters = Type.Object({
  limit: Type.Optional(
    Type.Number({ description: 'Max tasks to return, newest first (default 5, max 20)' }),
  ),
});

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/** Formats one task as a single result line for the model. */
function formatTaskLine(task: TaskListRecord): string {
  const detail =
    task.status === 'failed'
      ? (task.errorMessage ?? 'no error recorded')
      : (task.result?.split('\n', 1)[0] ?? '');
  const suffix = detail === '' ? '' : ` — ${detail}`;
  return `${task.id} [${task.status}] ${task.description}${suffix}`;
}

export async function executeTaskStatus(
  deps: { taskQueue: TaskQueue; userId: string },
  params: { limit?: number },
) {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const tasks = await deps.taskQueue.listByUser(deps.userId, {
    statuses: ['pending', 'running', 'completed', 'failed'],
    limit,
  });
  const text =
    tasks.length === 0 ? 'No background tasks found.' : tasks.map(formatTaskLine).join('\n');
  return { content: [{ type: 'text' as const, text }], details: {} };
}
```

3. Register in `createSurfaceExtension` (`surfaceExtension.ts`) with the strings from §7.5, delegating to `executeTaskStatus({ taskQueue: deps.taskQueue, userId: deps.userId }, params)`.
4. **Verify ordering:** `listByUser` must return newest-first. Check `sqliteTaskQueue.ts`; if it lacks an `ORDER BY`, add `ORDER BY updated_at DESC, id DESC` to that query (this also stabilizes the existing `GET /v1/tasks` route — confirm no test asserts the old order).
5. Truncate `task.description` to 120 chars in `formatTaskLine` (append `…`) so a verbose description cannot bloat the surface context.

### 8.7 Files intentionally untouched

- `src/agent/piMessageText.ts` — the time-prefix format stays exactly as-is; the surface prompt (§7.1) documents the existing format. Changing the prefix requires synchronized changes to `TIME_PREFIX_PATTERN`, `buildEnrichedUserMessagePrefix`, and `buildWorkerTaskPrompt` — avoid.
- `src/surface/extensions/filesystemSandbox.ts`, `src/surface/util/isPathInsideWorkspace.ts` — sandboxing unchanged.
- `extractRecentTurns.ts`, queue schema, HTTP routes — unchanged (no DB migration anywhere in this plan).

---

## 9. Configuration recommendations

No code changes; operator guidance (document in `.env.example`):

| Setting | Current default | Recommendation | Why |
|---|---|---|---|
| `WORKER_LLM_CONTEXT_WINDOW` | 8192 | **16384** if VRAM allows (and match llama-server `-c`) | System prompt grows by roughly 600–1,200 tokens with the snapshot; worker tasks also carry tool results |
| `SURFACE_LLM_CONTEXT_WINDOW` | 8192 | 8192 acceptable; 16384 preferred | Long chats accumulate history with compaction disabled |
| `WORKER_TASK_TIMEOUT_MS` | 120000 | Keep 120000 initially | The timeout case was caused by exploration waste that R1/R3 remove; raise only if timeouts persist after |
| `WORKER_THINKING_ENABLED` / level | true / low | Keep | Traces show calendar+simple-write tasks complete comfortably at `low` once context is provided |
| `SURFACE_THINKING_ENABLED` | false | Keep | Latency-first per design |
| `TASK_CONTEXT_TURN_LIMIT` | 3 | Keep | The self-contained-description rule (R2) reduces dependence on the excerpt |

Also note: the surface prompt grows, so **first-turn** prefill latency per new session increases slightly; subsequent turns are KV-cached. `scripts/timing-surface.mts` exists — capture before/after numbers (§12).

---

## 10. Tests to add and update

New tests:

- `tests/agent/readWorkspaceSnapshot.test.ts` — missing files → empty strings; truncation at line boundary sets `truncated`; listing sorted, relative, forward slashes, capped.
- `tests/worker/parseWorkerOutcome.test.ts` — `OUTCOME: done`, `OUTCOME: failed - reason`, `outcome: FAILED — reason` (case/dash variants), OUTCOME line not first line (still found), no line → `missing`, `failed` with no reason → fallback reason.
- `tests/surface/taskStatusTool.test.ts` — limit clamping (0→1, 999→20, default 5), empty list message, failed task renders `errorMessage`, completed renders first result line, description truncation.

Updated tests (these will fail until updated — expected):

- `tests/surface/createSurfaceSession.test.ts`, `tests/agent/buildRoleAgentSession.test.ts` — `buildSystemPrompt` now takes `SystemPromptInputs`; assert the built prompt contains the injected index text and capability lines.
- Any snapshot/equality assertions on `buildSurfaceSystemPrompt` / `buildWorkerSystemPrompt` output — rewrite to assert on **substrings** (e.g. contains `OUTCOME: done`, contains the conventions text) rather than full-string equality, so future prompt tuning doesn't require test rewrites.
- `tests/worker/runWorkerPrompt.test.ts` / `tests/worker/workerTaskService.test.ts` — unchanged behavior, but add loop-level tests: summary starting `OUTCOME: failed - x` → `markFailed('x')`, no retry; missing OUTCOME → `markCompleted` + warning.
- `tests/integrations/buildIntegrationSessionExtras.test.ts` — asserts `workerCapabilities` collected, web search contributes none.
- `ensureUserWorkspace` tests — existing workspace with `index.md` but without `conventions.md` gains `conventions.md`/`profile.md`; existing `index.md` content untouched.
- `buildWorkerTaskPrompt` tests — retry section present iff `retryCount > 0`; includes `errorMessage`; OUTCOME reminder line always present.
- `assertToolAllowlistSync` / registry collision tests — `task_status` added to base tools must not collide with integration tool names.

---

## 11. Migration of existing workspaces

Existing user workspaces (e.g. `data/users/web-user/memory/`) predate the conventions. Handle as follows:

1. **Automatic:** §8.3 re-seeding delivers `conventions.md` and `profile.md` on next session creation. No index overwrite happens.
2. **Index format:** old table-format indexes remain valid *inputs* (agents read whatever is there); the conventions tell the worker to write list-format lines. Mixed format is tolerable short-term.
3. **Recommended one-time cleanup (manual or via a queued task):** enqueue a task with this description (it exercises the whole new pipeline and doubles as an acceptance test):

   > Reorganize the memory workspace to follow conventions.md: merge the duplicate facts in user.md, user_preferences.md, and notes.md into profile.md and preferences/food.md using dated third-person bullets; move book.txt to documents/book.txt; rewrite index.md in the list format with a one-line summary for every file including documents/book.txt; delete files that become empty.

   Note the worker has no delete tool — "delete files that become empty" will fail; either drop that clause or accept empty files. Prefer dropping the clause.
4. This cleanup is also the prototype for the DESIGN.md §18 "memory maintenance worker" — a periodic consolidation task is a natural follow-up, but out of scope here.

---

## 12. Implementation order and acceptance criteria

Recommended order (each step leaves the system working):

1. **Template files** (§6) + `ensureUserWorkspace` re-seed (§8.3). Zero behavior risk.
2. **Snapshot plumbing** (§8.1, §8.2) + both system prompts (§7.1 minus capability list, §7.2). This is the highest-value step.
3. **Worker task prompt** (§7.3) + **outcome parsing** (§8.4).
4. **Capability metadata** (§8.5) + capability list in the surface prompt + `schedule_task` strings (§7.4).
5. **`task_status`** (§8.6, §7.5).
6. `.env.example` notes (§9), DESIGN.md updates (§14), migration task (§11).

Acceptance criteria — rerun the historical scenarios and compare against the trace baselines in §4/F2:

| Scenario | Pass condition |
|---|---|
| "Remember that I hate mushrooms" | Surface schedules a memory task unprompted phrasing aside; worker completes with **≤ 6 tool calls, no timeout**; fact appears once, dated, third person; index line updated |
| Repeat "I like hamburgers" twice across two sessions | Second task appends nothing new or corrects in place — **no duplicate bullet, no second file** |
| "Email my brother hello" | Surface **refuses politely; no task row is created** in tasks.sqlite |
| "Did you set my reminder?" | Surface calls `task_status` and reports the actual status, including failure reasons |
| Calendar write with Google disconnected | Task ends `status: failed` with the connect-related reason in `error_message` (not `completed`) |
| Worker summary formatting | ≥ 90% of worker runs begin with an `OUTCOME:` line (monitor `worker.outcome.missing` warnings) |
| Surface latency | `scripts/timing-surface.mts` shows no regression on turns 2+ of a session; first-turn regression bounded by the prompt-size increase |

---

## 13. Explicit non-goals — do NOT do these

Each of these has been considered and rejected; doing them would break design invariants:

1. **Do not rebuild the surface system prompt per turn** (e.g. to refresh the index snapshot). It invalidates the llama.cpp KV cache and adds full-prefill latency to every message. Staleness-with-tools is the designed trade-off (DESIGN.md §3.3).
2. **Do not move current time into any system prompt.** It is volatile; it belongs in the per-message prefix (existing mechanism).
3. **Do not preload topic file contents** into prompts. Index + conventions + listing only; contents load on demand via `read`. The 8 K window cannot afford more.
4. **Do not give the worker `bash`** or any tool outside `WORKER_BASE_TOOLS` + integrations (DESIGN.md §7.3 permission matrix).
5. **Do not enable Pi compaction** as a side effect of these changes; both roles have it deliberately disabled.
6. **Do not let the model supply `user_id`, task ids to *execute*, or paths outside the workspace.** `task_status` takes only `limit`; `userId` comes from the authenticated deps object, same as `schedule_task`.
7. **Do not duplicate guidance across prompt channels.** Tool usage details live in `promptGuidelines` on the tool; cross-tool policy lives in the integration `systemPrompt`; role behavior lives in the role prompt (`src/integrations/README.md`, "Prompt channels"). The capability list is role-prompt material because it is *about deferral policy*, not about how to call a tool.
8. **Do not make `OUTCOME: failed` trigger retries.** Retries are for transient transport/timeout errors only (§8.4 rationale).
9. **Do not change the `[Current time: …]` prefix format** without updating `TIME_PREFIX_PATTERN`, `buildEnrichedUserMessagePrefix`, and `buildWorkerTaskPrompt` in the same commit.

---

## 14. Documentation updates

- `DESIGN.md` §3.3/§4.3 — mark the index-snapshot/prompt content as implemented; describe the `WorkspaceSnapshot` mechanism and caps.
- `DESIGN.md` §3.4 and §7.3 permission matrix — add `task_status` (Surface: yes; Worker: no).
- `DESIGN.md` §4.5 — document the `OUTCOME:` contract and the failed-without-retry semantics.
- `DESIGN.md` §6.3/§6.4 — replace the table-index description with the list format; reference `conventions.md` as the in-workspace source of truth; add the `documents/` convention.
- `CONTEXT.md` — add ubiquitous-language entries: **Workspace snapshot** (index + conventions + file listing injected at session creation) and **Outcome line** (the worker's machine-parseable first line).
- `src/integrations/README.md` — document the new `workerCapability` field alongside the existing prompt-channels table.
- `.env.example` — context-window guidance from §9.
- `todo.md` — this work satisfies the "system prompt update - personality, better prompts for tools" item.
