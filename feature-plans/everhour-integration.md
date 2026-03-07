# Everhour Integration Guide

> **Ticket:** TICKET-1520
> **Date:** 2026-02-19
> **Status:** Implementation Plan

## Overview

This guide covers adding Everhour time-tracking to each ticket in the Cooperativ overlord app. The feature includes:

1. **Timer UX on each ticket** — start/stop a running timer linked to the Everhour task
2. **Task sync** — automatically create an Everhour task the first time a timer is started, using the ticket ID and ticket name
3. **Time entries panel** — list, add, edit, and delete time entries for a ticket

---

## Everhour API Reference

### Base URL & Authentication

```
Base URL: https://api.everhour.com
Auth:     X-Api-Key: <user_api_key>
```

The API key is obtained from the user's Everhour account: **Settings → My Profile → API Token**. Each user has their own key — this is a per-user credential, not a shared app secret.

---

### Key Endpoints

#### Timers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/timers/current` | Get the currently running timer (returns `null` if none) |
| `POST` | `/timers` | Start a timer for a task |
| `DELETE` | `/timers/current` | Stop the running timer |

**Start timer request body:**
```json
{
  "task": "ev:12345678",
  "comment": "optional comment"
}
```

**GET /timers/current response (timer running):**
```json
{
  "status": "active",
  "today": 1800,
  "duration": 3600,
  "task": {
    "id": "ev:12345678",
    "name": "My Ticket Name"
  }
}
```

**GET /timers/current response (no timer):**
```json
{ "status": "inactive" }
```

---

#### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tasks` | Search/list tasks (query params: `query`, `projects`, `status`) |
| `GET` | `/tasks/{taskId}` | Get a single task |
| `POST` | `/tasks` | Create a new task |
| `PUT` | `/tasks/{taskId}` | Update a task |
| `DELETE` | `/tasks/{taskId}` | Delete a task |

**Create task request body:**
```json
{
  "name": "TICKET-1520: Everhour Integration",
  "projects": ["ev:project:abc123"]
}
```

**Create task response:**
```json
{
  "id": "ev:12345678",
  "name": "TICKET-1520: Everhour Integration",
  "projects": [{ "id": "ev:project:abc123", "name": "Cooperativ" }]
}
```

> **Important:** Everhour task IDs use the prefix format `ev:{number}`. Store the returned `id` against the ticket record so you can look it up later without re-creating the task.

---

#### Time Records

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tasks/{taskId}/time` | List time records for one task (params: `from` **required**, `to` **required**, optional `limit`, `page`) |
| `GET` | `/time` | List time records across filters (legacy/compatibility path; params include `from`, `to`, `tasks`, `users`) |
| `GET` | `/time/{recordId}` | Get a single time record |
| `POST` | `/time` | Create a time record manually |
| `PUT` | `/time/{recordId}` | Update a time record |
| `DELETE` | `/time/{recordId}` | Delete a time record |

**List time records for a task:**
```
GET /tasks/ev:12345678/time?from=2024-01-01&to=2024-12-31&limit=10000&page=1
```

**Create time record request body:**
```json
{
  "task": "ev:12345678",
  "time": 3600,
  "date": "2026-02-19",
  "comment": "optional note"
}
```
> `time` is in **seconds**.

**Time record response:**
```json
{
  "id": 987654,
  "task": { "id": "ev:12345678", "name": "TICKET-1520: Everhour Integration" },
  "time": 3600,
  "date": "2026-02-19",
  "comment": "optional note",
  "user": { "id": 1, "name": "Jake" }
}
```

**Update time record:**
```json
PUT /time/987654
{ "time": 4500, "comment": "updated note" }
```

---

## Implementation Plan

### 1. Database Changes

Add two columns to the `tickets` table to store the Everhour task mapping:

```sql
-- supabase/migrations/20260219000000_add-everhour-task-id.sql

ALTER TABLE tickets
  ADD COLUMN everhour_task_id TEXT,        -- e.g. "ev:12345678"
  ADD COLUMN everhour_project_id TEXT;     -- the project to create tasks in
```

Also add a user-level table (or `profiles` column) for the user's API key:

```sql
-- Option A: column on profiles table
ALTER TABLE profiles
  ADD COLUMN everhour_api_key TEXT;

-- Option B: separate integrations table (more extensible)
CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,              -- 'everhour'
  api_key TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own integrations"
  ON user_integrations FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

**Recommendation:** Use Option B (separate `user_integrations` table) — it's more extensible and keeps sensitive keys isolated.

---

### 2. Server Actions

Create `lib/actions/everhour.ts`:

