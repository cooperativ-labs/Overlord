#!/usr/bin/env node

// Generates packages/contract/src/generated/api.ts from contract/api/openapi.yaml
// (ADR 0006: the description is the source of truth; types and validators are
// generated from it). `yarn api:generate` writes the module; `--check` (part of
// `yarn api:generate:check`) fails when the committed module is stale.
//
// The module holds, for every components.schemas entry, a TypeScript type with
// the schema's name and a Zod v4 schema `<name>Schema` annotated as
// `z.ZodType<Name>`, so the compiler proves that the schema's inferred output is
// the type. It also holds an operation table keyed by operationId (method, path,
// parameter schemas by location, request bodies and responses by media type and
// status, permission, edition, consumers, extension and security) and the
// `contractVersion` / `apiVersion` constants.
//
// The generator understands a fixed subset of OpenAPI 3.1 / JSON Schema
// (contract/api/README.md "Generator subset"). Anything outside it fails the run
// with the location of the construct: it never renders an unknown construct as an
// unchecked `z.any()`. Bodies that are not JSON (binary uploads and downloads,
// text pages, Server-Sent Events) and responses without a body (204, redirects)
// appear in the operation table as typed descriptors.
//
// `format: uuid` and `format: date-time` render leniently by default (a plain
// string), because the backend's own fixtures use readable ids and SQLite
// timestamps are stored as written (ADR 0050). `--strict-formats` renders them as
// `z.uuid()` and `z.iso.datetime({ offset: true })`; with `--out <file>` it writes
// a strict variant elsewhere without touching the committed module.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import { CONTRACT_VERSION_EXTENSION, isStrictSemver } from './version-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OPENAPI_PATH = 'contract/api/openapi.yaml';
export const OUTPUT_PATH = 'packages/contract/src/generated/api.ts';

export class ApiContractGenerationError extends Error {}

function fail(at, message) {
  throw new ApiContractGenerationError(`API contract generation failed at ${at}: ${message}`);
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const ANNOTATIONS = ['description', 'title', 'deprecated', 'example', 'examples'];
const KEYWORDS_BY_TYPE = {
  string: ['enum', 'const', 'format', 'minLength', 'maxLength', 'contentMediaType'],
  integer: ['enum', 'const', 'minimum', 'maximum'],
  number: ['enum', 'const', 'minimum', 'maximum'],
  boolean: ['enum', 'const'],
  null: [],
  array: ['items', 'minItems', 'maxItems', 'uniqueItems'],
  object: ['properties', 'required', 'additionalProperties']
};
const STRING_FORMATS = ['uuid', 'date-time'];
const JSON_MEDIA_TYPES = ['application/json'];
const FORM_MEDIA_TYPES = ['application/x-www-form-urlencoded'];
const TEXT_MEDIA_TYPES = ['text/plain', 'text/html', 'text/csv'];
const EVENT_STREAM_MEDIA_TYPES = ['text/event-stream'];
const BINARY_MEDIA_TYPES = ['*/*', 'application/octet-stream'];
const OPERATION_KEYS = [
  'operationId',
  'tags',
  'summary',
  'description',
  'security',
  'parameters',
  'requestBody',
  'responses',
  'deprecated',
  'x-overlord-permission',
  'x-overlord-permission-candidates',
  'x-overlord-edition',
  'x-overlord-consumers',
  'x-overlord-extension'
];
const PARAMETER_KEYS = ['name', 'in', 'required', 'description', 'schema', 'deprecated'];
const PARAMETER_LOCATIONS = ['path', 'query', 'header'];
const REQUEST_BODY_KEYS = ['required', 'description', 'content'];
const RESPONSE_KEYS = ['description', 'headers', 'content'];
const HEADER_KEYS = ['description', 'schema', 'required'];
const MEDIA_KEYS = ['schema'];
const SCHEMA_REF_PREFIX = '#/components/schemas/';
const RESPONSE_REF_PREFIX = '#/components/responses/';
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function onlyKeys(value, allowed, at) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(at, `unsupported keyword \`${key}\``);
  }
}

export function schemaIdentifier(name) {
  return `${name[0].toLowerCase()}${name.slice(1)}Schema`;
}

function shapeIdentifier(name) {
  return `${name[0].toLowerCase()}${name.slice(1)}Shape`;
}

