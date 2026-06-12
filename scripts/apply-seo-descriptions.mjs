#!/usr/bin/env node
/**
 * Apply Apify-playbook-compliant SEO descriptions (145–155 chars, keyword variations,
 * lists the data, names the buyer, no "etc.") to every pushed actor via the API.
 * Also sets the warm `description` to the spec's shortDescription. No rebuild needed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const factoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const token = JSON.parse(await readFile(path.join(homedir(), '.apify', 'auth.json'), 'utf8')).token;

// Each 145–155 chars: "<Thing> scraper & API: <action> for <fields> as JSON. For <buyer> AI agents."
const SEO = {
  'company-hiring-signals': 'Hiring signals & job postings API: scrape live jobs from Greenhouse, Lever and Ashby by company name as JSON. For sales-intel AI agents. Pay per result.',
  'sec-edgar-filings': 'SEC EDGAR filings scraper & API: search full-text filings by company or keyword for form type, filer and date as clean JSON. For due-diligence AI agents.',
  'research-paper-search': 'Academic paper scraper & API: search 250M+ research papers by topic for title, authors, year, citations and DOI as JSON. For research and RAG AI agents.',
  'github-repo-search': 'GitHub repository scraper & API: search repos by keyword for stars, language, activity and open issues as clean JSON. For developer and vetting AI agents.',
  'hacker-news-monitor': 'Hacker News scraper & API: search stories by keyword for points, comments, author and date as JSON. For brand-monitoring and trend-spotting AI agents.',
  'federal-register-monitor': 'Federal Register scraper & API: search US regulations and rules by keyword for agency, type and date as JSON. For compliance and policy AI agents.',
  'clinical-trials-search': 'Clinical trials scraper & API: search ClinicalTrials.gov by condition, drug or sponsor for status, phase and NCT id as JSON. For pharma and biotech AI agents.',
  'stackoverflow-search': 'Stack Overflow scraper & API: search questions by keyword for score, answers, tags and views as clean JSON. For developer-support and docs AI agents.',
  'gdelt-news-monitor': 'Global news scraper & API: search worldwide news by keyword (GDELT, 100+ languages) for source, country and date as JSON. For news-monitoring AI agents.',
  'wikipedia-search': 'Wikipedia search API & scraper: look up articles by keyword for title, short description and snippet as JSON. For grounding and research AI agents.',
};

const results = [];
for (const [slug, seoDescription] of Object.entries(SEO)) {
  const len = seoDescription.length;
  const inRange = len >= 145 && len <= 155;
  // keep warm `description` = the spec's shortDescription (has the data + price)
  let shortDescription;
  try {
    shortDescription = JSON.parse(await readFile(path.join(path.dirname(factoryRoot), slug, '.actor', 'actor.json'), 'utf8')).description;
  } catch { /* actor dir may not exist yet */ }
  try {
    const body = { seoDescription };
    if (shortDescription) body.description = shortDescription;
    const res = await fetch(`https://api.apify.com/v2/acts/oblanceolate_mandola~${slug}?token=${token}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    console.log(`${inRange ? '✅' : '⚠️ '} ${slug.padEnd(26)} seoDesc ${len}c${inRange ? '' : ' (OUT OF 145–155!)'}`);
    results.push({ slug, len, inRange, ok: true });
  } catch (err) {
    console.log(`❌ ${slug.padEnd(26)} ${err.message.slice(0, 80)}`);
    results.push({ slug, ok: false });
  }
}

// keep specs in sync so future regen/push matches
for (const [slug, seoDescription] of Object.entries(SEO)) {
  const specPath = path.join(factoryRoot, 'specs', `${slug}.json`);
  try {
    const spec = JSON.parse(await readFile(specPath, 'utf8'));
    spec.seoDescription = seoDescription;
    await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  } catch { /* spec optional */ }
}

const bad = results.filter((r) => r.ok && !r.inRange);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} updated; ${bad.length} out of 145–155 range.`);
process.exit(bad.length || results.some((r) => !r.ok) ? 1 : 0);
