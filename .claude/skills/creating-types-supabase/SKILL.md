---
name: creating-types-supabase
description: How to create types using the Supabase database schema
---

## Regenerating schema types

After schema changes, regenerate the Supabase types:

```bash
yarn generate  # Regenerate from local Supabase
```

This updates `types/database.types.ts`. **Never edit that file by hand.**

## Where to put types

- **Domain and shared types** → `types/` (e.g. `types/tickets.ts`, `types/objectives.ts`)
- **Generated schema** → `types/database.types.ts` only (via `yarn generate`)

Prefer adding or extending files under `./types` instead of defining ad-hoc types inline in components, hooks, or actions. Import domain types from `@/types/<name>` across the app.

## Building on `Database`

Derive application types from the generated `Database` type in `types/database.types.ts`:

```typescript
import type { Database } from '@/types/database.types';

// Full row
export type TicketType = Database['public']['Tables']['tickets']['Row'];

// Subset for a specific UI or API surface
export type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  'id' | 'objective' | 'title' | 'state'
>;

// Insert / update when needed
type TicketInsert = Database['public']['Tables']['tickets']['Insert'];
type TicketUpdate = Database['public']['Tables']['tickets']['Update'];

// Enums
type ConnectionMethod = Database['public']['Enums']['connection_method'];
```

Use `Pick`, `Omit`, or intersections when a feature needs only part of a row or a row plus computed fields. Avoid duplicating column names or shapes that already exist on `Database`.

## When inline `Database` access is OK

Importing `Database` directly from `@/types/database.types` is fine for one-off generics (e.g. Supabase client helpers) or a single table reference in a file. If the same `Database['public']['Tables'][...]` expression appears more than once, extract it to `types/`.

## Checklist

1. Schema changed? Run `yarn generate`.
2. New shared type? Add `types/<domain>.ts` and export from `Database`.
3. Consumers import from `@/types/<domain>`, not from `database.types.ts`, unless they need `Database` or `Json` directly.