function pascal(name) {
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

function literal(value) {
  return JSON.stringify(value);
}

function propertyKey(name) {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function refName(reference, at) {
  if (typeof reference !== 'string' || !reference.startsWith(SCHEMA_REF_PREFIX)) {
    fail(at, `unsupported reference ${JSON.stringify(reference)}`);
  }
  return reference.slice(SCHEMA_REF_PREFIX.length);
}

function docComment(lines, indent) {
  const text = lines.filter(line => typeof line === 'string' && line.trim() !== '');
  if (text.length === 0) return '';
  const body = text
    .join('\n')
    .replaceAll('*/', '*\\/')
    .split('\n')
    .map(line => `${indent} *${line.length > 0 ? ` ${line.trimEnd()}` : ''}`);
  return `${indent}/**\n${body.join('\n')}\n${indent} */\n`;
}

function schemaDoc(schema, indent) {
  if (!isObject(schema)) return '';
  return docComment(
    [schema.description, schema.deprecated === true ? '@deprecated' : undefined],
    indent
  );
}

/**
 * Classifies a schema and checks that it uses only understood keywords. Returns
 * one of: ref, oneOf, anyOf, allOf, any, const, enum, or a JSON type name.
 */
export function classifySchema(schema, at) {
  if (!isObject(schema)) fail(at, 'a schema must be an object');
  if ('$ref' in schema) {
    onlyKeys(schema, ['$ref', ...ANNOTATIONS], at);
    return 'ref';
  }
  if ('oneOf' in schema) {
    onlyKeys(schema, ['oneOf', ...ANNOTATIONS], at);
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) {
      fail(at, '`oneOf` needs at least two members');
    }
    return 'oneOf';
  }
  if ('anyOf' in schema) {
    onlyKeys(schema, ['anyOf', ...ANNOTATIONS], at);
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length < 2) {
      fail(at, '`anyOf` needs at least two members');
    }
    return 'anyOf';
  }
  if ('allOf' in schema) {
    onlyKeys(schema, ['allOf', ...ANNOTATIONS], at);
    if (!Array.isArray(schema.allOf) || schema.allOf.length < 2) {
      fail(at, '`allOf` needs at least two members');
    }
    return 'allOf';
  }
  if ('type' in schema) {
    const { type } = schema;
    if (typeof type !== 'string' || !(type in KEYWORDS_BY_TYPE)) {
      fail(at, `unsupported type ${JSON.stringify(type)}`);
    }
    onlyKeys(schema, ['type', ...ANNOTATIONS, ...KEYWORDS_BY_TYPE[type]], at);
    if ('format' in schema && !STRING_FORMATS.includes(schema.format)) {
      fail(at, `unsupported format ${JSON.stringify(schema.format)}`);
    }
    if ('contentMediaType' in schema && ('enum' in schema || 'const' in schema)) {
      fail(at, '`contentMediaType` cannot be combined with `enum` or `const`');
    }
    if ('enum' in schema) checkEnum(schema.enum, type, at);
    if ('const' in schema) checkLiteral(schema.const, type, at);
    for (const bound of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (bound in schema && typeof schema[bound] !== 'number') {
        fail(at, `\`${bound}\` must be a number`);
      }
    }
    for (const bound of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (bound in schema && !Number.isInteger(schema[bound])) {
        fail(at, `\`${bound}\` must be an integer`);
      }
    }
    if ('uniqueItems' in schema && typeof schema.uniqueItems !== 'boolean') {
      fail(at, '`uniqueItems` must be a boolean');
    }
    if (type === 'array' && !isObject(schema.items)) fail(at, 'an array needs `items`');
    return type;
  }
  if ('const' in schema) {
    onlyKeys(schema, ['const', ...ANNOTATIONS], at);
    checkLiteral(schema.const, undefined, at);
    return 'const';
  }
  if ('enum' in schema) {
    onlyKeys(schema, ['enum', ...ANNOTATIONS], at);
    checkEnum(schema.enum, undefined, at);
    return 'enum';
  }
  // A schema with annotations only accepts any JSON value (G1, `JsonValue`).
  onlyKeys(schema, ANNOTATIONS, at);
  return 'any';
}

function checkLiteral(value, type, at) {
  const kind = value === null ? 'null' : typeof value;
  if (!['string', 'number', 'boolean', 'null'].includes(kind)) {
    fail(at, `unsupported literal ${JSON.stringify(value)}`);
  }
  if (type === undefined) return;
  const matches =
    (type === 'string' && kind === 'string') ||
    (type === 'boolean' && kind === 'boolean') ||
    (type === 'number' && kind === 'number') ||
    (type === 'integer' && kind === 'number' && Number.isInteger(value)) ||
    (type === 'null' && kind === 'null');
  if (!matches) fail(at, `literal ${JSON.stringify(value)} does not match type ${type}`);
}

function checkEnum(values, type, at) {
  if (!Array.isArray(values) || values.length === 0) fail(at, '`enum` must be a non-empty array');
  for (const value of values) checkLiteral(value, type, at);
  if (new Set(values).size !== values.length) fail(at, '`enum` has duplicate values');
}

function literalsOf(schema) {
  if ('const' in schema) return [schema.const];
  if ('enum' in schema) return schema.enum;
  return null;
}

// ---- Zod rendering --------------------------------------------------------

class Renderer {
  constructor(document, options) {
    this.document = document;
    this.components = document.components?.schemas ?? {};
    this.strictFormats = options.strictFormats === true;
    this.declared = new Set();
    this.shapes = new Set();
  }

  component(name, at) {
    const schema = this.components[name];
    if (!isObject(schema)) fail(at, `reference to unknown schema ${name}`);
    return schema;
  }

  /** Follows references to the schema they name. */
  resolve(schema, at) {
    let current = schema;
    const seen = new Set();
    while (isObject(current) && '$ref' in current) {
      const name = refName(current.$ref, at);
      if (seen.has(name)) fail(at, `reference cycle through ${name}`);
      seen.add(name);
      current = this.component(name, at);
    }
    return current;
  }

  zod(schema, at) {
    const kind = classifySchema(schema, at);
    switch (kind) {
      case 'ref': {
        const name = refName(schema.$ref, at);
        this.component(name, at);
        const id = schemaIdentifier(name);
        return this.declared.has(name) ? id : `z.lazy(() => ${id})`;
      }
      case 'oneOf':
        return this.zodOneOf(schema, at);
      case 'anyOf':
        // Any member may match; z.union accepts exactly the values anyOf accepts
        // and parses with the first member that matches, in document order.
        return `z.union([${schema.anyOf
          .map((member, index) => this.zod(member, `${at}.anyOf[${index}]`))
          .join(', ')}])`;
      case 'allOf':
        return `z.object(${this.allOfShape(schema, at)})`;
      case 'any':
        return 'z.unknown()';
      case 'const':
        return `z.literal(${literal(schema.const)})`;
      case 'enum':
        return this.zodEnum(schema.enum);
      case 'null':
        return 'z.null()';
      case 'boolean':
        return 'const' in schema ? `z.literal(${literal(schema.const)})` : 'z.boolean()';
      case 'string':
        return this.zodString(schema);
      case 'integer':
      case 'number':
        return this.zodNumber(schema, kind);
      case 'array':
        return this.zodArray(schema, at);
      case 'object':
        return this.zodObject(schema, at);
      default:
        return fail(at, `unhandled schema kind ${kind}`);
    }
  }

