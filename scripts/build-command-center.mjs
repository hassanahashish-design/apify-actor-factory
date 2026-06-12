#!/usr/bin/env node
// build-command-center.mjs — regenerates command-center.html from registry.json.
// Run after any registry change: node scripts/build-command-center.mjs
// The page is self-contained (no secrets, no token — anonymous public-API calls only).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(await readFile(path.join(root, 'registry.json'), 'utf8'));
const USERNAME = 'oblanceolate_mandola';

// ---- channel board (statuses maintained here; verdicts from live research 2026-06-12) ----
const CHANNELS = [
  {
    group: 'LIVE NOW', color: '#22c55e', items: [
      { name: 'Apify Store', url: `https://apify.com/${USERNAME}`, note: 'Pay-per-event, 80/20 split. 5 published, 5/day cap, daily 1PM routine drains the queue.', status: 'SELLING' },
    ],
  },
  {
    group: 'THIS WEEK — free agent-discovery listings', color: '#3b82f6', items: [
      { name: 'Smithery', url: 'https://smithery.ai', note: 'MCP registry — list Apify MCP endpoint, billing stays on Apify.', status: 'not listed yet' },
      { name: 'Glama', url: 'https://glama.ai/mcp/servers', note: '35k+ MCP servers indexed — free listing.', status: 'not listed yet' },
      { name: 'mcp.so', url: 'https://mcp.so', note: 'MCP directory — free listing.', status: 'not listed yet' },
      { name: 'PulseMCP', url: 'https://www.pulsemcp.com', note: 'MCP directory + newsletter — free listing.', status: 'not listed yet' },
    ],
  },
  {
    group: 'NEXT — second paid marketplace', color: '#a855f7', items: [
      { name: 'x402 Bazaar', url: 'https://www.x402bazaar.org', note: 'Agents pay USDC per call (~$24M/mo protocol volume, Chainalysis-verified growth). Weekend project: thin pay-per-call wrapper over the same specs.', status: 'planned' },
      { name: 'MCPize', url: 'https://mcpize.com', note: 'Paid MCP marketplace — 85% rev share, Stripe fiat payouts. Traffic unproven.', status: 'evaluating' },
      { name: 'MCP Hive', url: 'https://mcp-hive.com', note: 'Pay-per-use MCP marketplace. Traffic unproven.', status: 'evaluating' },
    ],
  },
  {
    group: 'LATER — when gated UAE data unblocks', color: '#eab308', items: [
      { name: 'Snowflake Marketplace', url: 'https://app.snowflake.com/marketplace', note: 'Enterprise datasets; needs reviewed company provider profile. Right home for GCC registry data.', status: 'parked' },
      { name: 'AWS Data Exchange', url: 'https://aws.amazon.com/data-exchange/', note: 'Enterprise datasets — same play as Snowflake.', status: 'parked' },
      { name: 'Datarade', url: 'https://datarade.ai', note: 'Data-product broker — fits gated datasets, not tool calls.', status: 'parked' },
    ],
  },
  {
    group: 'SKIP', color: '#6b7280', items: [
      { name: 'RapidAPI', url: 'https://rapidapi.com', note: 'Nokia-acquired, pivoting to telco, declining listings, 20% fee. Sinking shelf.', status: 'skipped' },
    ],
  },
];

const STATUS_COLORS = { published: '#22c55e', pushed: '#3b82f6', parked: '#eab308', spec: '#6b7280', scaffolded: '#6b7280' };

const actorCards = registry.actors.map((a) => {
  const c = STATUS_COLORS[a.status] ?? '#6b7280';
  const link = a.status === 'published'
    ? `https://apify.com/${USERNAME}/${a.slug}`
    : `https://console.apify.com/actors?search=${a.slug}`;
  const price = a.pricePerResultUsd ? `$${a.pricePerResultUsd}/result` : '';
  const parked = a.parkedReason ? `<div class="parked">⏸ ${a.parkedReason}</div>` : '';
  const queued = a.publishBlockedBy ? `<div class="queued">⏳ ${a.publishBlockedBy}</div>` : '';
  return `<a class="actor" href="${link}" target="_blank" style="--c:${c}">
    <div class="dot"></div>
    <div class="meta"><strong>${a.slug}</strong><span>${a.status.toUpperCase()} ${price ? '· ' + price : ''}${a.aeoUpgraded ? ' · AEO ✓' : ''}</span>${parked}${queued}</div>
    <span class="runs" data-slug="${a.slug}">–</span>
  </a>`;
}).join('\n');

const channelBoard = CHANNELS.map((g) => `
  <section class="group" style="--g:${g.color}">
    <h2>${g.group}</h2>
    ${g.items.map((ch) => `
      <a class="channel" href="${ch.url}" target="_blank">
        <div class="ch-head"><strong>${ch.name}</strong><span class="pill">${ch.status}</span></div>
        <p>${ch.note}</p>
      </a>`).join('')}
  </section>`).join('\n');

