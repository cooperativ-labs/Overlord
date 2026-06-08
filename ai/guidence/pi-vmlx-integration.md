# Using the Pi harness with vMLX models

How to install the **Pi** coding-agent harness and point it at a model served
locally by **vMLX / MLX Studio**.

Pi (`earendil-works/pi`) is a terminal-first, provider-agnostic coding agent.
It runs the same agent loop against Claude, GPT, Gemini, or any local server
that speaks a supported wire format. vMLX exposes your local model over an
**Anthropic-compatible** `/v1/messages` endpoint *and* an **OpenAI-compatible**
`/v1/chat/completions` endpoint, so it drops straight into Pi as a custom
provider — no proxy or shim required.

---

## 1. Start the vMLX server

Make sure your model is running and reachable. Per the vMLX docs it serves an
OpenAI + Anthropic compatible API. Confirm the port (the examples below assume
`8080`) and the model name:

```bash
# List the models the server is exposing (OpenAI-style discovery endpoint)
curl http://localhost:8080/v1/models -H "x-api-key: not-needed"

# Smoke-test the Anthropic Messages endpoint
curl http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: not-needed" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "your-model-name",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Note the exact `model` id (`your-model-name` below) — it must match what you put
in Pi's config.

---

## 2. Install Pi

```bash
# Recommended: install the CLI globally
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# …or use the one-line installer
curl -fsSL https://pi.dev/install.sh | sh
```

Verify:

```bash
pi --help
```

> Pi normally expects a cloud key (e.g. `ANTHROPIC_API_KEY`) or a `/login`
> subscription. With a local vMLX provider you don't need either — the local
> provider config below supplies a dummy key.

---

## 3. Register vMLX as a custom provider

Pi reads custom providers from `**~/.pi/agent/models.json**`. The file is
reloaded every time you open `/model`, so you can edit it without restarting Pi.

You have two equivalent options. **Option A (Anthropic-messages) is
recommended** because Pi's agent loop was built around Anthropic semantics
(prompt caching, extended thinking), and vMLX serves that endpoint natively.

### Option A — Anthropic-compatible (recommended)

vMLX exposes `POST /v1/messages`, which matches Pi's `anthropic-messages` API
type. Point `baseUrl` at the server **root** (Pi appends `/v1/messages`):

```json
{
  "providers": {
    "vmlx": {
      "name": "vMLX (local)",
      "baseUrl": "http://localhost:8080",
      "api": "anthropic-messages",
      "apiKey": "not-needed",
      "models": [
        {
          "id": "your-model-name",
          "name": "vMLX your-model-name",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

### Option B — OpenAI-compatible

This mirrors the OpenCode `@ai-sdk/openai-compatible` config. vMLX exposes
`POST /v1/chat/completions`, which matches Pi's `openai-completions` API type.
Here `baseUrl` includes `/v1` (Pi appends `/chat/completions`):

```json
{
  "providers": {
    "vmlx": {
      "name": "vMLX (local)",
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "models": [
        {
          "id": "your-model-name",
          "name": "vMLX your-model-name",
          "input": ["text"],
          "contextWindow": 32768,
          "maxTokens": 4096,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

#### Field reference


| Field                         | Notes                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                     | Anthropic: server root (`…:8080`). OpenAI: include `/v1` (`…:8080/v1`).                                               |
| `api`                         | `anthropic-messages` or `openai-completions`.                                                                         |
| `apiKey`                      | vMLX ignores it but a value is required. Literal `"not-needed"` works; `$VAR` / `!command` are also supported.        |
| `id`                          | **Must** equal the model id vMLX reports at `/v1/models`. This is sent to the server.                                 |
| `name`                        | Friendly label shown in `/model` and matched by `--model`.                                                            |
| `contextWindow` / `maxTokens` | Match your model + the limits in the OpenCode example (`32768` / `4096`). Defaults are `128000` / `16384` if omitted. |
| `cost`                        | All zeros for a local model.                                                                                          |
| `reasoning`                   | Set `true` only if the model emits extended-thinking output.                                                          |


> If vMLX runs on a different port, update both `baseUrl` and your curl tests.
> If it requires a real key, replace `"not-needed"` with `"$VMLX_API_KEY"` and
> export that variable.

---

## 4. Launch Pi against the model

```bash
ipp
```

`pi --list-models` shows every configured model, including your vMLX entry, so you can confirm registration before launching.

---

## 5. Troubleshooting

- **Model not listed in `/model`** — JSON syntax error in `models.json`, or the
file is in the wrong place. It must be `~/.pi/agent/models.json`. Re-open
`/model` to force a reload.
- **404 / "not found"** — `baseUrl` path mismatch. Anthropic mode wants the
server root; OpenAI mode wants the `/v1` suffix. Re-check against the working
curl in step 1.
- **401 / auth error** — vMLX is enforcing a key; set a real `apiKey`.
- **Empty or malformed responses** — try the other API type (A ↔ B); some MLX
builds implement one wire format more completely than the other.
- **Wrong model answering** — the `id` field must exactly match what
`/v1/models` reports, not the friendly `name`.

---

## References

- Pi coding agent — [https://github.com/earendil-works/pi](https://github.com/earendil-works/pi)
- Pi custom models / `models.json` — `packages/coding-agent/docs/models.md`
- Pi custom providers — `packages/coding-agent/docs/custom-provider.md`
- Pi docs site — [https://pi.dev/docs/latest/custom-provider](https://pi.dev/docs/latest/custom-provider)
- vMLX — [https://github.com/jjang-ai/vmlx](https://github.com/jjang-ai/vmlx)
- MLX Studio — [https://mlx.studio/](https://mlx.studio/)

