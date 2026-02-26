---
Name: everhour-api
Description: Guidance for using Everhour timers and time-record endpoints correctly in this codebase.
---

## Instructions

Use these rules when creating or updating Everhour integrations:

1. Base URL and auth:
- Use `https://api.everhour.com`.
- Send the API key as `X-Api-Key`.

2. Timer endpoints:
- Get current timer: `GET /timers/current`
- Start timer: `POST /timers` with JSON body `{ task: "<taskId>", comment?: "<text>" }`
- Stop timer: `DELETE /timers/current`

3. Time-entry endpoints:
- List records: `GET /time` with query params `from`, `to`, and `task` (singular).
- Keep fallback support for `tasks` when needed for compatibility.
- Create record: `POST /time` with `{ task, date, time, comment? }`.
- Update record: `PUT /time/{recordId}` with `{ time, comment? }`.
- Delete record: `DELETE /time/{recordId}`.

4. Response parsing:
- Handle array responses and wrapped payloads (`records`, `data`, or `time`) because Everhour responses can vary by endpoint/version.
- Normalize IDs and duration fields (`time` or `duration`) before rendering.

5. Error handling:
- Surface non-2xx responses with status code + response text.
- For list-time fallback endpoints, treat `404`/`405` as “unsupported endpoint” and continue to the next candidate.

## Examples

```ts
const timer = await everhourFetch(apiKey, '/timers/current');
await everhourFetch(apiKey, '/timers', {
  method: 'POST',
  body: JSON.stringify({ task: taskId, comment: 'Investigating bug' })
});
```

```ts
const params = new URLSearchParams({ from: '2025-01-01', to: '2026-01-01', task: taskId });
const records = await everhourFetch(apiKey, `/time?${params.toString()}`);
```
