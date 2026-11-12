# ADR 0006: A hand-authored OpenAPI description is the source of truth for REST

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

About 280 Express routes are specified in prose bullets in
`architecture.md` "REST API Layer" and in `data/README.md`. Request validation
is hand-written per handler and DTO types are hand-written in
`packages/contract` and `packages/core`, so the specification, the validators
and the types can drift apart.

## Decision

`contract/api/openapi.yaml` is hand-authored and is the source of truth for
the REST surface. It is bootstrapped once from the code in phase 4 and then
inverted: Zod schemas, types, the operation table and the exported contract
version are generated from it, and hand-written DTOs are deleted as each is
covered. A route parity test, a generation check in CI, boundary validation
with the generated schemas and response validation in backend tests enforce
it. The description carries `info.x-overlord-contract-version`, written by
`yarn version:contract`, and its own `info.version`.

## Consequences

- One definition per wire shape.
- Where the description and the code disagree during bootstrap, the code is
  what ships; the description is corrected and the disagreement listed for
  review.
- Until phase 4 the contract tooling tolerates the absence of the file.

## Alternatives considered

- Generate OpenAPI from the code: rejected because the description would then
  record behaviour rather than specify it.
- Keep the prose specification: rejected because it cannot be checked.
