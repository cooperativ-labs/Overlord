# Overlord Project Memory

## Architecture
- **Next.js App Router** (Server Components by default)
- **Supabase** for DB + Auth (local Docker for dev, Supabase Cloud for production)
- **Electron** a thin wrapper
  - Dev: starts local Supabase + Next.js
  - Prod: Supabase Cloud (no Docker), Next.js standalone server in Electron
- **Vercel** for web deployment
- `organizations.id` is `integer` (not UUID)
