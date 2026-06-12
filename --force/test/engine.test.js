import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPath, renderTemplate, mapItem, passesFilters, runQuery, TRANSFORMS, stripHtml, resolveValue, buildUrl, buildHeaders, normalizeQuery, HttpError, planDelivery, dedupeKey, fetchJson } from '../src/engine.mjs';

const spec = JSON.parse(await readFile(new URL('../spec.json', import.meta.url), 'utf8'));
const fixtures = {};
for (const source of spec.sources) {
  try {
    fixtures[source.id] = JSON.parse(await readFile(new URL(`./fixtures/${source.id}.json`, import.meta.url), 'utf8'));
  } catch {
    /* fixture optional per source */
  }
}

/** fetch stub serving fixtures by source id matched on URL host. */
function fixtureFetch(url) {
  for (const source of spec.sources) {
    const host = new URL(renderTemplate(source.urlTemplate, { query: 'x' })).host;
    if (new URL(url).host === host && fixtures[source.id]) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(fixtures[source.id]) });
    }
  }
  return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
}

test('getPath walks nested paths and arrays', () => {
  assert.equal(getPath({ a: { b: [{ c: 7 }] } }, 'a.b.0.c'), 7);
  assert.equal(getPath({ a: 1 }, 'missing.path'), undefined);
});

test('renderTemplate fills and encodes placeholders', () => {
  assert.equal(renderTemplate('https://api.x.com/v1/{query}/jobs', { query: 'a b' }), 'https://api.x.com/v1/a%20b/jobs');
});

test('transforms: toIso handles epoch ms and date strings; stripHtml cleans markup', () => {
  assert.equal(TRANSFORMS.toIso(1778622524938), new Date(1778622524938).toISOString());
  assert.equal(TRANSFORMS.toIso('2026-06-02T10:00:00Z'), '2026-06-02T10:00:00.000Z');
  assert.equal(TRANSFORMS.toIso('garbage'), null);
  assert.equal(stripHtml('<div><strong>Hello</strong>&nbsp;world</div>'), 'Hello world');
});

test('every fixture maps through its source fields with citation metadata', async () => {
  for (const source of spec.sources) {
    if (!fixtures[source.id]) continue;
    const arr = getPath(fixtures[source.id], source.itemsPath);
    assert.ok(Array.isArray(arr) && arr.length > 0, `${source.id} fixture has items`);
    const item = mapItem(arr[0], source, spec, 'testco', '2026-06-10T00:00:00.000Z');
    assert.equal(item.source, source.id);
    assert.ok(item.sourceUrl.startsWith('http'));
    assert.equal(item.scrapedAt, '2026-06-10T00:00:00.000Z');
    assert.ok(item.title, `${source.id} maps a title`);
  }
});

test('every spec field path resolves in fixtures (catches typo\'d/unfaithful paths)', () => {
  // Guards against the SEC root_form class of bug: a field path that exists in no
  // fixture item is either a wrong path or an unfaithful (over-trimmed) fixture.
  for (const source of spec.sources) {
    if (!fixtures[source.id]) continue;
    const arr = getPath(fixtures[source.id], source.itemsPath);
    for (const [out, def] of Object.entries(source.fields)) {
      const fieldPath = typeof def === 'string' ? def : def.path;
      const resolvesSomewhere = arr.some((raw) => getPath(raw, fieldPath) !== undefined);
      assert.ok(resolvesSomewhere, `field "${out}" path "${fieldPath}" is undefined in ALL ${source.id} fixtures — wrong path or unfaithful fixture`);
    }
  }
});

test('runQuery returns items from the first matching source', async () => {
  const { items, source, error } = await runQuery(spec, 'testco', { fetchImpl: fixtureFetch });
  assert.equal(error, null);
  assert.ok(items.length > 0);
  assert.ok(source);
  assert.ok(items.every((i) => i.query === 'testco'));
});

