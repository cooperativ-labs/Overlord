---
name: update-docs
description: Use when updating, auditing, or writing documentation pages in apps/web/app/docs. Ensures links resolve, CLI commands match the real surface, and content is accurate and complete.
---

# update-docs

Apply this skill when working on any documentation page under `apps/web/app/docs/`.

## Instructions

### 1. Verify all links

For every hyperlink in the docs pages you touch (and adjacent pages that link to them), confirm:

- **Internal links** (e.g. `/docs/agent-plugins`, `/docs/protocol`) map to a real route in `apps/web/app/docs/`. Check that the corresponding `page.tsx` file exists.
- **External links** (e.g. `https://www.ovld.ai/signup`, `https://www.ovld.ai/downloads`) are correct and intentional. Flag any that look stale or point to placeholder URLs.
- Links in the navigation/sidebar (defined in `apps/web/app/docs/layout.tsx` or related nav components) must match the actual page routes.

### 2. Audit CLI commands against the real surface

The authoritative CLI surface is defined in:

```
packages/overlord-cli/bin/_cli/index.mjs
```

**Read that file before writing or reviewing any CLI docs.** 

**Commands that do NOT exist and must not appear in docs:**
- `ovld open` — not a real command (check docs/surfaces/cli/page.tsx)
- Any other command not listed above

When you spot a discrepancy, fix the docs page to match the real surface. Do not invent flags or subcommands.

### 3. Keep examples runnable

- Every code block tagged `bash` or `sh` must use only real commands from the surface above.
- Include the install step (`npm install -g @overlord-ai/cli`) when a page is intended for first-time readers.
- Use `ovld` as the primary command name consistently (not `overlord` or `ovld-cli`).

### 4. Cross-check page content against the protocol skill

The agent protocol surface lives in the Overlord plugin skill loaded into the session. Before writing or reviewing `apps/web/app/docs/protocol/` pages, read the protocol skill instructions (available as `overlord:overlord-ticket` skill) to ensure the documented protocol subcommands, flags, and event types match.

### 5. Structure and tone

- Use `##` for top-level sections within a page, `###` for subsections.
- Prefer short, imperative sentences in step-by-step flows.
- Each page should have a `## Related pages` section at the bottom that links to adjacent concepts.
- Do not leave placeholder comments like `<!-- Add content here -->`.

### 6. After edits, verify the build compiles

Run:

```bash
cd apps/web && yarn build 2>&1 | tail -20
```

A TypeScript or import error in a docs page will break the entire web build. Fix any errors before delivering.

## Examples

### Finding and fixing a broken CLI command

```bash
# Read the real CLI surface first
cat packages/overlord-cli/bin/_cli/index.mjs

# Grep docs for commands that may not exist
grep -r "ovld open\|ovld run\|ovld resume" apps/web/app/docs/
```

Then edit the offending page to remove or replace the invalid command.

### Checking internal links resolve

```bash
# List all internal hrefs in docs pages
grep -roh 'href="\/docs\/[^"]*"' apps/web/app/docs/ | sort -u

# Verify each maps to a real page
find apps/web/app/docs -name "page.tsx" | sed 's|apps/web/app||;s|/page.tsx||'
```

Compare the two lists. Any href without a matching page.tsx is a broken link.

<!-- version: 1.0.0 -->
