import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GeminiCacheCreate, GeminiClient } from './gemini-client.ts';
import { GeminiStaticCache, type StaticPrefix } from './static-cache.ts';

const prefix = (description: string): StaticPrefix => ({
  systemInstruction: 'instruction',
  tools: [
    {
      functionDeclarations: [
        { name: 'read', description, parametersJsonSchema: { type: 'object' } }
      ]
    }
  ],
  toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
});
const owner = (id: string) => ({ profileId: id, organizationId: 'org' });

function fixture(options: ConstructorParameters<typeof GeminiStaticCache>[1] = {}) {
  let now = 1_000_000;
  const creates: GeminiCacheCreate[] = [];
  const deletes: string[] = [];
  const observed: { kind: string; payload: unknown }[] = [];
  const client: GeminiClient = {
    stream: async () => {
      throw new Error('unused');
    },
    generate: async () => {
      throw new Error('unused');
    },
    createCache: async request => {
      creates.push(request);
      return { name: `cachedContents/c${creates.length}` };
    },
    deleteCache: async name => {
      deletes.push(name);
    }
  };
  const cache = new GeminiStaticCache(client, { now: () => now, ...options });
  const observe = async (kind: string, payload: unknown) => {
    observed.push({ kind, payload });
  };
  return {
    cache,
    creates,
    deletes,
    observed,
    observe,
    advance: (ms: number) => (now += ms)
  };
}

describe('Gemini static-prefix cache registry', () => {
  it('is single-flight per key and keyed by owner, model and exact prefix', async () => {
    const f = fixture();
    const first = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    const concurrent = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    assert.ok(first.creation);
    assert.equal(concurrent.creation, null);
    assert.equal(concurrent.name, null);
    await first.creation;
    assert.equal(f.creates.length, 1);
    assert.equal(f.cache.use(owner('a'), 'm', prefix('x'), f.observe).name, 'cachedContents/c1');
    const keys = new Set([
      first.key,
      f.cache.key(owner('b'), 'm', prefix('x')),
      f.cache.key(owner('a'), 'n', prefix('x')),
      f.cache.key(owner('a'), 'm', prefix('y'))
    ]);
    assert.equal(keys.size, 4);
    // Object key order does not change identity; array order does.
    const reordered = {
      toolConfig: prefix('x').toolConfig,
      tools: prefix('x').tools,
      systemInstruction: 'instruction'
    };
    assert.equal(f.cache.key(owner('a'), 'm', reordered), first.key);
    assert.equal(f.observed[0]!.kind, 'provider.cache_create');
  });

  it('stops reusing within the margin before expiry and recreates after the TTL', async () => {
    const f = fixture({ ttlSeconds: 600, reuseMarginMs: 60_000 });
    await f.cache.use(owner('a'), 'm', prefix('x'), f.observe).creation;
    f.advance(539_000);
    assert.equal(f.cache.use(owner('a'), 'm', prefix('x'), f.observe).name, 'cachedContents/c1');
    f.advance(2_000); // 59 s left: inline, no new creation until the entry expires.
    const near = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    assert.equal(near.name, null);
    assert.equal(near.creation, null);
    f.advance(60_000);
    const renewed = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    assert.ok(renewed.creation);
    await renewed.creation;
    assert.equal(f.creates.length, 2);
  });

  it('deletes the owner’s oldest cache beyond the per-owner bound and never touches others', async () => {
    const f = fixture({ maxPerOwner: 2 });
    await f.cache.use(owner('b'), 'm', prefix('other'), f.observe).creation;
    for (const d of ['1', '2', '3']) {
      f.advance(1);
      await f.cache.use(owner('a'), 'm', prefix(d), f.observe).creation;
    }
    assert.deepEqual(f.deletes, ['cachedContents/c2']);
    const deleted = f.observed.find(o => o.kind === 'provider.cache_delete')!;
    assert.match(JSON.stringify(deleted.payload), /owner_bound/);
    assert.equal(
      f.cache.use(owner('b'), 'm', prefix('other'), f.observe).name,
      'cachedContents/c1'
    );
    assert.equal(f.cache.use(owner('a'), 'm', prefix('1'), f.observe).name, null);
  });

  it('skips creation when the registry is full', async () => {
    const f = fixture({ maxEntries: 1 });
    await f.cache.use(owner('a'), 'm', prefix('x'), f.observe).creation;
    const full = f.cache.use(owner('b'), 'm', prefix('x'), f.observe);
    assert.equal(full.creation, null);
    assert.equal(f.creates.length, 1);
  });

  it('does not use a cache whose creation could not be recorded', async () => {
    const f = fixture();
    const failing = async () => {
      throw new Error('thread deleted');
    };
    await f.cache.use(owner('a'), 'm', prefix('x'), failing).creation;
    assert.equal(f.creates.length, 1);
    const after = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    assert.equal(after.name, null);
    assert.equal(after.creation, null);
  });

  it('invalidation drops only the named cache', async () => {
    const f = fixture();
    const use = f.cache.use(owner('a'), 'm', prefix('x'), f.observe);
    await use.creation;
    f.cache.invalidate(use.key, 'cachedContents/other');
    assert.equal(f.cache.use(owner('a'), 'm', prefix('x'), f.observe).name, 'cachedContents/c1');
    f.cache.invalidate(use.key, 'cachedContents/c1');
    assert.ok(f.cache.use(owner('a'), 'm', prefix('x'), f.observe).creation);
  });

  it('is disabled for clients without cache operations', () => {
    const cache = new GeminiStaticCache({
      stream: async () => {
        throw new Error('unused');
      },
      generate: async () => {
        throw new Error('unused');
      }
    });
    const use = cache.use(owner('a'), 'm', prefix('x'), async () => undefined);
    assert.deepEqual([use.name, use.creation], [null, null]);
  });
});
