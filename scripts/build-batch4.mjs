#!/usr/bin/env node
/** Batch 4 — court-opinions-search, podcast-search. Faithful live fixtures. */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const specsDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'specs');
const USER = 'oblanceolate_mandola';
const UA = 'actor-factory/1.0 (Apify Actor; contact via Apify profile)';
const getJson = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const specs = [];

// 1. CourtListener — US court opinions
{
  const data = await getJson('https://www.courtlistener.com/api/rest/v4/search/?q=data+privacy&type=o');
  const results = (data.results || []).slice(0, 2).map((r) => pick(r, ['caseName', 'court', 'dateFiled', 'docketNumber', 'absolute_url', 'status', 'citeCount', 'judge', 'cluster_id', 'citation']));
  specs.push({ file: 'court-opinions-search', spec: {
    slug: 'court-opinions-search', username: USER,
    title: 'Court Opinions Search — US Case Law to JSON',
    shortDescription: 'Search millions of US court opinions by keyword and get case name, court, date, docket number and citation count as JSON at $0.004 per opinion.',
    seoTitle: 'Court Opinions Search — US Case Law to JSON',
    seoDescription: 'Court opinions scraper & API: search US case law by keyword for case name, court, date and citation count as JSON. For legal and due-diligence AI agents.',
    categories: ['BUSINESS', 'NEWS', 'AUTOMATION'],
    pricing: { pricePerResultUsd: 0.004 }, sourceMode: 'firstHit', defaults: { maxResults: 20 },
    query: { label: 'Keyword, party, or topic', description: 'Term to search across US court opinions (CourtListener), e.g. a legal topic, party name, or case keyword.', example: 'data privacy', prefill: ['data privacy'] },
    readme: {
      intro: 'Case law is where legal precedent and corporate disputes live. This actor turns a keyword into the matching US court opinions from CourtListener, so legal, compliance, and due-diligence agents can read case law as structured data — a natural companion to SEC filings and regulatory documents.',
      bullets: [
        'Search millions of US federal and state court opinions by keyword, party, or topic',
        'Each result: case name, court, filing date, docket number, citation count, status, opinion URL',
        'Filter by postedAfter for new-ruling monitoring',
        'Batch many queries per run; cap spend with maxResults',
        'Agent-ready: flat JSON with the opinion URL + scrapedAt for citation',
      ],
      sampleOutput: { query: 'data privacy', source: 'courtlistener', title: 'U.S. Office of Pers. Mgmt. Data Sec. Breach Litig.', court: 'Court of Appeals for the D.C. Circuit', docketNumber: '17-5117', citeCount: 12, postedAt: '2019-06-21T00:00:00.000Z', url: 'https://www.courtlistener.com/opinion/4631839/', sourceUrl: 'https://www.courtlistener.com/api/rest/v4/search/?q=data+privacy&type=o', scrapedAt: '2026-06-12T10:00:00.000Z' },
      faq: [
        { q: 'What courts are covered?', a: 'US federal and state courts indexed by CourtListener (Free Law Project), spanning millions of opinions.' },
        { q: 'How do I track new rulings?', a: 'Set postedAfter to your last-run date and schedule it for an incremental case-law feed.' },
        { q: 'What is the source?', a: 'The CourtListener API by the Free Law Project — a public, non-profit legal database.' },
      ],
    },
    sources: [{ id: 'courtlistener', urlTemplate: 'https://www.courtlistener.com/api/rest/v4/search/?q={query}', params: { type: 'o' }, itemsPath: 'results', fields: {
      jobId: { path: 'cluster_id', transform: 'toString' }, title: 'caseName', court: 'court',
      docketNumber: 'docketNumber', status: 'status', citeCount: 'citeCount',
      judge: { path: 'judge', optional: true }, citation: { path: 'citation', optional: true },
      url: { path: 'absolute_url', transform: 'clUrl' },
      postedAt: { path: 'dateFiled', transform: 'toIso' },
    } }],
    fixtures: { courtlistener: { results } },
  } });
}

