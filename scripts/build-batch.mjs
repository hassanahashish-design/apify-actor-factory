#!/usr/bin/env node
/**
 * One-off: fetch trimmed live fixtures for the current batch of candidate sources
 * and write their spec.json files into specs/. Run once; specs are then permanent.
 * Keeps the factory honest — fixtures are REAL captured responses, not invented.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const specsDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'specs');
const USER = 'oblanceolate_mandola';
const UA = 'actor-factory/1.0 (Apify Actor; contact via Apify profile)';

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

const specs = [];

// 1. SEC EDGAR full-text filings
{
  const data = await getJson('https://efts.sec.gov/LATEST/search-index?q=tesla&forms=8-K', { 'user-agent': UA });
  const hits = data.hits.hits.slice(0, 2).map((h) => ({ _id: h._id, _source: pick(h._source, ['file_date', 'file_type', 'root_form', 'display_names', 'ciks']) }));
  specs.push({
    file: 'sec-edgar-filings',
    spec: {
      slug: 'sec-edgar-filings', username: USER,
      title: 'SEC EDGAR Filings Search — Company Filings to JSON',
      shortDescription: 'Search SEC EDGAR full-text for company filings (8-K, 10-K, S-1 and more) and get filer, form type, date and document URL as JSON — $0.005 per filing.',
      seoTitle: 'SEC EDGAR Filings Scraper — Full-Text Filing Search to JSON API',
      seoDescription: 'Search SEC EDGAR full-text filings by keyword or company. Form type, filer, date, document link as JSON for finance & due-diligence AI agents. $5 per 1,000, no coding.',
      seoTitleSafe: true,
      categories: ['BUSINESS', 'NEWS', 'AUTOMATION'],
      viewFields: ['query', 'title', 'form', 'filedAt', 'filer', 'url'],
      pricing: { pricePerResultUsd: 0.005 },
      sourceMode: 'firstHit', defaults: { maxResults: 100 },
      query: { label: 'Keyword or company name', description: 'Full-text query across all SEC filings, e.g. "artificial intelligence", "Tesla", or a person/product name. Matches filing text, not just company names.', example: 'artificial intelligence', prefill: ['artificial intelligence'] },
      readme: {
        intro: 'Every material corporate event in the US is disclosed in an SEC filing — acquisitions, executive changes, risk factors, new products. This actor turns a keyword into the matching filings across all of EDGAR, so finance, legal, and due-diligence agents can read corporate disclosures as structured data instead of scraping HTML.',
        bullets: [
          'Full-text search across all SEC EDGAR filings by keyword, company, person, or product',
          'Each result: filing title, form type (8-K/10-K/S-1/…), filing date, filer name + CIK, direct document URL',
          'Filter by keyword, date posted (postedAfter) for incremental disclosure monitoring',
          'Batch many queries per run; cap spend with maxResults',
          'Agent-ready: flat JSON, sourceUrl + scrapedAt on every item for citation',
        ],
        sampleOutput: { query: 'artificial intelligence', source: 'sec_edgar', title: 'EX-10.17(A)', form: 'EX-10.17(A)', filer: ['ViewRay, Inc. (VRAYQ) (CIK 0001597313)'], filedAt: '2015-07-29', url: 'https://www.sec.gov/Archives/edgar/data/...', sourceUrl: 'https://efts.sec.gov/LATEST/search-index?q=artificial+intelligence', scrapedAt: '2026-06-11T09:00:00.000Z' },
        faq: [
          { q: 'What does it search?', a: 'The SEC EDGAR full-text index, which covers filings from 2001 onward across every form type.' },
          { q: 'How do I get only recent filings?', a: 'Set postedAfter to an ISO date (YYYY-MM-DD); combined with a schedule this becomes a live disclosure feed.' },
          { q: 'Is this affiliated with the SEC?', a: 'No — it reads the SEC’s public EDGAR API. Always confirm against the official filing for legal use.' },
        ],
      },
      sources: [{
        id: 'sec_edgar',
        urlTemplate: 'https://efts.sec.gov/LATEST/search-index?q={query}',
        headers: { 'user-agent': UA },
        itemsPath: 'hits.hits',
        fields: {
          jobId: '_id', title: '_source.file_type', form: '_source.root_form',
          filer: '_source.display_names', cik: '_source.ciks.0',
          filedAt: { path: '_source.file_date', transform: 'toIso' },
          postedAt: { path: '_source.file_date', transform: 'toIso' },
          url: '_id',
        },
      }],
      fixtures: { sec_edgar: { hits: { hits } } },
    },
  });
}

// 2. OpenAlex research papers
{
  const data = await getJson('https://api.openalex.org/works?search=large+language+models&per-page=2');
  const results = data.results.slice(0, 2).map((w) => ({
    id: w.id, title: w.title, publication_year: w.publication_year, publication_date: w.publication_date,
    cited_by_count: w.cited_by_count, doi: w.doi,
    primary_location: { source: { display_name: w.primary_location?.source?.display_name ?? null } },
    authorships: (w.authorships || []).slice(0, 3).map((a) => ({ author: { display_name: a.author?.display_name } })),
  }));
  specs.push({
    file: 'research-paper-search',
    spec: {
      slug: 'research-paper-search', username: USER,
      title: 'Research Paper Search — Academic Papers to JSON (OpenAlex)',
      shortDescription: 'Search 250M+ academic papers by topic and get title, authors, year, citation count, venue and DOI as JSON — $0.003 per paper.',
      seoTitle: 'Research Paper Scraper — Academic Literature Search to JSON (OpenAlex API)',
      seoDescription: 'Search academic papers by topic via OpenAlex. Title, authors, year, citations, DOI, venue as JSON for research & literature-review AI agents. $3 per 1,000, no coding.',
      categories: ['AI', 'NEWS', 'AUTOMATION'],
      viewFields: ['query', 'title', 'year', 'citations', 'venue', 'doi'],
      pricing: { pricePerResultUsd: 0.003 },
      sourceMode: 'firstHit', defaults: { maxResults: 100 },
      query: { label: 'Research topic or keywords', description: 'Topic to search across academic literature, e.g. "large language models", "CRISPR gene editing", "agentic commerce".', example: 'large language models', prefill: ['large language models'] },
      readme: {
        intro: 'Literature review is the slowest part of any research task. This actor turns a topic into the most relevant academic papers from OpenAlex (250M+ works), so research and grounding agents can cite real, dated, peer-reviewed sources instead of hallucinating references.',
        bullets: [
          'Search 250M+ academic works by topic across every field',
          'Each result: title, authors, publication year + date, citation count, venue, DOI',
          'Filter by postedAfter for "papers since my last run" monitoring of a field',
          'Batch many topics per run; cap spend with maxResults',
          'Agent-ready: flat JSON with DOI + sourceUrl for citation and grounding',
        ],
        sampleOutput: { query: 'large language models', source: 'openalex', title: 'ChatGPT for good? On opportunities and challenges of large language models for education', year: 2023, citations: 4943, venue: 'Learning and Individual Differences', doi: 'https://doi.org/10.1016/j.lindif.2023.102274', sourceUrl: 'https://api.openalex.org/works?search=large+language+models', scrapedAt: '2026-06-11T09:00:00.000Z' },
        faq: [
          { q: 'Where does the data come from?', a: 'OpenAlex, a free and open index of scholarly works (successor to Microsoft Academic Graph).' },
          { q: 'Can I track new papers in a field?', a: 'Yes — set postedAfter and run on a schedule for an incremental literature feed.' },
          { q: 'Does it include citation counts?', a: 'Yes, every result carries its current cited-by count so you can rank by impact.' },
        ],
      },
      sources: [{
        id: 'openalex',
        urlTemplate: 'https://api.openalex.org/works?search={query}',
        params: { per_page: '50' },
        itemsPath: 'results',
        fields: {
          jobId: 'id', title: 'title', year: 'publication_year',
          citations: 'cited_by_count', doi: 'doi',
          venue: 'primary_location.source.display_name',
          firstAuthor: 'authorships.0.author.display_name',
          postedAt: { path: 'publication_date', transform: 'toIso' },
          url: 'id',
        },
      }],
      fixtures: { openalex: { results } },
    },
  });
}

// 3. GitHub repository search
{
  const data = await getJson('https://api.github.com/search/repositories?q=ai+agent&sort=stars&order=desc&per_page=2');
  const items = data.items.slice(0, 2).map((r) => pick(r, ['full_name', 'description', 'html_url', 'stargazers_count', 'language', 'open_issues_count', 'forks_count', 'pushed_at', 'created_at']));
  specs.push({
    file: 'github-repo-search',
    spec: {
      slug: 'github-repo-search', username: USER,
      title: 'GitHub Repository Search — Repos to JSON',
      shortDescription: 'Search GitHub repositories by keyword or qualifier and get stars, language, activity, issues and URL as JSON — $0.003 per repo.',
      seoTitle: 'GitHub Repo Scraper — Repository Search to JSON API (stars, language, activity)',
      seoDescription: 'Search GitHub repositories by keyword. Stars, language, last push, open issues, forks as JSON for developer-tooling & research AI agents. $3 per 1,000, no coding.',
      categories: ['DEVELOPER_TOOLS', 'AI', 'AUTOMATION'],
      viewFields: ['query', 'title', 'stars', 'language', 'pushedAt', 'url'],
      pricing: { pricePerResultUsd: 0.003 },
      sourceMode: 'firstHit', defaults: { maxResults: 100 },
      query: { label: 'GitHub search query', description: 'A GitHub repository search query — keywords plus optional qualifiers, e.g. "ai agent", "language:rust stars:>1000", "topic:rag".', example: 'ai agent', prefill: ['ai agent'] },
      readme: {
        intro: 'Whether you are vetting a dependency, tracking a competitor’s open-source, or finding tools for a build, the signal is in the repo metadata: stars, recency, issue load. This actor turns a GitHub search into structured repo records so developer and research agents can rank and vet repositories without parsing HTML.',
        bullets: [
          'Search GitHub repositories with full query-qualifier support (language:, stars:, topic:, …)',
          'Each result: full name, description, stars, language, forks, open issues, last-push + created dates, URL',
          'Filter by keyword/postedAfter; sorted by stars by default',
          'Batch many queries per run; cap spend with maxResults',
          'Optional: set a GITHUB_TOKEN secret env var to raise the rate limit for large runs',
        ],
        sampleOutput: { query: 'ai agent', source: 'github', title: 'NousResearch/hermes-agent', stars: 190459, language: 'Python', pushedAt: '2026-06-11T09:30:15.000Z', url: 'https://github.com/NousResearch/hermes-agent', sourceUrl: 'https://api.github.com/search/repositories?q=ai+agent', scrapedAt: '2026-06-11T09:00:00.000Z' },
        faq: [
          { q: 'Do I need a GitHub token?', a: 'No for small runs (unauthenticated search allows ~10 requests/min). For large batches, add a GITHUB_TOKEN secret env var to lift the limit.' },
          { q: 'Can I use search qualifiers?', a: 'Yes — anything GitHub search supports, e.g. "language:go stars:>500 pushed:>2026-01-01".' },
          { q: 'How are results ordered?', a: 'By stars, descending, so the most prominent repositories come first.' },
        ],
      },
      sources: [{
        id: 'github',
        urlTemplate: 'https://api.github.com/search/repositories?q={query}',
        params: { sort: 'stars', order: 'desc', per_page: '50' },
        itemsPath: 'items',
        fields: {
          title: 'full_name', description: 'description', stars: 'stargazers_count',
          language: 'language', forks: 'forks_count', openIssues: 'open_issues_count',
          postedAt: { path: 'created_at', transform: 'toIso' },
          pushedAt: { path: 'pushed_at', transform: 'toIso' },
          url: 'html_url',
        },
      }],
      fixtures: { github: { items } },
    },
  });
}

// 4. Hacker News monitor (Algolia)
{
  const data = await getJson('https://hn.algolia.com/api/v1/search?query=anthropic&tags=story&hitsPerPage=2');
  const hits = data.hits.slice(0, 2).map((h) => pick(h, ['title', 'url', 'author', 'points', 'num_comments', 'created_at', 'objectID']));
  specs.push({
    file: 'hacker-news-monitor',
    spec: {
      slug: 'hacker-news-monitor', username: USER,
      title: 'Hacker News Search — Stories & Mentions to JSON',
      shortDescription: 'Search Hacker News stories by keyword and get title, points, comments, author, date and URL as JSON — $0.002 per story.',
      seoTitle: 'Hacker News Scraper — Story & Keyword Search to JSON API',
      seoDescription: 'Search Hacker News stories by keyword. Points, comments, author, date, URL as JSON for brand-monitoring & trend-spotting AI agents. $2 per 1,000, no coding.',
      categories: ['NEWS', 'SOCIAL_MEDIA', 'AUTOMATION'],
      viewFields: ['query', 'title', 'points', 'comments', 'author', 'url'],
      pricing: { pricePerResultUsd: 0.002 },
      sourceMode: 'firstHit', defaults: { maxResults: 100 },
      query: { label: 'Keyword, brand, or topic', description: 'Term to search across Hacker News stories, e.g. a company name, product, or technology.', example: 'anthropic', prefill: ['anthropic'] },
      readme: {
        intro: 'Hacker News is where launches break and reputations are made. This actor turns a keyword into the matching HN stories with their scores and discussion volume, so brand-monitoring, trend-spotting, and launch-tracking agents can catch the conversation while it is live.',
        bullets: [
          'Search all Hacker News stories by keyword, brand, product, or topic',
          'Each result: title, points, comment count, author, created date, story URL + HN object ID',
          'Filter by postedAfter for "mentions since my last check" monitoring',
          'Batch many terms per run; cap spend with maxResults',
          'Agent-ready: flat JSON with sourceUrl + scrapedAt on every item',
        ],
        sampleOutput: { query: 'anthropic', source: 'hackernews', title: 'Anthropic acquires Bun', points: 2192, comments: 1073, author: 'ryanvogel', url: 'https://bun.com/blog/bun-joins-anthropic', sourceUrl: 'https://hn.algolia.com/api/v1/search?query=anthropic', scrapedAt: '2026-06-11T09:00:00.000Z' },
        faq: [
          { q: 'Does it cover comments too?', a: 'v1 searches stories. Each result includes the comment count and links to the HN discussion via the object ID.' },
          { q: 'How do I monitor a brand over time?', a: 'Set postedAfter and run on a schedule to get only new mentions since the last run.' },
          { q: 'What is the data source?', a: 'The official Hacker News Search API (Algolia), which indexes all HN stories and comments.' },
        ],
      },
      sources: [{
        id: 'hackernews',
        urlTemplate: 'https://hn.algolia.com/api/v1/search?query={query}',
        params: { tags: 'story', hitsPerPage: '50' },
        itemsPath: 'hits',
        fields: {
          jobId: 'objectID', title: 'title', url: 'url', author: 'author',
          points: 'points', comments: 'num_comments',
          postedAt: { path: 'created_at', transform: 'toIso' },
        },
      }],
      fixtures: { hackernews: { hits } },
    },
  });
}

for (const { file, spec } of specs) {
  await writeFile(path.join(specsDir, `${file}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote specs/${file}.json (${spec.sources[0].id}, ${Object.keys(spec.fixtures[spec.sources[0].id])[0]} fixture)`);
}
console.log(`\n${specs.length} specs written with live fixtures.`);
