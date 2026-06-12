# Cloud Factory — scope & runbook (daily autonomous actor at 1pm)

Goal: a Claude Code **Routine** that, every day at 1pm, builds one new Apify actor through
the full factory pipeline and publishes it — running in Anthropic's cloud, independent of
the Mac being on or online.

## Feasibility: YES (verified June 12, 2026)

Claude Code Routines (research preview, Apr 2026) provide everything required:
- Run on Anthropic's cloud; no local machine needed (survives Mac off/closed).
- Fresh `git clone` of a configured repo each run.
- **Environment variables** for credentials (the Apify token).
- Configurable network access (need **full internet** to reach api.apify.com + data-source APIs).
- A **setup script** that runs before the session (npm install, apify login).
- **Cron schedule** trigger (1pm daily), plus API/webhook triggers.

## Architecture

```
1pm cron ─▶ Anthropic cloud container
             ├─ git clone <github repo>            (the factory)
             ├─ setup script: npm install + apify login -t $APIFY_TOKEN
             └─ Claude runs the routine prompt:
                  • list existing actors via Apify API  → know what's already built (no dup)
                  • discover 1 fresh source → MOAT GATE (live probe + Store competition)
                  • build spec + faithful fixture → scaffold → 27/27 tests
                  • bug-hunt INLINE (tests + live smoke + risky-path probes)
                  • apify push → set pricing/display/SEO via API → publish (isPublic) ≤5/day
                  • PushNotification with the day's result (or "well dry" / "skipped")
```

**State persistence:** no git write-back needed. The routine derives "what's already built"
by listing existing actors via `GET /v2/acts` — so it never duplicates a source. (registry.json
in the repo is a convenience snapshot, not the source of truth in the cloud.)

## Prerequisites (one-time)

1. **GitHub repo** (private) containing `06-Agent-Economy/actor-factory/` (scripts, template,
   specs). NO secrets committed. → run `scripts/routine-prep.sh` to stage it.
2. **Apify Store T&C accepted** in the Console (one-time, account-wide). Without this the
   publish API call fails — everything else works, but actors stay private.
3. **Scoped Apify token** created in Console → Settings → API & Integrations (limit its
   permissions; it will live in the routine's env vars, which are visible to environment
   editors — there's no dedicated secrets store yet, so use a scoped + rotatable token).
4. **Create the Routine** (Claude Code web UI): attach the repo, set `APIFY_TOKEN` env var,
   network = full internet, setup script = `scripts/routine-setup.sh`, schedule = 1pm daily,
   prompt = the block in "Routine prompt" below.

## Honest risks (read before enabling auto-publish)

- **Unsupervised auto-publish.** An AI-built actor ships daily with no human review. The
  inline bug-hunt + 27 tests + live smoke are the gate, and Apify *also* reviews Store
  submissions — but a subtle bug could still reach users. **Recommended for the first ~2
  weeks: build + push + fully configure, then PushNotify you to tap Publish** (one tap),
  rather than full auto-publish. Flip to full auto once you trust the output.
- **Token visibility.** Env vars aren't a hardened secret store; use a scoped token, rotate
  periodically.
- **Source exhaustion.** Daily creation drains good no-auth sources within ~1–2 weeks. The
  routine must SKIP (build nothing) and notify when the moat gate finds no quality source —
  never pad with me-too actors. The well being dry is a success signal, not a failure.
- **5/day publish cap.** Apify limits publishing to 5 actors/day; the routine publishes one
  per day so this is never hit, but a backlog (you have 12 unpublished now) needs draining
  first.
- **Cost.** One cloud Claude Code run + Apify compute per day. Modest, but non-zero.

## Routine prompt (paste into the routine)

> Run ONE Apify actor factory batch. (1) `apify login` is already done by setup; confirm with
> `apify info`. (2) List existing actors via the Apify API to know what sources are already
> built — never duplicate. (2b) EXPLOIT CHECK (PLAYBOOK "Portfolio strategy"): scan existing
> actors' stats for traction (external paying user, totalUsers > 2 and growing, or top-10
> Store rank on a real keyword). If ANY actor shows traction, today's build goes to a SIBLING
> in that winning niche (adjacent source, same buyer) instead of a random new one — the
> market voted; reinforce it. (3) Read 06-Agent-Economy/actor-factory/PLAYBOOK.md. (4) No
> traction → EXPLORE: pick a candidate from DISCOVERY-POOL.md (or equally weird) in a
> VERTICAL different from the last 5 actors built — public, no-auth, list-shaped,
> agent-relevant JSON API, NOT already built and NOT in the parked list. (5) COMPETITION GATE (enforced — the scaffolder refuses specs without it):
> run `node scripts/store-check.mjs "<topic keywords>"` with 2-3 keyword variants buyers would
> type. SATURATED → kill the candidate (no gateOverride in autonomous runs — overrides are a
> human decision); CONTESTABLE → write a FACTUAL differentiation (it renders into the listing);
> OPEN → record demandEvidence. Also live-probe source reachability+shape. If two candidates
> in a row fail, SKIP the day and PushNotify "no quality source — well dry"; a skipped day is
> success, a me-too actor is failure. (6) Build spec (paste the storeCheck block in) + faithful
> fixture, scaffold via scripts/new-actor.mjs, confirm all tests green. (7) Bug-hunt INLINE:
> npm test + a live smoke run + probe the risky paths (URL absoluteness, date transforms, null
> fields, no Actor.charge). Fix every confirmed bug with a regression test; back-port systemic
> fixes to template/. (8) `apify push`. (9) Set pricing (apify-default-dataset-item,
> isPrimaryEvent, measured price), categories, seoTitle=title, seoDescription (145-155 chars,
> keyword variations), output schema via API. AEO check: README must have the "Why pick this
> Actor" section (template renders it from storeCheck.differentiation) and the two agent-task
> FAQ entries — every claim field-verified. (10) Run scripts/smoke-all.mjs for the new actor;
> only if it returns real items: [PUBLISH MODE] set isPublic=true via API. [REVIEW MODE] leave
> private. (11) Run `node scripts/store-check.mjs --rank-all` and include rank movements in the
> PushNotify result. NEVER pad the count; honesty over volume.

## Setup script: `scripts/routine-setup.sh`

Runs before each session — installs deps and logs in the Apify CLI from the env-var token.
