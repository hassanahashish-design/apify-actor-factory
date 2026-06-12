#!/usr/bin/env node
/**
 * Factory stage 3 — deterministic scaffolder.
 * Usage: node scripts/new-actor.mjs specs/<name>.json [outputDir]
 *
 * Takes a spec file, stamps the template, installs deps, runs tests.
 * Produces a complete pushable actor directory. No AI involved — same
 * spec in, same actor out, every time.
 */
import { cp, mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exists = (p) => access(p).then(() => true).catch(() => false);

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const specPath = process.argv[2];
if (!specPath) {
  console.error('Usage: node scripts/new-actor.mjs specs/<name>.json [outputDir]');
  process.exit(1);
}

const spec = JSON.parse(await readFile(specPath, 'utf8'));
const required = ['slug', 'title', 'shortDescription', 'seoTitle', 'seoDescription', 'sources', 'pricing', 'query'];
const missing = required.filter((k) => spec[k] == null);
if (missing.length) {
  console.error(`Spec is missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}

// COMPETITION GATE (enforced 2026-06-12, after 8 actors shipped into saturated niches
// and got zero users). Every spec must carry a fresh storeCheck block produced by
// scripts/store-check.mjs — run: node scripts/store-check.mjs "<topic keywords>".
// There is NO CLI bypass; a deliberate bet into a saturated niche must be written
// into the spec itself as storeCheck.gateOverride.reason (auditable forever).
{
  const sc = spec.storeCheck;
  const fail = (msg) => {
    console.error(`COMPETITION GATE: ${msg}\nRun: node scripts/store-check.mjs "<topic keywords>" and paste the storeCheck block into the spec.`);
    process.exit(1);
  };
  if (!sc) fail('spec has no storeCheck block — the live Store competition check is mandatory before any build.');
  if (!Array.isArray(sc.keywords) || !sc.keywords.length) fail('storeCheck.keywords is empty.');
  if (!sc.checkedAt) fail('storeCheck.checkedAt missing.');
  const ageDays = (Date.now() - new Date(sc.checkedAt).getTime()) / 86400000;
  if (!(ageDays >= 0 && ageDays <= 7)) fail(`storeCheck is stale (${sc.checkedAt}) — re-run the check; rankings move.`);
  if (sc.verdict === 'SATURATED' && !sc.gateOverride?.reason)
    fail(`verdict is SATURATED (${sc.establishedIncumbents} incumbents, top: ${sc.topIncumbent}). KILL by default — a new entrant starts invisible behind incumbents with social proof. To proceed as a deliberate named bet, set storeCheck.gateOverride.reason.`);
  if (sc.verdict === 'CONTESTABLE' && (!sc.differentiation || /^REQUIRED/.test(sc.differentiation)))
    fail('verdict is CONTESTABLE — storeCheck.differentiation must name the angle no incumbent covers (it goes in the listing).');
  if (sc.verdict === 'OPEN' && !sc.demandEvidence)
    fail('verdict is OPEN — an empty niche can mean no buyers. Set storeCheck.demandEvidence (a citable signal someone wants this).');
  console.log(`Competition gate: ${sc.verdict}${sc.gateOverride ? ' (override: ' + sc.gateOverride.reason + ')' : ''} — checked ${sc.checkedAt}`);
}

const outDir = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? path.join(path.dirname(factoryRoot), spec.slug);

// SAFETY: refuse to overwrite an existing actor dir. After Stage 3, the generated
// directory is the source of truth — Stage 4 bug fixes and regression tests live
// there, and a blind re-scaffold would silently clobber them. Back-port engine/test
// fixes to template/ instead; only --force re-scaffolds (destructive).
if ((await exists(outDir)) && !process.argv.includes('--force')) {
  console.error(`Refusing to overwrite existing actor at ${outDir}.\n` +
    `The generated dir is source-of-truth after scaffolding; re-scaffolding would clobber Stage-4 fixes.\n` +
    `Back-port any engine/test changes to template/ instead. Pass --force only to intentionally rebuild from scratch.`);
  process.exit(1);
}
if (!spec.username) console.warn('WARNING: spec.username unset — README MCP/Python/TS snippets will read "your-username/<slug>". Set it before publishing.');

console.log(`Scaffolding ${spec.slug} -> ${outDir}`);
await mkdir(outDir, { recursive: true });
await cp(path.join(factoryRoot, 'template'), outDir, { recursive: true });

// Engine spec consumed at runtime by src/main.js
const runtimeSpec = {
  slug: spec.slug,
  sourceMode: spec.sourceMode ?? 'firstHit',
  queryNormalize: spec.query.normalize ?? null,
  sources: spec.sources,
  defaults: spec.defaults ?? { maxResults: 1000 },
  example: { query: spec.query.example },
};
await writeFile(path.join(outDir, 'spec.json'), `${JSON.stringify(runtimeSpec, null, 2)}\n`);

// Test fixtures: the spec carries one captured API response per source so the
// generated actor's tests run offline and deterministic.
if (spec.fixtures) {
  await mkdir(path.join(outDir, 'test/fixtures'), { recursive: true });
  for (const [sourceId, payload] of Object.entries(spec.fixtures)) {
    await writeFile(path.join(outDir, `test/fixtures/${sourceId}.json`), `${JSON.stringify(payload, null, 1)}\n`);
  }
}

// ---- Output (dataset) schema generation ----
// Every actor outputs query + its mapped fields + source/sourceUrl/scrapedAt. We
// document each with a human label and an inferred display format so the Console
// renders typed columns AND agents can read the output shape before calling.
function humanizeField(name) {
  const special = {
    query: 'Query', source: 'Source', sourceUrl: 'Source URL', scrapedAt: 'Scraped at',
    nctId: 'NCT ID', documentId: 'Document ID', doi: 'DOI', cik: 'CIK', url: 'URL',
    jobId: 'ID', applyUrl: 'Apply URL', sourceCountry: 'Source country',
    isAnswered: 'Answered', openIssues: 'Open issues', postedAt: 'Posted date',
    rootForm: 'Root form', docType: 'Document type', filedAt: 'Filed date', updatedAt: 'Updated date',
  };
  if (special[name]) return special[name];
  const words = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function inferFormat(name) {
  const n = name.toLowerCase();
  if (n === 'url' || n.endsWith('url') || n === 'doi') return 'link';
  if (n.endsWith('at') || n.endsWith('date')) return 'date';
  if (/(count|score|stars|points|citations|^year$|forks|views|answers|comments|openissues|num)/.test(n)) return 'number';
  if (/^(remote|is[A-Z])/.test(name) || n === 'remote' || n === 'isanswered') return 'boolean';
  if (/(locations|tags|conditions|agency|phases|filer|authors|secondary)/.test(n)) return 'array';
  return 'text';
}
function buildOutputSchema(s) {
  const mapped = [];
  for (const src of s.sources) for (const k of Object.keys(src.fields)) if (!mapped.includes(k)) mapped.push(k);
  const fields = ['query', ...mapped, 'source', 'sourceUrl', 'scrapedAt'].filter((v, i, a) => a.indexOf(v) === i);
  const properties = {};
  for (const f of fields) properties[f] = { label: humanizeField(f), format: inferFormat(f) };
  return { fields, properties };
}
const outputSchema = buildOutputSchema(spec);

// Token replacement across .tmpl files
const tokens = {
  __SLUG__: spec.slug,
  __TITLE__: spec.title,
  __SHORT_DESCRIPTION__: spec.shortDescription,
  __SEO_TITLE__: spec.seoTitle,
  __SEO_DESCRIPTION__: spec.seoDescription,
  __CATEGORIES__: JSON.stringify(spec.categories ?? ['AUTOMATION']),
  __VIEW_FIELDS__: JSON.stringify(outputSchema.fields),
  __VIEW_PROPERTIES__: JSON.stringify(outputSchema.properties),
  __PRICE_USD__: String(spec.pricing.pricePerResultUsd),
  __QUERY_LABEL__: spec.query.label,
  __QUERY_DESCRIPTION__: spec.query.description,
  __QUERY_PREFILL__: JSON.stringify(spec.query.prefill ?? [spec.query.example]),
  __DEFAULT_MAX__: String(spec.defaults?.maxResults ?? 1000),
  __INTRO__: spec.readme?.intro ?? '',
  __WHAT_LIST__: (spec.readme?.bullets ?? []).map((b) => `- ${b}`).join('\n'),
  __SAMPLE_OUTPUT__: JSON.stringify(spec.readme?.sampleOutput ?? {}, null, 2),
  __SAMPLE_INPUT__: JSON.stringify({ queries: spec.query.prefill ?? [spec.query.example] }),
  __SAMPLE_INPUT_PY__: JSON.stringify({ queries: spec.query.prefill ?? [spec.query.example] }),
  __SOURCE_SUMMARY__: spec.sources.map((s) => s.id).join(', '),
  __USERNAME__: spec.username ?? 'your-username',
  __FAQ__: (spec.readme?.faq ?? []).map((f) => `### ${f.q}\n\n${f.a}`).join('\n\n') || '_No FAQ provided._',
  // AEO: the "Why pick this Actor" section. The first bullet is the niche
  // differentiation the competition gate required — the storeCheck finding flows
  // straight into the listing so agent buyers see the angle, not just we do.
  __WHY_LIST__: (() => {
    const bullets = [];
    const diff = spec.storeCheck?.differentiation;
    if (diff && !/^REQUIRED/.test(diff)) bullets.push(diff);
    bullets.push(
      `Per-result pricing ($${spec.pricing.pricePerResultUsd}/result) with a hard \`maxResults\` spend cap — empty lookups cost $0`,
      'Flat, stable JSON schema with `sourceUrl` + `scrapedAt` on every item — citation-ready for RAG and grounding',
      'Batch many queries in one run; overlapping results are deduplicated and charged once',
      'MCP server, OpenAPI schema, and LangChain/CrewAI tool support out of the box — no glue code',
    );
    return bullets.map((b) => `- ${b}`).join('\n');
  })(),
  // README filter row must match the ACTUAL exposed filters (jobs-only ones are
  // stripped from the schema for non-jobs actors), and only mention includeDescription
  // when a source actually supports it — never advertise an input that does nothing.
  __FILTERS_DOC__: (() => {
    const hasDesc = spec.sources.some((s) => s.descriptionParam);
    const rows = [];
    if (hasDesc) rows.push('| `includeDescription` | boolean | Include full description text. |');
    const filterList = spec.jobsFilters ? '`keywords` / `locations` / `remoteOnly` / `postedAfter`' : '`keywords` / `postedAfter`';
    rows.push(`| ${filterList} | filters | Narrow results; enable delta/scheduled runs. |`);
    return rows.join('\n');
  })(),
};

// Tokens that are raw prose must be JSON-escaped when injected inside a JSON
// string (a quote in a description must not break the schema), but stay raw in
// markdown. Tokens that are themselves JSON values (arrays, objects, numbers)
// are never escaped.
const JSON_VALUE_TOKENS = new Set(['__CATEGORIES__', '__VIEW_FIELDS__', '__VIEW_PROPERTIES__', '__QUERY_PREFILL__', '__PRICE_USD__', '__DEFAULT_MAX__', '__SAMPLE_OUTPUT__', '__SAMPLE_INPUT__']);
const escapeForJson = (s) => JSON.stringify(String(s)).slice(1, -1);

const templated = ['package.json', '.actor/actor.json', '.actor/input_schema.json', '.actor/pay_per_event.json', 'README.md'];
for (const rel of templated) {
  const tmplPath = path.join(outDir, `${rel}.tmpl`);
  const isJsonTarget = rel.endsWith('.json');
  let content = await readFile(tmplPath, 'utf8');
  for (const [token, value] of Object.entries(tokens)) {
    const out = isJsonTarget && !JSON_VALUE_TOKENS.has(token) ? escapeForJson(value) : value;
    content = content.replaceAll(token, out);
  }
  const leftover = content.match(/__[A-Z_]+__/g);
  if (leftover) {
    console.error(`Unfilled tokens in ${rel}: ${[...new Set(leftover)].join(', ')}`);
    process.exit(1);
  }
  await writeFile(path.join(outDir, rel), content);
  await rename(tmplPath, `${tmplPath}.used`).catch(() => {});
  execSync(`rm -f "${tmplPath}.used"`);
}

// Jobs-only filters (remoteOnly, locations) reference fields that non-jobs sources
// never have — exposing them makes a buyer's filter silently zero out every result.
// Strip them unless the spec opts in with jobsFilters: true.
{
  const isPath = path.join(outDir, '.actor/input_schema.json');
  const schema = JSON.parse(await readFile(isPath, 'utf8'));
  const stripped = [];
  if (!spec.jobsFilters) {
    delete schema.properties.remoteOnly;
    delete schema.properties.locations;
    stripped.push('remoteOnly', 'locations');
  }
  // includeDescription only does something when a source has a descriptionParam —
  // otherwise it's an input that silently does nothing (a buyer trust-breaker).
  if (!spec.sources.some((s) => s.descriptionParam)) {
    delete schema.properties.includeDescription;
    stripped.push('includeDescription');
  }
  if (stripped.length) {
    await writeFile(isPath, `${JSON.stringify(schema, null, 2)}\n`);
    console.log(`Stripped no-op inputs from schema: ${stripped.join(', ')}.`);
  }
}

console.log('Installing dependencies...');
execSync('npm install --no-audit --no-fund --silent', { cwd: outDir, stdio: 'inherit' });
console.log('Running tests...');
execSync('npm test', { cwd: outDir, stdio: 'inherit' });

console.log(`\nDone. Next steps:\n  cd "${outDir}"\n  npx -y apify-cli push\nThen set pay-per-event pricing ($${spec.pricing.pricePerResultUsd}/result) and publish.`);
