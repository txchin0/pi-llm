# Auth Implementation Plan — Handoff

Status: requirements + general steps. Not exact code. Two repos:
- **Backend**: `E:\Projects\pi-llm` (Fastify + TypeScript + drizzle/SQLite)
- **Frontend**: `E:\Projects\ts-llm-frontend` (React + Vite web + Capacitor Android)

## Goal

Replace the MVP trust model (unauthenticated `user_id` on every request) with real
HTTP authentication. Authenticated identity becomes the single source of `user_id`
for all downstream scoping. This is step one toward multi-user support.

## Decisions (already made — do not re-litigate)

1. **Credentials**: `user_id` + password. Keep basic; design for easy migration to a
   stronger IdP/OAuth-login later.
2. **Provisioning**: self-serve `POST /v1/auth/register` (public). Anyone can create an
   account for now. Assume rate-limiting/abuse controls are a later concern, but leave a
   seam for them.
3. **Token model**: short-lived **access JWT** (~15 min) + long-lived **refresh token**.
   Mobile (Capacitor) needs to survive app restarts without re-login.
4. **OAuth `/start` auth**: it is a top-level browser navigation and cannot carry an
   `Authorization` header. Use a **short-lived, single-use "connect token"**: an
   authenticated endpoint mints it, the frontend appends it to the `/start` URL, the
   server validates + consumes it and derives `userId` server-side. Do **not** trust
   `user_id` from the query anymore.

---

## Current State (verified in code)

### Backend
- No user/password/JWT/session code exists anywhere.
- `user_id` is a trusted zod string:
  - `POST /v1/respond` — in request **body** (`src/contracts/respond.ts` `RespondRequestSchema`).
  - `GET /v1/tasks` — in **query** (`src/server/routes/tasks.ts`).
  - `GET/DELETE /v1/oauth/:providerId/*` — in **query** (`OAuthUserQuerySchema`, `OAuthStartQuerySchema`).
- Routes registered in `src/server/buildServer.ts`. CORS already hardened: `*` origin
  throws in prod *because* `/v1` is unauthenticated (see comment at buildServer.ts:61) —
  update/remove that guard once auth lands.
- Storage: SQLite via drizzle (`src/queue/schema.ts`, migrations in `drizzle/`) for tasks;
  per-user JSON file stores for integrations + OAuth tokens
  (`src/integrations/**/file*Store.ts`). `DATA_ROOT` env drives file paths.
- Env config: `src/config/env.ts` (hand-rolled parsers in `src/config/parseEnv.ts`).
- OAuth state store is in-memory single-use (`src/integrations/oauth/oauthStateStore.ts`) —
  good pattern to mirror for the connect-token store.

### Frontend
- `user_id` stored in `localStorage` (`ts-llm.user_id`, default `web-user`), managed by
  `src/state/useSettings.ts`, edited via `src/components/UserIdDialog.tsx`. No password/login UI.
- API base URL resolved per-request from `getApiBaseUrl()` (`src/api/config.ts`): empty =
  same-origin (browser, Vite proxies `/v1`); absolute URL on native (set in Settings).
- Request styles differ (important for token delivery):
  - `respondStream` — `fetch` POST, streams SSE (`src/api/client.ts`). Can send a header.
  - `listTasks`, `getOAuthStatus`, `disconnectOAuth` — `fetch` GET/DELETE (`src/api/*.ts`). Can send a header.
  - **OAuth start** — `window.open(buildOAuthStartUrl(...))` top-level nav
    (`src/state/useOAuthIntegrations.ts` → `src/api/oauth.ts`). **Cannot** send a header.
- Native settings mirror exists (`src/native/settingsMirror.ts`) — token persistence on
  Android should reuse the Capacitor Preferences pattern already in place.

---

## Backend Requirements

### 1. User store & password hashing
- New persisted user record: `user_id` (unique, treat as the login identifier), password
  hash, created timestamp. Prefer a drizzle SQLite table (`users`) with a migration — the
  DB layer already exists; don't invent a new file store for credentials.
- Hash with a memory-hard KDF (argon2id preferred, bcrypt acceptable). Never store plaintext.
- Enforce `user_id` format/uniqueness. Reuse `UserIdSchema` shape where sensible.

### 2. Token issuance & verification
- Access JWT: short TTL (~15 min), signed with a server secret (new env var, e.g.
  `AUTH_JWT_SECRET`; fail fast at startup if missing in prod). Claims: `sub = user_id`,
  `iat`, `exp`, a token `type`/`kind` marker.
- Refresh token: long TTL, **persisted server-side** (revocable) — store a hash of it, not
  the raw value. Rotate on use. Support revocation (logout / compromise).
- Provide a verification utility usable as a Fastify auth pre-handler.

