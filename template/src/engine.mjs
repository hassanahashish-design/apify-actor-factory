/**
 * Generic spec-driven extraction engine — the heart of the actor factory.
 *
 * One declarative spec describes a "public JSON API -> normalized dataset items"
 * actor. This engine executes any such spec: fetch, walk to the items array,
 * map fields by dot-path, attach citation metadata, filter, cap, and yield flat
 * typed items. No per-actor code — only data, so a new actor = a new spec.
 *
 * Pure and dependency-free so it can be unit-tested offline against fixtures.
 */

export class HttpError extends Error {
  constructor(status, url) {
    // Strip the query string: resolved params may contain {{ENV}} secrets, and this
    // message flows into logs and the persisted SUMMARY record.
    const safeUrl = String(url).split('?')[0];
    super(`HTTP ${status} for ${safeUrl}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = safeUrl;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a dot-path (e.g. "a.b.0.c") out of a nested object; undefined if absent. */
export function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Fill {placeholders} in a template from a values object, URL-encoding each value. */
export function renderTemplate(tpl, values) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(values[k] ?? '')));
}

/**
 * Resolve a spec-supplied dynamic value. Supports:
 *   "{query}"        -> the current query (raw, not URL-encoded; caller encodes)
 *   "{{ENV_NAME}}"   -> process.env.ENV_NAME (for API keys/secrets; throws if unset)
 *   "{today-30d}"    -> ISO date N days before `now` (computed windows)
 *   any other string -> returned literally
 * @param {string} raw
 * @param {{query?: string, now?: number, env?: Record<string,string|undefined>}} ctx
 */
export function resolveValue(raw, { query = '', now, env = {} } = {}) {
  if (typeof raw !== 'string') return raw;
  let out = raw;
  // env secrets {{NAME}} (anywhere in the string) — throw if referenced but unset
  out = out.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = env[name];
    if (v == null || v === '') throw new Error(`Spec requires env secret "${name}" but it is not set (configure it as an Actor secret env var).`);
    return v;
  });
  // computed date windows {today-Nd} (anywhere) when a reference time is known
  if (now != null) {
    out = out.replace(/\{today-(\d+)d\}/g, (_, n) => new Date(now - Number(n) * 86_400_000).toISOString().slice(0, 10));
  }
  // the current query (anywhere) — function replacer so "$&"-style sequences in
  // the query value are inserted literally, not as replacement patterns
  out = out.replace(/\{query\}/g, () => query);
  return out;
}

/** Build a URL with templated path + resolved query params. */
export function buildUrl(source, ctx) {
  let url = renderTemplate(source.urlTemplate, { query: ctx.query ?? '' });
  const params = source.params ?? {};
  const pairs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(resolveValue(v, ctx))}`);
  if (ctx.extraParams) pairs.push(...ctx.extraParams);
  if (pairs.length) url += (url.includes('?') ? '&' : '?') + pairs.join('&');
  return url;
}

/** Resolve a spec's per-source headers, substituting env secrets. */
export function buildHeaders(source, ctx) {
  const out = {};
  for (const [k, v] of Object.entries(source.headers ?? {})) out[k] = resolveValue(v, ctx);
  return out;
}

/**
 * Strip HTML to readable text (descriptions often arrive as HTML).
 * Entities are decoded BEFORE tags are stripped — sources like Greenhouse return
 * HTML-escaped markup (&lt;h2&gt;…), which must become real tags first or the output
 * keeps raw "<h2>" text. `&amp;` decodes last so double-escaped entities stay text
 * instead of fabricating strippable tags.
 */
export function stripHtml(html) {
  return String(html)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalize a query per the spec's queryNormalize mode.
 * 'slug': lowercase (board slugs are case-sensitive on some ATSs — "Palantir" 404s
 * on Lever while "palantir" returns 222 jobs) and warn when the value can't be a
 * valid slug, so a wrong-shaped query fails loudly instead of as a silent no-match.
 */
export function normalizeQuery(raw, mode) {
  const q = String(raw).trim();
  if (mode === 'slug') {
    const value = q.toLowerCase();
    const warning = /[^a-z0-9_-]/.test(value)
      ? `Query "${raw}" contains characters that cannot appear in a board slug — expect a URL identifier like "stripe"; this lookup will likely return no results.`
      : null;
    return { value, warning };
  }
  return { value: q, warning: null };
}

/** Built-in field transforms a spec can name in `fields[x].transform`. */
export const TRANSFORMS = {
  stripHtml: (v) => (v == null ? null : stripHtml(v)),
  toIso: (v) => {
    if (v == null || v === '') return null;
    const s = String(v);
    if (/^\d{4}$/.test(s)) return `${s}-01-01T00:00:00.000Z`; // bare year, not epoch-ms
    const n = Number(v);
    const d = new Date(typeof v === 'number' || /^\d+$/.test(s) ? n : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  // Unix epoch SECONDS -> ISO (e.g. StackExchange creation_date). `toIso` treats a
  // bare number as milliseconds, which would map 2023 timestamps to 1970.
  epochSecToIso: (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const d = new Date(n * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  },
  toString: (v) => (v == null ? null : String(v)),
  boolRemote: (v) => (v == null ? null : /remote/i.test(String(v))),
  lower: (v) => (v == null ? null : String(v).toLowerCase()),
  trim: (v) => (v == null ? null : String(v).trim()),
  // Array of {name} objects -> array of name strings (e.g. Federal Register agencies),
  // so output matches a documented array-of-strings shape instead of nested objects.
  pluckNames: (v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name : x)).filter(Boolean) : v),
  // GDELT's compact timestamp "YYYYMMDDTHHMMSSZ" -> ISO (toIso can't parse it).
  gdeltDate: (v) => {
    const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
  },
  // CourtListener returns root-relative opinion paths; make them absolute URLs.
  clUrl: (v) => (v ? `https://www.courtlistener.com${v}` : null),
};

export async function fetchJson(url, { retries = 3, timeoutMs = 30_000, fetchImpl = fetch, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': 'ApifyActor/1.0 (+https://apify.com)', accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (err) {
      lastErr = err;
      // Don't retry terminal statuses: 404/410 (not found) and 403/429/451
      // (forbidden / rate-limited / blocked) won't change within a run, and
      // retrying just burns more of an already-exhausted quota.
      if (err instanceof HttpError && [403, 404, 410, 429, 451].includes(err.status)) throw err;
      if (attempt < retries) await sleep(1000 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr;
}

const isNotFound = (err) => err instanceof HttpError && (err.status === 404 || err.status === 410);

/** Map one raw API item to a flat output object per the spec's source.fields. */
export function mapItem(raw, source, spec, query, scrapedAt) {
  const out = {};
  for (const [outField, def] of Object.entries(source.fields)) {
    const path = typeof def === 'string' ? def : def.path;
    const transform = typeof def === 'object' ? def.transform : undefined;
    let val = getPath(raw, path);
    if (transform && TRANSFORMS[transform]) val = TRANSFORMS[transform](val);
    if (val === undefined) val = null;
    out[outField] = val;
  }
  out.query = query;
  out.source = source.id;
  out.sourceUrl = renderTemplate(source.urlTemplate, { query });
  out.scrapedAt = scrapedAt;
  return out;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-token keyword match. Uses alphanumeric lookarounds rather than \b so that
 * "ai" does NOT match inside "Maintenance" yet terms ending in symbols ("c++", "c#")
 * still match — \b fails on those because + and # are non-word characters.
 */
export function matchesKeyword(haystack, keyword) {
  return new RegExp(`(?<![a-z0-9])${escapeRegex(keyword)}(?![a-z0-9])`, 'i').test(haystack);
}

/**
 * Stable de-duplication key for a result. Overlapping queries in one run must not
 * charge the buyer twice for the same underlying item (e.g. one HN story surfaced
 * by two brand terms). Prefer an explicit id, then the canonical URL, then title.
 */
export function dedupeKey(item) {
  // Prefer any stable identifier before falling back to title — two distinct records
  // can share a title (e.g. clinical trials with the same briefTitle but different
  // nctId), and keying on title would silently drop one as a "duplicate".
  return String(
    item.jobId ?? item.documentId ?? item.nctId ?? item.id ?? item.url ?? item.title ?? JSON.stringify(item),
  );
}

/** Does an item pass the run-time filters block? */
export function passesFilters(item, filters = {}) {
  if (filters.keywords?.length) {
    // Users pay per returned result, so a sloppy keyword match charges them for junk.
    // Build the haystack from all common text-bearing fields across actor types
    // (FR uses abstract, clinical uses conditions/sponsor, SO uses tags), flattening
    // arrays — otherwise a keyword that only appears in e.g. abstract is silently missed.
    const flat = (v) => (Array.isArray(v) ? v.join(' ') : v ?? '');
    const hay = ['title', 'department', 'team', 'description', 'abstract', 'sponsor', 'conditions', 'tags']
      .map((f) => flat(item[f]))
      .join(' ');
    if (!filters.keywords.some((k) => matchesKeyword(hay, k))) return false;
  }
  if (filters.locations?.length) {
    const loc = String(item.location ?? '').toLowerCase();
    if (!filters.locations.some((l) => loc.includes(String(l).toLowerCase()))) return false;
  }
  if (filters.remoteOnly && item.remote !== true) return false;
  if (filters.postedAfter) {
    // Delta semantics: an item whose posted date is unknown cannot be proven new —
    // exclude it rather than charge for a possibly-old result.
    if (!item.postedAt) return false;
    if (new Date(item.postedAt) < new Date(filters.postedAfter)) return false;
  }
  return true;
}

/**
 * Run one query against a spec's sources.
 * @returns {Promise<{items: object[], source: string|null, error: string|null}>}
 */
/**
 * Decide how many of a query's results may be DELIVERED, given the user's result cap
 * and the buyer's charge cap. Delivering more than is chargeable gives data away free;
 * delivering more than maxResults breaks the user's spend bound. Pure → unit-tested.
 * @returns {{count: number, limitReached: boolean}}
 */
export function planDelivery(available, alreadyPushed, maxResults, chargeableRoom) {
  const resultRoom = Math.max(0, maxResults - alreadyPushed);
  const room = Math.max(0, Math.min(resultRoom, chargeableRoom));
  const count = Math.min(available, room);
  // Charge limit is "reached" when there were results we could not deliver because the
  // charge cap (not the user's maxResults) ran out.
  const limitReached = chargeableRoom <= resultRoom && available > count;
  return { count, limitReached };
}

export async function runQuery(spec, query, { filters = {}, includeDescription = false, fetchImpl = fetch, scrapedAt, now, env = (typeof process !== 'undefined' ? process.env : {}) } = {}) {
  const ts = scrapedAt ?? new Date().toISOString();
  const nowMs = now ?? (ts ? Date.parse(ts) : undefined);
  const mode = spec.sourceMode ?? 'firstHit'; // 'firstHit' = stop at first source with data; 'all' = merge
  const collected = [];
  let matchedSource = null;
  let lastError = null;

  for (const source of spec.sources) {
    const ctx = { query, now: nowMs, env };
    const headers = buildHeaders(source, ctx);
    try {
      const rawItems = await fetchAllPages(source, ctx, { fetchImpl, headers, includeDescription });
      // A live-but-EMPTY board must not shadow a populated later source (ATS-migration
      // leftovers): only a source with actual items counts as a hit.
      if (rawItems == null || rawItems.length === 0) continue;
      const mapped = rawItems
        .map((raw) => mapItem(raw, source, spec, query, ts))
        .filter((it) => passesFilters(it, filters));
      matchedSource = matchedSource ?? source.id;
      collected.push(...mapped);
      if (mode === 'firstHit') return { items: collected, source: matchedSource, error: null };
    } catch (err) {
      if (isNotFound(err)) continue; // not on this source — try next
      lastError = err.message;
    }
  }

  if (!collected.length && lastError) return { items: [], source: null, error: lastError };
  return { items: collected, source: matchedSource, error: null };
}

/**
 * Fetch one source's items, following offset pagination when source.paginate is set.
 * Returns the raw item array, or null if the response shape didn't match itemsPath.
 * paginate spec: { offsetParam, limitParam, limit, totalPath?, maxPages? }
 */
export async function fetchAllPages(source, ctx, { fetchImpl, headers, includeDescription }) {
  const descParam = includeDescription && source.descriptionParam ? [source.descriptionParam.replace(/^[?&]/, '')] : [];
  const pag = source.paginate;
  if (!pag) {
    const url = buildUrl(source, { ...ctx, extraParams: descParam });
    const data = await fetchJson(url, { fetchImpl, headers });
    const arr = getPath(data, source.itemsPath);
    return Array.isArray(arr) ? arr : null;
  }
  const limit = pag.limit ?? 100;
  const maxPages = pag.maxPages ?? 50;
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const extra = [...descParam, `${pag.limitParam}=${limit}`, `${pag.offsetParam}=${page * limit}`];
    const url = buildUrl(source, { ...ctx, extraParams: extra });
    const data = await fetchJson(url, { fetchImpl, headers });
    const arr = getPath(data, source.itemsPath);
    if (!Array.isArray(arr)) return page === 0 ? null : all;
    all.push(...arr);
    const total = pag.totalPath ? Number(getPath(data, pag.totalPath)) : undefined;
    if (arr.length < limit || (total != null && all.length >= total)) break;
  }
  return all;
}
