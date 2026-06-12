#!/usr/bin/env node
/**
 * Fill Store display info (categories, seoTitle≤60, seoDescription≤160) via the Apify
 * API for every pushed factory actor, then optionally publish (isPublic:true).
 *
 * Usage:
 *   node scripts/set-display-and-publish.mjs            # set display info only
 *   node scripts/set-display-and-publish.mjs --publish  # set display info + publish
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const econDir = path.dirname(factoryRoot);
const token = JSON.parse(await readFile(path.join(homedir(), '.apify', 'auth.json'), 'utf8')).token;
const registry = JSON.parse(await readFile(path.join(factoryRoot, 'registry.json'), 'utf8'));
const doPublish = process.argv.includes('--publish');

/** Truncate to max chars at a word boundary, no trailing punctuation. */
function clip(s, max) {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return cut.slice(0, lastSpace > max - 20 ? lastSpace : max).replace(/[\s,.;:—-]+$/, '');
}

const targets = registry.actors.filter((a) => a.status === 'pushed' && a.bugHuntPassed);
const results = [];

for (const a of targets) {
  const actorJson = JSON.parse(await readFile(path.join(econDir, a.slug, '.actor/actor.json'), 'utf8'));
  const ref = `oblanceolate_mandola~${a.slug}`;
  const display = {
    title: actorJson.title,
    description: actorJson.description,
    seoTitle: clip(actorJson.title, 60), // title is already ≤60 and keyword-rich
    seoDescription: clip(actorJson.seoDescription || actorJson.description, 160),
    categories: actorJson.categories,
  };
  try {
    let res = await fetch(`https://api.apify.com/v2/acts/${ref}?token=${token}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(display),
    });
    let j = await res.json();
    if (j.error) throw new Error(`display: ${j.error.message}`);

    let published = false;
    if (doPublish) {
      res = await fetch(`https://api.apify.com/v2/acts/${ref}?token=${token}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ isPublic: true }),
      });
      j = await res.json();
      if (j.error) throw new Error(`publish: ${j.error.message}`);
      published = j.data.isPublic;
    }
    console.log(`✅ ${a.slug}: categories=${JSON.stringify(display.categories)} seoTitle="${display.seoTitle}" (${display.seoTitle.length}c)${doPublish ? ` | public=${published}` : ''}`);
    results.push({ slug: a.slug, ok: true, published });
  } catch (err) {
    console.log(`❌ ${a.slug}: ${err.message.slice(0, 140)}`);
    results.push({ slug: a.slug, ok: false, error: err.message });
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} actors ${doPublish ? 'published' : 'display-info set'}.`);
process.exit(ok === results.length ? 0 : 1);
