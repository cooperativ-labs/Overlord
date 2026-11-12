# OpenAPI schema disagreements (phase 4b working file)

Running record kept while phase 4b adds request and response schemas to
`openapi.yaml`. The description follows the code (ADR 0006); everything here is where
another source, or the code itself, looks wrong. Phase 4d consumes this file: it
resolves each entry by a contract change, a code fix, or an explicit decision to keep
the behaviour. Batches append; do not renumber entries.

Each entry names the operationIds affected and the file and function that ship the
behaviour. Status is `open` until phase 4d decides.

## 1. Prose and type disagreements

Where `rest-notes.md`, a TypeScript DTO comment, or another document says something
the code does not do.

## 2. Non-conforming error shapes

Every route in `backend/app.ts` that forwards errors through `handle()` or `next(err)`
answers with `ErrorEnvelope` (`backend/errors.ts` `apiErrorHandler`). The envelope is
one shape with origin-dependent members: `{ error, detail?, code? }` from `ApiError`,
`{ error, code, details? }` from `ServiceError`, `{ error, code: 'body_too_large' }`
from the body parser, `{ error, detail }` from a SQLite constraint failure and from an
unexpected exception, and `{ error }` from the authentication middleware (401) and the
project-automation route guard (404).

- **E1** (open). The envelope carries both `detail` (string, from `ApiError`) and
  `details` (any JSON, from `ServiceError`). Two near-identical member names with
  different types; a later contract change should pick one.
- **E2** (open). `POST /api/auth/desktop/exchange` (`postAuthDesktopExchange`) and
  `POST /api/auth/browser/exchange` (`postAuthBrowserExchange`) answer 401 with
  `{ message }` (`backend/app.ts`), not `{ error }`.
- **E3** (open). `GET /api/auth/browser/callback` (`getAuthBrowserCallback`) answers 400
  and 401 with `text/plain` bodies (`backend/app.ts`).
- **E4** (open, probably intended). The OAuth endpoints answer RFC 6749 errors
  `{ error, error_description }` (`backend/oauth.ts` `jsonError`), where `error` is an
  OAuth code, not a message.

## 3. Suspected code defects

Found while reading handlers; not fixed in phase 4b (no runtime change). Each needs a
decision and, if confirmed, a fix with its own contract impact.

- **X1** (open, all routes). A malformed JSON body answers **500**
  `{ error: <parser message>, detail: <same> }` instead of 400: `apiErrorHandler` maps
  only the body parser's `entity.too.large`, not `entity.parse.failed`. Reproduced
  against `backend/errors.ts`.
- **X2** (open, all routes). A request from an origin CORS rejects answers 500: the
  `cors` origin callback raises a plain `Error` that `apiErrorHandler` treats as
  unexpected.
- **X3** (open, Postgres). `apiErrorFromDatabaseError` maps only `SQLITE_CONSTRAINT*`
  codes; the same unique or foreign-key violation on Postgres answers 500 instead of
  409/400, so the two editions answer differently.
- **X4** (open, raw uploads). `readRawUpload` (`backend/http/raw-upload.ts`) calls
  `decodeURIComponent` on `x-upload-filename` unguarded; a malformed percent-encoding
  answers 500 `URI malformed` instead of 400. Reproduced.
- **X5** (open, raw uploads). The attachment routes' raw parser limit equals
  `MAX_ATTACHMENT_BYTES`, so an oversized upload is always refused by the parser
  (`body_too_large`) and `assertAttachmentBytes`'s own 413 message is unreachable.
- **X6** (open, many routes). Handlers call string methods on body members without a
  type check (`body.name.trim()`, `body.label.trim()`, `body.title.trim()`,
  `body.instructionText.trim()`, …). A member of the wrong JSON type (number, object)
  answers 500 with a `TypeError` message instead of 400. The schemas declare the
  intended types; the code does not enforce them.

## 4. Generator constructs needed

Constructs used beyond the subset Clear Comply's generator
(`scripts/generate-api-contract.mjs`) translates. Phase 4c must support each or the
schema must change.

- **G1** `JsonValue` (a schema with no `type`, any JSON value): artifact `contentJson`,
  shared-context `value`, ServiceError `details`, repository-read `data`. Needs
  `z.unknown()`.
- **G2** `additionalProperties: true` (an open object): `ProjectResourceSourceDto.descriptor`.
  Clear Comply's generator renders it as a plain `z.object({})`, which strips unknown
  keys; it needs `z.record(z.string(), z.unknown())`.
- **G3** Non-JSON request bodies (`'*/*'` raw uploads with `RawUploadBody`, a string
  with `contentMediaType`), header parameters, and `text/event-stream` or file
  responses. The Clear Comply generator reads only JSON success responses.
- **G4** String bounds (`minLength`, `maxLength`) are ignored by the Clear Comply
  generator; they are documentation until 4c renders them.
- **G5** `allOf` for a DTO that extends another (`MissionDetailDto` = `MissionDto` +
  detail projections). Needs `.extend()`/`z.intersection`; the alternative is
  repeating every `MissionDto` property in each extension.
- **G6** `$ref` with sibling keywords (`description`) on a property. Valid OpenAPI 3.1;
  the Clear Comply generator ignores the siblings, which is harmless.

## 5. Operations left as stubs

None so far.