### 3. Auth endpoints (new, unauthenticated except where noted)
- `POST /v1/auth/register` — create account, return access + refresh tokens.
- `POST /v1/auth/login` — verify password, return access + refresh tokens.
- `POST /v1/auth/refresh` — exchange refresh token for a new access token (rotate refresh).
- `POST /v1/auth/logout` — revoke the presented refresh token (authenticated).
- Uniform failure shape consistent with existing `{ code, message }` validation errors so
  the frontend `fetchJson`/`ApiHttpError` mapping keeps working. Use 401 for bad creds/expired.

### 4. Auth middleware + identity plumbing (the core change)
- Add a Fastify pre-handler that validates the `Authorization: Bearer <access JWT>` header,
  rejects with 401 on missing/invalid/expired, and attaches the derived `user_id` to the
  request context.
- Apply it to **all** `/v1` routes except the auth endpoints and the OAuth `callback`
  (callback comes from Google, carries its own signed state).
- **Remove `user_id` from all client-supplied inputs** and source it from the token instead:
  - `RespondRequestSchema` — drop `user_id` from the body; inject server-side.
  - `GET /v1/tasks` — drop `user_id` query param; use token identity.
  - OAuth status/disconnect — drop `user_id` query param; use token identity.
- Downstream services (`respondController`, task list, oauth service) already take a `userId`
  argument — feed them the authenticated identity. Scoping semantics don't change; only the
  *source* of `userId` changes.

### 5. OAuth connect-token flow (the tricky endpoint)
- New authenticated endpoint (e.g. `POST /v1/oauth/connect-token`) that mints a short-lived,
  single-use token bound to the authenticated `user_id` (mirror the in-memory single-use
  `oauthStateStore` pattern; TTL ~60s).
- `GET /v1/oauth/:providerId/start` — replace the trusted `user_id` query param with this
  connect token. Validate + consume it, derive `userId`, bind into signed OAuth state as
  before. Reject if missing/expired/already-used.
- OAuth `callback` is unchanged (identity recovered from OAuth state).

### 6. Cross-cutting
- Update `DESIGN.md §14` (§14.5 OAuth trust note, §14.1/§14.4) to describe the new model.
- Revisit the CORS `*`-in-prod guard in `buildServer.ts` now that `/v1` is authenticated.
- Add tests mirroring existing controller/route test style (there's a `tests/` dir and
  vitest). Cover: register/login/refresh/logout, 401 on unauthenticated `/v1`, connect-token
  single-use + expiry, and that `user_id` is ignored if still sent in body/query.

---

## Frontend Requirements

### 1. Token storage & lifecycle
- Persist access + refresh tokens. Reuse the existing settings/native-mirror pattern
  (`useSettings.ts` + `settingsMirror.ts` → Capacitor Preferences) so tokens survive on
  Android. Keep tokens out of URL/logs.
- `user_id` stops being a user-editable setting; it becomes derived from the logged-in
  account. Remove/repurpose `UserIdDialog` and the `ts-llm.user_id` default `web-user`.

### 2. Auth API client + centralized token attachment
- New `src/api/auth.ts`: `register`, `login`, `refresh`, `logout`.
- Centralize `Authorization: Bearer` injection in the fetch layer (`http.ts` + `client.ts`
  `respondStream`) so every authed call carries the access token. Today these are separate;
  add a shared helper rather than editing each call site ad hoc.
- Implement **401 → refresh → retry once** logic in one place. On refresh failure, clear
  tokens and route to login.

### 3. Login/register UI
- Add a login + register screen gating the app when no valid session exists
  (`Root.tsx`/`App.tsx` are the entry points). Keep it minimal.
- Logout action (Settings) that calls `/v1/auth/logout` and clears local tokens.

### 4. OAuth connect flow update
- Before `window.open(startUrl)`, call the authed `POST /v1/oauth/connect-token`, then build
  the start URL with the connect token instead of `user_id`
  (`buildOAuthStartUrl` in `src/api/oauth.ts`, called from `useOAuthIntegrations.ts`).
- `getOAuthStatus` / `disconnectOAuth` / `listTasks`: drop the `userId` argument + `user_id`
  query param; rely on the bearer token.
- `respondStream`: drop `user_id` from the request body; rely on the bearer token.

### 5. Housekeeping
- Update `src/api/types.ts` (`user_id` fields) and all tests referencing `user_id` in
  bodies/queries.
- Update frontend `DESIGN.md`/`PRODUCT.md` auth notes.

---

## Android Native (Kotlin) Requirements

There is a **second, independent client** the plan cannot ignore: the "Ember Assist"
native voice-assistant layer under `android/app/src/main/java/app/ember/mobile/assist/`.
It is a `VoiceInteractionService` overlay that talks to the agent server **directly via
OkHttp — not through the WebView** — and can run when the web app is not open.

What it does today:
- `RespondClient.kt` — POSTs `/v1/respond` over OkHttp with `user_id` in the JSON body and
  **no `Authorization` header**. This is the exact contract that's changing, so it breaks.
