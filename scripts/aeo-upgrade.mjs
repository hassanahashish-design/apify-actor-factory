#!/usr/bin/env node
// aeo-upgrade.mjs — one-time AEO retrofit (2026-06-12) for actors generated before the
// template gained the "Why pick this Actor" section + agent-task FAQ entries.
// Idempotent: skips any README that already has the section. New actors get this from
// the template; this script exists only to upgrade the pre-gate fleet.
//
// Every differentiation line below is FACTUAL — checked against the actor's spec.json
// field mappings on 2026-06-12. Never add a claim the dataset doesn't carry.

import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const portfolioRoot = path.dirname(factoryRoot);
const registry = JSON.parse(await readFile(path.join(factoryRoot, 'registry.json'), 'utf8'));

// Per-slug niche differentiation — the angle agents see first. Field-verified.
const DIFF = {
  'company-hiring-signals': 'One call queries three ATS platforms (Greenhouse, Lever, Ashby) and returns a single normalized schema — title, department, location, remote flag, compensation — no per-platform glue code',
  'sec-edgar-filings': 'Full-text search across the EDGAR corpus with form type, filer + CIK, and filing date on every item; `postedAfter` turns a query into a scheduled disclosure monitor',
  'research-paper-search': "Backed by OpenAlex's open catalog of scholarly works — DOI, citation count, venue, year, and first author on every item",
  'github-repo-search': "Flat repo records with stars, forks, open issues, language, and last-push date — ranking-pipeline-ready without parsing GitHub's nested API shapes",
  'hacker-news-monitor': 'Points and comment counts on every item for signal-weighting; `postedAfter` makes it a scheduled brand or keyword monitor',
  'federal-register-monitor': 'Agency names flattened to plain strings and document abstracts included; `postedAfter` gives compliance agents a daily regulatory delta feed',
  'clinical-trials-search': 'Stable NCT IDs, recruiting status, sponsor, conditions, and phases via the official ClinicalTrials.gov v2 API',
  'stackoverflow-search': 'Score, answer count, accepted-answer flag, tags, and view counts on every question — credibility ranking without a second call',
  'gdelt-news-monitor': 'Global news coverage across 100+ languages with domain, language, and source-country on every article',
  'wikipedia-search': 'Clean entity grounding: title, stable page key, one-line description, and excerpt — disambiguation-ready for RAG pipelines',
  'court-opinions-search': 'Court, docket number, citation, judge, and cite count from CourtListener — precedent triage in one call',
  'podcast-search': 'Returns the RSS `feedUrl` where available, so agents go straight from discovery to episode ingestion',
};

const FAQ_ADD = `### Can AI agents call this Actor directly?

Yes — via the Apify MCP server (snippet above), the OpenAPI schema on the Actor's API tab, or the LangChain/CrewAI tool wrapper. Results are flat JSON with \`sourceUrl\` and \`scrapedAt\` on every item, so downstream agents can cite and re-verify.

### What happens when there are no results?

You pay nothing. Billing is per dataset item delivered, so an empty lookup costs $0, and the run log states why (no match, source rate limit) instead of failing silently.

`;

const whySection = (slug, price) => `## Why pick this Actor

- ${DIFF[slug]}
- Per-result pricing ($${price}/result) with a hard \`maxResults\` spend cap — empty lookups cost $0
- Flat, stable JSON schema with \`sourceUrl\` + \`scrapedAt\` on every item — citation-ready for RAG and grounding
- Batch many queries in one run; overlapping results are deduplicated and charged once
- MCP server, OpenAPI schema, and LangChain/CrewAI tool support out of the box — no glue code

`;

let touched = 0;
for (const actor of registry.actors) {
  const { slug, pricePerResultUsd } = actor;
  if (actor.status === 'parked' || !DIFF[slug]) continue;
  const readmePath = path.join(portfolioRoot, slug, 'README.md');
  if (!(await access(readmePath).then(() => true).catch(() => false))) {
    console.log(`SKIP ${slug}: no README at ${readmePath}`);
    continue;
  }
  let md = await readFile(readmePath, 'utf8');
  let changed = false;

  if (!md.includes('## Why pick this Actor')) {
    const anchor = '## Sample output';
    if (!md.includes(anchor)) { console.log(`SKIP ${slug}: no "${anchor}" anchor`); continue; }
    md = md.replace(anchor, whySection(slug, pricePerResultUsd) + anchor);
    changed = true;
  }
  if (!md.includes('### Can AI agents call this Actor directly?')) {
    const anchor = '## Changelog';
    if (md.includes(anchor)) { md = md.replace(anchor, FAQ_ADD + anchor); changed = true; }
  }
  if (changed) {
    await writeFile(readmePath, md);
    console.log(`UPGRADED ${slug}`);
    touched++;
  } else {
    console.log(`OK ${slug} (already upgraded)`);
  }
}
console.log(`\n${touched} README(s) upgraded. Re-push the touched actors for the change to reach the Store.`);
