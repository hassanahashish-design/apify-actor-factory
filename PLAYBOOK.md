# Actor Factory Playbook — the conduct protocol

This document is law for every agent and session working on the Apify actor portfolio.
It encodes lessons paid for with real failures. Do not skip stages. Do not trust memory
where a check is possible. An agent that cannot cite which stage it is in is off-process.

## Architecture: orchestrator, never conductor

One hub (the main session) drives every stage, collects every output, and owns every
go/kill decision. Sub-agents never hand work directly to each other — results always
return to the hub. Deterministic scripts do every step that needs no judgment
(scaffold, test, push); AI agents are used only where judgment is required (niche
scouting, spec writing, adversarial QA). Only migrate a specific stage to agent-chaining
if evidence shows the hub is the bottleneck — never because it sounds better.

## The pipeline (every new actor goes through ALL stages, in order)

### Stage 0 — Decision protocol (for niche selection and any non-obvious choice)
Run the critical-thinking loop, not a linear argument:
1. Generate ≥3 candidates **different in kind**, including one contrarian you'd normally skip.
2. Attack each as its harshest critic: strongest counter-argument, hidden assumption,
   kill-shot edge case. **Verify the decisive variable with a live check** — competition
   claims require an actual Apify Store search; demand claims require sources. A scoring
   table with unverified numbers is fiction (we once scored "competition: 4/5" that a
   single search proved was 1/5 — ten incumbents).
3. Extract lessons from what broke; mutate or cross-breed survivors.
4. Audit your own trail: name at least one error you caught in your own reasoning.
5. Final answer states: confidence %, the key assumption, and the switch-trigger that
   would flip you to the runner-up.

### Stage 1 — Moat gate (kill here is cheap; kill late is expensive)
An actor proceeds ONLY if it passes all four:
- **DIY-resistance**: would a capable agent just call the underlying API itself in one
  step? If yes, your value-add must be named (aggregation across sources, statefulness/
  deltas, normalization, gated access). "Convenience" alone is not a moat.
- **Openness paradox**: data open to you is open to every competitor. Open-to-everyone
  sources need a differentiation layer; gated-but-licensed sources (official accounts,
  registered API keys) are the strongest moats — the pain of access IS the product.
- **Competition check (ENFORCED — `scripts/store-check.mjs`)**: run
  `node scripts/store-check.mjs "<topic keywords>"` and paste the emitted `storeCheck`
  block into the spec. The scaffolder REFUSES any spec without a fresh (≤7 days) block.
  Verdicts: OPEN (0 incumbents ≥100 runs — must add `demandEvidence`), CONTESTABLE
  (1–3 — must fill `differentiation`, which renders into the README's "Why pick this
  Actor" section), SATURATED (>3 — KILL by default; only a written
  `gateOverride.reason` in the spec proceeds, auditable forever).
  This stopped being advisory on 2026-06-12: eight actors had shipped into niches
  where live search showed 5–8 incumbents with 100–28,000 runs each (one had our exact
  name with 1,834 runs); all ranked outside the top 10 on their own keywords and got
  zero external users. Prose rules get skipped; gates don't.