const published = registry.actors.filter((a) => a.status === 'published').length;
const queued = registry.actors.filter((a) => a.status === 'pushed').length;
const parked = registry.actors.filter((a) => a.status === 'parked').length;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Agent-Economy Command Centre</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0}
  body{font:14px/1.5 -apple-system,system-ui,sans-serif;background:#0b0f17;color:#e5e7eb;padding:28px}
  header{display:flex;flex-wrap:wrap;align-items:baseline;gap:18px;margin-bottom:6px}
  h1{font-size:22px}
  .stamp{color:#6b7280;font-size:12px}
  .totals{display:flex;gap:12px;margin:14px 0 26px}
  .tot{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 18px;text-align:center}
  .tot b{font-size:22px;display:block}
  .tot.green b{color:#22c55e}.tot.blue b{color:#3b82f6}.tot.yellow b{color:#eab308}.tot.red b{color:#f87171}
  .cols{display:grid;grid-template-columns:1.1fr .9fr;gap:26px}
  @media(max-width:980px){.cols{grid-template-columns:1fr}}
  h2{font-size:13px;letter-spacing:.08em;color:var(--g,#9ca3af);margin:0 0 10px;border-left:3px solid var(--g,#374151);padding-left:8px}
  .group{margin-bottom:22px}
  .channel{display:block;background:#111827;border:1px solid #1f2937;border-radius:10px;padding:12px 14px;margin-bottom:8px;text-decoration:none;color:inherit;transition:border-color .15s}
  .channel:hover{border-color:var(--g,#4b5563)}
  .ch-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
  .pill{font-size:11px;background:#1f2937;border-radius:99px;padding:2px 10px;color:#9ca3af}
  .channel p{color:#9ca3af;font-size:12.5px}
  .actor{display:flex;align-items:center;gap:12px;background:#111827;border:1px solid #1f2937;border-radius:10px;padding:10px 14px;margin-bottom:8px;text-decoration:none;color:inherit}
  .actor:hover{border-color:var(--c)}
  .dot{width:10px;height:10px;border-radius:99px;background:var(--c);flex:none}
  .meta{flex:1}.meta span{display:block;font-size:11.5px;color:#9ca3af}
  .parked,.queued{font-size:11px;color:#eab308;margin-top:3px}
  .queued{color:#60a5fa}
  .runs{font-variant-numeric:tabular-nums;color:#9ca3af;font-size:12px}
  .note{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px 16px;margin-bottom:24px;color:#94a3b8;font-size:12.5px}
  .note b{color:#e2e8f0}
</style></head><body>
<header><h1>🛰️ Agent-Economy Command Centre</h1><span class="stamp">generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · regen: <code>node scripts/build-command-center.mjs</code></span></header>
<div class="totals">
  <div class="tot green"><b>${published}</b>published</div>
  <div class="tot blue"><b>${queued}</b>queued (5/day cap)</div>
  <div class="tot yellow"><b>${parked}</b>parked</div>
  <div class="tot red"><b id="ext-users">0</b>external users</div>
</div>
<div class="note"><b>Reality check (2026-06-12):</b> day-0 — actors not yet in Store search index; every niche has established incumbents. Levers: AEO listings (done ✓), competition gate on all new actors (done ✓), multi-channel listing (column 2), 48h rank re-check: <code>node scripts/store-check.mjs --rank-all</code>.</div>
<div class="cols">
  <div>
    <h2 style="--g:#e5e7eb">SALES CHANNELS</h2>
    ${channelBoard}
  </div>
  <div>
    <h2 style="--g:#e5e7eb">ACTOR PORTFOLIO (${registry.actors.length})</h2>
    ${actorCards}
    <div class="note" style="margin-top:14px">Run counts load live from Apify's public API for published actors (anonymous — no token in this file). “–” = not public yet.</div>
  </div>
</div>
<script>
// Anonymous fetch of PUBLIC actor stats only — no credentials anywhere in this page.
document.querySelectorAll('.runs[data-slug]').forEach(async (el) => {
  try {
    const r = await fetch('https://api.apify.com/v2/acts/${USERNAME}~' + el.dataset.slug);
    if (!r.ok) return;
    const { data } = await r.json();
    if (data && data.stats) {
      el.textContent = (data.stats.totalRuns ?? 0) + ' runs · ' + (data.stats.totalUsers ?? 0) + ' users';
      window.__ext = (window.__ext || 0) + Math.max(0, (data.stats.totalUsers ?? 0) - 2); // minus us + review bot
      document.getElementById('ext-users').textContent = window.__ext;
    }
  } catch {}
});
</script>
</body></html>
`;

await writeFile(path.join(root, 'command-center.html'), html);
console.log(`command-center.html generated (${registry.actors.length} actors, ${CHANNELS.reduce((n, g) => n + g.items.length, 0)} channels).`);
