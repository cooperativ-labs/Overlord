# MCP `attach` Failure — Root Cause Analysis

**Date:** March 12, 2026
**Symptom:** Calling the `attach` MCP tool returns `"Ticket not found or access denied."` even for a valid, accessible ticket.

---

## 1. How the bug was found

Calling `attach` with a known ticket ID returned the generic error:

```
Ticket not found or access denied.
```

However, calling `read_context` with the **same ticket ID** (and a fake session key) returned a *different* error:

```
Session not found for ticket.
```

This proves the ticket **does exist** and the agent token's `organization_id` **does match** — because `read_context` internally resolves the ticket before checking the session, and it succeeded on the ticket lookup.

The only meaningful difference between the two code paths is what they **SELECT from the database**.

---

## 2. The two code paths side by side

### `read_context` path — works

```typescript
// supabase/functions/mcp/session.ts
const { data: ticket, error: ticketErr } = await supabase
  .from('tickets')
  .select('id')           // ← only selects 'id'
  .eq('id', resolvedId)
  .eq('organization_id', organizationId)
  .single();
```

### `attach` path — fails

```typescript
// supabase/functions/mcp/handlers/attach.ts (line 38–45)
const TICKET_AGENT_FIELDS =
  'id,title,objective,status,priority,assigned_agent,recent_agent,...';

const { data: ticket, error: ticketErr } = await supabase
  .from('tickets')
  .select(TICKET_AGENT_FIELDS)   // ← selects many columns including 'recent_agent'
  .eq('id', ticketId)
  .eq('organization_id', organizationId)
  .single();

if (ticketErr || !ticket) return toolErr('Ticket not found or access denied.');
```

When `ticketErr` is set for **any reason** — including a missing column — the handler returns the same generic message, making the actual DB error invisible.

---

## 3. Root cause: `recent_agent` column missing from production DB

The column `recent_agent` is present in `TICKET_AGENT_FIELDS` but was **not included in the initial squash migration**. It was added in a separate migration:

| Migration file | Date | What it adds |
|---------------|------|-------------|
| `20260223110247_init-squash.sql` | Feb 23 | Base schema — no `recent_agent` |
| `20260225125004_add_recent_agent_to_tickets.sql` | Feb 25 | Adds `recent_agent text` to tickets |

If the production Supabase database was initialised from the squash but the subsequent migrations were not applied (or migrations have drifted from production), the `recent_agent` column doesn't exist. When Supabase PostgREST receives a `SELECT` for a column that doesn't exist, it returns an error (HTTP 400) with a message like:

```
column tickets.recent_agent does not exist
```

`ticketErr` becomes truthy, the handler falls into:

```typescript
if (ticketErr || !ticket) return toolErr('Ticket not found or access denied.');
```

…and the real error is discarded silently.

### Secondary possibility: PostgREST schema cache stale

If the `recent_agent` migration *was* applied but PostgREST's schema cache was not reloaded, PostgREST would similarly return an error for that column. This can happen when migrations are applied via direct SQL or Supabase CLI without triggering a schema reload.

---

## 4. Why the real error is invisible

The `attach` handler never logs `ticketErr`:

```typescript
// attach.ts — actual code
if (ticketErr || !ticket) return toolErr('Ticket not found or access denied.');
//                                        ↑ ticketErr.message is never logged or surfaced
```

The top-level MCP handler (`index.ts`) does have error logging:

```typescript
} catch (err) {
  console.error(`[mcp] tool error (${toolName}):`, err);
```

But this only catches **thrown exceptions**. `toolErr()` is a normal return, not a thrown error, so this log never fires for the failing `attach` call.

---

## 5. Migration state — all columns in `TICKET_AGENT_FIELDS`

Cross-referencing `TICKET_AGENT_FIELDS` against the squash migration shows one gap:

| Column | In squash migration? | Added by |
|--------|---------------------|---------|
| `id` | ✅ | squash |
| `title` | ✅ | squash |
| `objective` | ✅ | squash |
| `status` | ✅ | squash |
| `priority` | ✅ | squash |
| `assigned_agent` | ✅ | squash |
| **`recent_agent`** | ❌ | `20260225125004_add_recent_agent_to_tickets.sql` |
| `board_position` | ✅ | squash |
| `organization_id` | ✅ | squash |
| `project_id` | ✅ | squash |
| `execution_target` | ✅ | squash |
| `context` | ✅ | squash |
| `constraints` | ✅ | squash |
| `available_tools` | ✅ | squash |
| `acceptance_criteria` | ✅ | squash |
| `output_format` | ✅ | squash |
| `created_at` | ✅ | squash |
| `updated_at` | ✅ | squash |
| `ticket_sequence` | ✅ | squash |
| `everhour_task_id` | ✅ | squash |
| `created_by` | ✅ | squash |

