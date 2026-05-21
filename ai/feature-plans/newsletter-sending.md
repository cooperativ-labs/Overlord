# Newsletter Sending — Architecture Decision

## Recommendation: Resend Batch Send (not Broadcasts)

### Why not Broadcasts?

The Resend Broadcasts API (`POST /broadcasts`) is designed for teams who manage their contacts *inside* Resend's own Audience/Segment system. To use it you would need to:

1. Sync every opted-in subscriber from our `mailing_list` table into a Resend Audience.
2. Keep that sync live — on consent change, email change, or user deletion.
3. Create and manage Segments/Topics in Resend's dashboard for each email type.

This adds a two-system contact management burden on top of the source of truth we already own.

### Why Batch Send?

We already have exactly what we need in the `mailing_list` table:

- One row per user with explicit boolean consent per email type (`new_features`).
- Email address populated on signup via a database trigger.
- RLS-protected; admin can query all opted-in users.

**`resend.batch.send()`** lets us:

1. Query `mailing_list` where `new_features = true`.
2. Chunk into groups of 100 (Resend's batch limit).
3. Send each chunk in a single API call.
4. Return a summary of sent/failed counts.

No contact syncing. No external state. Simple and auditable.

---

## Implementation: `send-newsletter` Edge Function

**Location:** `supabase/functions/send-newsletter/index.ts`

### Request (POST)

```json
{
  "subject": "What's new in Overlord",
  "html": "<h2>Headline</h2><p>Body copy...</p>",
  "text": "Optional plain-text fallback",
  "previewText": "Shown in email client preview",
  "emailType": "new_features",
  "replyTo": "jake@cooperativ.io"
}
```

### Auth

Accepts either:
- `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
- `Authorization: Bearer <NEWSLETTER_TRIGGER_SECRET>` (a dedicated secret stored in Supabase secrets)

### Response

```json
{ "ok": true, "sent": 142, "total": 142 }
```

Partial success (some batches failed):
```json
{ "ok": true, "sent": 100, "total": 142, "partialErrors": ["..."] }
```

### HTML Template

The function wraps the `html` body in a responsive email shell with:
- Overlord dark header
- Readable body container (600px max-width)
- Footer with link to `/settings` for preference management
- Preview text injection (hidden div trick for email clients)

You pass *only the content portion* — not a full HTML document.

---

## Required Secrets

Add to Supabase Edge Function secrets:

| Secret | Value |
|--------|-------|
| `RESEND_API_KEY` | Already set (shared with other functions) |
| `RESEND_FROM_EMAIL` | `Overlord <updates@notifications.cooperativ.io>` |
| `NEWSLETTER_TRIGGER_SECRET` | Generate a strong random secret |

---

## Sending a Newsletter

```bash
curl -X POST https://<project>.supabase.co/functions/v1/send-newsletter \
  -H "Authorization: Bearer $NEWSLETTER_TRIGGER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "What'\''s new in Overlord — May 2026",
    "html": "<h2>New this month</h2><p>We shipped X, Y, and Z...</p>",
    "previewText": "Agent execution improvements, new CLI commands, and more."
  }'
```

---

## Future Enhancements

- **Admin UI** — a page to compose and send newsletters from the dashboard.
- **Preview mode** — send a test email to the admin before the full send.
- **Unsubscribe link** — generate a signed token that updates `mailing_list` via a public API route.
- **Per-email-type targeting** — add more boolean columns to `mailing_list` and pass `emailType` in the payload.
- **Scheduling** — use a Supabase cron job or a scheduled Overlord agent to trigger sends at a set time.
