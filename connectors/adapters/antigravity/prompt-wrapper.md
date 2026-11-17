# Antigravity Prompt Wrapper

Antigravity launch prompts should keep the mission objective compact. Do not pass a model or reasoning-effort flag — Antigravity manages model selection internally, so the launch shape carries only context.

Recommended launch shape:

```bash
agy "Begin working on this mission."
```

Rules:

- The initial session prompt holds only what is needed to attach: mission and objective ids, the execution directive and the attach command. The attach response carries the objective, history, artifacts, attachments, shared context and all working rules.
- The visible user prompt should name the active mission ID; for normal execution this is a short instruction such as `Begin working on this mission.`
- Never pass `--model` or an effort/thinking flag — Antigravity's own model selection stays in control.
- For large context, write a context file and pass a short prompt that points Antigravity at it, the same way the Codex and Claude wrappers do.
- Do not embed secrets in the prompt wrapper. Authentication comes from shared `ovld auth` credentials, Overlord-launched environment variables, or `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`.
