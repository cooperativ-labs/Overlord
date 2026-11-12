# ADR 0050: Generated REST types replace hand-written DTOs; formats are lenient by default

- Date: 2026-11-12
- Status: accepted
- Contract version: 169.1.1
- Supersedes: none

## Context

ADR 0006 makes `contract/api/openapi.yaml` the source of truth for REST and calls for types,
validators and an operation table generated from it, with hand-written DTOs deleted as each
is covered. Phase 4c of the migration builds that generator. Several choices are not settled
by ADR 0006: how strictly string formats are validated, how optional members and unknown
members behave, what a non-JSON body becomes, how far adoption goes, and what happens where a
hand-written type and the description differ.

The backend's own test fixtures use readable ids (`local-workspace`, `test-organization`)
where the description says `format: uuid`, and SQLite stores timestamps as written, so a
strict rendering of either format would reject what the backend legitimately emits.

## Decision

- `scripts/generate-api-contract.mjs` (`yarn api:generate`) writes
  `packages/contract/src/generated/api.ts`: one type per component schema, named as the
  schema, and a Zod v4 schema annotated `z.ZodType<Type>` so the compiler checks that both
  renderings agree; an operation table keyed by operationId; and the `contractVersion` and
  `apiVersion` constants. `yarn api:generate:check` fails on a stale module and runs in CI and
  `yarn check`. `@overlord/contract` depends on `zod` for this module, which it exports as
  `@overlord/contract/api`.
- The generator supports a fixed subset of OpenAPI 3.1 (contract/api/README.md) and refuses
  everything else. A `oneOf` must be provably exclusive; overlapping alternatives the code
  tries in order are `anyOf`. Bodies that are not JSON and responses without a body are typed
  descriptors in the operation table.
- `format: uuid` and `format: date-time` render as plain strings by default. A strict variant
  that validates both is available to anyone who opts in (`--strict-formats --out <file>`);
  the committed module stays lenient until the fixtures and stored data allow otherwise.
- An optional member is absent or has a value, never `undefined`. An object without
  `additionalProperties` drops unknown members when parsed; `false` refuses them.
- The generated types are the only definition of a REST DTO. `@overlord/contract` re-exports
  them from the module paths the hand-written types had, and `packages/core` re-exports them
  where it declared the same vocabularies. Where a generated type differs from the
  hand-written one, the generated type wins, because it describes what the code emits;
  consumers' types are corrected without changing runtime behaviour. A runtime list of a
  closed vocabulary is declared with `vocabulary<T>()`, which fails to compile unless the list
  names exactly the members of the generated type.
- Hand-written types remain only for shapes the description does not carry: protocol and MCP
  payloads, CLI-local reads, internal service inputs, vocabularies narrower than a wire
  `string`, and the chat block kinds no current writer produces.

## Consequences

- One definition per wire shape; a description change that breaks a consumer fails its
  typecheck.
- After `yarn version:contract` or any edit of `openapi.yaml`, `yarn api:generate` must run
  and its output must be committed.
- Request validation at the route boundary and response validation in backend tests (phase
  4d) use these schemas; lenient formats keep them from rejecting today's fixtures.
- A rest-consumer that vendors the contract subset vendors the generated module, not
  `packages/contract/src/index.ts` alone.

## Alternatives considered

- Infer each type with `z.infer`: rejected because the inferred declarations are emitted
  fully expanded in the package's `.d.ts`, are slower to check, and carry no member
  documentation.
- Strict `format` validation by default: rejected because it rejects the backend's own
  fixtures and stored values.
- Keep hand-written DTOs beside the generated ones: rejected by ADR 0006.
