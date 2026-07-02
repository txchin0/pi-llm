# pi-llm

A personal-assistant backend where a chat-facing agent defers work to a
background agent, both running against local LLM endpoints with optional
Google integrations.

## Language

### Agents

**Role**:
Which of the two agent kinds is being configured or run: `surface` or `worker`. Every role-specific behaviour (env prefix, thinking defaults, tools, prompt) is keyed by Role.
_Avoid_: agent type, mode

**Surface**:
The read-only, user-facing chat agent. It answers within a conversation session and defers anything requiring writes or external actions by scheduling a Task.
_Avoid_: frontend agent, chat service

**Worker**:
The write-capable background agent that executes one queued Task at a time and reports a result summary.
_Avoid_: job runner, background service

**Task**:
A unit of deferred work the Surface schedules for the Worker, carrying a description and recent conversation turns as context.
_Avoid_: job, ticket

### Integrations

**Integration**:
An optional capability (web search, Google Calendar, Google Tasks) a user can enable, which contributes tools and prompt guidance to an agent session.
_Avoid_: plugin, extension (reserved for Pi harness extensions)

**Unconfigured OAuth**:
The supported deployment state in which no OAuth provider is configured: OAuth routes are absent and integrations that need tokens report "not connected." Chosen once at bootstrap, never as a silent fallback.
_Avoid_: noop OAuth