```typescript
'use server'

import { createClient } from '@/supabase/utils/server'

const EVERHOUR_BASE = 'https://api.everhour.com'

async function getEverhourKey(userId: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', 'everhour')
    .single()
  return data?.api_key ?? null
}

function everhourFetch(apiKey: string, path: string, options?: RequestInit) {
  return fetch(`${EVERHOUR_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      ...options?.headers,
    },
  })
}

// ── Timer actions ──────────────────────────────────────────────────────────

export async function getCurrentTimer(userId: string) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) return null
  const res = await everhourFetch(apiKey, '/timers/current')
  if (!res.ok) return null
  return res.json()
}

export async function startTimer(userId: string, everhourTaskId: string, comment?: string) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')
  const res = await everhourFetch(apiKey, '/timers', {
    method: 'POST',
    body: JSON.stringify({ task: everhourTaskId, comment }),
  })
  if (!res.ok) throw new Error(`Failed to start timer: ${res.status}`)
  return res.json()
}

export async function stopTimer(userId: string) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')
  const res = await everhourFetch(apiKey, '/timers/current', { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to stop timer: ${res.status}`)
  return res.json()
}

// ── Task sync ──────────────────────────────────────────────────────────────

export async function ensureEverhourTask(
  userId: string,
  ticketId: string,
  ticketTitle: string,
  everhourProjectId: string
): Promise<string> {
  const supabase = createClient()

  // Check if we already have a task ID stored
  const { data: ticket } = await supabase
    .from('tickets')
    .select('everhour_task_id')
    .eq('id', ticketId)
    .single()

  if (ticket?.everhour_task_id) return ticket.everhour_task_id

  // Create the task in Everhour
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')

  const res = await everhourFetch(apiKey, '/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: ticketTitle,
      projects: [everhourProjectId],
    }),
  })
  if (!res.ok) throw new Error(`Failed to create Everhour task: ${res.status}`)
  const task = await res.json()

  // Persist the task ID
  await supabase
    .from('tickets')
    .update({ everhour_task_id: task.id })
    .eq('id', ticketId)

  return task.id
}

// ── Time records ───────────────────────────────────────────────────────────

export async function listTimeRecords(userId: string, everhourTaskId: string) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) return []

  const from = new Date()
  from.setFullYear(from.getFullYear() - 1)
  const fromStr = from.toISOString().split('T')[0]
  const toStr = new Date().toISOString().split('T')[0]

  const res = await everhourFetch(
    apiKey,
    `/time?from=${fromStr}&to=${toStr}&tasks=${encodeURIComponent(everhourTaskId)}`
  )
  if (!res.ok) return []
  return res.json()
}

export async function createTimeRecord(
  userId: string,
  everhourTaskId: string,
  seconds: number,
  date: string,
  comment?: string
) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')
  const res = await everhourFetch(apiKey, '/time', {
    method: 'POST',
    body: JSON.stringify({ task: everhourTaskId, time: seconds, date, comment }),
  })
  if (!res.ok) throw new Error(`Failed to create time record: ${res.status}`)
  return res.json()
}

export async function updateTimeRecord(
  userId: string,
  recordId: number,
  seconds: number,
  comment?: string
) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')
  const res = await everhourFetch(apiKey, `/time/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify({ time: seconds, comment }),
  })
  if (!res.ok) throw new Error(`Failed to update time record: ${res.status}`)
  return res.json()
}

export async function deleteTimeRecord(userId: string, recordId: number) {
  const apiKey = await getEverhourKey(userId)
  if (!apiKey) throw new Error('No Everhour API key configured')
  const res = await everhourFetch(apiKey, `/time/${recordId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete time record: ${res.status}`)
}

// ── API key management ─────────────────────────────────────────────────────

