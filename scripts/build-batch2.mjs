#!/usr/bin/env node
/** Batch 2 — federal-register, clinical-trials, stackoverflow. Faithful live fixtures. */
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
const trim = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : s);

const specs = [];

// 1. Federal Register — US regulatory documents
{
  const data = await getJson('https://www.federalregister.gov/api/v1/documents.json?per_page=2&conditions%5Bterm%5D=artificial+intelligence');
  const results = (data.results || []).slice(0, 2).map((d) => ({
    document_number: d.document_number, title: d.title, type: d.type, publication_date: d.publication_date,
    agencies: (d.agencies || []).map((a) => ({ name: a.name })), html_url: d.html_url, abstract: trim(d.abstract, 220),
  }));
  specs.push({ file: 'federal-register-monitor', spec: {
    slug: 'federal-register-monitor', username: USER,
    title: 'Federal Register Monitor — US Regulations to JSON',
    shortDescription: 'Search the US Federal Register for rules, notices and executive orders by keyword and get title, agency, type, date and URL as JSON — $0.004 per document.',
    seoTitle: 'Federal Register Scraper — US Regulation & Rule Search to JSON API',
    seoDescription: 'Search US Federal Register documents by keyword. Title, agency, type, date, URL as JSON for compliance & policy AI agents. $4 per 1,000, no coding.',
    categories: ['NEWS', 'BUSINESS', 'AUTOMATION'],
    viewFields: ['query', 'title', 'docType', 'agency', 'postedAt', 'url'],
    pricing: { pricePerResultUsd: 0.004 }, sourceMode: 'firstHit', defaults: { maxResults: 100 },
    query: { label: 'Keyword or topic', description: 'Term to search across US Federal Register documents, e.g. "artificial intelligence", "data privacy", an agency or program name.', example: 'artificial intelligence', prefill: ['artificial intelligence'] },
    readme: {
      intro: 'New US regulations, proposed rules, and executive orders all land in the Federal Register first. This actor turns a keyword into the matching documents, so compliance, policy, and legal agents can monitor the regulatory pipeline as structured data — a natural companion to corporate filings.',
      bullets: [
        'Search every US Federal Register document by keyword or agency',
        'Each result: title, document type (rule/proposed rule/notice), issuing agency, publication date, official URL, abstract',
        'Filter by postedAfter for a daily regulatory-change feed',
        'Batch many topics per run; cap spend with maxResults',
        'Agent-ready: flat JSON with the official html_url + scrapedAt for citation',
      ],
      sampleOutput: { query: 'artificial intelligence', source: 'federal_register', title: 'Advancing American AI', docType: 'Presidential Document', agency: ['Executive Office of the President'], postedAt: '2026-01-15T00:00:00.000Z', url: 'https://www.federalregister.gov/documents/...', sourceUrl: 'https://www.federalregister.gov/api/v1/documents.json?conditions[term]=artificial+intelligence', scrapedAt: '2026-06-11T09:00:00.000Z' },
      faq: [
        { q: 'What document types are covered?', a: 'Rules, proposed rules, notices, and presidential documents — everything published in the daily Federal Register.' },
        { q: 'How do I track new regulations?', a: 'Set postedAfter to your last-run date and schedule it for an incremental regulatory feed.' },
        { q: 'Is the data official?', a: 'Yes — it comes from the official Federal Register API (federalregister.gov); each result links to the canonical document.' },
      ],
    },
    sources: [{ id: 'federal_register', urlTemplate: 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D={query}', params: { per_page: '50', order: 'newest' }, itemsPath: 'results', fields: {
      jobId: 'document_number', title: 'title', docType: 'type', agency: 'agencies', url: 'html_url',
      abstract: { path: 'abstract', optional: true }, postedAt: { path: 'publication_date', transform: 'toIso' },
    } }],
    fixtures: { federal_register: { results } },
  } });
}

