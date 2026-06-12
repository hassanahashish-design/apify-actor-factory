#!/usr/bin/env node
/**
 * Platform smoke test: run each published factory actor ON APIFY with its canary
 * input and assert the run returns real items with the expected fields. This is the
 * verify-before-done gate for "it works on the platform", not just locally.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const token = JSON.parse(await readFile(path.join(homedir(), '.apify', 'auth.json'), 'utf8')).token;
const registry = JSON.parse(await readFile(path.join(factoryRoot, 'registry.json'), 'utf8'));

// every factory actor except the parked gated one
const targets = registry.actors.filter((a) => a.slug !== 'uae-business-verify' && a.canary);

const results = [];
for (const a of targets) {
  const ref = `${a.username}~${a.slug}`;
  const input = a.canary.input ?? { query: a.canary.query, maxResults: 3 };
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ref}/run-sync-get-dataset-items?token=${token}&timeout=120`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    const need = a.canary.expectFields ?? [];
    const min = a.canary.minItems ?? 1;
    if (!Array.isArray(items) || items.length < min) throw new Error(`got ${Array.isArray(items) ? items.length : 'non-array'} items (< ${min})`);
    const missing = need.filter((f) => !(f in items[0]));
    if (missing.length) throw new Error(`missing fields: ${missing.join(', ')}`);
    console.log(`✅ ${a.slug}: ${items.length} items — e.g. "${String(items[0].title ?? items[0].nctId ?? '').slice(0, 50)}"`);
    results.push({ slug: a.slug, ok: true, items: items.length });
  } catch (err) {
    console.log(`❌ ${a.slug}: ${err.message}`);
    results.push({ slug: a.slug, ok: false, error: err.message });
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} actors verified working on Apify.`);
process.exit(ok === results.length ? 0 : 1);