- **Demand evidence (sourced)**: at least one citable signal that agents/humans want
  this (search volume, an existing actor's user count, a community asking for it). No
  demand signal found = treat as a kill unless it's a deliberate bet you name as such.
- **Source stability & legality**: public/documented endpoints or licensed access only.
  No login-credential harvesting, no CAPTCHA bypass, no ToS-violating scraping. Probe the
  source live from the actual runtime environment before writing any code — geo-blocks
  and auth walls must be discovered in stage 1, not after the build (we lost a day to a
  registry that required a UAE IP + account, discovered only at smoke-test time).

### Stage 2 — Spec, not code
New actors are declarative specs executed by the shared engine. **`SPEC.md` is the full
spec contract** — read it; it documents every field, the six allowed transforms, the
dynamic tokens (`{query}`, `{{ENV_SECRET}}`, `{today-Nd}`), `params`/`headers`/`paginate`,
and the hard rules (every source must map a `title`; fixture keys must equal source ids;
the input-schema filters are jobs-flavored and must be hand-trimmed for non-jobs actors).
The spec must include captured real fixtures (one trimmed API response per source) so
tests run offline forever — capture them live during this stage.

**If the engine genuinely cannot express a source** (non-offset pagination, GraphQL,
multi-step auth): extend `template/src/engine.mjs` behind a new spec field + add a test
in `template/test/engine.test.js` (see SPEC.md "Engine extension"). Never fork per-actor
logic. Note: each generated actor gets a frozen copy of the engine at scaffold time, so
engine upgrades reach existing actors only by re-pushing them.

**Pricing at spec time is PROVISIONAL.** `pricing.pricePerResultUsd` is required by the
scaffolder and gets baked into the README + `pay_per_event.json`, but the real number
comes from Stage 5/7 (measured compute + competitor anchor). Enter a competitor-anchored
estimate now; after Stage 5, update the spec value, regenerate ONLY the README price
line + `pay_per_event.json` by hand-editing (do NOT re-scaffold — see source-of-truth
rule below), and set the final price in Console. This is not a "fabricated number" —
it's a provisional input, corrected before publish.

**Source-of-truth rule:** once Stage 3 has run, the generated actor directory is the
source of truth. Stage 4 fixes and regression tests live there. NEVER re-run the
scaffolder on an existing actor (it refuses without `--force`, which is destructive).
Back-port any engine/test improvements to `template/` in the same session.

### Stage 3 — Scaffold + offline tests (deterministic)
`node scripts/new-actor.mjs specs/<name>.json` — same spec in, same actor out.
All tests must pass offline against fixtures. No network in unit tests.

### Stage 4 — Adversarial bug-hunt (mandatory before any push)
Spawn the dedicated **`bug-hunter` agent** (`.claude/agents/bug-hunter.md`) on the actor
directory — a fresh-eyes reviewer with no build context. It reviews for correctness bugs
only and must RUN probes to confirm findings — distinguish CONFIRMED from SUSPECTED.
Known recurring bug classes to hunt every time, each found in real builds:
- silent wrong answers (returning "no match" when the query could never have matched —
  an agent consumer reads that as "doesn't exist"; fail loudly instead)
- substring/containment matching across token boundaries ("star" inside "mustard")
- unbounded buffers on generic queries (prune with top-K, prove the top result survives)
- missing runtime deps that only fail on the platform (dynamic imports not in package.json)
- stream errors that .pipe() swallows (use compose; propagate to the iterator)
- poisoned caches that brick every later run (invalidate + retry once on corruption)
- cache-key collisions (hash the full source URL into the key)
- input coercion that silently substitutes defaults (validate; throw on out-of-range)
- locale traps (Arabic-Indic digits, 2-digit-year pivots, DD/MM vs MM/DD)
- billing-cap leak: delivering results past the buyer's maxTotalChargeUsd gives data
  away free — cap delivery to what's chargeable (`planDelivery` helper), stop when hit
- entity-before-tag: decode HTML entities BEFORE stripping tags, or escaped markup
  (`&lt;h2&gt;`) survives as visible text (Greenhouse content)
- case-sensitive upstream keys: some APIs 404 on capitalized slugs ("Palantir" vs
  "palantir") — normalize, and warn on slug-impossible input instead of silent no-match
- `\b` word boundaries fail on symbol-ending terms ("c++", "c#") — use alphanumeric
  lookarounds for whole-token matching
- `String.replace(/x/, value)` interprets `$&`/`$'` in `value` — use a function replacer
- empty-but-live source shadowing a populated one in firstHit mode (require items > 0)
- jobs-filter leak: the template input schema is jobs-flavored; non-jobs actors must
  NOT expose remoteOnly/locations (the scaffolder strips them unless spec.jobsFilters
  is true) — exposing them makes a buyer's filter silently return zero
- cross-query double-charge: overlapping queries in one run must dedupe (dedupeKey)
  so the same item is charged once, not per query that surfaced it
- unfaithful fixtures: a spec field path that resolves nowhere in the fixtures is
  either a typo or an over-trimmed fixture (the SEC root_form bug). Capture fixtures by
  keeping FULL objects and trimming only bulky text fields; the template field-path
  test catches this — mark genuinely-optional enrichment fields {optional:true}
- dedupeKey must key on a STABLE id, not title: two distinct records can share a title
  (clinical trials with the same briefTitle, different nctId) — keying on title drops
  one as a false duplicate. The id chain covers jobId/documentId/nctId/id/url/title.
- epoch units: API timestamps in SECONDS (Stack Exchange) need epochSecToIso, not toIso
  (which assumes ms and maps seconds to 1970). Bare 4-digit years are handled by toIso.
- keyword-haystack coverage: the filter must search all text-bearing fields (title,
  abstract, conditions, sponsor, tags…), not just title, or a keyword present only in
  the body silently zeroes the result (and the buyer still pays nothing but gets nothing).
- listing honesty: the README/schema must not advertise inputs that do nothing —
  jobs-filters on non-jobs actors, includeDescription with no descriptionParam, an
  unreachable maxResults default. The scaffolder now strips these automatically.
Every confirmed bug gets a regression test before the fix is considered done.

**How to run a generated actor locally** (for the bug-hunt agent's probes):
`cd <actor-dir> && mkdir -p storage/key_value_stores/default && echo '{"query":"<canary>"}'
> storage/key_value_stores/default/INPUT.json && APIFY_LOCAL_STORAGE_DIR="$PWD/storage"
node src/main.js` — output items land in `storage/datasets/default/*.json`. Unit tests:
`npm test`.

**SUSPECTED-finding disposition:** every SUSPECTED finding must be driven to CONFIRMED
or REFUTED (with a probe) before Stage 5. Any that genuinely cannot be resolved is logged
in this playbook's bug-class list with a one-line rationale — never silently dropped.

### Stage 5 — Push + live smoke run (verify-before-done)
Exact procedure:
```
cd <actor-dir>
npx -y apify-cli push                                  # deploys + builds on platform
npx -y apify-cli call <username>/<slug> --input '{"query":"<canary>","maxResults":5}'
npx -y apify-cli actor:datasets... # or: read the run's dataset items in Console / via API
```
Read the ACTUAL dataset items — confirm real values, not just "succeeded". Local fixture
tests passing is not "done". If the source needs proxy/geo handling, prove it here (pass
`proxyConfiguration`).

**Failure handling (bounded — no infinite "should work" loops):**
- A red "Failed" run means the stage is not complete. Diagnose from the run log.
- If the failure is a **code/shape** bug: fix in the generated dir, re-push, re-run.
- If the failure traces to **source access/legality** (geo-block, auth wall, ToS) — the
  thing Stage 1 was supposed to catch — STOP and return to Stage 1 re-gate. Do not paper
  over it with proxies unless that path is legal and was part of the moat plan.
- After **3 failed fix attempts** on the same actor, move it to `status: parked` in
  `registry.json` with a named `parkedReason` and a re-check trigger. A parked actor is
  an honest outcome (see `uae-business-verify`), not a failure to hide. Do not publish a
  parked actor.

### Stage 6 — Listing (AEO for agent buyers)
Agents read schemas and literal task phrasing; they penalize marketing language and
sponsored-style copy, and reward structured, capability-dense listings:
- Title/slug: exact task keywords ("X Scraper — Y to JSON"), no brand fluff.
- README: H1 = primary keyword; sample JSON output near the top; "How much does it
  cost" with the per-unit price; MCP + API + LangChain integration snippets; FAQ with
  question-phrased headings; data/compliance note.
- **"Why pick this Actor" section (mandatory since 2026-06-12)**: the template renders
  it automatically; its first bullet is `storeCheck.differentiation` — the angle the
  competition gate made you name. Every bullet must be FACTUAL (field-verified against
  spec.json); agents compare listings side-by-side and a fabricated capability is both
  a refund and a review risk. Standing bullets: per-result price + spend cap, flat
  citation-ready schema, cross-query dedup, MCP/OpenAPI/LangChain support.
- FAQ must include the two standing agent-task entries (template provides them):
  "Can AI agents call this Actor directly?" and "What happens when there are no
  results?" — these match literal agent task-phrasing queries.
- The phrase "you only pay for successful results" appears verbatim — and must be true
  (charge only on pushed items).
- Re-tune listings when major models ship: agent tool-selection preferences swing
  violently across model versions; treat listing copy as a recurring maintenance task.
- **Rank monitoring**: `node scripts/store-check.mjs --rank-all` shows where every
  portfolio actor ranks for its own keywords. Day-0 reality (measured 2026-06-12):
  new actors are NOT in the Store search index at all for the first hours/days —
  don't panic-edit listings before indexing lands; re-check after 48h, then weekly.

### Stage 7 — Pricing

**Billing model (canonical since 2026-06-11):** factory actors use Apify's AUTOMATIC
`apify-default-dataset-item` event — the platform charges each row pushed to the
default dataset; the code contains NO `Actor.charge()` call (a leftover custom charge
on top of the automatic event = double-charging). The spend-cap control is therefore
*pre-push*: `planDelivery` + `chargeableRoom('apify-default-dataset-item')` cap what
gets pushed. `apify-actor-start` stays unpriced ($0) so "you only pay for successful
results" remains literally true.

**Pricing IS settable via API** (undocumented; verified live 2026-06-11): PUT
`/v2/acts/:id` with `{"pricingInfos":[{"pricingModel":"PAY_PER_EVENT","pricingPerEvent":
{"actorChargeEvents":{"apify-default-dataset-item":{"eventTitle":…,"eventDescription":…,
"eventPriceUsd":N,"isPrimaryEvent":true}}}}]}` — `isPrimaryEvent: true` is REQUIRED or
validation fails with a misleading "must contain price, title, description" error.
Modifying an existing pricing record later requires echoing its `createdAt`. Publishing
to the Store remains a Console click (terms acceptance is account-level and legal).
- **Floor**: platform compute cost per successful result, measured from the Stage 5 run
  (read the run's compute usage ÷ items pushed).
- **Anchor**: what the alternative costs (competitor actors, commercial APIs).
- **Formula**: `price = max(3 × measured floor, 0.7 × cheapest credible anchor)`. If no
  anchor exists, `price = 5 × floor`. Round to a clean figure ($0.002, $0.005, $0.01,
  $0.05…). The 3× floor guarantees margin even if compute drifts up; the 0.7× anchor
  keeps you the cheap option agents prefer.
- After deciding: update `pricing.pricePerResultUsd` in the spec, hand-edit the generated
  README price line + `.actor/pay_per_event.json` to match (do NOT re-scaffold), and set
  the event price in Console.
- Published per-unit price, pay-per-event, charge ONLY successful results. Spend caps
  (`maxResults`) in every input schema. Never opaque compute-unit-only pricing.

### Stage 8 — Portfolio monitor (the recurring moat)
Scheduled health checks on every published actor: run success rate, source schema
drift (fail-loud column/shape detection makes drift visible), earnings, issue-response
SLA (<24h — it feeds store ranking). Breakage found by monitoring, not by customers.

## Portfolio strategy — diversified volume + double-down (Hassan's directive, 2026-06-12)

The portfolio is a power-law bet: many cheap, genuinely different actors; expect most to
earn $0 and a few to pay for everything. This only works under three rules:

1. **Diversity must be on demand axes, not topic names.** Twelve actors in twelve "different"
   niches all failed identically because they shared the same traits: free commodity API +
   crowded layer + zero push. EXPLORE rule: each new actor must differ from the last 5 in
   VERTICAL (finance/safety/aviation/culture/energy/legal/...) and ideally BUYER TYPE
   (sales-intel vs compliance vs consumer-agent vs ops). Consult DISCOVERY-POOL.md for
   deliberately weird candidates; the competition gate still applies to every one.
2. **Carrying cost per actor must stay ~$0.** Volume is only viable because tests, monitor,
   pricing, AEO and publishing are automated. Any actor needing manual babysitting gets
   fixed systemically or unpublished — a portfolio of 100 needs the same attention as 10.
3. **EXPLOIT (double-down) trigger — checked BEFORE building anything new each day:**
   scan the portfolio via API for traction: any actor with an external paying user, OR
   totalUsers > 2 and growing, OR ranked top-10 in Store search for a real keyword.
   On trigger: that day's build budget goes to the WINNING niche instead of a random new
   one — 1-2 sibling actors (adjacent sources, same buyer), AEO refresh with the winning
   keywords, and consider a deliberate gateOverride push into the same buyer's other needs.
   The market votes; we reinforce whatever it votes for. No traction anywhere → explore.

## Queue discipline — the park-and-switch rule (anti-Dubai-Pulse)

The portfolio's scarcest resource is wall-clock time, not ideas. We once burned hours
trying to reach one gated registry while a launchable actor sat waiting. Therefore:
- **Every stage is time-boxed** (`scripts/pipeline.mjs` enforces this for the
  deterministic stages). When a stage exceeds its box, that's a failure, not a reason
  to keep pushing.
- **Blocker = park immediately.** The moment a failure traces to something needing
  human or external input (credential, geo-block, account approval, CAPTCHA, waiting
  on a third party), park the actor in `registry.json` with a named `parkedReason` and
  a re-check trigger — then PULL THE NEXT SPEC. Parking is a scheduling decision, not
  a defeat; parked actors with real moats (uae-business-verify) stay valuable.
- **Never more than 3 attempts** on the same failure without new information.
- **The queue must never be empty**: keep ≥2 specs in `specs/` that have passed the
  moat gate, so there is always a "next idea" to switch to.
- Run the deterministic stages with `node scripts/pipeline.mjs <slug>` (or `--all`).
  The runner refuses to push anything whose registry entry lacks `bugHuntPassed` —
  automation never bypasses the judgment gates.

## Known process hazard: registry.json is a shared file

`registry.json` has no locking. Two concurrent writers (e.g. a background `pipeline.mjs`
run finishing while you hand-edit the registry) will clobber each other — the later
write wins with its stale in-memory copy. Rule: do not edit `registry.json` while a
background pipeline/push is in flight; re-read → edit → write as one quick step, and
verify the actor count afterward. (Bit us once: a batch-1 pipeline finish wiped 3
batch-2 entries.) Future hardening: a read-modify-write that merges by slug.

## Standing rules (all stages, all agents)

- **Honest reporting**: state what is verified vs assumed; a failed check is reported
  with its output, never smoothed over. Mistakes are data — surface them and extract
  the lesson into this playbook.
- **No fabricated numbers**: every stat in listings/marketing must trace to a source.
- **Secrets**: never in code, chat transcripts, or pushed files. Platform env vars
  (marked Secret) only. A token that touches a transcript or terminal scrollback gets
  rotated immediately.
- **Economics honesty**: a new actor realistically earns $0–3k/month; the portfolio
  compounds through niche selection quality, social proof, and maintenance — not raw
  upload volume. Ten me-too actors earn less than one moated one.
- **Strategy anchor**: gated/licensed data (e.g., registered official registries) and
  owned distribution beat anything an afternoon of AI codegen can replicate. When in
  doubt between "easy to build" and "hard to access", choose hard to access.

## Quick reference

- Factory root: `06-Agent-Economy/actor-factory/` (run scripts with this as cwd).
- Spec contract: `SPEC.md` (read before writing a spec).
- New actor: `node scripts/new-actor.mjs specs/<name>.json` (refuses to overwrite; `--force` rebuilds).
- Monitor portfolio: `node scripts/monitor.mjs` (all published) or `… <slug>`.
- Portfolio manifest: `registry.json` (every actor + status + canary; statuses:
  spec | scaffolded | pushed | published | parked).
- Actors:
  - `uae-business-verify` — flagship, gated-data moat. PARKED: Dubai Pulse open-data
    download needs a registered account + UAE-IP registration; awaiting credential.
  - `company-hiring-signals` — factory-built (Greenhouse/Lever/Ashby), scaffolded.
  - `job-postings-scraper` — earlier hand-built TypeScript ATS actor (pre-factory;
    superseded by `company-hiring-signals` — do not invest further, kept for reference).
- Pricing set in Apify Console → Actor → Publication → Monetization (pay-per-event,
  event name `result` for factory actors).