// 2. ClinicalTrials.gov v2
{
  const data = await getJson('https://clinicaltrials.gov/api/v2/studies?query.term=diabetes&pageSize=2');
  const studies = (data.studies || []).slice(0, 2).map((s) => {
    const ps = s.protocolSection || {};
    return { protocolSection: {
      identificationModule: { nctId: ps.identificationModule?.nctId, briefTitle: ps.identificationModule?.briefTitle },
      statusModule: { overallStatus: ps.statusModule?.overallStatus, startDateStruct: { date: ps.statusModule?.startDateStruct?.date } },
      sponsorCollaboratorsModule: { leadSponsor: { name: ps.sponsorCollaboratorsModule?.leadSponsor?.name } },
      conditionsModule: { conditions: ps.conditionsModule?.conditions || [] },
      designModule: { phases: ps.designModule?.phases || [] },
    } };
  });
  specs.push({ file: 'clinical-trials-search', spec: {
    slug: 'clinical-trials-search', username: USER,
    title: 'Clinical Trials Search — ClinicalTrials.gov to JSON',
    shortDescription: 'Search ClinicalTrials.gov by condition, drug or sponsor and get trial title, status, phase, sponsor and NCT id as JSON — $0.004 per trial.',
    seoTitle: 'Clinical Trials Scraper — ClinicalTrials.gov Study Search to JSON API',
    seoDescription: 'Search ClinicalTrials.gov by condition, drug or sponsor. Trial title, status, phase, sponsor, NCT id as JSON for pharma & biotech AI agents. $4 per 1,000, no coding.',
    categories: ['BUSINESS', 'NEWS', 'AUTOMATION'],
    viewFields: ['query', 'title', 'status', 'sponsor', 'nctId'],
    pricing: { pricePerResultUsd: 0.004 }, sourceMode: 'firstHit', defaults: { maxResults: 100 },
    query: { label: 'Condition, drug, or sponsor', description: 'Term to search across registered clinical studies, e.g. "diabetes", "semaglutide", or a sponsor/company name.', example: 'diabetes', prefill: ['diabetes'] },
    readme: {
      intro: 'Clinical trial activity is a leading signal of pharma and biotech pipelines. This actor turns a condition, drug, or sponsor into the matching registered studies, so healthcare, investment, and competitive-intelligence agents can read the trial landscape as structured data.',
      bullets: [
        'Search ClinicalTrials.gov by condition, intervention/drug, or sponsor',
        'Each result: brief title, recruitment status, phase, lead sponsor, conditions, NCT id',
        'Open any study at clinicaltrials.gov/study/{nctId}',
        'Batch many terms per run; cap spend with maxResults',
        'Agent-ready: flat JSON with sourceUrl + scrapedAt for citation',
      ],
      sampleOutput: { query: 'diabetes', source: 'clinical_trials', title: 'Effect of Diet on Type 2 Diabetes', status: 'COMPLETED', sponsor: 'University Hospital', nctId: 'NCT00471549', conditions: ['Diabetes Mellitus, Type 2'], sourceUrl: 'https://clinicaltrials.gov/api/v2/studies?query.term=diabetes', scrapedAt: '2026-06-11T09:00:00.000Z' },
      faq: [
        { q: 'How do I open a study?', a: 'Each result includes its NCT id; the study page is clinicaltrials.gov/study/{nctId}.' },
        { q: 'Can I track a company’s pipeline?', a: 'Yes — search by sponsor name and schedule with postedAfter for new-trial alerts.' },
        { q: 'What is the source?', a: 'The official ClinicalTrials.gov v2 API (US National Library of Medicine).' },
      ],
    },
    sources: [{ id: 'clinical_trials', urlTemplate: 'https://clinicaltrials.gov/api/v2/studies?query.term={query}', params: { pageSize: '50' }, itemsPath: 'studies', fields: {
      nctId: 'protocolSection.identificationModule.nctId',
      title: 'protocolSection.identificationModule.briefTitle',
      status: 'protocolSection.statusModule.overallStatus',
      sponsor: 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
      conditions: { path: 'protocolSection.conditionsModule.conditions', optional: true },
      phases: { path: 'protocolSection.designModule.phases', optional: true },
      postedAt: { path: 'protocolSection.statusModule.startDateStruct.date', transform: 'toIso', optional: true },
    } }],
    fixtures: { clinical_trials: { studies } },
  } });
}

