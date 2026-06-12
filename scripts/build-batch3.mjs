#!/usr/bin/env node
/** Batch 3 — gdelt-news-monitor, wikipedia-search. Faithful live fixtures (GDELT calls spaced for its 1-req/5s soft limit). */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const specsDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'specs');
const USER = 'oblanceolate_mandola';
const UA = 'actor-factory/1.0 (Apify Actor; contact via Apify profile)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`non-JSON from ${url}: ${text.slice(0, 80)}`); }
};

const specs = [];

// 1. GDELT news monitor (space the call for the 1-req/5s soft limit; one retry)
let gdelt;
for (let i = 0; i < 3 && !gdelt; i += 1) {
  try { gdelt = await getJson('https://api.gdeltproject.org/api/v2/doc/doc?query=anthropic&format=json&maxrecords=2&sort=datedesc'); }
  catch (e) { console.log(`gdelt attempt ${i + 1}: ${e.message.slice(0, 60)} — waiting 6s`); await sleep(6000); }
}
{
  const articles = (gdelt.articles || []).slice(0, 2).map((a) => ({
    url: a.url, title: a.title, domain: a.domain, seendate: a.seendate, language: a.language, sourcecountry: a.sourcecountry,
  }));
  specs.push({ file: 'gdelt-news-monitor', spec: {
    slug: 'gdelt-news-monitor', username: USER,
    title: 'GDELT News Monitor — Global News Mentions to JSON',
    shortDescription: 'Search global news (GDELT, 100+ languages) by keyword and get article title, source, domain, country and date as JSON — $0.002 per article.',
    seoTitle: 'GDELT News Scraper — Global News & Brand Mention Search to JSON API',
    seoDescription: 'Search worldwide news by keyword via GDELT. Title, source domain, country, date as JSON for brand-monitoring & news-tracking AI agents. $2 per 1,000, no coding.',
    categories: ['NEWS', 'SOCIAL_MEDIA', 'AUTOMATION'],
    viewFields: ['query', 'title', 'domain', 'sourceCountry', 'postedAt', 'url'],
    pricing: { pricePerResultUsd: 0.002 }, sourceMode: 'firstHit', defaults: { maxResults: 50 },
    query: { label: 'Keyword, brand, or topic', description: 'Term to search across worldwide online news, e.g. a company, product, person, or event. GDELT indexes news in 100+ languages.', example: 'anthropic', prefill: ['anthropic'] },
    readme: {
      intro: 'GDELT monitors the world’s news media in real time across 100+ languages. This actor turns a keyword into the matching global news coverage, so brand-monitoring, PR, and market-intelligence agents can track what the world is publishing about any topic as structured data.',
      bullets: [
        'Search worldwide online news by keyword, brand, person, or event (100+ languages)',
        'Each result: article title, publisher domain, source country, language, publication date, URL',
        'Sorted newest-first; filter by postedAfter for an incremental mention feed',
        'Batch many terms per run; cap spend with maxResults',
        'Agent-ready: flat JSON with the article URL + scrapedAt for citation',
      ],
      sampleOutput: { query: 'anthropic', source: 'gdelt', title: 'Anthropic launches new model', domain: 'techcrunch.com', sourceCountry: 'US', postedAt: '2026-06-11T14:30:00.000Z', url: 'https://techcrunch.com/...', sourceUrl: 'https://api.gdeltproject.org/api/v2/doc/doc?query=anthropic', scrapedAt: '2026-06-11T15:00:00.000Z' },
      faq: [
        { q: 'How current is the news?', a: 'GDELT updates continuously; results are sorted newest-first so you see the latest coverage.' },
        { q: 'Does it cover non-English news?', a: 'Yes — GDELT monitors news in 100+ languages worldwide, with the source country on each result.' },
        { q: 'Can I monitor a brand over time?', a: 'Yes — search the term and use postedAfter on a schedule to catch only new coverage.' },
      ],
    },
    sources: [{ id: 'gdelt', urlTemplate: 'https://api.gdeltproject.org/api/v2/doc/doc?query={query}', params: { format: 'json', maxrecords: '50', sort: 'datedesc' }, itemsPath: 'articles', fields: {
      title: 'title', url: 'url', domain: 'domain', language: 'language', sourceCountry: 'sourcecountry',
      postedAt: { path: 'seendate', transform: 'gdeltDate' },
    } }],
    fixtures: { gdelt: { articles } },
  } });
}