export async function saveEverhourApiKey(userId: string, apiKey: string) {
  const supabase = createClient()
  const { error } = await supabase.from('user_integrations').upsert({
    user_id: userId,
    provider: 'everhour',
    api_key: apiKey,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}
```

---

### 3. Timer Component

Create `components/features/everhour/TimerButton.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { PlayIcon, StopCircleIcon, ClockIcon } from 'lucide-react'
import { startTimer, stopTimer, getCurrentTimer, ensureEverhourTask } from '@/lib/actions/everhour'

interface TimerButtonProps {
  userId: string
  ticketId: string
  ticketTitle: string
  everhourProjectId: string
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export function TimerButton({ userId, ticketId, ticketTitle, everhourProjectId }: TimerButtonProps) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(false)

  // Poll current timer on mount
  useEffect(() => {
    getCurrentTimer(userId).then((timer) => {
      if (timer?.status === 'active') {
        setRunning(true)
        setElapsed(timer.today ?? 0)
      }
    })
  }, [userId])

  // Tick while running
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(interval)
  }, [running])

  async function handleStart() {
    setLoading(true)
    try {
      const taskId = await ensureEverhourTask(userId, ticketId, ticketTitle, everhourProjectId)
      await startTimer(userId, taskId)
      setRunning(true)
      setElapsed(0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    setLoading(true)
    try {
      await stopTimer(userId)
      setRunning(false)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {running && (
        <span className="flex items-center gap-1 text-sm font-mono text-green-600">
          <ClockIcon className="h-4 w-4 animate-pulse" />
          {formatElapsed(elapsed)}
        </span>
      )}
      {running ? (
        <Button
          size="sm"
          variant="destructive"
          onClick={handleStop}
          disabled={loading}
        >
          <StopCircleIcon className="mr-1 h-4 w-4" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={handleStart}
          disabled={loading}
        >
          <PlayIcon className="mr-1 h-4 w-4" />
          Start Timer
        </Button>
      )}
    </div>
  )
}
```

---

### 4. Time Entries Panel

Create `components/features/everhour/TimeEntriesPanel.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PencilIcon, TrashIcon, PlusIcon } from 'lucide-react'
import {
  listTimeRecords,
  createTimeRecord,
  updateTimeRecord,
  deleteTimeRecord,
} from '@/lib/actions/everhour'

interface TimeEntry {
  id: number
  time: number   // seconds
  date: string
  comment?: string
}

interface TimeEntriesPanelProps {
  userId: string
  everhourTaskId: string
}

function secondsToHHMM(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function parseHHMM(input: string): number {
  // Accepts formats: "1h 30m", "1.5h", "90m", "5400" (raw seconds)
  const hoursMatch = input.match(/(\d+\.?\d*)h/)
  const minsMatch = input.match(/(\d+)m/)
  const rawMatch = input.match(/^(\d+)$/)
  if (rawMatch) return parseInt(rawMatch[1])
  const hours = hoursMatch ? parseFloat(hoursMatch[1]) : 0
  const mins = minsMatch ? parseInt(minsMatch[1]) : 0
  return Math.round((hours * 60 + mins) * 60)
}

export function TimeEntriesPanel({ userId, everhourTaskId }: TimeEntriesPanelProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTime, setEditTime] = useState('')
  const [editComment, setEditComment] = useState('')
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newTime, setNewTime] = useState('')
  const [newComment, setNewComment] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    listTimeRecords(userId, everhourTaskId).then(setEntries)
  }, [userId, everhourTaskId])

  async function handleAdd() {
    const seconds = parseHHMM(newTime)
    if (!seconds) return
    const entry = await createTimeRecord(userId, everhourTaskId, seconds, newDate, newComment)
    setEntries((prev) => [entry, ...prev])
    setNewTime('')
    setNewComment('')
    setAdding(false)
  }

  async function handleSaveEdit(id: number) {
    const seconds = parseHHMM(editTime)
    if (!seconds) return
    const updated = await updateTimeRecord(userId, id, seconds, editComment)
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)))
    setEditingId(null)
  }

  async function handleDelete(id: number) {
    await deleteTimeRecord(userId, id)
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const totalSeconds = entries.reduce((sum, e) => sum + e.time, 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Time Entries — Total: {secondsToHHMM(totalSeconds)}
        </h3>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <PlusIcon className="mr-1 h-3 w-3" />
          Add Entry
        </Button>
      </div>

      {adding && (
        <div className="rounded border p-3 space-y-2 bg-muted/50">
          <div className="flex gap-2">
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-36"
            />
            <Input
              placeholder="e.g. 1h 30m"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="w-28"
            />
          </div>
          <Textarea
            placeholder="Optional comment"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No time entries yet.</p>
        )}
        {entries.map((entry) =>
          editingId === entry.id ? (
            <div key={entry.id} className="rounded border p-3 space-y-2 bg-muted/50">
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. 1h 30m"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="w-28"
                />
                <span className="text-xs text-muted-foreground self-center">{entry.date}</span>
              </div>
              <Textarea
                placeholder="Comment"
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleSaveEdit(entry.id)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div
              key={entry.id}
              className="flex items-center justify-between rounded border px-3 py-2 text-sm"
            >
              <div>
                <span className="font-mono font-medium">{secondsToHHMM(entry.time)}</span>
                <span className="ml-2 text-muted-foreground">{entry.date}</span>
                {entry.comment && (
                  <span className="ml-2 text-muted-foreground truncate max-w-xs">{entry.comment}</span>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    setEditingId(entry.id)
                    setEditTime(secondsToHHMM(entry.time).replace('h ', 'h ').replace('m', 'm'))
                    setEditComment(entry.comment ?? '')
                  }}
                >
                  <PencilIcon className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => handleDelete(entry.id)}
                >
                  <TrashIcon className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
```

---

### 5. Ticket Page Integration

In the ticket detail page (e.g., `app/[organizationId]/tickets/[ticketId]/page.tsx`), add the two components:

```tsx
import { TimerButton } from '@/components/features/everhour/TimerButton'
import { TimeEntriesPanel } from '@/components/features/everhour/TimeEntriesPanel'
import { createClient } from '@/supabase/utils/server'

export default async function TicketPage({ params }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: ticket } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', params.ticketId)
    .single()

  // Everhour project ID should come from organization settings
  const everhourProjectId = process.env.EVERHOUR_PROJECT_ID ?? ''

  return (
    <div>
      {/* ... existing ticket content ... */}

      {/* Timer section */}
      <section className="mt-6 space-y-4">
        <TimerButton
          userId={user.id}
          ticketId={ticket.id}
          ticketTitle={ticket.title}
          everhourProjectId={everhourProjectId}
        />

        {ticket.everhour_task_id && (
          <TimeEntriesPanel
            userId={user.id}
            everhourTaskId={ticket.everhour_task_id}
          />
        )}
      </section>
    </div>
  )
}
```

---

### 6. Settings UI — API Key

Add a settings section for users to connect their Everhour account:

```tsx
// components/features/everhour/EverhourSettings.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveEverhourApiKey } from '@/lib/actions/everhour'

export function EverhourSettings({ userId }: { userId: string }) {
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    await saveEverhourApiKey(userId, apiKey)
    setSaved(true)
  }

  return (
    <div className="space-y-2">
      <h3 className="font-medium">Everhour Integration</h3>
      <p className="text-sm text-muted-foreground">
        Paste your Everhour API key from{' '}
        <a
          href="https://app.everhour.com/#/account/profile"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Account → My Profile
        </a>
        .
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="Your Everhour API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={handleSave} disabled={!apiKey}>
          {saved ? 'Saved!' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
```

---

### 7. Environment Variables

Add to `.env.local` and Vercel:

```env
# The Everhour project where tasks will be created.
# Find this in the Everhour UI (URL contains the project ID).
EVERHOUR_PROJECT_ID=ev:project:your_project_id
```

---

## Implementation Checklist

- [ ] Run `supabase migration new add-everhour-task-id` and add the SQL from Step 1
- [ ] Run `yarn generate` to regenerate TypeScript types
- [ ] Add `user_integrations` table migration and RLS policy
- [ ] Create `lib/actions/everhour.ts` (Step 2)
- [ ] Create `components/features/everhour/TimerButton.tsx` (Step 3)
- [ ] Create `components/features/everhour/TimeEntriesPanel.tsx` (Step 4)
- [ ] Create `components/features/everhour/EverhourSettings.tsx` (Step 6)
- [ ] Wire components into ticket detail page (Step 5)
- [ ] Add `EverhourSettings` to user account/settings page
- [ ] Set `EVERHOUR_PROJECT_ID` env var in Vercel
- [ ] Test: connect API key → open ticket → start timer → stop timer → verify entry appears → edit entry → delete entry

---

## Caveats & Decisions

### Per-user API keys
Everhour does not support OAuth for third-party apps (it is designed for team-internal tools). Each user must paste their own API key from Everhour's profile page. This key must be stored securely — use RLS so users can only read their own key.

### Task deduplication
The `ensureEverhourTask` function stores the Everhour task ID on the ticket after the first timer start. This prevents duplicate tasks from being created on every timer start. The ticket title used at creation time is persisted in Everhour; subsequent title changes in Cooperativ won't auto-sync (a `PUT /tasks/{id}` call could be added if desired).

### Timer is per-user
Everhour timers are per-user — only one timer can run at a time per user. Starting a timer for a different task in Everhour automatically stops the previous one. The UI should reflect this.

### Date range for time records
`GET /tasks/{taskId}/time` requires `from` and `to` query params. The implementation above defaults to the past year. For tickets with older entries, consider exposing a date range filter in the UI.

### Everhour project
Tasks must belong to a project in Everhour. The simplest approach is one shared internal Everhour project (e.g., "Cooperativ") whose ID is stored as an env var. An organization-level setting could be added later.

---

## References

- [Everhour API Documentation (Apiary)](https://everhour.docs.apiary.io/)
- [Everhour — Do you have an API?](https://support.everhour.com/article/426-do-you-have-an-api-available)
- [ben-pr-p/everhour-api (Node.js wrapper)](https://github.com/ben-pr-p/everhour-api)
- [UmanshSarabhai/mcp-server-everhour (MCP reference)](https://github.com/UmanshSarabhai/mcp-server-everhour)
