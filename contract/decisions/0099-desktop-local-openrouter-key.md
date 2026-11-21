# 0099 — User-supplied OpenRouter key for the local desktop backend

Status: Accepted

## Decision

Desktop distribution must never embed a provider API key. In Local mode the user
may save, replace, or remove an OpenRouter key in OS-backed encrypted desktop
settings. IPC accepts writes and reports only configured status, restricted to
the main local shell; it never returns the key to the renderer. The local server
receives the key on application restart. Without one, AI-dependent operations
retain their existing unavailable or deterministic fallback behavior. The
hosted backend continues to use server-managed credentials; headless runtime
environment configuration remains available.

## Impact

This supersedes ADR 0055's desktop credential packaging requirement. Desktop,
renderer settings, and the local server change together. Users supply and pay
for their own local provider access; switching a key requires an app restart.
