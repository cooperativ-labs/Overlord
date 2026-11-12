import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import {
  ApiContractGenerationError,
  componentOrder,
  OPENAPI_PATH,
  renderApiContract
} from './generate-api-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Under the repository's node_modules so the generated module resolves `zod`.
const scratch = path.join(repoRoot, 'node_modules', '.cache', `api-contract-test-${process.pid}`);
let loaded = 0;

after(() => rmSync(scratch, { recursive: true, force: true }));

const AUTHENTICATED = [{ sessionCookie: [] }, { sessionBearer: [] }, { userToken: [] }];

function operation(overrides = {}) {
  return {
    operationId: 'getThing',
    tags: ['things'],
    'x-overlord-permission': 'authenticated',
    'x-overlord-edition': 'both',
    'x-overlord-consumers': ['webapp'],
    summary: 'Read a thing',
    security: AUTHENTICATED,
    responses: {
      200: {
        description: 'The thing.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } }
      },
      500: { $ref: '#/components/responses/InternalError' }
    },
    ...overrides
  };
}

function documentWith({ schemas = {}, paths, responses } = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.2.3', 'x-overlord-contract-version': '169.1.0' },
    paths: paths ?? { '/api/things': { get: operation() } },
    components: {
      responses: responses ?? {
        InternalError: {
          description: 'Unexpected failure.',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } }
          }
        }
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string' } }
        },
        Thing: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' }, note: { type: 'string' } }
        },
        ...schemas
      }
    }
  };
}

/** Renders a document and imports the module with its types stripped. */
async function load(document, options) {
  const source = renderApiContract(document, options);
  mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, `module-${(loaded += 1)}.mjs`);
  writeFileSync(file, stripTypeScriptTypes(source));
  return { source, module: await import(pathToFileURL(file).href) };
}

function rejects(document, pattern, options) {
  assert.throws(
    () => renderApiContract(document, options),
    error => error instanceof ApiContractGenerationError && pattern.test(error.message)
  );
}

describe('module layout', () => {
  it('carries a do-not-edit header and the two version constants', async () => {
    const { source, module } = await load(documentWith());
    assert.match(source, /^\/\/ Generated from contract\/api\/openapi\.yaml/);
    assert.match(source, /Do not edit by hand/);
    assert.equal(module.contractVersion, '169.1.0');
    assert.equal(module.apiVersion, '1.2.3');
  });

  it('refuses a document without strict Semantic Versions', () => {
    const document = documentWith();
    document.info.version = '2.1';
    rejects(document, /info\.version/);
    const other = documentWith();
    delete other.info['x-overlord-contract-version'];
    rejects(other, /x-overlord-contract-version/);
  });

  it('names each type after its schema and its validator <name>Schema', async () => {
    const { source, module } = await load(documentWith());
    assert.match(source, /export interface Thing \{/);
    assert.match(source, /export const thingSchema: z\.ZodType<Thing> = /);
    assert.deepEqual(module.thingSchema.parse({ id: 'a' }), { id: 'a' });
  });

  it('keeps optional members optional and required members required', async () => {
    const { source, module } = await load(documentWith());
    assert.match(source, /\n {2}id: string;\n {2}note\?: string;/);
    assert.equal(module.thingSchema.safeParse({ note: 'x' }).success, false);
    assert.equal(module.thingSchema.safeParse({ id: 'x' }).success, true);
  });

  it('writes descriptions and deprecation as doc comments', async () => {
    const { source } = await load(
      documentWith({
        schemas: { Old: { type: 'string', description: 'Ends with */ here.', deprecated: true } }
      })
    );
    assert.match(source, /\/\*\*\n \* Ends with \*\\\/ here\.\n \* @deprecated\n \*\/\nexport type Old = string;/);
  });
});

describe('scalar keywords', () => {
  it('renders enums, consts and number bounds', async () => {
    const { module, source } = await load(
      documentWith({
        schemas: {
          Color: { type: 'string', enum: ['red', 'blue'] },
          Code: { type: 'integer', enum: [-1, 2] },
          Yes: { const: true },
          Count: { type: 'integer', minimum: 0, maximum: 5 },
          Ratio: { type: 'number', minimum: 0.5 }
        }
      })
    );
    assert.match(source, /export type Color = "red" \| "blue";/);
    assert.match(source, /export type Code = -1 \| 2;/);
    assert.equal(module.colorSchema.safeParse('green').success, false);
    assert.equal(module.codeSchema.safeParse(2).success, true);
    assert.equal(module.yesSchema.safeParse(false).success, false);
    assert.equal(module.countSchema.safeParse(6).success, false);
    assert.equal(module.countSchema.safeParse(1.5).success, false);
    assert.equal(module.ratioSchema.safeParse(0.25).success, false);
  });

  it('renders string bounds (G4)', async () => {
    const { module } = await load(
      documentWith({ schemas: { Name: { type: 'string', minLength: 1, maxLength: 3 } } })
    );
    assert.equal(module.nameSchema.safeParse('').success, false);
    assert.equal(module.nameSchema.safeParse('abcd').success, false);
    assert.equal(module.nameSchema.safeParse('ab').success, true);
  });

  it('renders array bounds and uniqueItems', async () => {
    const { module } = await load(
      documentWith({
        schemas: {
          Tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, uniqueItems: true }
        }
      })
    );
    assert.equal(module.tagsSchema.safeParse([]).success, false);
    assert.equal(module.tagsSchema.safeParse(['a', 'a']).success, false);
    assert.equal(module.tagsSchema.safeParse(['a', 'b', 'c']).success, false);
    assert.equal(module.tagsSchema.safeParse(['a', 'b']).success, true);
  });

  it('renders a null member of a two-member oneOf as nullable', async () => {
    const { module, source } = await load(
      documentWith({ schemas: { Maybe: { oneOf: [{ type: 'string' }, { type: 'null' }] } } })
    );
    assert.match(source, /export type Maybe = string \| null;/);
    assert.match(source, /z\.string\(\)\.nullable\(\)/);
    assert.equal(module.maybeSchema.safeParse(null).success, true);
  });
});