  zodEnum(values) {
    if (values.every(value => typeof value === 'string')) {
      return `z.enum([${values.map(literal).join(', ')}])`;
    }
    return values.length === 1
      ? `z.literal(${literal(values[0])})`
      : `z.literal([${values.map(literal).join(', ')}])`;
  }

  zodString(schema) {
    if ('contentMediaType' in schema) return 'binaryBodySchema';
    if ('const' in schema) return `z.literal(${literal(schema.const)})`;
    if ('enum' in schema) return this.zodEnum(schema.enum);
    let rendered = 'z.string()';
    if (this.strictFormats && schema.format === 'uuid') rendered = 'z.uuid()';
    if (this.strictFormats && schema.format === 'date-time') {
      rendered = 'z.iso.datetime({ offset: true })';
    }
    if (typeof schema.minLength === 'number') rendered += `.min(${schema.minLength})`;
    if (typeof schema.maxLength === 'number') rendered += `.max(${schema.maxLength})`;
    return rendered;
  }

  zodNumber(schema, type) {
    if ('const' in schema) return `z.literal(${literal(schema.const)})`;
    if ('enum' in schema) return this.zodEnum(schema.enum);
    let rendered = type === 'integer' ? 'z.int()' : 'z.number()';
    if (typeof schema.minimum === 'number') rendered += `.min(${schema.minimum})`;
    if (typeof schema.maximum === 'number') rendered += `.max(${schema.maximum})`;
    return rendered;
  }

  zodArray(schema, at) {
    let rendered = `z.array(${this.zod(schema.items, `${at}.items`)})`;
    if (typeof schema.minItems === 'number') rendered += `.min(${schema.minItems})`;
    if (typeof schema.maxItems === 'number') rendered += `.max(${schema.maxItems})`;
    if (schema.uniqueItems === true) {
      rendered += ".refine(hasUniqueItems, { error: 'Expected unique items' })";
    }
    return rendered;
  }

