# Review: Controller–Service Refactor Proposal

This is an in-depth review of [CONTROLLER_SERVICE_REFACTOR.md](./CONTROLLER_SERVICE_REFACTOR.md), checked against the current source in `src/`.

**Verdict:** Approve with changes. The proposal is accurate, well-scoped, and low-risk. The single code extraction (`runSurfacePrompt`) is the only part with real behavioral nuance, and there are a few concrete improvements worth folding in before/while implementing.

---

## 1. Accuracy check (proposal vs. actual code)

Every factual claim in the proposal was verified against the codebase. All check out:

| Claim | Status | Evidence |
|-------|--------|----------|
| `respondHandoff.ts` defines `RespondContext` + `RespondHandler` interface only | ✅ | `src/runtime/respondHandoff.ts` (interface, no impl) |
| `RespondOrchestrator` validates, makes IDs, emits `start`, delegates | ✅ | `respondOrchestrator.ts:76-132` |
| `surfaceRespondHandler.ts` mixes service + runner concerns | ✅ | `streamSurfacePrompt` holds session lookup + `session_busy` **and** `subscribe`/queue/`waitForNextTick`/`unsubscribe` |
| Double validation | ✅ | `respond.ts:19-22` (`prepareRespondPayload`) and `respondOrchestrator.ts:86` both `safeParse` |
| Stale stub comment | ✅ | `stubRespondHandler.ts:3` "until the Pi surface agent is wired in" while `index.ts:32` wires the real handler |
| `noopRespondService` default keeps integration tests green | ✅ | `respond-route.test.ts` calls `buildServer()` with no handler → only `start`/`validation_error` asserted |
| `PI_SDK_REPORT.md` references the old names | ✅ | lines 941, 988–990, 1089 reference `respondOrchestrator.ts` / `RespondHandler` / `respondHandoff.ts` |
| `enrichUserMessage`, `mapPiEventToRespond`, registry, factory unchanged | ✅ | their signatures are unaffected by the move |

The diagnosis is correct and the "mostly rename + one extraction" framing is honest.

---

## 2. What's good

- **Correct problem identification.** The naming overload (`handler` vs Fastify handler) and the service/runner entanglement in `streamSurfacePrompt` are the two genuinely worthwhile fixes. Extracting the Pi loop is the highest-value change here.
- **Phased, runnable-after-each-step migration.** Phase 1 (extract runner with no public API change) is the right first brick and aligns with the repo's "atomic, self-contained" working style in `AGENTS.md`.
- **Test plan matches the new seams.** A `runSurfacePrompt` unit test is exactly what the extraction unlocks — today that loop can only be tested through the full HTTP integration path.
- **Restraint on scope.** Worker agent, queue, and config changes are correctly listed as non-goals. The "extract `runAgentPrompt` only when duplication is proven" stance is the right call.
- **Removing route-level validation is safe.** `RespondRequestSchema` uses `.strict()` with `.trim()` transforms only; re-parsing already-parsed data is idempotent, so collapsing to a single validation site in the controller introduces no behavior change.

---

## 3. Issues and required/recommended changes

### 3.1 Don't type the mapper as `unknown` (recommended)

The §6.4 sketch types the mapper as `(piEvent: unknown) => RespondSseEvent[]` and `session.subscribe((event) => ...)`. The actual Pi callback delivers `AgentSessionEvent`, and `mapPiEventForRequest(event, ...)` already requires `event: AgentSessionEvent` (`mapPiEventToRespond.ts:223-224`). Using `unknown` throws away type safety that exists today for no benefit.

```typescript
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type SurfacePromptMapper = (event: AgentSessionEvent) => RespondSseEvent[];
```

The runner stays ignorant of `RespondRequest` (good) while keeping the Pi event type.

### 3.2 The `waitForNextTick` busy-poll survives the extraction (recommended)

The proposal faithfully copies the existing `while (!done || queue.length) { ... await waitForNextTick() }` poll loop. That's fine for "no behavior change," but the whole point of formalizing a **reusable runner** is that this loop will be reused by the worker. The `setImmediate` poll is a latency/efficiency smell: every empty tick costs a macrotask round-trip, and deltas wait up to one `setImmediate` cycle.

Since you're isolating this logic anyway, consider replacing the poll with a promise-backed push/pull queue (a single "waiter" promise resolved by `subscribe`):

```typescript
let resolveNext: (() => void) | null = null;
const unsubscribe = session.subscribe((event) => {
  queue.push(...mapEvent(event));
  resolveNext?.();
  resolveNext = null;
});
// drain loop awaits `new Promise(r => { resolveNext = r; })` instead of waitForNextTick()
```

