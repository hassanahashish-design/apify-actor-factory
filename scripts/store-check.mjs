#!/usr/bin/env node
// store-check.mjs — the ENFORCED Stage-1 competition gate + AEO ranking monitor.
//
// Born from a real failure (June 12, 2026): 8 actors shipped into niches where live
// Store search showed 5-8 incumbents with 100-28,000 runs each; ours ranked nowhere
// and got zero external users. The PLAYBOOK prose said "check competition live" —
// nothing enforced it. This script IS the enforcement.
//
// Modes:
//   node scripts/store-check.mjs "sec edgar" "sec filings"     gate mode: verdict for a topic
//   node scripts/store-check.mjs --spec specs/foo.json         gate mode, keywords from spec
//   node scripts/store-check.mjs --rank <slug> "kw" ["kw"...]  rank mode: where does OUR actor sit
//   node scripts/store-check.mjs --rank-all                    rank mode for every registry actor
//
// Gate mode prints a spec-pastable "storeCheck" JSON block. The scaffolder REFUSES any
// spec without one (fresh, <=7 days). Verdicts:
//   OPEN         0 established incumbents (>=100 runs)        → build
//   CONTESTABLE  1-3 established incumbents                   → build ONLY with a named,
//                                                               listing-visible differentiation
//   SATURATED    >3 established incumbents                    → KILL (or a deliberate,
//                                                               named bet via gateOverride)

const STORE = 'https://api.apify.com/v2/store';
const OUR_USERNAME = process.env.APIFY_USERNAME || 'oblanceolate_mandola';
const ESTABLISHED_RUNS = 100; // an incumbent with >=100 runs has social proof we lack
const FRESH_DAYS = 7;

async function searchStore(keyword, limit = 25) {
  const url = `${STORE}?search=${encodeURIComponent(keyword)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Store API ${res.status} for "${keyword}"`);
  const body = await res.json();
  return (body.data && body.data.items) || [];
}

function fmtRow(pos, a, mine) {
  const id = `${a.username}/${a.name}`;
  const runs = a.stats?.totalRuns ?? 0;
  const users = a.stats?.totalUsers ?? '';
  return `  ${String(pos).padStart(2)}. ${mine ? '>>> ' : '    '}${id.padEnd(48)} runs:${String(runs).padStart(7)}${users !== '' ? ' users:' + String(users).padStart(6) : ''}${mine ? '   <<< OURS' : ''}`;
}

async function gateMode(keywords) {
  const seen = new Map(); // "user/name" -> actor (dedupe across keywords)
  const perKeyword = [];
  for (const kw of keywords) {
    const items = await searchStore(kw);
    console.log(`\n--- Store search: "${kw}" (top ${items.length}) ---`);
    items.forEach((a, i) => {
      const id = `${a.username}/${a.name}`;
      console.log(fmtRow(i + 1, a, a.username === OUR_USERNAME));
      if (a.username !== OUR_USERNAME && !seen.has(id)) seen.set(id, a);
    });
    if (!items.length) console.log('  (no results — keyword may be too narrow, try variants)');
    perKeyword.push({ keyword: kw, results: items.length });
  }

  const incumbents = [...seen.values()]
    .filter((a) => (a.stats?.totalRuns ?? 0) >= ESTABLISHED_RUNS)
    .sort((a, b) => (b.stats?.totalRuns ?? 0) - (a.stats?.totalRuns ?? 0));

  const verdict = incumbents.length === 0 ? 'OPEN' : incumbents.length <= 3 ? 'CONTESTABLE' : 'SATURATED';
  const top = incumbents[0];

  console.log(`\n================ GATE VERDICT ================`);
  console.log(`Established incumbents (>=${ESTABLISHED_RUNS} runs, deduped): ${incumbents.length}`);
  incumbents.slice(0, 8).forEach((a) =>
    console.log(`  - ${a.username}/${a.name}  (${a.stats?.totalRuns ?? 0} runs)`));
  console.log(`VERDICT: ${verdict}`);
  if (verdict === 'SATURATED')
    console.log(`KILL by default. A new entrant starts invisible behind ${incumbents.length} actors with social proof.\nProceed ONLY as a deliberate named bet: add "gateOverride": {"reason": "..."} to storeCheck.`);
  if (verdict === 'CONTESTABLE')
    console.log(`Build ONLY with a named differentiation that appears IN THE LISTING (fill "differentiation" below).`);
  if (verdict === 'OPEN')
    console.log(`No established incumbents — verify there is DEMAND (an empty niche can mean no buyers).`);

  const block = {
    checkedAt: new Date().toISOString().slice(0, 10),
    keywords,
    establishedIncumbents: incumbents.length,
    topIncumbent: top ? `${top.username}/${top.name} (${top.stats?.totalRuns ?? 0} runs)` : null,
    verdict,
    differentiation: verdict === 'OPEN' ? null : 'REQUIRED — name the angle no incumbent covers, verbatim from their listings',
  };
  console.log(`\nPaste into the spec as "storeCheck":`);
  console.log(JSON.stringify(block, null, 2));
  return verdict;
}

async function rankMode(slug, keywords) {
  console.log(`\n=== Ranking check: ${OUR_USERNAME}/${slug} ===`);
  let foundAnywhere = false;
  for (const kw of keywords) {
    const items = await searchStore(kw, 50);
    const pos = items.findIndex((a) => a.username === OUR_USERNAME && a.name === slug);
    const line = pos >= 0 ? `position ${pos + 1} of ${items.length}` : `NOT in top ${items.length}`;
    if (pos >= 0) foundAnywhere = true;
    console.log(`  "${kw}": ${line}`);
  }
  if (!foundAnywhere)
    console.log(`  → invisible on every checked keyword. Levers: external traffic, reviews, README keyword coverage.`);
}

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Usage: store-check.mjs "<keyword>" [...] | --spec <spec.json> | --rank <slug> "<kw>" [...] | --rank-all');
  process.exit(2);
}

if (args[0] === '--spec') {
  const { readFileSync } = await import('node:fs');
  const spec = JSON.parse(readFileSync(args[1], 'utf8'));
  const kws = spec.storeCheck?.keywords || spec.seoKeywords ||
    [spec.title, spec.slug?.replace(/-/g, ' ')].filter(Boolean);
  const verdict = await gateMode(kws);
  process.exit(verdict === 'SATURATED' ? 1 : 0);
} else if (args[0] === '--rank') {
  await rankMode(args[1], args.slice(2));
} else if (args[0] === '--rank-all') {
  const { readFileSync } = await import('node:fs');
  const reg = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8'));
  for (const a of reg.actors) {
    if (a.status === 'parked') continue;
    const kws = [a.slug.replace(/-/g, ' ')];
    await rankMode(a.slug, kws);
  }
} else {
  const verdict = await gateMode(args);
  process.exit(verdict === 'SATURATED' ? 1 : 0);
}