- `EmberSettings.kt` — read-only load from the shared `CapacitorStorage` SharedPreferences
  (the same store the web app mirrors localStorage into). Reads `ts-llm.server_url`,
  `ts-llm.user_id` (default `web-user`), `ts-llm.mic_language`. `user_id` is going away.
- `EmberAssistSession.kt:115` builds `RespondClient(serverUrl, settings.userId)`.
- Native only calls `/v1/respond` — no tasks/oauth — so the blast radius is one endpoint.

Required changes:
1. `RespondClient` — drop `user_id` from the body; add `Authorization: Bearer <access token>`.
2. `EmberSettings` — stop depending on `user_id`; read the **access token** (and refresh
   token) from the mirrored Preferences store. The web app must mirror tokens there via the
   existing `settingsMirror.ts` path (add token keys to the mirror allow-list), and the
   native reader must be updated in lockstep with those key names.
3. **Token refresh is the hard part** — the access token is ~15 min but the native assistant
   can fire long after the WebView last ran, so a mirrored access token will usually be
   expired. Native must handle `401` by calling `POST /v1/auth/refresh` with the refresh
   token (new small OkHttp call), then retry `/v1/respond`.
4. **Refresh-rotation race**: if both the WebView and the native layer rotate refresh tokens
   independently they will invalidate each other. Pick a strategy on the backend and honor it
   natively — e.g. allow multiple concurrent refresh tokens per user (per "device"), or issue
   the native layer its own long-lived device token, or make refresh non-rotating for this
   case. Do **not** ship independent rotating refresh on two clients sharing one token.
5. Handle the unauthenticated / logged-out state: if no token is present (user never logged
   in, or logged out in the WebView), the overlay should surface a "sign in first" error
   rather than firing an unauthenticated request. `EmberAssistSession` already has a
   `serverUrl == null` guard to model the new "no token" branch on.
6. No Gradle/dependency changes expected (OkHttp is already the HTTP client) unless you add
   JSON/JWT decode helpers — plain string handling is sufficient.

Note: `MainActivity.java` is a stock Capacitor bridge and needs no changes; all the work is
in the `assist/` package.

### Native implementation — DONE (contract the other surfaces must honor)

The `assist/` changes are implemented and verified against a mock server. The backend and
frontend work must match these decisions:

- **Mirrored token keys** (`CapacitorStorage` prefs, written by `settingsMirror.ts`):
  `ts-llm.access_token`, `ts-llm.refresh_token`. `ts-llm.user_id` is no longer read.
- **Refresh contract**: `POST /v1/auth/refresh` with JSON body `{ "refresh_token": "..." }`
  → 200 `{ "access_token": "...", "refresh_token": "..." }` (`refresh_token` optional if
  non-rotating); 401/403 = token revoked/expired. Native persists the returned pair back
  into the shared prefs (both layers converge on the newest pair), and clears both keys on
  a definitive 401/403 so the overlay falls back to "sign in first".
- **Rotation race**: native single-flights its own refreshes and writes rotated pairs back
  to the shared store, but the WebView must read tokens from Capacitor Preferences (not a
  private localStorage copy) on native, or the backend must allow a small reuse grace
  window / multiple live refresh tokens per user. Pick one when implementing the backend.
- 401 on `/v1/respond` is refreshed + retried once (OkHttp `Authenticator`); a second 401
  surfaces "Signed out — open Ember and sign in again".

## Suggested Sequencing

1. Backend: user table + hashing + JWT/refresh utilities (no routes wired yet).
2. Backend: auth endpoints (register/login/refresh/logout).
3. Backend: auth middleware; strip `user_id` from respond/tasks/oauth inputs; wire identity.
4. Backend: connect-token endpoint + `/start` migration.
5. Frontend: auth client + token storage + centralized bearer injection + 401-refresh-retry.
6. Frontend: login/register/logout UI gating the app.
7. Frontend: OAuth connect-token wiring; drop `user_id` from all call sites.
8. Frontend: mirror access/refresh tokens into native Preferences (`settingsMirror.ts`).
9. Android native: bearer header + drop `user_id` in `RespondClient`; token read + 401
   refresh/retry in the `assist/` package; logged-out handling.
10. Docs (both repos), CORS guard revisit, tests all three surfaces, end-to-end verification
    (web + Android WebView + native voice overlay).

## Migration / Compatibility Notes
- Backend and frontend must ship together (breaking contract change: `user_id` removed from
  inputs, bearer required). Coordinate the cutover or gate behind a flag.
- Existing per-user data (integration/OAuth token files keyed by `user_id`) stays valid as
  long as the login `user_id` equals the old id. Decide how existing `web-user` data maps —
  likely have the first real account claim it, or ignore for a fresh start.
- Keep the KDF and token logic behind small interfaces so a later move to a managed IdP or
  OAuth-based login is a swap, not a rewrite.
