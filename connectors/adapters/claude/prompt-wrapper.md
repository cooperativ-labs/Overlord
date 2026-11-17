# Claude Prompt Wrapper

Claude launch prompts should keep the mission objective compact and place large context in a file that Claude receives through its native context flag.

Recommended launch shape:

```bash
claude --append-system-prompt-file <context-file> --model <model> --effort <level> "Attach, then immediately execute this mission's current objective."
```

Rules:

- The context file holds only what is needed to attach: mission and objective ids, the execution directive and the attach command. The attach response carries the objective, history, artifacts, attachments, shared context and all working rules.
- The visible user prompt should point Claude at the context file, name the active mission ID, and explicitly direct execution without waiting for confirmation.
- `--model` is passed only when the execution target has a model configured.
- `--effort` is passed only when the installed Claude binary supports it and the execution target has an effort level configured.
- Do not embed secrets in the prompt wrapper. Authentication comes from shared `ovld auth` credentials, Overlord-launched environment variables, `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`, or the Claude plugin `user_token` config passed to `ovld protocol` as `Overlord_USER_TOKEN`.
