# Cursor Prompt Wrapper

Cursor launch prompts should keep the mission objective compact and pass model selection through the native agent CLI when configured.

Recommended launch shape:

```bash
agent [--model <model>] "Begin working on this mission."
```

Rules:

- The initial session prompt holds only what is needed to attach: mission and objective ids, the execution directive and the attach command. The attach response carries the objective, history, artifacts, attachments, shared context and all working rules.
- The visible user prompt should name the active mission ID; for normal execution this is a short instruction such as `Begin working on this mission.`
- `--model` is passed only when the execution target has a model configured.
- Do not embed secrets in the prompt wrapper. Authentication comes from shared `ovld auth` credentials, Overlord-launched environment variables, or `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`.