// 2. Wikipedia search
{
  const data = await getJson('https://en.wikipedia.org/w/rest.php/v1/search/page?q=agentic+commerce&limit=2');
  const pages = (data.pages || []).slice(0, 2).map((p) => ({ id: p.id, key: p.key, title: p.title, excerpt: p.excerpt, description: p.description }));
  specs.push({ file: 'wikipedia-search', spec: {
    slug: 'wikipedia-search', username: USER,
    title: 'Wikipedia Search — Article Lookup to JSON',
    shortDescription: 'Search Wikipedia by keyword and get matching article titles, descriptions and snippets as JSON — $0.001 per result.',
    seoTitle: 'Wikipedia Search Scraper — Article Lookup to JSON API (title, description, snippet)',
    seoDescription: 'Search Wikipedia by keyword. Article title, short description, matching snippet as JSON for grounding & research AI agents. $1 per 1,000, no coding.',
    categories: ['AI', 'NEWS', 'AUTOMATION'],
    viewFields: ['query', 'title', 'description', 'key'],
    pricing: { pricePerResultUsd: 0.001 }, sourceMode: 'firstHit', defaults: { maxResults: 50 },
    query: { label: 'Search term', description: 'Term to look up on Wikipedia, e.g. a person, company, concept, or place — for grounding and disambiguation.', example: 'agentic commerce', prefill: ['agentic commerce'] },
    readme: {
      intro: 'Agents grounding their answers need fast, structured access to encyclopedic facts. This actor turns a query into the matching Wikipedia articles with their short descriptions and snippets, so research and RAG agents can disambiguate entities and cite a stable source.',
      bullets: [
        'Search Wikipedia by keyword for matching articles',
        'Each result: page title, short description, matching snippet (clean text), page key',
        'Open any article at en.wikipedia.org/wiki/{key}',
        'Batch many terms per run; cap spend with maxResults',
        'Agent-ready: flat JSON with sourceUrl + scrapedAt for citation',
      ],
      sampleOutput: { query: 'agentic commerce', source: 'wikipedia', title: 'Agentic commerce', description: 'Form of automated electronic commerce', key: 'Agentic_commerce', sourceUrl: 'https://en.wikipedia.org/w/rest.php/v1/search/page?q=agentic+commerce', scrapedAt: '2026-06-11T15:00:00.000Z' },
      faq: [
        { q: 'How do I open the article?', a: 'Each result includes its page key; the article is at en.wikipedia.org/wiki/{key}.' },
        { q: 'Are snippets clean text?', a: 'Yes — search-match HTML in excerpts is stripped to readable text.' },
        { q: 'What is the source?', a: 'The official Wikimedia REST search API for English Wikipedia.' },
      ],
    },
    sources: [{ id: 'wikipedia', urlTemplate: 'https://en.wikipedia.org/w/rest.php/v1/search/page?q={query}', params: { limit: '50' }, itemsPath: 'pages', fields: {
      jobId: { path: 'id', transform: 'toString' }, title: 'title', key: 'key', description: 'description',
      excerpt: { path: 'excerpt', transform: 'stripHtml' },
    } }],
    fixtures: { wikipedia: { pages } },
  } });
}

for (const { file, spec } of specs) {
  await writeFile(path.join(specsDir, `${file}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote specs/${file}.json`);
}
console.log(`\n${specs.length} batch-3 specs written with live fixtures.`);