  properties(schema, at) {
    const properties = schema.properties ?? {};
    if (!isObject(properties)) fail(at, '`properties` must be an object');
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some(key => typeof key !== 'string')) {
      fail(at, '`required` must be an array of property names');
    }
    for (const key of required) {
      if (!(key in properties)) fail(at, `\`required\` names ${key}, which is not a property`);
    }
    return { properties, required: new Set(required) };
  }

  shapeEntries(schema, at) {
    const { properties, required } = this.properties(schema, at);
    return Object.entries(properties).map(([key, property]) => {
      const rendered = this.zod(property, `${at}.properties.${key}`);
      return `${literal(key)}: ${required.has(key) ? rendered : `z.exactOptional(${rendered})`}`;
    });
  }

  zodObject(schema, at) {
    const extra = schema.additionalProperties;
    const hasProperties = isObject(schema.properties) && Object.keys(schema.properties).length > 0;
    if (extra !== undefined && typeof extra !== 'boolean' && !isObject(extra)) {
      fail(at, '`additionalProperties` must be a boolean or a schema');
    }
    if (!hasProperties && 'required' in schema && schema.required.length > 0) {
      fail(at, '`required` without `properties`');
    }
    const shape = `{ ${this.shapeEntries(schema, at).join(', ')} }`;
    if (extra === false) return `z.strictObject(${shape})`;
    if (extra === true) {
      return hasProperties ? `z.looseObject(${shape})` : 'z.record(z.string(), z.unknown())';
    }
    if (isObject(extra)) {
      const value = this.zod(extra, `${at}.additionalProperties`);
      return hasProperties
        ? `z.object(${shape}).catchall(${value})`
        : `z.record(z.string(), ${value})`;
    }
    if (!hasProperties) {
      fail(at, 'an object without `properties` must say what `additionalProperties` it accepts');
    }
    return `z.object(${shape})`;
  }

  /** The members of an `allOf` as object-shape spreads (G5). */
  allOfShape(schema, at) {
    const parts = schema.allOf.map((member, index) => {
      const memberAt = `${at}.allOf[${index}]`;
      const kind = classifySchema(member, memberAt);
      if (kind === 'ref') {
        const name = refName(member.$ref, memberAt);
        const target = this.component(name, memberAt);
        this.objectLike(target, name, memberAt);
        if (!this.declared.has(name)) {
          fail(memberAt, `allOf member ${name} must be declared before it is extended`);
        }
        this.shapes.add(name);
        return `...${shapeIdentifier(name)}`;
      }
      if (kind === 'allOf') return `...${this.allOfShape(member, memberAt)}`;
      if (kind !== 'object') fail(memberAt, 'every allOf member must be an object schema');
      this.objectLike(member, 'inline member', memberAt);
      return this.shapeEntries(member, memberAt).join(', ');
    });
    return `{ ${parts.filter(part => part.length > 0).join(', ')} }`;
  }

  objectLike(schema, name, at) {
    const kind = classifySchema(schema, at);
    if (kind === 'allOf') return;
    if (kind !== 'object' || !isObject(schema.properties)) {
      fail(at, `allOf member ${name} must be an object with properties`);
    }
    if (schema.additionalProperties !== undefined) {
      fail(at, `allOf member ${name} must not restrict or type additionalProperties`);
    }
  }

  zodOneOf(schema, at) {
    const members = schema.oneOf;
    const nullIndex = members.findIndex(
      member => isObject(member) && member.type === 'null' && Object.keys(member).length === 1
    );
    if (members.length === 2 && nullIndex !== -1) {
      const other = members[1 - nullIndex];
      return `${this.zod(other, `${at}.oneOf[${1 - nullIndex}]`)}.nullable()`;
    }
    this.checkExclusive(members, at);
    const rendered = members.map((member, index) => this.zod(member, `${at}.oneOf[${index}]`));
    return `z.union([${rendered.join(', ')}])`;
  }

  // ---- oneOf exclusivity (G8, G16) ----------------------------------------

  /**
   * `oneOf` means exactly one member matches; `z.union` takes the first member
   * that does. They agree when no value can match two members, which this
   * proves pairwise: different JSON types, disjoint literal sets, a required
   * property whose literal values differ (a discriminator), or a closed member
   * that cannot hold a property the other requires.
   */
  checkExclusive(members, at) {
    const views = members.map((member, index) => this.view(member, `${at}.oneOf[${index}]`));
    for (let left = 0; left < views.length; left += 1) {
      for (let right = left + 1; right < views.length; right += 1) {
        if (!this.disjoint(views[left], views[right])) {
          fail(
            at,
            `oneOf members ${left} and ${right} can match the same value; give them a const discriminator or close them with additionalProperties: false`
          );
        }
      }
    }
  }

  view(member, at) {
    const schema = this.resolve(member, at);
    const kind = classifySchema(schema, at);
    if (kind === 'allOf') {
      const merged = { type: 'object', properties: {}, required: [], closed: false };
      for (const [index, part] of schema.allOf.entries()) {
        const partView = this.view(part, `${at}.allOf[${index}]`);
        Object.assign(merged.properties, partView.properties);
        merged.required.push(...partView.required);
      }
      return merged;
    }
    if (kind === 'oneOf' || kind === 'anyOf') {
      return { type: 'union', members: schema[kind].map(member => this.view(member, at)) };
    }
    if (kind === 'object') {
      return {
        type: 'object',
        properties: schema.properties ?? {},
        required: schema.required ?? [],
        closed: schema.additionalProperties === false
      };
    }
    if (kind === 'const' || kind === 'enum') {
      const values = literalsOf(schema);
      return { type: 'literal', values, jsonTypes: new Set(values.map(jsonType)) };
    }
    if (kind === 'any') return { type: 'any' };
    const values = literalsOf(schema);
    if (values) return { type: 'literal', values, jsonTypes: new Set(values.map(jsonType)) };
    return { type: 'primitive', jsonType: kind === 'integer' ? 'number' : kind };
  }

  disjoint(left, right) {
    if (left.type === 'any' || right.type === 'any') return false;
    if (left.type === 'union') return left.members.every(member => this.disjoint(member, right));
    if (right.type === 'union') return right.members.every(member => this.disjoint(left, member));
    const leftTypes = typesOf(left);
    const rightTypes = typesOf(right);
    if (![...leftTypes].some(type => rightTypes.has(type))) return true;
    if (left.type === 'literal' && right.type === 'literal') {
      return !left.values.some(value => right.values.includes(value));
    }
    if (left.type === 'literal' || right.type === 'literal') return false;
    if (left.type !== 'object' || right.type !== 'object') return false;
    for (const key of left.required) {
      if (!right.required.includes(key)) continue;
      const leftValues = this.literalValues(left.properties[key]);
      const rightValues = this.literalValues(right.properties[key]);
      if (leftValues && rightValues && !leftValues.some(value => rightValues.includes(value))) {
        return true;
      }
    }
    if (left.closed && right.required.some(key => !(key in left.properties))) return true;
    if (right.closed && left.required.some(key => !(key in right.properties))) return true;
    return false;
  }

  literalValues(schema) {
    if (!isObject(schema)) return null;
    const resolved = this.resolve(schema, 'discriminator');
    return isObject(resolved) ? literalsOf(resolved) : null;
  }

  // ---- TypeScript rendering -------------------------------------------------

  ts(schema, at, indent = '') {
    const kind = classifySchema(schema, at);
    switch (kind) {
      case 'ref':
        return refName(schema.$ref, at);
      case 'oneOf':
      case 'anyOf':
        return schema[kind]
          .map((member, index) => this.tsMember(member, `${at}.${kind}[${index}]`, indent))
          .join(' | ');
      case 'allOf':
        return schema.allOf
          .map((member, index) => this.tsMember(member, `${at}.allOf[${index}]`, indent))
          .join(' & ');
      case 'any':
        return 'unknown';
      case 'const':
        return literal(schema.const);
      case 'enum':
        return schema.enum.map(literal).join(' | ');
      case 'null':
        return 'null';
      case 'boolean':
      case 'integer':
      case 'number': {
        const values = literalsOf(schema);
        if (values) return values.map(literal).join(' | ');
        return kind === 'boolean' ? 'boolean' : 'number';
      }
      case 'string': {
        if ('contentMediaType' in schema) return 'BinaryBody';
        const values = literalsOf(schema);
        return values ? values.map(literal).join(' | ') : 'string';
      }
      case 'array': {
        const item = this.ts(schema.items, `${at}.items`, indent);
        return /^[A-Za-z0-9_$]+$/.test(item) ? `${item}[]` : `Array<${item}>`;
      }
      case 'object':
        return this.tsObject(schema, at, indent);
      default:
        return fail(at, `unhandled schema kind ${kind}`);
    }
  }

  tsMember(member, at, indent) {
    const rendered = this.ts(member, at, indent);
    const kind = classifySchema(member, at);
    const compound =
      ['oneOf', 'anyOf', 'allOf', 'enum'].includes(kind) ||
      (literalsOf(member)?.length ?? 0) > 1 ||
      (kind === 'object' && member.additionalProperties !== undefined && member.properties);
    return compound ? `(${rendered})` : rendered;
  }

  tsShape(schema, at, indent) {
    const { properties, required } = this.properties(schema, at);
    const inner = `${indent}  `;
    const lines = Object.entries(properties).map(([key, property]) => {
      const type = this.ts(property, `${at}.properties.${key}`, inner);
      const optional = required.has(key) ? '' : '?';
      return `${schemaDoc(property, inner)}${inner}${propertyKey(key)}${optional}: ${type};`;
    });
    return lines.length === 0 ? '{}' : `{\n${lines.join('\n')}\n${indent}}`;
  }

  tsObject(schema, at, indent) {
    const extra = schema.additionalProperties;
    const hasProperties = isObject(schema.properties) && Object.keys(schema.properties).length > 0;
    if (extra === true) {
      return hasProperties
        ? `${this.tsShape(schema, at, indent)} & { [key: string]: unknown }`
        : '{ [key: string]: unknown }';
    }
    if (isObject(extra)) {
      const value = this.ts(extra, `${at}.additionalProperties`, indent);
      return hasProperties
        ? `${this.tsShape(schema, at, indent)} & { [key: string]: ${value} }`
        : `{ [key: string]: ${value} }`;
    }
    return this.tsShape(schema, at, indent);
  }

  /** `interface` for a plain object, otherwise a type alias. */
  tsDeclaration(name, schema, at) {
    const kind = classifySchema(schema, at);
    const doc = schemaDoc(schema, '');
    const plainObject =
      kind === 'object' &&
      (schema.additionalProperties === undefined || schema.additionalProperties === false) &&
      isObject(schema.properties);
    if (plainObject) return `${doc}export interface ${name} ${this.tsShape(schema, at, '')}`;
    return `${doc}export type ${name} = ${this.ts(schema, at, '')};`;
  }
}

