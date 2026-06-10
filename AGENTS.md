Read DESIGN.md and [docs/CONTROLLER_SERVICE_REFACTOR.md](docs/CONTROLLER_SERVICE_REFACTOR.md) for respond-path layering.



You work on atomic self contained changes, we will build this repo collaboratively brick by brick



## Documentation



Add a JSDoc comment above every function, method, and interface method you define or introduce. Keep comments short and purposeful: what the function does, important inputs or side effects, and non-obvious behavior. Skip comments on obvious one-liners and on Zod schema exports unless the validation rules need explanation.



## Logging



Use `src/logging/` for all application logging. Do not use `console.*` in application code.



- Create the root logger once at bootstrap with `createRootLogger()` and pass it through dependency injection (`buildServer`, respond controller, services). Do not import a global logger singleton.

- Create child loggers with `createChildLogger(parent, { component, request_id, session_id, user_id, ... })` so every line carries correlation context.

- Use dot-separated `event` names (for example `respond.request.started`, `tool.call`).

- **Debug** (`LOG_LEVEL=debug`): log full inbound user `message` text and full tool `input` / `output` payloads. Text `delta` and `thinking_delta` events are logged at debug only.

- **Info and above**: log summaries only — `message_length` instead of message body; tool metadata (`tool_name`, `tool_call_id`, `step`, `is_error`) without payloads.

- Never log credentials, auth headers, or API keys. The root logger redacts common sensitive field names.

- For respond-path verbosity, use `logInboundMessage` and `logRespondSseEvent` instead of hand-rolling level checks.

- Tests default to `LOG_LEVEL=silent` when `NODE_ENV=test`. Inject a capture logger via `createRootLogger({ level, pretty: false, destination })` when asserting log output.