// 3. Stack Overflow (Stack Exchange API)
{
  const data = await getJson('https://api.stackexchange.com/2.3/search/advanced?site=stackoverflow&q=rust+async&pagesize=2&order=desc&sort=votes&filter=default');
  const items = (data.items || []).slice(0, 2).map((q) => ({
    title: q.title, score: q.score, answer_count: q.answer_count, is_answered: q.is_answered,
    tags: q.tags, link: q.link, creation_date: q.creation_date, view_count: q.view_count,
  }));
  specs.push({ file: 'stackoverflow-search', spec: {
    slug: 'stackoverflow-search', username: USER,
    title: 'Stack Overflow Search — Questions to JSON',
    shortDescription: 'Search Stack Overflow questions by keyword and get title, score, answers, tags, views and URL as JSON — $0.002 per question.',
    seoTitle: 'Stack Overflow Scraper — Question Search to JSON API (score, tags, answers)',
    seoDescription: 'Search Stack Overflow questions by keyword. Score, answer count, tags, views, URL as JSON for developer-support & docs AI agents. $2 per 1,000, no coding.',
    categories: ['DEVELOPER_TOOLS', 'AI', 'AUTOMATION'],
    viewFields: ['query', 'title', 'score', 'answers', 'tags', 'url'],
    pricing: { pricePerResultUsd: 0.002 }, sourceMode: 'firstHit', defaults: { maxResults: 100 },
    query: { label: 'Keyword or technology', description: 'Term to search across Stack Overflow questions, e.g. "rust async", "pandas merge", a library or error message.', example: 'rust async', prefill: ['rust async'] },
    readme: {
      intro: 'What developers struggle with on Stack Overflow is a map of where a technology is confusing, broken, or trending. This actor turns a keyword into the matching questions with their scores and answer status, so developer-support, documentation, and dev-tool agents can mine real pain points as structured data.',
      bullets: [
        'Search all Stack Overflow questions by keyword, library, or error',
        'Each result: title, score, answer count, answered flag, tags, view count, question URL',
        'Sorted by votes; filter by postedAfter for trend monitoring',
        'Batch many terms per run; cap spend with maxResults',
        'Agent-ready: flat JSON with the question URL + scrapedAt for citation',
      ],
      sampleOutput: { query: 'rust async', source: 'stackoverflow', title: 'How does async/await work in Rust?', score: 145, answers: 3, tags: ['rust', 'async-await', 'rust-tokio'], url: 'https://stackoverflow.com/questions/...', sourceUrl: 'https://api.stackexchange.com/2.3/search/advanced?q=rust+async', scrapedAt: '2026-06-11T09:00:00.000Z' },
      faq: [
        { q: 'Are question titles clean text?', a: 'Yes — HTML entities in titles are decoded so you get readable text.' },
        { q: 'Can I monitor a tag or library over time?', a: 'Yes — search the term and use postedAfter on a schedule to catch new questions.' },
        { q: 'What is the source?', a: 'The official Stack Exchange API for the Stack Overflow site.' },
      ],
    },
    sources: [{ id: 'stackoverflow', urlTemplate: 'https://api.stackexchange.com/2.3/search/advanced?q={query}', params: { site: 'stackoverflow', order: 'desc', sort: 'votes', pagesize: '50', filter: 'default' }, itemsPath: 'items', fields: {
      title: { path: 'title', transform: 'stripHtml' }, score: 'score', answers: 'answer_count',
      isAnswered: 'is_answered', tags: 'tags', views: 'view_count', url: 'link',
      postedAt: { path: 'creation_date', transform: 'epochSecToIso' },
    } }],
    fixtures: { stackoverflow: { items } },
  } });
}

for (const { file, spec } of specs) {
  await writeFile(path.join(specsDir, `${file}.json`), `${JSON.stringify(spec, null, 2)}\n`);
  console.log(`wrote specs/${file}.json`);
}
console.log(`\n${specs.length} batch-2 specs written with live fixtures.`);