function jsonType(value) {
  if (value === null) return 'null';
  return typeof value;
}

function typesOf(view) {
  if (view.type === 'literal') return view.jsonTypes;
  if (view.type === 'object') return new Set(['object']);
  if (view.type === 'primitive') return new Set([view.jsonType]);
  return new Set();
}

// ---- Component ordering -----------------------------------------------------

function collectRefs(schema, out, hard = false) {
  if (Array.isArray(schema)) {
    for (const item of schema) collectRefs(item, out, hard);
    return;
  }
  if (!isObject(schema)) return;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith(SCHEMA_REF_PREFIX)) {
    out.push({ name: schema.$ref.slice(SCHEMA_REF_PREFIX.length), hard });
  }
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'allOf' && Array.isArray(value)) {
      for (const member of value) {
        if (isObject(member) && typeof member.$ref === 'string') collectRefs(member, out, true);
        else collectRefs(member, out, hard);
      }
    } else if (key !== '$ref' && (isObject(value) || Array.isArray(value))) {
      collectRefs(value, out, false);
    }
  }
}

/**
 * Component names in declaration order: every schema after the schemas it
 * references, except across a reference cycle, where the back reference
 * becomes `z.lazy`. An `allOf` base must always come first, since its shape is
 * spread when the extending schema is built.
 */
export function componentOrder(schemas) {
  const order = [];
  const state = new Map();
  const visit = (name, from) => {
    if (!isObject(schemas[name])) fail(from, `reference to unknown schema ${name}`);
    const current = state.get(name);
    if (current === 'done') return;
    if (current === 'active') return;
    state.set(name, 'active');
    const refs = [];
    collectRefs(schemas[name], refs);
    for (const ref of refs) {
      if (ref.hard && state.get(ref.name) === 'active') {
        fail(`components.schemas.${name}`, `allOf member ${ref.name} is part of a reference cycle`);
      }
      visit(ref.name, `components.schemas.${name}`);
    }
    state.set(name, 'done');
    order.push(name);
  };
  for (const name of Object.keys(schemas)) visit(name, 'components.schemas');
  return order;
}

// ---- Operations ---------------------------------------------------------------

function mediaKind(mediaType, schema, renderer, at) {
  if (JSON_MEDIA_TYPES.includes(mediaType)) return 'json';
  if (FORM_MEDIA_TYPES.includes(mediaType)) return 'form';
  if (TEXT_MEDIA_TYPES.includes(mediaType)) return 'text';
  if (EVENT_STREAM_MEDIA_TYPES.includes(mediaType)) return 'event-stream';
  if (BINARY_MEDIA_TYPES.includes(mediaType)) {
    const resolved = renderer.resolve(schema, at);
    if (!(isObject(resolved) && resolved.type === 'string' && 'contentMediaType' in resolved)) {
      fail(at, `a ${mediaType} body must be a string schema with contentMediaType`);
    }
    return 'binary';
  }
  return fail(at, `unsupported media type ${mediaType}`);
}

class OperationRenderer {
  constructor(renderer, componentNames) {
    this.renderer = renderer;
    this.reserved = new Set(componentNames);
    this.declarations = [];
  }

  /** A schema reference, or a named declaration for an inline schema. */
  schemaReference(schema, at, typeName) {
    const kind = classifySchema(schema, at);
    if (kind === 'ref') {
      const name = refName(schema.$ref, at);
      this.renderer.component(name, at);
      return schemaIdentifier(name);
    }
    if (this.reserved.has(typeName)) fail(at, `generated name ${typeName} collides`);
    this.reserved.add(typeName);
    const declaration = this.renderer.tsDeclaration(typeName, schema, at);
    const zod = this.renderer.zod(schema, at);
    const id = schemaIdentifier(typeName);
    this.declarations.push(
      `${declaration}\nexport const ${id}: z.ZodType<${typeName}> = ${zod};`
    );
    return id;
  }