describe('generator constructs (schema-disagreements.md section 4)', () => {
  it('G1: a schema with annotations only accepts any JSON value', async () => {
    const { module, source } = await load(
      documentWith({ schemas: { JsonValue: { description: 'Any JSON value.' } } })
    );
    assert.match(source, /export type JsonValue = unknown;/);
    assert.match(source, /jsonValueSchema: z\.ZodType<JsonValue> = z\.unknown\(\)/);
    assert.deepEqual(module.jsonValueSchema.parse({ a: [1] }), { a: [1] });
  });

  it('G2: open objects keep unknown members; closed objects refuse them', async () => {
    const { module, source } = await load(
      documentWith({
        schemas: {
          Open: { type: 'object', additionalProperties: true },
          OpenWithKnown: {
            type: 'object',
            additionalProperties: true,
            properties: { a: { type: 'string' } }
          },
          Map: { type: 'object', additionalProperties: { type: 'integer' } },
          Typed: {
            type: 'object',
            properties: { a: { type: 'string' } },
            additionalProperties: { type: 'integer' }
          },
          Closed: {
            type: 'object',
            additionalProperties: false,
            properties: { a: { type: 'string' } }
          },
          Plain: { type: 'object', properties: { a: { type: 'string' } } }
        }
      })
    );
    assert.deepEqual(module.openSchema.parse({ x: 1 }), { x: 1 });
    assert.deepEqual(module.openWithKnownSchema.parse({ a: 'y', x: 1 }), { a: 'y', x: 1 });
    assert.equal(module.mapSchema.safeParse({ x: 'no' }).success, false);
    assert.deepEqual(module.typedSchema.parse({ a: 'y', x: 2 }), { a: 'y', x: 2 });
    assert.equal(module.typedSchema.safeParse({ x: 'no' }).success, false);
    assert.equal(module.closedSchema.safeParse({ a: 'y', x: 1 }).success, false);
    assert.deepEqual(module.plainSchema.parse({ a: 'y', x: 1 }), { a: 'y' });
    assert.match(source, /export type Open = \{ \[key: string\]: unknown \};/);
    assert.match(source, /export type Map = \{ \[key: string\]: number \};/);
  });

  it('G2: refuses an object that says nothing about its members', () => {
    rejects(documentWith({ schemas: { Empty: { type: 'object' } } }), /additionalProperties/);
  });

  it('G3: binary bodies, text, event streams and header parameters are descriptors', async () => {
    const document = documentWith({
      schemas: {
        RawUploadBody: { type: 'string', contentMediaType: 'application/octet-stream' },
        Event: { type: 'object', required: ['type'], properties: { type: { const: 'ping' } } }
      },
      paths: {
        '/api/uploads': {
          post: operation({
            operationId: 'postUploads',
            parameters: [
              { name: 'X-Upload-Filename', in: 'header', required: true, schema: { type: 'string' } }
            ],
            requestBody: {
              required: true,
              content: { '*/*': { schema: { $ref: '#/components/schemas/RawUploadBody' } } }
            },
            responses: {
              200: {
                description: 'A download.',
                content: { '*/*': { schema: { $ref: '#/components/schemas/RawUploadBody' } } }
              }
            }
          })
        },
        '/api/export': {
          get: operation({
            operationId: 'getExport',
            responses: {
              200: { description: 'CSV.', content: { 'text/csv': { schema: { type: 'string' } } } }
            }
          })
        },
        '/realtime': {
          get: operation({
            operationId: 'getRealtime',
            responses: {
              200: {
                description: 'Events.',
                content: { 'text/event-stream': { schema: { $ref: '#/components/schemas/Event' } } }
              }
            }
          })
        }
      }
    });
    const { module, source } = await load(document);
    const upload = module.apiOperations.postUploads;
    assert.equal(upload.requestBody.content['*/*'].kind, 'binary');
    assert.equal(upload.requestBody.content['*/*'].schema, module.rawUploadBodySchema);
    assert.equal(upload.responses['200'].content['*/*'].kind, 'binary');
    assert.equal(module.rawUploadBodySchema.safeParse(new Uint8Array([1])).success, true);
    assert.equal(module.rawUploadBodySchema.safeParse('bytes').success, false);
    assert.match(source, /export type RawUploadBody = BinaryBody;/);
    assert.equal(upload.parameters.header.safeParse({ 'x-upload-filename': 'a.txt' }).success, true);
    assert.equal(module.apiOperations.getExport.responses['200'].content['text/csv'].kind, 'text');
    const stream = module.apiOperations.getRealtime.responses['200'].content['text/event-stream'];
    assert.equal(stream.kind, 'event-stream');
    assert.equal(stream.event, module.eventSchema);
  });

  it('G3: refuses a binary media type whose schema is not binary', () => {
    const document = documentWith();
    document.paths['/api/things'].get.responses[200].content = {
      '*/*': { schema: { type: 'string' } }
    };
    rejects(document, /contentMediaType/);
  });

  it('G5: allOf extends a base declared later in the document', async () => {
    const document = documentWith({
      schemas: {
        Detail: {
          allOf: [
            { $ref: '#/components/schemas/Base' },
            {
              type: 'object',
              required: ['extra', 'list'],
              properties: { extra: { type: 'integer' }, list: { type: 'array', items: { type: 'string' } } }
            }
          ]
        },
        Base: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, list: { type: 'array', items: { type: 'string' } } }
        }
      }
    });
    const order = componentOrder(document.components.schemas);
    assert.ok(order.indexOf('Base') < order.indexOf('Detail'));
    const { module, source } = await load(document);
    assert.match(source, /export type Detail = Base & \{/);
    assert.deepEqual(module.detailSchema.parse({ id: 'a', extra: 1, list: [] }), {
      id: 'a',
      extra: 1,
      list: []
    });
    assert.equal(module.detailSchema.safeParse({ id: 'a', extra: 1 }).success, false);
    assert.equal(module.baseSchema.safeParse({ id: 'a' }).success, true);
  });

  it('G5: refuses an allOf member that is not an open object', () => {
    rejects(
      documentWith({
        schemas: {
          Closed: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
          Both: {
            allOf: [
              { $ref: '#/components/schemas/Closed' },
              { type: 'object', properties: { b: { type: 'string' } } }
            ]
          }
        }
      }),
      /must not restrict/
    );
  });

  it('G6: accepts annotations beside a $ref and refuses anything else', async () => {
    const ok = documentWith({
      schemas: {
        Holder: {
          type: 'object',
          properties: { thing: { $ref: '#/components/schemas/Thing', description: 'The thing.' } }
        }
      }
    });
    const { source } = await load(ok);
    assert.match(source, /\/\*\*\n {3}\* The thing\.\n {3}\*\/\n {2}thing\?: Thing;/);
    rejects(
      documentWith({
        schemas: { Bad: { $ref: '#/components/schemas/Thing', type: 'object' } }
      }),
      /unsupported keyword `type`/
    );
  });

  it('G7: uuid and date-time are lenient by default and strict on request', async () => {
    const document = documentWith({
      schemas: { When: { type: 'string', format: 'date-time' } }
    });
    const lenient = await load(document);
    assert.equal(lenient.module.thingSchema.safeParse({ id: 'local-workspace' }).success, true);
    assert.equal(lenient.module.whenSchema.safeParse('yesterday').success, true);
    const strict = await load(document, { strictFormats: true });
    assert.match(strict.source, /Strict formats/);
    assert.equal(strict.module.thingSchema.safeParse({ id: 'local-workspace' }).success, false);
    assert.equal(
      strict.module.thingSchema.safeParse({ id: '6f1c2c1e-8a4b-4c2d-9e0f-1a2b3c4d5e6f' }).success,
      true
    );
    assert.equal(strict.module.whenSchema.safeParse('yesterday').success, false);
    assert.equal(strict.module.whenSchema.safeParse('2026-11-12T10:00:00.000Z').success, true);
  });

  it('G8: a oneOf of closed objects told apart by their keys', async () => {
    const { module } = await load(
      documentWith({
        schemas: {
          Either: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['a'],
                properties: { a: { type: 'string' } }
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['b'],
                properties: { b: { type: 'string' } }
              }
            ]
          }
        }
      })
    );
    assert.deepEqual(module.eitherSchema.parse({ b: 'x' }), { b: 'x' });
    assert.equal(module.eitherSchema.safeParse({ a: 'x', b: 'y' }).success, false);
  });

  it('G8/G16: refuses a oneOf whose members can match the same value', () => {
    rejects(
      documentWith({
        schemas: {
          Overlap: {
            oneOf: [
              { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
              { type: 'object', required: ['b'], properties: { b: { type: 'string' } } }
            ]
          }
        }
      }),
      /can match the same value/
    );
    rejects(
      documentWith({
        schemas: { Numbers: { oneOf: [{ type: 'integer' }, { type: 'number' }] } }
      }),
      /can match the same value/
    );
  });

  it('G9: a 204 response has no content', async () => {
    const document = documentWith();
    document.paths['/api/things'].delete = operation({
      operationId: 'deleteThing',
      responses: { 204: { description: 'Deleted.' } }
    });
    const { module } = await load(document);
    assert.deepEqual(module.apiOperations.deleteThing.responses['204'], { headers: [], content: {} });
  });

  it('G10: a redirect lists its headers; text pages are text descriptors', async () => {
    const document = documentWith();
    document.paths['/api/things'].get.responses = {
      302: { description: 'Redirect.', headers: { Location: { schema: { type: 'string' } } } },
      400: { description: 'Page.', content: { 'text/html': { schema: { type: 'string' } } } }
    };
    const { module } = await load(document);
    const { responses } = module.apiOperations.getThing;
    assert.deepEqual(responses['302'].headers, ['Location']);
    assert.equal(responses['400'].content['text/html'].kind, 'text');
    assert.equal(responses['400'].content['text/html'].schema.safeParse('<p>').success, true);
  });

  it('G11: an optional security requirement is kept as an empty object', async () => {
    const document = documentWith();
    document.paths['/api/things'].get.security = [{ sessionCookie: [] }, {}];
    const { module } = await load(document);
    assert.deepEqual(module.apiOperations.getThing.security, [{ sessionCookie: [] }, {}]);
  });

  it('G12: a DELETE may take a JSON body', async () => {
    const document = documentWith();
    document.paths['/api/things'].delete = operation({
      operationId: 'deleteThing',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object', properties: { force: { type: 'boolean' } } }
          }
        }
      }
    });
    const { module, source } = await load(document);
    const body = module.apiOperations.deleteThing.requestBody;
    assert.equal(body.required, false);
    assert.equal(body.content['application/json'].schema, module.deleteThingRequestBodySchema);
    assert.match(source, /export interface DeleteThingRequestBody \{/);
  });

  it('G13: 201, form bodies beside JSON, and a body that is an object or a batch', async () => {
    const document = documentWith({
      schemas: {
        Call: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }
      }
    });
    document.paths['/api/things'].post = operation({
      operationId: 'postThing',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              oneOf: [
                { $ref: '#/components/schemas/Call' },
                { type: 'array', items: { $ref: '#/components/schemas/Call' } }
              ]
            }
          },
          'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/Call' } }
        }
      },
      responses: {
        201: {
          description: 'Created.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } }
        }
      }
    });
    const { module } = await load(document);
    const post = module.apiOperations.postThing;
    assert.equal(post.requestBody.content['application/x-www-form-urlencoded'].kind, 'form');
    const json = post.requestBody.content['application/json'].schema;
    assert.equal(json.safeParse([{ id: 1 }]).success, true);
    assert.equal(json.safeParse({ id: 1 }).success, true);
    assert.ok(post.responses['201']);
  });

  it('G14: an operation may answer only errors', async () => {
    const document = documentWith();
    document.paths['/api/things'].get.responses = {
      410: { description: 'Gone.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } }
    };
    const { module } = await load(document);
    assert.deepEqual(Object.keys(module.apiOperations.getThing.responses), ['410']);
  });

  it('G15: one status may carry two media types', async () => {
    const document = documentWith();
    document.paths['/api/things'].get.responses[200].content['text/event-stream'] = {
      schema: { $ref: '#/components/schemas/Thing' }
    };
    const { module } = await load(document);
    const content = module.apiOperations.getThing.responses['200'].content;
    assert.deepEqual(Object.keys(content), ['application/json', 'text/event-stream']);
    assert.equal(content['application/json'].kind, 'json');
    assert.equal(content['text/event-stream'].kind, 'event-stream');
  });

  it('G16: a union told apart by a const member', async () => {
    const { module, source } = await load(
      documentWith({
        schemas: {
          Text: {
            type: 'object',
            required: ['kind', 'text'],
            properties: { kind: { const: 'text' }, text: { type: 'string' } }
          },
          Other: {
            type: 'object',
            required: ['kind'],
            properties: { kind: { type: 'string', enum: ['a', 'b'] }, text: { type: 'integer' } }
          },
          Block: { oneOf: [{ $ref: '#/components/schemas/Text' }, { $ref: '#/components/schemas/Other' }] }
        }
      })
    );
    assert.match(source, /export type Block = Text \| Other;/);
    assert.deepEqual(module.blockSchema.parse({ kind: 'b', text: 2 }), { kind: 'b', text: 2 });
    assert.equal(module.blockSchema.safeParse({ kind: 'text', text: 2 }).success, false);
  });

  it('G17: an operation keeps its deprecation', async () => {
    const document = documentWith();
    document.paths['/api/things'].get.deprecated = true;
    const { module, source } = await load(document);
    assert.equal(module.apiOperations.getThing.deprecated, true);
    assert.match(source, /GET \/api\/things: Read a thing\n {3}\* @deprecated/);
  });

  it('anyOf accepts any member and parses with the first that matches', async () => {
    const { module } = await load(
      documentWith({
        schemas: {
          Batch: {
            anyOf: [
              {
                type: 'object',
                required: ['events'],
                properties: { events: { type: 'array', items: { type: 'string' } } }
              },
              { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } }
            ]
          }
        }
      })
    );
    assert.deepEqual(module.batchSchema.parse({ events: ['a'], kind: 'x' }), { events: ['a'] });
    assert.deepEqual(module.batchSchema.parse({ kind: 'x' }), { kind: 'x' });
  });
});