This is optional for Phase 1 (keep it a pure move), but worth a follow-up brick before the worker reuses it. At minimum, call out in the doc that the poll is a known limitation rather than the intended end state.

### 3.3 Backpressure is unbounded — note it (recommended)

Neither the current code nor the proposal bounds `queue`. If Pi emits faster than the SSE client drains (slow/stalled client), the array grows without limit. This is pre-existing, not introduced by the refactor, but formalizing a reusable runner is the natural moment to document the assumption ("relies on fast local consumer; no backpressure") so the worker variant doesn't inherit it silently.

### 3.4 Error-mapping move: confirm the one edge case (clarify)

§11 decides error mapping lives in the **service**, with the runner re-throwing. That's cleaner. One subtlety to keep in mind: the `mapEvent` closure runs **inside** Pi's `subscribe` callback (synchronous emit context), not inside the generator body. So if mapping itself throws, it surfaces in Pi's emit path — the service's `try/catch` around `yield*` will **not** catch it. This is identical to today's behavior (the current `subscribe` callback also calls `mapPiEventForRequest`), so it's not a regression — but the doc should state that the service catch covers *prompt/runner* failures, not *mapper* failures, so nobody assumes the new boundary hardened that path.

### 3.5 Drop the `@deprecated RespondOrchestrator` alias (recommended)

§6.2 / §11 suggest keeping `export const RespondOrchestrator = RespondController` for gradual migration. There are **no external consumers** — every reference is inside this repo (verified: `buildServer.ts`, `respond.ts`, `index.ts`, tests, docs). Acceptance criterion #1 also wants no legacy names. An alias just adds dead surface and contradicts the clean-rename goal. Also note a `const` alias won't carry the companion type `RespondOrchestratorDependencies`, so the alias is half-measure anyway. Do the clean rename in one PR and skip the alias.

### 3.6 Two things called "controller" (minor / naming)

The doc labels both `respond.ts` ("HTTP controller") and `RespondController` ("application controller"). It acknowledges this is intentional, which is defensible, but in practice `respond.ts` is only ever referred to as the **route** in the codebase. Consider keeping the conceptual label in prose but not renaming or re-badging `respond.ts` at all (the proposal already keeps the file as-is — good). Just ensure the glossary/diagrams don't imply a new `HTTPController` symbol needs to exist.

---

## 4. Migration-order notes

- **Phase 1 interaction with §11.** During Phase 1 the runner re-throws and the *existing* `streamSurfacePrompt` catch still maps the error — consistent, no gap. The error-mapping-in-service decision only fully lands in Phase 3 when the handler is slimmed. Worth a one-line note so the implementer doesn't try to move the catch in Phase 1.
- **Add a `runtime/respond` index or keep flat?** Not required, but with `respondController.ts`, `respondService.ts`, `noopRespondService.ts` all landing in `runtime/`, a short barrel could reduce import churn in `buildServer.ts`/`index.ts`. Optional.
- **`PI_SDK_REPORT.md` §19** is already on the touch list — good. It's a code sketch doc, so updating symbol names there is low effort.

---

## 5. Could it be better? (net assessment)

The proposal is already a solid, conservative refactor. The biggest lever — extracting the Pi streaming loop — is correctly prioritized. To make it *better* rather than just *renamed*:

1. **Preserve types** in the runner (`AgentSessionEvent`, not `unknown`). *(3.1)*
2. **Treat the `waitForNextTick` poll as a known limitation** and plan to replace it with a promise-backed queue before the worker reuses the runner. *(3.2)*
3. **Document the no-backpressure assumption** on the new runner boundary. *(3.3)*
4. **Skip the deprecation alias** and do a clean single-PR rename. *(3.5)*

If the renames feel like churn-for-churn's-sake risk: the rename half (Phases 2–4) is pure cosmetics with real value (removes the `handler`/handoff ambiguity), and the extraction half (Phase 1) is the part that buys testability and worker reuse. Both are worth doing; if you want to stage value, **do Phase 1 first as its own brick**, then the renames.

---

## 6. Suggested edits to the proposal doc

- §6.4: change `SurfacePromptMapper` signature from `unknown` to `AgentSessionEvent`.
- §6.4: add a note that the poll loop is a temporary mechanism (or replace with promise-backed queue).
- §11 / §6.2: remove the `RespondOrchestrator` alias recommendation; recommend clean rename (no external consumers).
- §4.3 / §11: add a sentence clarifying the service catch covers runner/prompt failures, not synchronous mapper throws.
- Add a "Known limitations" subsection noting unbounded queue / no backpressure on the runner.
