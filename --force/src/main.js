/**
 * Universal Actor entrypoint — identical in every generated actor.
 * It loads the actor's own spec.json and runs it through the shared engine.
 *
 * Input (all specs share this shape):
 *   { queries: string[] | query: string, maxResults, includeDescription, filters, ... }
 *
 * Billing: pay-per-event, charged ONLY per successful dataset item ("result"),
 * so failed/empty lookups cost the agent nothing. Stated plainly in the README.
 */
import { readFile } from 'node:fs/promises';
import { Actor, log } from 'apify';
import { runQuery, normalizeQuery, planDelivery, dedupeKey } from './engine.mjs';

const spec = JSON.parse(await readFile(new URL('../spec.json', import.meta.url), 'utf8'));

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const queries = (Array.isArray(input.queries) ? input.queries : input.query ? [input.query] : [])
  .map((q) => normalizeQuery(q, spec.queryNormalize))
  .filter((q) => q.value);

if (!queries.length) {
  throw new Error(`Input requires "query" (string) or "queries" (array). Example: ${JSON.stringify(spec.example ?? { query: 'example' })}`);
}

const maxResults = Math.max(1, Math.floor(Number(input.maxResults) || spec.defaults?.maxResults || 1000));
const includeDescription = Boolean(input.includeDescription ?? spec.defaults?.includeDescription ?? false);
if (input.postedAfter != null && input.postedAfter !== '') {
  // An unparseable date would silently disable the delta filter and charge the user
  // for the full board — fail loudly instead.
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(input.postedAfter) && !Number.isNaN(Date.parse(input.postedAfter));
  if (!ok) throw new Error(`Input "postedAfter" must be an ISO date (YYYY-MM-DD), got "${input.postedAfter}".`);
}
const filters = {
  keywords: input.keywords,
  locations: input.locations,
  remoteOnly: input.remoteOnly,
  postedAfter: input.postedAfter,
};

const proxyConfiguration = input.proxyConfiguration
  ? await Actor.createProxyConfiguration(input.proxyConfiguration)
  : undefined;
const fetchImpl = proxyConfiguration ? await makeProxyFetch(proxyConfiguration) : fetch;

/**
 * Charge for delivered results. Returns whether the buyer's charge limit was hit.
 * A charge failure AFTER data was pushed is treated as limit-reached: we must stop
 * delivering rather than hand out unbilled results.
 */
async function chargeDelivered(count) {
  if (count <= 0) return { limitReached: false };
  try {
    const res = await Actor.charge({ eventName: 'result', count });
    return { limitReached: Boolean(res?.eventChargeLimitReached) };
  } catch (err) {
    log.error(`charge(result) failed after delivery: ${err.message} — halting further deliveries.`);
    return { limitReached: true };
  }
}

/** How many more results may be charged under the buyer's maxTotalChargeUsd cap. */
function chargeableRoom() {
  try {
    const allowed = Actor.getChargingManager?.()?.calculateMaxEventChargeCountWithinLimit?.('result');
    return Number.isFinite(allowed) ? allowed : Infinity;
  } catch {
    return Infinity; // local / non-PPE runs have no cap
  }
}

const scrapedAt = new Date().toISOString();
const summary = [];
const seen = new Set(); // cross-query de-dup so an item surfaced by two queries is charged once
let pushed = 0;
let chargeLimitHit = false;

for (const { value: query, warning } of queries) {
  if (pushed >= maxResults || chargeLimitHit) break;
  if (warning) log.warning(warning);
  const { items: rawItems, source, error } = await runQuery(spec, query, { filters, includeDescription, fetchImpl, scrapedAt });
  if (error) {
    log.warning(`"${query}": ${error}`);
    summary.push({ query, source: null, found: 0, pushed: 0, error });
    continue;
  }
  const items = rawItems.filter((it) => {
    const k = dedupeKey(it);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Never deliver more than the buyer can be charged for — delivering past the cap
  // gives results away free (and past maxResults breaks the user's spend bound).
  const plan = planDelivery(items.length, pushed, maxResults, chargeableRoom());
  if (plan.limitReached) chargeLimitHit = true;
  const toPush = items.slice(0, plan.count);
  if (toPush.length) {
    await Actor.pushData(toPush);
    const { limitReached } = await chargeDelivered(toPush.length);
    pushed += toPush.length;
    if (limitReached) chargeLimitHit = true;
  }
  log.info(`"${query}" [${source ?? 'no-match'}]: ${items.length} found, ${toPush.length} pushed (total ${pushed}/${maxResults}).`);
  summary.push({ query, source: source ?? null, found: items.length, pushed: toPush.length, error: null });
}

if (chargeLimitHit) log.warning('Charge limit reached — stopped delivering so no results go unbilled. Raise maxTotalChargeUsd to get more.');
await Actor.setValue('SUMMARY', { actor: spec.slug, totalPushed: pushed, chargeLimitHit, queries: summary, scrapedAt });
log.info(`Done: ${pushed} result(s) across ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}.`);
await Actor.exit(`Pushed ${pushed} result(s)${chargeLimitHit ? ' (stopped at charge limit)' : ''}.`);

/** Route fetch through Apify Proxy when a spec/source needs it (most don't). */
async function makeProxyFetch(proxyConfig) {
  const { ProxyAgent } = await import('undici');
  return async (url, opts = {}) => {
    const proxyUrl = await proxyConfig.newUrl();
    return fetch(url, { ...opts, dispatcher: new ProxyAgent(proxyUrl) });
  };
}
