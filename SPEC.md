# Spec reference — the declarative actor format

A spec is one JSON file in `specs/`. `scripts/new-actor.mjs` turns it into a complete,
tested, pushable actor. The engine (`template/src/engine.mjs`) executes it at runtime.
This is the full contract — nothing here is discoverable only by reading code.

## Required top-level fields (scaffold hard-fails without them)

`slug`, `title`, `shortDescription`, `seoTitle`, `seoDescription`, `sources`, `pricing`, `query`,
and `storeCheck` (see below — the competition gate).

## `storeCheck` — the enforced competition gate (since 2026-06-12)

Produce it with `node scripts/store-check.mjs "<topic keywords>"` (2-3 variants buyers would
type) and paste the emitted block in. The scaffolder hard-fails without it, if it is older
than 7 days, or if its verdict-specific field is missing:

```jsonc
"storeCheck": {
  "checkedAt": "2026-06-12",            // must be <=7 days old at scaffold time
  "keywords": ["court opinions", "case law scraper"],
  "establishedIncumbents": 2,           // actors with >=100 runs, deduped across keywords
  "topIncumbent": "user/name (runs)",   // null when OPEN
  "verdict": "CONTESTABLE",             // OPEN | CONTESTABLE | SATURATED
  "differentiation": "...",             // REQUIRED if CONTESTABLE — factual angle no incumbent
                                        //   covers; renders as the first "Why pick this Actor"
                                        //   bullet in the README, so write it for buyers
  "demandEvidence": "...",              // REQUIRED if OPEN — citable signal someone wants this
  "gateOverride": { "reason": "..." }   // ONLY way past SATURATED — a named, auditable bet.
                                        //   Never use in autonomous/cloud runs.
}
```

Why it exists: 8 actors shipped into saturated niches (5-8 incumbents, 100-28k runs) and got
zero external users. The check was prose before; now it's a gate.

## All fields

```jsonc
{
  "slug": "company-hiring-signals",          // hyphenated, exact primary keyword, no brand
  "username": "oblanceolate_mandola",        // STRONGLY recommended — without it, README
                                             //   integration snippets read "your-username/<slug>"
  "title": "Company Hiring Signals — Job Postings to JSON",  // <60 chars: keyword + outcome + format
  "shortDescription": "...ends with the unit price.",        // store card; primary keyword in first 5 words
  "seoTitle": "...",                          // Google SERP title
  "seoDescription": "...140-160 chars, includes price + 'no coding'...",
  "categories": ["JOBS", "BUSINESS", "AUTOMATION"],  // Apify Store categories (UPPERCASE)
  "viewFields": ["query","title","location","postedAt","url"],  // dataset table columns; defaults to first 6 output fields
  "pricing": { "pricePerResultUsd": 0.002 },  // PROVISIONAL at spec time — see PLAYBOOK Stage 7
  "sourceMode": "firstHit",                   // "firstHit" = stop at first source returning data;
                                             //   "all" = query every source and merge
  "defaults": { "maxResults": 1000, "includeDescription": false },
  "query": {
    "label": "Company",                       // used in input schema + README
    "description": "...how to obtain the query value...",
    "example": "stripe",                       // single canary value
    "prefill": ["stripe","openai","palantir"]  // input-schema prefill + README sample
  },
  "readme": {
    "intro": "Loss-aversion lead paragraph...",
    "bullets": ["what it does, one per line"],
    "sampleOutput": { /* one realistic output item, shown near top of README */ },
    "faq": [ { "q": "Question phrased as a search query?", "a": "Answer." } ]
  },
  "sources": [ /* see below */ ],
  "fixtures": { "<sourceId>": { /* a trimmed REAL API response */ } }
}
```

## `sources[]` — one per upstream API

```jsonc
{
  "id": "greenhouse",                          // MUST equal the fixtures key for this source
  "urlTemplate": "https://api.x.com/{query}/jobs",   // {query} is URL-encoded in path
  "itemsPath": "jobs",                          // dot-path to the array; "" means the response IS the array
  "descriptionParam": "?content=true",          // appended only when includeDescription=true
  "params": { "sort": "updated", "since": "{today-30d}" },  // extra query params (resolved, then encoded)
  "headers": { "authorization": "Bearer {{GITHUB_TOKEN}}" }, // {{ENV}} pulled from Actor secret env vars
  "paginate": { "offsetParam": "offset", "limitParam": "limit", "limit": 100, "totalPath": "total", "maxPages": 50 },
  "fields": {                                    // output field <- mapping
    "title": "title",                            //   string = dot-path
    "postedAt": { "path": "first_published", "transform": "toIso" },  // object = path + transform
    "remote":   { "path": "location.name", "transform": "boolRemote" }
  }
}
```

### Dynamic value tokens (usable in `params` and `headers` values)
- `{query}` → the current query value.
- `{{ENV_NAME}}` → `process.env.ENV_NAME`; **throws at runtime if unset** (configure as an Actor secret env var, never hard-code).
- `{today-Nd}` → ISO date N days before run time (computed windows, e.g. trending/delta).

### Allowed `transform` names (the ONLY ones — see `TRANSFORMS` in engine.mjs)
`stripHtml`, `toIso` (epoch-MS or date string → ISO, else null), `epochSecToIso` (Unix
epoch SECONDS → ISO; use for APIs like Stack Exchange whose timestamps are in seconds —
`toIso` on seconds would land in 1970), `toString`, `boolRemote` (true if value matches
/remote/i), `lower`, `trim`.

### Field def options
A field value is either a string (dot-path) or an object `{ path, transform?, optional? }`.
Set `optional: true` for an enrichment field whose parent object is present but the leaf
may be absent in some records (e.g. `categories.department` on a Lever board that doesn't
set it) — this exempts it from the field-path-faithfulness test, which otherwise treats a
present-parent-but-missing-leaf as a likely typo.

## Hard rules (these fail Stage 3 tests or ship broken output)

1. **Every source MUST map an output field named `title`** — the generated test asserts
   `item.title` is truthy for each source. A repo/product whose natural field is `name`
   must still be mapped to `title`.
2. **Filter fields are fixed names.** `passesFilters` reads `title`, `department`, `team`,
   `location`, `remote`, `postedAt`. If your domain has no notion of these, either map the
   nearest equivalent to those names or accept that the corresponding filter is a no-op.
   The template input schema is jobs-flavored (remoteOnly, postedAfter, locations); for a
   non-jobs actor, hand-edit `.actor/input_schema.json` after scaffold to drop irrelevant
   filters (this is a known template limitation — see PLAYBOOK Stage 2).
3. **`fixtures` keys MUST equal `source.id`.** A mismatch makes that source's test silently
   skip (no coverage), not fail.
4. **Always include real fixtures**, one trimmed actual API response per source, so tests
   run offline and deterministically forever. Capture them live during Stage 2.
5. The engine auto-adds `query`, `source`, `sourceUrl`, `scrapedAt` to every item — do not
   map those yourself.

## Engine extension (when a spec genuinely cannot express a source)

If a source needs something the spec format can't do (non-offset pagination, GraphQL,
multi-step auth), extend the SHARED engine, never fork per-actor:
1. Add the capability to `template/src/engine.mjs` behind a new spec field.
2. Add a unit test to `template/test/engine.test.js`.
3. Because `new-actor.mjs` copies the template into each actor at scaffold time, existing
   shipped actors keep their frozen engine copy — back-port the change to already-published
   actors only if they need it (and bump their version + re-push). Document the new field here.
