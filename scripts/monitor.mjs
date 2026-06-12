#!/usr/bin/env node
/**
 * Stage 8 — portfolio health monitor.
 * Runs each registered actor against a canary input and asserts it still returns
 * the expected shape. Source schema drift, dead endpoints, and broken builds show
 * up here instead of in a customer's failed run.
 *
 * Usage:
 *   node scripts/monitor.mjs                  # check every actor in registry.json
 *   node scripts/monitor.mjs <slug>           # check one
 *
 * Requires apify CLI logged in. Reads registry.json (see template below). Exits
 * non-zero if any actor fails, so it can drive a scheduled alert.
 */
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(await readFile(path.join(factoryRoot, 'registry.json'), 'utf8'));
const only = process.argv[2];
const actors = registry.actors.filter((a) => a.status === 'published' && (!only || a.slug === only));

if (!actors.length) {
  console.log(only ? `No published actor "${only}" in registry.` : 'No published actors to monitor yet.');
  process.exit(0);
}

const fails = [];
for (const actor of actors) {
  const ref = `${actor.username}/${actor.slug}`;
  try {
    const input = JSON.stringify(actor.canary?.input ?? { query: actor.canary?.query ?? 'stripe', maxResults: 3 });
    const out = execSync(
      `npx -y apify-cli call ${ref} --silent --input '${input}' --output-dataset 2>/dev/null`,
      { cwd: factoryRoot, encoding: 'utf8', timeout: 180_000 },
    );
    const items = JSON.parse(out);
    const minItems = actor.canary?.minItems ?? 1;
    const need = actor.canary?.expectFields ?? ['sourceUrl', 'scrapedAt'];
    if (!Array.isArray(items) || items.length < minItems) throw new Error(`expected >=${minItems} items, got ${Array.isArray(items) ? items.length : 'non-array'}`);
    const missing = need.filter((f) => !(f in items[0]));
    if (missing.length) throw new Error(`schema drift: missing fields ${missing.join(', ')}`);
    console.log(`OK  ${ref}: ${items.length} items, fields present.`);
  } catch (err) {
    console.error(`FAIL ${ref}: ${err.message.split('\n')[0]}`);
    fails.push(ref);
  }
}

console.log(`\n${actors.length - fails.length}/${actors.length} healthy.`);
if (fails.length) {
  console.error(`Action required: ${fails.join(', ')}`);
  process.exit(1);
}
