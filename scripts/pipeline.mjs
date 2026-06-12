#!/usr/bin/env node
/**
 * Deterministic pipeline runner — stages 3 + 5 with hard time-boxes and the
 * park-and-switch rule (the anti-Dubai-Pulse rule): any stage that fails on a
 * blocker needing human/external input parks the actor with a named reason and
 * the runner MOVES ON to the next spec. No grinding on stuck ideas.
 *
 * Usage:
 *   node scripts/pipeline.mjs <slug>        # run one spec through the pipeline
 *   node scripts/pipeline.mjs --all         # process every non-parked spec in specs/
 *   node scripts/pipeline.mjs <slug> --force  # retry even if parked
 *
 * Stages: scaffold (if missing) -> offline tests -> apify push -> platform smoke
 * run -> dataset assertion -> registry update. Judgment stages (moat gate, spec
 * writing, bug-hunt) stay with the orchestrator — this script never skips them:
 * it refuses to push an actor whose registry entry lacks bugHuntPassed.
 */
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const pexec = promisify(execFile);
const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const econDir = path.dirname(factoryRoot);
const registryPath = path.join(factoryRoot, 'registry.json');

const TIMEOUTS = { scaffold: 240_000, test: 120_000, push: 480_000, smoke: 300_000 };
const MAX_ATTEMPTS = 3;

