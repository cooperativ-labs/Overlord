import type { Metadata } from 'next';

import { DocsMarkdownPage } from '../../_components/docs-markdown-page';

export const metadata: Metadata = {
  title: 'External Providers'
};

export default function ExternalProvidersPage() {
  return (
    <DocsMarkdownPage
      title="External providers"
      lead="Overlord runs on infrastructure and AI services operated by third parties. This page summarizes what leaves our control and where to read each vendor's security posture."
    >
      {`
## Google Gemini (summarization)

When Overlord generates dashboard feed posts from ticket activity, a **Supabase Edge Function** calls the **Google Gemini API** with structured context derived from the ticket. That context can include ticket fields, objectives, delivery summaries, change rationales, file-change metadata, and other text that agents or humans have written into the ticket record.

- [Security at Google Cloud](https://cloud.google.com/security) — how Google protects cloud and AI platform infrastructure
- [Google Privacy Policy](https://policies.google.com/privacy) — how Google handles personal information across its services
- [Gemini API additional terms of service](https://ai.google.dev/gemini-api/terms) — contractual terms for Gemini API usage

## Supabase (database and edge functions)

Overlord stores application data in **Supabase** (PostgreSQL) and runs server-side logic—including the Gemini summarization function—in **Supabase Edge Functions**.

- [Supabase security](https://supabase.com/security) — security program overview for the Supabase platform

## Vercel (web frontend)

The Overlord **web application** frontend is hosted on **Vercel**.

- [Vercel security](https://vercel.com/security) — how Vercel secures its platform and customer workloads

## Related pages

- [Security overview](/docs/security)
- [Data boundaries](/docs/security/data-boundaries)
- [Authentication](/docs/security/authentication)
      `}
    </DocsMarkdownPage>
  );
}
