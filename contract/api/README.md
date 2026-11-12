# contract/api conventions

`openapi.yaml` is the hand-authored source of truth for REST (ADR 0006, 0048). These
rules keep the request and response schemas added in phase 4b uniform, and keep them
inside what the phase 4c Zod generator can translate. Read them before adding schemas.

## Layout

- Two-space indentation. Path keys at 2 spaces, operation keys at 4, operation fields
  at 6: `scripts/check-openapi.mjs` scans the file line by line in this layout.
- Path parameters stay inline in the path item's `parameters` (never a `$ref`): the
  OpenAPI test reads their `in` and `required`. Give each a `description` saying what
  it accepts.
- Short collections may use flow style (`required: [a, b]`, `{ $ref: ... }`).
- Shared parts live under `components`: `securitySchemes`, `responses`, `schemas`.

## Naming

- A component schema describing an existing TypeScript type takes that type's exact
  name (`MissionDto`, `CreateMissionBody`, `MissionDeliveriesDto`), so phase 4c can
  replace the hand-written type one for one.
- Without a TypeScript type: `<Thing>Dto` for a response object, `<Verb><Thing>Body` for
  a request body, `<Thing>List` for a bare array response, `<Thing>Response` for an
  envelope. An enum used twice or more becomes its own component.
- Every request body is a named schema. Inline schemas are for one-off trivial shapes
  only (a single-field acknowledgement, a variant inside a `oneOf`).
- Keep operationIds as bootstrapped (ADR 0048); never rename one.

## Optional and nullable

- Nullable is `oneOf: [<schema>, { type: 'null' }]`. Never `type: [x, 'null']`, never
  `nullable`.
- Optional means "not in `required`". A response object's `required` lists every key
  the mapper always writes, including keys whose value may be null. A key the mapper
  sometimes omits is optional and its description says when it is present.
- Derive this from the row-to-DTO mapper and the handler, not from the TypeScript type:
  where the type says `foo?: T | null` but the mapper always writes `foo`, the schema
  makes it required and nullable.
- A request body's `required` lists only what the handler rejects when absent. Trimming,
  blank handling, defaults and bounds the handler applies go in `description` (and in
  `minLength`/`maxLength`/`minimum`/`maximum`/`maxItems` where they are exact).

## Generator subset

Use only: `$ref` to `#/components/schemas/*`, `type` `string`/`integer`/`number`/
`boolean`/`null`/`array`/`object`, `enum`, `const`, `oneOf`, `required`,
`properties`, `additionalProperties` (`false` or a schema), `items`, `minimum`/`maximum`
on integers, `minItems`/`maxItems`/`uniqueItems`, and `format` `uuid`/`date-time`.
Anything else (`allOf`, a schema-less `JsonValue`, `additionalProperties: true`, string
bounds, non-JSON bodies, 204 or non-200 success codes) is allowed when the code needs it,
and every use is listed under "Generator constructs needed" in
`schema-disagreements.md` so phase 4c ports it deliberately.

## Values

- Timestamps are `$ref: '#/components/schemas/DateTime'` (ISO-8601 string).
- `format: uuid` only on ids the server mints with `randomUUID()` (projects, missions,
  objectives, statuses, workspaces, …). Execution-target ids and other externally
  supplied ids are plain strings.
- Path parameters never carry `format: uuid`. Mission routes accept a mission UUID or
  display id (`coo:756`), objective routes an objective UUID or full display id
  (`coo:756.k7xm`); an unknown or foreign reference answers 404 and an ambiguous display
  id 409. Say which in the parameter description.
- Free JSON is `$ref: '#/components/schemas/JsonValue'`.

## Security

Every operation has its own `security`. Authenticated REST routes take
`[{ sessionCookie: [] }, { sessionBearer: [] }, { userToken: [] }]`; public routes take
`[]`; the adapter channel family takes `[{ channelCredential: [] }]`. The loopback
local-operator fallback (unauthenticated loopback calls to `/api/protocol/*`,
`/api/runner/*` and `/mcp`) is not a security scheme: describe it in those operations'
descriptions. A `project_automation` user token reaches only the routes allowlisted in
`backend/project-automation-routes.ts`; others answer 404.

## Responses and errors

- List the real success status. `handle()` answers 200 with the handler's value, or
  `{ ok: true }` (`OkResponse`) when it returns nothing; there are no 201s from it.
- Every JSON error is an `ErrorEnvelope` (`backend/errors.ts`). Use the shared
  `components.responses` and list only the statuses the handler can produce:
  `401` on every authenticated operation; `403` where an RBAC action is checked;
  `404` where a resource or workspace is resolved; `400` where input is validated;
  `409`, `502` and others where the code throws them; `413` on operations that take a
  request body; `500` on every operation.
- A handler that writes another error shape (`{ message }`, OAuth `{ error,
  error_description }`, text/plain) is described as it is and listed in
  `schema-disagreements.md` under "Non-conforming error shapes".

## Pagination

There is no generic scheme. Each paged route documents its own parameters and
envelope exactly as the code reads and writes them: bounded newest-first lists
(`{ items, total, limit }`), cursor pages (`before`/`after`/`nextBefore`), sequence
cursors (`after`, `cursor`, `hasMore`). Say what the cap is and whether `total` is
pre-cap.

## Non-JSON transports

Raw-body uploads declare the body as `'*/*'` with `RawUploadBody`, and their headers
(`x-upload-filename`, percent-encoded) as header parameters. Streams declare
`text/event-stream` and describe the event names and payloads in the description.
Downloads declare the real media types and headers.

## Completing an operation

1. Read the handler and everything it calls up to the mapper; note every validation,
   default and error.
2. Add `summary`, `description` (authorization, rules the schema cannot express),
   `security`, `parameters`, `requestBody` and `responses`.
3. Resolve `x-overlord-permission` `unknown` and `x-overlord-consumers [unverified]`
   when the code establishes them (an operation needing two RBAC actions stays
   `unknown` with `x-overlord-permission-candidates`, ADR 0048).
4. Delete its `x-overlord-schema-status: stub` line and lower `stubOperations` in
   `openapi-ratchet.json` by one.
5. If the operation cannot be described truthfully yet, leave it a stub and say why in
   `schema-disagreements.md`.

## Recording disagreements

Where `rest-notes.md`, a TypeScript type or another document disagrees with the code,
the description follows the code (ADR 0006). Append an entry to
`schema-disagreements.md` in the matching section, naming the operationId, what each
side says, and the file and function that ship the behaviour. Suspected defects found
while reading handlers go there too; do not change runtime code in a schema change.