test('filters: keywords, remoteOnly and postedAfter narrow results', async () => {
  const base = { title: 'Senior Engineer', department: 'Eng', team: null, location: 'Dubai, UAE', remote: false, postedAt: '2026-05-01T00:00:00Z' };
  assert.equal(passesFilters(base, { keywords: ['engineer'] }), true);
  assert.equal(passesFilters(base, { keywords: ['designer'] }), false);
  assert.equal(passesFilters(base, { remoteOnly: true }), false);
  assert.equal(passesFilters(base, { locations: ['dubai'] }), true);
  assert.equal(passesFilters(base, { postedAfter: '2026-06-01' }), false);
});

test('resolveValue: query, env secrets, and computed dates', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  assert.equal(resolveValue('{query}', { query: 'acme' }), 'acme');
  assert.equal(resolveValue('{{GITHUB_TOKEN}}', { env: { GITHUB_TOKEN: 'ghp_x' } }), 'ghp_x');
  assert.throws(() => resolveValue('{{MISSING}}', { env: {} }), /env secret/);
  assert.equal(resolveValue('{today-30d}', { now }), '2026-05-11');
  assert.equal(resolveValue('stars:>100 created:{today-7d}', { now, query: '' }), 'stars:>100 created:2026-06-03');
});

test('buildUrl: templated path + resolved params + extras', () => {
  const source = { urlTemplate: 'https://api.x.com/search/{query}', params: { sort: 'updated', per_page: '50' } };
  const url = buildUrl(source, { query: 'repos', extraParams: ['offset=0'] });
  assert.match(url, /^https:\/\/api\.x\.com\/search\/repos\?/);
  assert.match(url, /sort=updated/);
  assert.match(url, /per_page=50/);
  assert.match(url, /offset=0/);
});

test('buildHeaders: substitutes env secrets into auth headers', () => {
  const source = { headers: { authorization: 'Bearer {{API_KEY}}', 'x-static': 'v1' } };
  const h = buildHeaders(source, { env: { API_KEY: 'sek' } });
  assert.equal(h.authorization, 'Bearer sek');
  assert.equal(h['x-static'], 'v1');
});

// --- regression tests from the bug-hunter agent's first sweep (2026-06-10) ---

test('bug #2: slug normalization lowercases and warns on impossible slugs', () => {
  assert.deepEqual(normalizeQuery('Palantir', 'slug'), { value: 'palantir', warning: null });
  assert.equal(normalizeQuery('Stripe, Inc.', 'slug').value, 'stripe, inc.');
  assert.match(normalizeQuery('Stripe, Inc.', 'slug').warning, /cannot appear in a board slug/);
  assert.deepEqual(normalizeQuery('  Free Text ', null), { value: 'Free Text', warning: null });
});

test('bug #3: firstHit skips a live-but-empty source instead of shadowing a populated one', async () => {
  const spec2 = {
    sourceMode: 'firstHit',
    sources: [
      { id: 'empty', urlTemplate: 'https://empty.test/jobs', itemsPath: 'jobs', fields: { jobId: 'id', title: 'name' } },
      { id: 'full', urlTemplate: 'https://full.test/jobs', itemsPath: 'jobs', fields: { jobId: 'id', title: 'name' } },
    ],
  };
  const stub = (url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(url.includes('empty') ? { jobs: [] } : { jobs: [{ id: 1, name: 'Real job' }] }),
  });
  const { items, source } = await runQuery(spec2, 'x', { fetchImpl: stub });
  assert.equal(source, 'full');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Real job');
});

test('bug #4: stripHtml decodes entities before stripping (Greenhouse escaped HTML)', () => {
  assert.equal(stripHtml('&lt;h2&gt;Who we are&lt;/h2&gt;'), 'Who we are');
  assert.equal(stripHtml('<b>x &amp; y</b>'), 'x & y');
  assert.equal(stripHtml('&amp;lt;notatag&amp;gt;'), '&lt;notatag&gt;'); // double-escaped stays text
});