/** Error classes that mean "park and switch", not "retry". */
const BLOCKER_PATTERNS = [
  /geo|blocked|access denied|login|captcha|credential|unauthoriz|forbidden|402|451/i,
  /ENOTFOUND|ECONNREFUSED|certificate/i,
  /not logged in/i,
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const all = args.includes('--all');
const slugArg = args.find((a) => !a.startsWith('--'));

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const apifyToken = JSON.parse(await readFile(path.join(homedir(), '.apify', 'auth.json'), 'utf8')).token;
const me = await (await fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`)).json();
const username = me.data.username;

async function sh(cmd, cmdArgs, { cwd, timeout }) {
  return pexec(cmd, cmdArgs, { cwd, timeout, env: process.env, maxBuffer: 16 * 1024 * 1024 });
}

const isBlocker = (msg) => BLOCKER_PATTERNS.some((re) => re.test(msg));

function entryFor(slug) {
  let e = registry.actors.find((a) => a.slug === slug);
  if (!e) {
    e = { slug, username, status: 'spec', moat: '', pricePerResultUsd: null, canary: null, parkedReason: null };
    registry.actors.push(e);
  }
  return e;
}

async function processSlug(slug) {
  const specPath = path.join(factoryRoot, 'specs', `${slug}.json`);
  const spec = JSON.parse(await readFile(specPath, 'utf8'));
  const entry = entryFor(slug);
  entry.username = spec.username ?? username;
  const actorDir = path.join(econDir, slug);
  const ref = `${entry.username}/${slug}`;
  const log = (stage, msg) => console.log(`[${slug}] ${stage}: ${msg}`);

  if (entry.status === 'parked' && !force) {
    log('skip', `parked (${entry.parkedReason}) — pass --force to retry`);
    return { slug, outcome: 'parked-skip' };
  }
  if (entry.status === 'published') {
    log('skip', 'already published');
    return { slug, outcome: 'published' };
  }

  const park = (reason) => {
    entry.status = 'parked';
    entry.parkedReason = reason;
    log('PARKED', `${reason} -> switching to next idea`);
    return { slug, outcome: 'parked', reason };
  };

  try {
    // Stage 3 — scaffold if missing, offline tests
    const exists = await access(actorDir).then(() => true).catch(() => false);
    if (!exists) {
      log('scaffold', 'generating from spec...');
      await sh('node', [path.join(factoryRoot, 'scripts/new-actor.mjs'), specPath, actorDir], { cwd: factoryRoot, timeout: TIMEOUTS.scaffold });
    } else {
      log('test', 'running offline tests...');
      await sh('npm', ['test'], { cwd: actorDir, timeout: TIMEOUTS.test });
    }
    log('test', 'offline tests green');
    if (entry.status === 'spec') entry.status = 'scaffolded';

    // Gate — bug-hunt is a judgment stage; the runner enforces it happened.
    if (!entry.bugHuntPassed) {
      return park('bug-hunt not recorded in registry (run the bug-hunter agent, set bugHuntPassed: true)');
    }

    // Stage 5a — push. --force: for factory actors the local repo (spec + registry)
    // is always the source of truth; remote edits are never canonical.
    log('push', 'deploying to Apify...');
    await sh('npx', ['-y', 'apify-cli', 'push', '--force'], { cwd: actorDir, timeout: TIMEOUTS.push });
    entry.status = 'pushed';
    log('push', 'build succeeded');

    // Stage 5b — platform smoke run with the canary input
    const canary = entry.canary ?? { query: spec.query.example, minItems: 1, expectFields: ['title', 'sourceUrl', 'scrapedAt'] };
    const input = JSON.stringify(canary.input ?? { query: canary.query, maxResults: 5 });
    log('smoke', `platform run with ${input} ...`);
    await sh('npx', ['-y', 'apify-cli', 'call', ref, '--input', input], { cwd: actorDir, timeout: TIMEOUTS.smoke });

    // Stage 5c — read the ACTUAL dataset items (verify-before-done)
    const runRes = await (await fetch(`https://api.apify.com/v2/acts/${ref.replace('/', '~')}/runs/last?token=${apifyToken}`)).json();
    const run = runRes.data;
    if (run.status !== 'SUCCEEDED') throw new Error(`platform run status ${run.status}`);
    const itemsRes = await (await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${apifyToken}&limit=10`)).json();
    const items = Array.isArray(itemsRes) ? itemsRes : [];
    if (items.length < (canary.minItems ?? 1)) throw new Error(`smoke returned ${items.length} items (< ${canary.minItems ?? 1})`);
    const missing = (canary.expectFields ?? []).filter((f) => !(f in items[0]));
    if (missing.length) throw new Error(`smoke output missing fields: ${missing.join(', ')}`);

    entry.smoke = { at: new Date().toISOString(), items: items.length, runId: run.id };
    entry.parkedReason = null;
    log('smoke', `GREEN — ${items.length} real items verified (run ${run.id})`);
    log('done', `pushed + smoke-verified. Remaining manual: Console -> Monetization (pay-per-event 'result' @ $${entry.pricePerResultUsd ?? spec.pricing.pricePerResultUsd}) -> Publish to Store.`);
    return { slug, outcome: 'pushed+verified' };
  } catch (err) {
    const msg = `${err.message}\n${err.stderr ?? ''}\n${err.stdout ?? ''}`.replace(/npm warn[^\n]*\n/g, '').slice(0, 700);
    entry.attempts = (entry.attempts ?? 0) + 1;
    if (isBlocker(msg)) return park(`blocker: ${msg.split('\n')[0]}`);
    if (entry.attempts >= MAX_ATTEMPTS) return park(`${MAX_ATTEMPTS} failed attempts: ${msg.split('\n')[0]}`);
    log('fail', `attempt ${entry.attempts}/${MAX_ATTEMPTS}: ${msg.split('\n')[0]}`);
    return { slug, outcome: 'failed', error: msg.split('\n')[0] };
  }
}

const targets = all
  ? (await readdir(path.join(factoryRoot, 'specs'))).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  : [slugArg];
if (!targets[0]) {
  console.error('Usage: node scripts/pipeline.mjs <slug> [--force] | --all');
  process.exit(1);
}

const results = [];
for (const slug of targets) {
  results.push(await processSlug(slug));
}
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

console.log('\n=== queue summary ===');
for (const r of results) console.log(`${r.slug}: ${r.outcome}${r.reason ? ` (${r.reason})` : ''}`);
const parked = results.filter((r) => r.outcome === 'parked');
if (parked.length) console.log(`\n${parked.length} parked — pull the next spec from specs/ instead of grinding. Blockers are logged in registry.json.`);
