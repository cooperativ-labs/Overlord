# Codex Prompt Wrapper

Codex launch prompts should keep the mission objective compact and pass model and reasoning effort through native Codex flags when configured.

Recommended launch shape:

```bash
codex [--model <model>] [-c model_reasoning_effort="<level>"] "Attach, then immediately execute this mission's current objective."
```

Rules:

- The initial session prompt holds only what is needed to attach: mission and objective ids, the execution directive and the attach command. The attach response carries the objective, history, artifacts, attachments, shared context and all working rules.
- The visible user prompt should name the active mission ID and explicitly direct execution without waiting for confirmation.
- `--model` is passed only when the execution target has a model configured.
- `-c model_reasoning_effort="<level>"` is passed only when the execution target has an effort level configured.
- For large context, write a context file and pass a short prompt that points Codex at it.
- Do not embed secrets in the prompt wrapper. Authentication comes from shared `ovld auth` credentials, Overlord-launched environment variables, or `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`.
