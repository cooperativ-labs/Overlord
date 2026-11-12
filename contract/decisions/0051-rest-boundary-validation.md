# ADR 0051: The OpenAPI description is enforced at the route boundary and in the backend tests

- Date: 2026-11-12
- Status: accepted
- Contract version: 169.2.0
- Supersedes: none

## Context

ADR 0006 calls for boundary validation with the generated schemas and response validation
in the backend tests; ADR 0050 generated the schemas and the operation table. Phase 4d of
`planning/feature-plans/contract-adr-openapi-migration.md` adds both, and retires
`contract/api/rest-notes.md`, the holding file for REST prose.

Every handler already validates its input by hand, with specific statuses, codes and
messages that clients and tests rely on. Input those checks do not anticipate (a body that
is not JSON, a member of the wrong JSON type, a non-integer where an integer is required)
often reaches code that fails, and the client gets a 500. Most backend tests call service
functions; a minority drive the app or one of its routers over HTTP.

## Decision

1. **Where.** Every route that has an operation gets one request-validation layer, inserted
   when the app is built (`installRequestValidation`, `backend/http/request-validation.ts`)
   immediately before the route's handler: after the global and route-level authentication
   middleware, the project-automation guard and the body parsers, and before the handler's
   own permission checks. An unauthenticated caller therefore still gets 401, and a
   `project_automation` token outside its allowlist still gets 404, before any validation
   detail.
2. **What.** Path, query and header parameters and the body are checked against the
   operation's generated schemas: JSON and form bodies against their schemas (a request
   without a JSON body is checked as the `{}` the handler receives), raw bodies for presence
   and type only. Event streams and downloads are never buffered. Unknown body members are
   ignored unless the schema refuses them.
3. **Handlers keep their answers.** The layer records the issues and lets the handler run.
   A handler's own answer to an invalid request stands, status, code and message. When the
   handler fails with 500 on a request the description refuses, the response becomes 400
   `ErrorEnvelope` with `code: invalid_request`, `detail` naming the first issues as
   `<location>.<member>: <message>`, and `details.issues` (`in`, `path`, `code`, `message`),
   never echoing a submitted value. When the handler accepts such a request, it succeeds as
   before and the backend logs a structured warning, because the description is narrower than
   the code that ships. A JSON body that does not parse answers 400 `invalid_json` from the
   layer, after authentication; route-level parsers and validation `off` answer the same
   through the error handler.
4. **Switch.** `OVERLORD_API_REQUEST_VALIDATION` is `enforce` (default), `warn` (log, as
   one JSON line with event `api_request_validation`, what enforce would have changed, and
   change nothing) or `off` (the layer does nothing). An unrecognised value keeps `enforce`
   and is reported once. The operator can back out without a code change.
5. **Response conformance in tests.** `yarn test:backend` runs under
   `scripts/api-conformance-report.mjs`, which points `OVERLORD_API_CONFORMANCE_REPORT` at a
   fresh file. The app (and every test app built from an Overlord router) mounts
   `apiResponseConformance()` first; with the variable set it checks each response against
   its operation, matched by the validation layer or by path template: the status must be
   declared, the media type must be one the status declares, and a JSON or text body must
   match the generated schema with every object closed, so an undocumented member fails.
   Formats stay lenient (ADR 0050). The run fails on any mismatch and on any invalid request a
   handler accepted, and reports how many operations had a response checked. A sweep test
   calls every GET operation of the real app against a small fixture.
6. **The description declares what the boundary adds.** Every operation served behind the
   JSON body parser declares 400, operations whose own 400 has another shape also admit
   `ErrorEnvelope`, and every operation behind the project-automation guard declares 404.
   Where a handler accepts input its schema refused, the schema is corrected to the handler.
7. **REST prose.** `contract/api/rest-notes.md` is deleted. What OpenAPI cannot express
   (cross-route invariants, ordering, side effects, ownership, isolation and privacy) is in
   `architecture.md` ("REST API Layer", "REST API → Database (HTTP Surface)") and
   `data/README.md` ("REST API Boundary"), naming operations by `operationId`; shapes are only
   in the description. `scripts/check-contract.sh` refuses the file if it returns, and it is no
   longer an ADR trigger of its own.

## Consequences

- A minor increment. Requests that are valid today behave exactly as before, and an invalid
  request a handler answers keeps that answer. Malformed input that produced 500 now produces
  400 with a stable code (`invalid_json`, `invalid_request`); an unauthenticated request with
  a body that is not JSON now gets 401 instead of 500. `invalid_json` and `invalid_request`
  join the open `ErrorEnvelope` code vocabulary.
- Validation is a backstop, not a replacement: handlers keep their checks, and removing one
  needs proof that the boundary answers with the identical status, code and message.
- A handler that starts accepting a new value without its schema saying so fails the backend
  tests when a test exercises it, and logs in production.
- Response coverage is as wide as the tests that reach the HTTP surface; the report names the
  operations no test reached.
- The validation layer adds one schema parse per request; it never reads or buffers a body
  the route's own parser did not read.

## Alternatives considered

- Rejecting every invalid request at the boundary before the handler: rejected because it
  replaces handlers' specific statuses and messages, which clients and tests rely on.
- Validating before authentication: rejected because unauthenticated callers would learn
  validation detail instead of getting 401.
- Validating only in `handle()`: rejected because the chat, connections, channel, OAuth and
  extension routes do not use it.
- Generating a second, closed variant of the schemas for tests: rejected in favour of closing
  the generated schemas at test time, which keeps one generated module.
