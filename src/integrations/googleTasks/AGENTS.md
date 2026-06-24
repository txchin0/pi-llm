# Google Tasks integration

Agent reference for `tasks_read` (surface) and `tasks_write` (worker). Shared OAuth helpers live in `src/integrations/google/`.

## OAuth scopes

| Role | Scope | Purpose |
|------|-------|---------|
| Surface | `https://www.googleapis.com/auth/tasks.readonly` | List task lists and tasks |
| Worker | `https://www.googleapis.com/auth/tasks` | Create, update, delete tasks |

Enable the Google Tasks API in the same GCP project as Calendar OAuth credentials.

## Conventions

- **Task list id**: Required on all writes. Reads default to the first list when `tasklistId` is omitted; output always echoes `list id`.
- **Due dates**: `YYYY-MM-DD` only. The Tasks API discards time.
- **Complete a task**: `tasks_write` action `update` with `status: "completed"` (no separate complete action).

Official API reference: [Google Tasks REST v1](https://developers.google.com/workspace/tasks/reference/rest)

---

## `tasks_read` tool schema

```typescript
{
  listTaskLists?: boolean;   // list all task lists; ignores other filters
  tasklistId?: string;
  date?: string;             // YYYY-MM-DD due filter
  dueMin?: string;           // YYYY-MM-DD range start
  dueMax?: string;           // YYYY-MM-DD range end
  showCompleted?: boolean;   // default false
  maxResults?: number;       // 1–100, default 50
}
```

### API calls

| Filter | Method |
|--------|--------|
| `listTaskLists: true` | `tasklists.list` |
| otherwise | `tasks.list` on resolved list |

Single-page results only; truncation message appended when `nextPageToken` is present.

---

## `tasks_write` tool schema

```typescript
{
  action: 'create' | 'update' | 'delete';
  tasklistId: string;        // required
  taskId?: string;           // required for update/delete
  title?: string;            // required for create
  notes?: string;
  due?: string;              // YYYY-MM-DD
  status?: 'needsAction' | 'completed';  // update only
  skipDuplicateCheck?: boolean;
}
```

| Action | API |
|--------|-----|
| `create` | `tasks.insert` |
| `update` | `tasks.patch` |
| `delete` | `tasks.delete` |