  content(content, at, typePrefix) {
    if (!isObject(content) || Object.keys(content).length === 0) {
      fail(at, '`content` must name at least one media type');
    }
    const entries = Object.entries(content).map(([mediaType, media]) => {
      const mediaAt = `${at}.content[${mediaType}]`;
      if (!isObject(media)) fail(mediaAt, 'a media type object is required');
      onlyKeys(media, MEDIA_KEYS, mediaAt);
      if (!isObject(media.schema)) fail(mediaAt, 'a media type needs a schema');
      const kind = mediaKind(mediaType, media.schema, this.renderer, mediaAt);
      const suffix = { json: '', form: 'Form', text: 'Text', 'event-stream': 'Event', binary: 'Binary' }[
        kind
      ];
      const schema = this.schemaReference(media.schema, mediaAt, `${typePrefix}${suffix}`);
      const field = kind === 'event-stream' ? 'event' : 'schema';
      return `${literal(mediaType)}: { kind: ${literal(kind)}, ${field}: ${schema} }`;
    });
    return `{ ${entries.join(', ')} }`;
  }

  headers(headers, at) {
    if (headers === undefined) return '[]';
    if (!isObject(headers)) fail(at, '`headers` must be an object');
    for (const [name, header] of Object.entries(headers)) {
      if (!isObject(header)) fail(`${at}.${name}`, 'a header object is required');
      onlyKeys(header, HEADER_KEYS, `${at}.${name}`);
      if (header.schema !== undefined) classifySchema(header.schema, `${at}.${name}.schema`);
    }
    return `[${Object.keys(headers).map(literal).join(', ')}]`;
  }

  response(response, at, typePrefix) {
    if (!isObject(response)) fail(at, 'a response object is required');
    onlyKeys(response, RESPONSE_KEYS, at);
    const headers = this.headers(response.headers, `${at}.headers`);
    const content =
      response.content === undefined ? '{}' : this.content(response.content, at, typePrefix);
    return `{ headers: ${headers}, content: ${content} }`;
  }

  parameters(pathItem, operation, at) {
    const byKey = new Map();
    for (const [source, list] of [
      ['path item', pathItem.parameters],
      ['operation', operation.parameters]
    ]) {
      if (list === undefined) continue;
      if (!Array.isArray(list)) fail(at, `${source} \`parameters\` must be an array`);
      for (const parameter of list) {
        const name = parameter?.name;
        const parameterAt = `${at}.parameters[${name}]`;
        if (!isObject(parameter)) fail(parameterAt, 'a parameter object is required');
        onlyKeys(parameter, PARAMETER_KEYS, parameterAt);
        if (typeof name !== 'string') fail(parameterAt, 'a parameter needs a name');
        if (!PARAMETER_LOCATIONS.includes(parameter.in)) {
          fail(parameterAt, `unsupported parameter location ${JSON.stringify(parameter.in)}`);
        }
        if (parameter.in === 'path' && parameter.required !== true) {
          fail(parameterAt, 'a path parameter must be required');
        }
        if (!isObject(parameter.schema)) fail(parameterAt, 'a parameter needs a schema');
        const key = parameter.in === 'header' ? name.toLowerCase() : name;
        byKey.set(`${parameter.in}:${key}`, { ...parameter, key });
      }
    }
    return byKey;
  }

  parameterSchemas(parameters, operationId, at) {
    const rendered = {};
    for (const location of PARAMETER_LOCATIONS) {
      const list = [...parameters.values()].filter(parameter => parameter.in === location);
      if (list.length === 0) {
        rendered[location] = 'null';
        continue;
      }
      const suffix = { path: 'PathParams', query: 'QueryParams', header: 'HeaderParams' }[location];
      const schema = {
        type: 'object',
        properties: Object.fromEntries(
          list.map(parameter => [
            parameter.key,
            parameter.description && !parameter.schema.description
              ? { ...parameter.schema, description: parameter.description }
              : parameter.schema
          ])
        ),
        required: list.filter(parameter => parameter.required === true).map(p => p.key)
      };
      rendered[location] = this.schemaReference(
        schema,
        `${at}.parameters.${location}`,
        `${pascal(operationId)}${suffix}`
      );
    }
    return `{ path: ${rendered.path}, query: ${rendered.query}, header: ${rendered.header} }`;
  }

  requestBody(requestBody, operationId, at) {
    if (requestBody === undefined) return 'null';
    if (!isObject(requestBody)) fail(at, 'a request body object is required');
    onlyKeys(requestBody, REQUEST_BODY_KEYS, at);
    const content = this.content(requestBody.content, at, `${pascal(operationId)}RequestBody`);
    return `{ required: ${requestBody.required === true}, content: ${content} }`;
  }

  responses(responses, operationId, at, componentResponses) {
    if (!isObject(responses) || Object.keys(responses).length === 0) {
      fail(at, 'an operation needs responses');
    }
    const entries = Object.entries(responses).map(([status, response]) => {
      const statusAt = `${at}.${status}`;
      if (!/^[1-5][0-9][0-9]$/.test(status)) fail(statusAt, `unsupported status ${status}`);
      if (isObject(response) && '$ref' in response) {
        onlyKeys(response, ['$ref'], statusAt);
        if (
          typeof response.$ref !== 'string' ||
          !response.$ref.startsWith(RESPONSE_REF_PREFIX) ||
          !componentResponses.has(response.$ref.slice(RESPONSE_REF_PREFIX.length))
        ) {
          fail(statusAt, `unsupported response reference ${JSON.stringify(response.$ref)}`);
        }
        return `${literal(status)}: apiResponses.${response.$ref.slice(RESPONSE_REF_PREFIX.length)}`;
      }
      return `${literal(status)}: ${this.response(
        response,
        statusAt,
        `${pascal(operationId)}Response${status}`
      )}`;
    });
    return `{ ${entries.join(', ')} }`;
  }
}

function stringList(value, at, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    fail(at, 'must be an array of strings');
  }
  return value;
}

function securityRequirements(security, at) {
  if (!Array.isArray(security)) fail(at, 'every operation must declare `security`');
  return security.map((requirement, index) => {
    if (!isObject(requirement)) fail(`${at}[${index}]`, 'a security requirement is an object');
    for (const [scheme, scopes] of Object.entries(requirement)) {
      stringList(scopes, `${at}[${index}].${scheme}`);
    }
    return requirement;
  });
}