// 2. Apple Podcasts (iTunes Search API)
{
  const data = await getJson('https://itunes.apple.com/search?term=technology&entity=podcast&limit=2');
  const results = (data.results || []).slice(0, 2).map((r) => pick(r, ['trackName', 'artistName', 'kind', 'primaryGenreName', 'trackViewUrl', 'releaseDate', 'trackCount', 'trackId', 'feedUrl']));
  specs.push({ file: 'podcast-search', spec: {
    slug: 'podcast-search', username: USER,
    title: 'Podcast Search — Apple Podcasts to JSON',
    shortDescription: 'Search Apple Podcasts by keyword and get show title, creator, genre, episode count, feed and URL as JSON at $0.002 per result.',
    seoTitle: 'Podcast Search — Apple Podcasts to JSON',
    seoDescription: 'Podcast scraper & API: search Apple Podcasts by keyword for show title, creator, genre, episode count and RSS feed as JSON. For content-discovery AI agents.',
    categories: ['NEWS', 'SOCIAL_MEDIA', 'AUTOMATION'],
    pricing: { pricePerResultUsd: 0.002 }, sourceMode: 'firstHit', defaults: { maxResults: 50 },
    query: { label: 'Keyword or topic', description: 'Term to search across Apple Podcasts, e.g. a topic, show name, or creator.', example: 'technology', prefill: ['technology'] },
    readme: {
      intro: 'Podcasts are a fast-growing content and research surface. This actor turns a keyword into the matching shows on Apple Podcasts with their genre, episode count, and RSS feed, so content, research, and marketing agents can discover and analyze podcasts as structured data.',
      bullets: [
        'Search Apple Podcasts by keyword, topic, show, or creator',
        'Each result: show title, creator, genre, episode count, RSS feed URL, Apple Podcasts URL, latest release date',
        'The RSS feed URL lets agents fetch full episode lists downstream',
        'Batch many terms per run; cap spend with maxResults',
        'Agent-ready: flat JSON with the show URL + scrapedAt for citation',
      ],
      sampleOutput: { query: 'technology', source: 'itunes', title: 'The Future of Everything', artist: 'Stanford Engineering', genre: 'Science', episodes: 380, feedUrl: 'https://feeds.example.com/future.xml', url: 'https://podcasts.apple.com/us/podcast/id1235836821', postedAt: '2026-05-29T14:00:00.000Z', sourceUrl: 'https://itunes.apple.com/search?term=technology&entity=podcast', scrapedAt: '2026-06-12T10:00:00.000Z' },
      faq: [
        { q: 'Does it return episodes?', a: 'It returns shows with their RSS feed URL; fetch that feed downstream for the full episode list.' },
        { q: 'Is it just podcasts?', a: 'This actor searches Apple Podcasts. The same iTunes Search API also covers apps, music, and audiobooks if you need those.' },
        { q: 'What is the source?', a: 'The public Apple iTunes Search API — no key required.' },
      ],
    },
    sources: [{ id: 'itunes', urlTemplate: 'https://itunes.apple.com/search?term={query}', params: { entity: 'podcast', limit: '50' }, itemsPath: 'results', fields: {
      jobId: { path: 'trackId', transform: 'toString' }, title: 'trackName', artist: 'artistName',
      genre: 'primaryGenreName', episodes: { path: 'trackCount', optional: true },
      feedUrl: { path: 'feedUrl', optional: true }, url: 'trackViewUrl',
      postedAt: { path: 'releaseDate', transform: 'toIso' },
    } }],
    fixtures: { itunes: { results } },
  } });
}

for (const { file, spec } of specs) {
  await writeFile(path.join(specsDir, `${file}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote specs/${file}.json`);
}
console.log(`\n${specs.length} batch-4 specs written with live fixtures.`);