`recent_agent` is the **only field** in `TICKET_AGENT_FIELDS` that post-dates the squash migration.

---

## 6. How to fix

### Immediate fix — apply pending migrations to production

```bash
npx supabase db push
```

This will apply all unapplied migrations to the production database. The critical one is:

```sql
-- 20260225125004_add_recent_agent_to_tickets.sql
alter table "public"."tickets"
  add column if not exists recent_agent text;
```

There are also 14 other migrations after the squash that may not have been applied. Run `supabase db push` to bring production up to date.

If you're using the Supabase dashboard instead of the CLI, go to **Database → Migrations** and check which are marked as applied.

### If `recent_agent` already exists — reload PostgREST schema cache

If the column exists but PostgREST is caching the old schema:

1. Go to **Supabase Dashboard → Database → Extensions**
2. Find `pg_net` or use the SQL editor to run:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

### Code fix — surface the real error in attach (prevents future silent failures)

In `supabase/functions/mcp/handlers/attach.ts`, log the actual DB error before returning the generic message:

```typescript
// Before:
if (ticketErr || !ticket) return toolErr('Ticket not found or access denied.');

// After:
if (ticketErr || !ticket) {
  if (ticketErr) console.error('[attach] ticket select error:', ticketErr.message, ticketErr.code);
  return toolErr('Ticket not found or access denied.');
}
```

This makes future schema mismatches immediately visible in Supabase Edge Function logs without changing the API surface.

Same fix should be applied in `lib/overlord/protocol-attach.ts` (the REST route counterpart):

```typescript
// Before:
if (ticketError || !ticket) {
  return { error: 'Ticket not found.', status: ticketError?.code === 'PGRST116' ? 404 : 500 } as const;
}

// After — distinguish schema errors from not-found:
if (ticketError || !ticket) {
  const is404 = ticketError?.code === 'PGRST116';
  if (ticketError && !is404) {
    console.error('[attach] ticket select error:', ticketError.message, ticketError.code);
  }
  return {
    error: 'Ticket not found.',
    status: is404 ? 404 : 500
  } as const;
}
```

---

## 7. Affected migrations not yet in production

Based on the git log, the following migrations post-date the squash and may not be applied:

```
20260223115511_device-auth.sql
20260223153220_app-downloads-storage-bucket.sql
20260223154903_app-downloads-public-read.sql
20260223191500_objective_threads.sql
20260224071000_add_icebox_default_status.sql
20260224132506_enable-realtime-notifications.sql
20260225090902_remove_ticket_number.sql
20260225125004_add_recent_agent_to_tickets.sql   ← ROOT CAUSE
20260225143000_add_user_follow_up_event_type.sql
20260225144000_ticket_search_vector.sql
20260226090000_add_ticket_reopened_event_type.sql
20260226100500_include_first_objective_in_ticket_search_vector.sql
20260226201000_add_profiles.sql
20260226201500_add_default_project_id_to_profiles.sql
20260227090000_ticket-documents-storage.sql
20260302120000_auth-grants.sql
20260302120001_extend-agent-tokens.sql
20260303000001_device-auth-poll-throttle.sql
20260305100000_user_agent_configs.sql
20260307093000_fix_public_oauth_client_secret_hash.sql
20260311210953_remove-ev-project_add-is_read.sql
20260311233000_add_change_rationales.sql
20260312090000_project_user_preferences.sql
```

Running `supabase db push` will apply all unapplied ones in order.

---

## 8. Summary

| | Detail |
|--|--------|
| **Symptom** | `attach` returns "Ticket not found or access denied." |
| **Root cause** | `recent_agent` column in `TICKET_AGENT_FIELDS` missing from production DB |
| **Why** | Migration `20260225125004` not applied to production after initial squash |
| **Why hard to diagnose** | Handler swallows `ticketErr` without logging it |
| **Immediate fix** | `npx supabase db push` |
| **Code fix** | Log `ticketErr.message` before the generic error return |