test('bug #5: keyword filter matches whole tokens only (incl. symbol-ending terms)', () => {
  const item = { title: 'Maintenance Technician', department: null, team: null };
  assert.equal(passesFilters(item, { keywords: ['ai'] }), false);
  assert.equal(passesFilters({ title: 'AI Engineer' }, { keywords: ['ai'] }), true);
  assert.equal(passesFilters({ title: 'HTML Email Developer' }, { keywords: ['ml'] }), false);
  assert.equal(passesFilters({ title: 'Machine Learning Engineer' }, { keywords: ['machine learning'] }), true);
  assert.equal(passesFilters({ title: 'C++ Developer' }, { keywords: ['c++'] }), true); // \b would fail here
  assert.equal(passesFilters({ title: 'C# Developer' }, { keywords: ['c#'] }), true);
});

test('bug #1 (revenue): planDelivery never delivers more than is chargeable', () => {
  // 12 available, nothing pushed, user cap 100, but only 6 chargeable under the $ cap
  assert.deepEqual(planDelivery(12, 0, 100, 6), { count: 6, limitReached: true });
  // plenty of charge room -> deliver all, no limit
  assert.deepEqual(planDelivery(12, 0, 100, 1000), { count: 12, limitReached: false });
  // user maxResults is the binding constraint, NOT the charge cap -> not "limit reached"
  assert.deepEqual(planDelivery(12, 8, 10, 1000), { count: 2, limitReached: false });
  // charge room already exhausted
  assert.deepEqual(planDelivery(5, 0, 100, 0), { count: 0, limitReached: true });
  // exact fit
  assert.deepEqual(planDelivery(6, 0, 100, 6), { count: 6, limitReached: false });
});

test('bug #6: postedAfter excludes items with unknown posted date', () => {
  assert.equal(passesFilters({ title: 'x', postedAt: null }, { postedAfter: '2026-01-01' }), false);
  assert.equal(passesFilters({ title: 'x', postedAt: '2026-02-01T00:00:00Z' }, { postedAfter: '2026-01-01' }), true);
});

test('bug #7: {query} substitution treats $-sequences literally', () => {
  assert.equal(resolveValue('{query}', { query: 'acme$&corp' }), 'acme$&corp');
  assert.equal(resolveValue('q={query}', { query: "a$'b$$c" }), "q=a$'b$$c");
});

test('bug #8: HttpError strips query string so secrets never reach logs', () => {
  const err = new HttpError(500, 'https://api.test/search?api_key=sk_live_SECRET&q=acme');
  assert.ok(!err.message.includes('SECRET'));
  assert.ok(!err.url.includes('SECRET'));
  assert.match(err.message, /HTTP 500 for https:\/\/api\.test\/search/);
});

test('HN bug #2 (billing): dedupeKey is stable across queries for the same item', () => {
  assert.equal(dedupeKey({ jobId: '42', title: 'x' }), '42');
  assert.equal(dedupeKey({ url: 'https://h.n/item?id=9', title: 'x' }), 'https://h.n/item?id=9');
  assert.equal(dedupeKey({ documentId: 'acc:doc' }), 'acc:doc');
  // same underlying item surfaced by two queries -> identical key -> charged once
  assert.equal(dedupeKey({ jobId: '7', query: 'a' }), dedupeKey({ jobId: '7', query: 'b' }));
});

test('fetchJson does not retry terminal statuses (403/429), surfaces immediately', async () => {
  for (const status of [403, 429, 404]) {
    let calls = 0;
    const stub = () => { calls += 1; return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) }); };
    await assert.rejects(() => fetchJson('https://x.test', { fetchImpl: stub, retries: 3 }));
    assert.equal(calls, 1, `status ${status} should not be retried`);
  }
});

test('runQuery: offset pagination accumulates pages and stops on short page', async () => {
  const pagedSpec = {
    sourceMode: 'firstHit',
    sources: [{
      id: 'paged',
      urlTemplate: 'https://api.test.com/jobs',
      itemsPath: 'content',
      paginate: { offsetParam: 'offset', limitParam: 'limit', limit: 2, totalPath: 'total' },
      fields: { jobId: 'id', title: 'name' },
    }],
  };
  const pages = {
    0: { total: 3, content: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] },
    2: { total: 3, content: [{ id: 3, name: 'C' }] },
  };
  const pagedFetch = (url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(pages[offset]) });
  };
  const { items } = await runQuery(pagedSpec, 'x', { fetchImpl: pagedFetch });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.title), ['A', 'B', 'C']);
});