function componentResponseDeclarations(document, operations) {
  const responses = document.components?.responses ?? {};
  if (!isObject(responses)) fail('components.responses', 'must be an object');
  const entries = Object.entries(responses).map(([name, response]) => {
    if (!IDENTIFIER.test(name)) fail(`components.responses.${name}`, 'unsupported response name');
    return `  ${name}: ${operations.response(response, `components.responses.${name}`, `${name}Response`)}`;
  });
  return { names: new Set(Object.keys(responses)), entries };
}

// ---- Module ---------------------------------------------------------------------

const PRELUDE = `/** A non-JSON request or response body: raw bytes (G3). */
export type BinaryBody = Uint8Array | ArrayBuffer | Blob;

function isBinaryBody(value: unknown): value is BinaryBody {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  );
}

function hasUniqueItems(items: readonly unknown[]): boolean {
  return new Set(items.map(item => JSON.stringify(item))).size === items.length;
}

/** Raw bytes: the schema of every \`contentMediaType\` string (uploads and downloads). */
export const binaryBodySchema: z.ZodType<BinaryBody> = z.custom<BinaryBody>(isBinaryBody, {
  error: 'Expected a binary body'
});`;

const DESCRIPTOR_TYPES = `/**
 * How a body is carried. \`json\` and \`form\` bodies are parsed into \`schema\`;
 * \`text\` bodies are strings; \`event-stream\` responses are Server-Sent Events
 * whose \`data\` is \`event\`; \`binary\` bodies are raw bytes.
 */
export type ApiMediaDescriptor =
  | { readonly kind: 'json' | 'form' | 'text' | 'binary'; readonly schema: z.ZodType }
  | { readonly kind: 'event-stream'; readonly event: z.ZodType };

/** A response: its header names and its bodies by media type (none for 204 or a redirect). */
export interface ApiResponseDescriptor {
  readonly headers: readonly string[];
  readonly content: { readonly [mediaType: string]: ApiMediaDescriptor };
}

/** One operation of the REST surface (ADRs 0006, 0048). */
export interface ApiOperationDescriptor {
  readonly operationId: string;
  readonly method: 'GET' | 'PUT' | 'POST' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'PATCH' | 'TRACE';
  readonly path: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  readonly permission: string;
  readonly permissionCandidates: readonly string[];
  readonly edition: string;
  readonly consumers: readonly string[];
  readonly extension: string | null;
  /** Alternative requirements; an empty object means the operation also runs unauthenticated. */
  readonly security: readonly { readonly [scheme: string]: readonly string[] }[];
  /** Parameter schemas by location; header names are lower case. */
  readonly parameters: {
    readonly path: z.ZodType | null;
    readonly query: z.ZodType | null;
    readonly header: z.ZodType | null;
  };
  readonly requestBody: {
    readonly required: boolean;
    readonly content: { readonly [mediaType: string]: ApiMediaDescriptor };
  } | null;
  readonly responses: { readonly [status: string]: ApiResponseDescriptor };
}`;

