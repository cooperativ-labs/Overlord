# coo:831 — Railway Infrastructure as Code

**Date:** 2026-08-23  
**Mission:** coo:831 / objective coo:831.ndwe  
**Docs:** https://docs.railway.com/infrastructure-as-code

## Summary

Migrated Overlord Cloud from deprecated Config as Code (`railway.json`) to
Railway TypeScript Infrastructure as Code (`.railway/railway.ts`).

## Changes

1. Added `railway@^3.10.0` (provides `railway/iac`) as a root devDependency.
2. Imported the linked `overlord-cloud` / `production` graph into
   `.railway/railway.ts` (Postgres, overlord-backend, racecar-gateway,
   volumes, overlord-storage bucket, custom domain, `preserve()` secrets).
3. Ran `railway config migrate --apply --delete-files` to clear the service
   Railway Config File setting and remove `railway.json`.
4. Encoded former CaC settings on `overlord-backend`:
   - `dockerfilePath: "backend/Dockerfile.railway"`
   - `healthcheck: "/api/health"`
   - `healthcheckTimeout: 120`
5. Applied the two non-destructive dashboard updates via
   `railway config apply --yes` so deploys keep the correct Dockerfile after
   CaC removal.
6. Updated `planning/feature-plans/overlord-cloud-architecture.md` to point at
   `.railway/railway.ts`.

## Verification

`railway config plan` reports: **Your Railway configuration is already up to date.**

## Not applied / deferred

- Left secrets as `preserve()` rather than rewriting `DATABASE_URL` /
  S3 vars as resource references (avoids unintended variable churn).
- Did not redeploy services; only config ownership and two deploy settings
  changed.