describe('operation table', () => {
  it('records the method, path, permission, edition, consumers, extension and parameters', async () => {
    const document = documentWith();
    document.paths['/api/things/{id}'] = {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: operation({
        operationId: 'getThingById',
        'x-overlord-permission': 'unknown',
        'x-overlord-permission-candidates': ['a:read', 'b:read'],
        'x-overlord-extension': 'github',
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }]
      })
    };
    const { module } = await load(document);
    const entry = module.apiOperations.getThingById;
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/api/things/{id}');
    assert.equal(entry.permission, 'unknown');
    assert.deepEqual(entry.permissionCandidates, ['a:read', 'b:read']);
    assert.equal(entry.edition, 'both');
    assert.deepEqual(entry.consumers, ['webapp']);
    assert.equal(entry.extension, 'github');
    assert.equal(entry.parameters.path.safeParse({ id: 'x' }).success, true);
    assert.equal(entry.parameters.path.safeParse({}).success, false);
    assert.equal(entry.parameters.query.safeParse({}).success, true);
    assert.equal(entry.parameters.header, null);
    assert.equal(entry.responses['500'], module.apiResponses.InternalError);
  });

  it('refuses an operation without its contract extensions', () => {
    const document = documentWith();
    delete document.paths['/api/things'].get['x-overlord-permission'];
    rejects(document, /x-overlord-permission/);
  });

  it('refuses unsupported parameter locations and media types', () => {
    const cookie = documentWith();
    cookie.paths['/api/things'].get.parameters = [
      { name: 's', in: 'cookie', required: false, schema: { type: 'string' } }
    ];
    rejects(cookie, /parameter location/);
    const xml = documentWith();
    xml.paths['/api/things'].get.responses[200].content = {
      'application/xml': { schema: { type: 'string' } }
    };
    rejects(xml, /unsupported media type application\/xml/);
  });
});