export function renderApiContract(document, options = {}) {
  if (!isObject(document)) fail('document', 'the OpenAPI document must be an object');
  const contractVersion = document.info?.[CONTRACT_VERSION_EXTENSION];
  if (!isStrictSemver(contractVersion)) {
    fail(`info.${CONTRACT_VERSION_EXTENSION}`, `not a strict Semantic Version: ${contractVersion}`);
  }
  const apiVersion = document.info?.version;
  if (!isStrictSemver(apiVersion)) fail('info.version', `not a strict Semantic Version: ${apiVersion}`);
  const schemas = document.components?.schemas;
  if (!isObject(schemas) || Object.keys(schemas).length === 0) {
    fail('components.schemas', 'at least one schema is required');
  }
  for (const name of Object.keys(schemas)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      fail(`components.schemas.${name}`, 'schema names must be PascalCase identifiers');
    }
  }
  const renderer = new Renderer(document, options);
  const order = componentOrder(schemas);

  // Bases of an allOf need their shape as a value; find them first.
  for (const name of order) {
    const refs = [];
    collectRefs(schemas[name], refs);
    for (const ref of refs) if (ref.hard) renderer.shapes.add(ref.name);
  }

  const componentBlocks = [];
  for (const name of order) {
    const schema = schemas[name];
    const at = `components.schemas.${name}`;
    const kind = classifySchema(schema, at);
    const id = schemaIdentifier(name);
    const declaration = renderer.tsDeclaration(name, schema, at);
    let value;
    if (renderer.shapes.has(name)) {
      const shapeId = shapeIdentifier(name);
      if (kind === 'allOf') {
        value = `const ${shapeId} = ${renderer.allOfShape(schema, at)};\nexport const ${id}: z.ZodType<${name}> = z.object(${shapeId});`;
      } else {
        renderer.objectLike(schema, name, at);
        value = `const ${shapeId} = { ${renderer.shapeEntries(schema, at).join(', ')} };\nexport const ${id}: z.ZodType<${name}> = z.object(${shapeId});`;
      }
    } else {
      value = `export const ${id}: z.ZodType<${name}> = ${renderer.zod(schema, at)};`;
    }
    renderer.declared.add(name);
    componentBlocks.push(`${declaration}\n${value}`);
  }

  const operations = new OperationRenderer(renderer, Object.keys(schemas));
  const responses = componentResponseDeclarations(document, operations);
  const operationEntries = [];
  const seenIds = new Set();
  if (!isObject(document.paths) || Object.keys(document.paths).length === 0) {
    fail('paths', 'at least one path is required');
  }
  for (const [route, pathItem] of Object.entries(document.paths)) {
    const pathAt = `paths.${route}`;
    if (!isObject(pathItem)) fail(pathAt, 'a path item object is required');
    onlyKeys(pathItem, [...HTTP_METHODS, 'parameters', 'summary', 'description'], pathAt);
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      const at = `${method.toUpperCase()} ${route}`;
      if (!isObject(operation)) fail(at, 'an operation object is required');
      onlyKeys(operation, OPERATION_KEYS, at);
      const { operationId } = operation;
      if (typeof operationId !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(operationId)) {
        fail(at, 'every operation needs a lowerCamelCase operationId');
      }
      if (seenIds.has(operationId)) fail(at, `duplicate operationId ${operationId}`);
      seenIds.add(operationId);
      const permission = operation['x-overlord-permission'];
      const edition = operation['x-overlord-edition'];
      if (typeof permission !== 'string') fail(at, '`x-overlord-permission` is required');
      if (typeof edition !== 'string') fail(at, '`x-overlord-edition` is required');
      const consumers = stringList(operation['x-overlord-consumers'], `${at}.x-overlord-consumers`);
      const candidates = stringList(
        operation['x-overlord-permission-candidates'],
        `${at}.x-overlord-permission-candidates`,
        { optional: true }
      );
      const tags = stringList(operation.tags, `${at}.tags`, { optional: true });
      const extension = operation['x-overlord-extension'];
      if (extension !== undefined && typeof extension !== 'string') {
        fail(at, '`x-overlord-extension` must be a string');
      }
      if (operation.deprecated !== undefined && typeof operation.deprecated !== 'boolean') {
        fail(at, '`deprecated` must be a boolean');
      }
      const security = securityRequirements(operation.security, `${at}.security`);
      const parameters = operations.parameterSchemas(
        operations.parameters(pathItem, operation, at),
        operationId,
        at
      );
      const requestBody = operations.requestBody(operation.requestBody, operationId, `${at}.requestBody`);
      const responseMap = operations.responses(
        operation.responses,
        operationId,
        `${at}.responses`,
        responses.names
      );
      const doc = docComment(
        [
          `${method.toUpperCase()} ${route}${operation.summary ? `: ${operation.summary}` : ''}`,
          operation.deprecated === true ? '@deprecated' : undefined
        ],
        '  '
      );
      operationEntries.push(
        [
          `${doc}  ${operationId}: {`,
          `    operationId: ${literal(operationId)},`,
          `    method: ${literal(method.toUpperCase())},`,
          `    path: ${literal(route)},`,
          `    tags: ${literal(tags)},`,
          `    deprecated: ${operation.deprecated === true},`,
          `    permission: ${literal(permission)},`,
          `    permissionCandidates: ${literal(candidates)},`,
          `    edition: ${literal(edition)},`,
          `    consumers: ${literal(consumers)},`,
          `    extension: ${extension === undefined ? 'null' : literal(extension)},`,
          `    security: ${literal(security)},`,
          `    parameters: ${parameters},`,
          `    requestBody: ${requestBody},`,
          `    responses: ${responseMap}`,
          '  }'
        ].join('\n')
      );
    }
  }

  const strictness = renderer.strictFormats
    ? 'Strict formats: `format: uuid` and `format: date-time` are validated.'
    : 'Lenient formats (default): `format: uuid` and `format: date-time` accept any string (ADR 0050).';
  return [
    `// Generated from ${OPENAPI_PATH} by scripts/generate-api-contract.mjs (\`yarn api:generate\`).`,
    '// Do not edit by hand: change the OpenAPI description and regenerate.',
    `// ${strictness}`,
    '/* eslint-disable */',
    "import { z } from 'zod';",
    '',
    `/** The contract version (contract/VERSION) this API description belongs to. */`,
    `export const contractVersion = ${literal(contractVersion)};`,
    '',
    '/** The API description\'s own version (OpenAPI `info.version`). */',
    `export const apiVersion = ${literal(apiVersion)};`,
    '',
    PRELUDE,
    '',
    '// ---- Component schemas ----',
    '',
    componentBlocks.join('\n\n'),
    '',
    '// ---- Operation schemas ----',
    '',
    DESCRIPTOR_TYPES,
    '',
    operations.declarations.join('\n\n'),
    '',
    '/** Shared responses (components.responses). */',
    'export const apiResponses = {',
    responses.entries.join(',\n'),
    '} as const satisfies { readonly [name: string]: ApiResponseDescriptor };',
    '',
    '/** Every operation of the REST surface, keyed by operationId. */',
    'export const apiOperations = {',
    operationEntries.join(',\n'),
    '} as const satisfies { readonly [operationId: string]: ApiOperationDescriptor };',
    '',
    'export type ApiOperations = typeof apiOperations;',
    'export type ApiOperationId = keyof ApiOperations;',
    ''
  ].join('\n');
}

function parseArguments(argv) {
  const options = { check: false, strictFormats: false, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--strict-formats') options.strictFormats = true;
    else if (argument === '--out') options.out = argv[(index += 1)];
    else throw new ApiContractGenerationError(`unknown argument ${argument}`);
  }
  if (options.strictFormats && options.out === null) {
    throw new ApiContractGenerationError(
      '--strict-formats writes a variant; pass --out <file> so the committed module stays lenient'
    );
  }
  return options;
}

export async function main(argv = process.argv.slice(2), root = ROOT) {
  const options = parseArguments(argv);
  const document = parse(await readFile(path.join(root, OPENAPI_PATH), 'utf8'));
  const content = renderApiContract(document, { strictFormats: options.strictFormats });
  const target = options.out ? path.resolve(options.out) : path.join(root, OUTPUT_PATH);
  const relative = path.relative(root, target);
  if (options.check) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== content) {
      throw new ApiContractGenerationError(`${relative} is stale; run yarn api:generate`);
    }
    console.warn(`${relative} is current`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  console.warn(`generated ${relative}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error instanceof ApiContractGenerationError ? error.message : error);
    process.exitCode = 1;
  });
}
