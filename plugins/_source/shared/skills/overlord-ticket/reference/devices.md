# Devices And Checkout Paths

Device rows use **(organization_id, user_id, device_fingerprint)**, so the same physical machine can register independently in each org you belong to. Persist a fingerprint per workstation, upsert via `ovld protocol get-device`, then maintain checkout paths via `list-project-resources`, `add-project-resource`, `update-project-resource`, and `update-device` (`ovld protocol help` lists flags).

```bash
ovld protocol get-device --device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"
ovld protocol list-project-resources --project-id <project_uuid> --device-fingerprint "$OVERLORD_DEVICE_FINGERPRINT"
```

## Choosing `--execution-target`

Pass `--execution-target agent` or `--execution-target human` (default: `human`) when creating tickets.

- **`agent`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **`human`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: _can this be done entirely inside a terminal or browser by an AI without human intervention?_ If yes → `agent`. If it requires a human to log in, decide, or act in the real world → `human`.