describe('fails loudly on what it does not understand', () => {
  const cases = [
    ['a keyword outside the subset', { type: 'string', pattern: '^a' }, /unsupported keyword `pattern`/],
    ['an unknown format', { type: 'string', format: 'email' }, /unsupported format/],
    ['a type array', { type: ['string', 'null'] }, /unsupported type/],
    ['a schema written as a string', { type: 'object', properties: { a: '{ type: string }' } }, /must be an object/],
    ['a required member that is not a property', { type: 'object', required: ['b'], properties: { a: { type: 'string' } } }, /not a property/],
    ['a reference to an unknown schema', { $ref: '#/components/schemas/Missing' }, /unknown schema Missing/],
    ['a reference outside components.schemas', { $ref: 'other.yaml#/X' }, /unsupported reference/],
    ['an enum value of the wrong type', { type: 'string', enum: ['a', 1] }, /does not match type/],
    ['a not', { not: { type: 'string' } }, /unsupported keyword `not`/],
    ['an array without items', { type: 'array' }, /needs `items`/]
  ];
  for (const [label, schema, pattern] of cases) {
    it(label, () => rejects(documentWith({ schemas: { Bad: schema } }), pattern));
  }

  it('never emits z.any()', () => {
    const document = parse(readFileSync(path.join(repoRoot, OPENAPI_PATH), 'utf8'));
    assert.doesNotMatch(renderApiContract(document), /z\.any\(/);
  });
});

describe('reference cycles', () => {
  it('breaks a cycle with z.lazy', async () => {
    const { module, source } = await load(
      documentWith({
        schemas: {
          Node: {
            type: 'object',
            required: ['children'],
            properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } }
          }
        }
      })
    );
    assert.match(source, /z\.lazy\(\(\) => nodeSchema\)/);
    assert.equal(module.nodeSchema.safeParse({ children: [{ children: [] }] }).success, true);
  });
});

describe('the contract description', () => {
  it('renders, and the committed module is current', () => {
    const document = parse(readFileSync(path.join(repoRoot, OPENAPI_PATH), 'utf8'));
    const committed = readFileSync(
      path.join(repoRoot, 'packages/contract/src/generated/api.ts'),
      'utf8'
    );
    assert.equal(renderApiContract(document), committed);
  });
});
