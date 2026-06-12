# Discovery pool — deliberately diverse actor candidates

Fuel for the EXPLORE half of the portfolio strategy (PLAYBOOK → "Portfolio strategy").
These are HINTS, not vetted specs: every candidate still passes the competition gate
(store-check.mjs) and a live source probe before any build. Pick from a DIFFERENT vertical
than the last 5 actors built. Strike through entries when built or parked; add new ideas
freely — weird is good, correlated is bad.

| Vertical | Source (API hint) | Buyer hypothesis |
|---|---|---|
| Geology/insurance | USGS earthquakes — earthquake.usgs.gov/fdsnws (JSON, no auth) | insurance, logistics, risk agents |
| Weather/ops | NWS alerts — api.weather.gov/alerts (JSON, no auth) | logistics, event-ops, field-service agents |
| Aviation | OpenSky flights — opensky-network.org/api (anon tier) | travel, logistics, journalism agents |
| Pharma/safety | openFDA — api.fda.gov (recalls, adverse events, no auth) | pharma compliance, health agents |
| Consumer safety | CPSC recalls — saferproducts.gov API (JSON) | e-commerce compliance, resellers |
| Automotive | NHTSA recalls/complaints — api.nhtsa.gov (JSON, no auth) | dealers, fleet ops, consumer agents |
| Security | NVD CVEs — services.nvd.nist.gov (JSON, rate-limited) | security/devops agents |
| Security/sales-intel | crt.sh certificate transparency (JSON) | tech-stack discovery, sales-intel |
| Fundraising | Grants.gov — api.grants.gov (JSON) | nonprofit, grant-writing agents |
| Due diligence | ProPublica Nonprofit Explorer — IRS 990s (JSON, no auth) | donor vetting, partnership DD |
| Politics | FEC — api.open.fec.gov (free key) | political research, journalism |
| Policy | Senate LDA lobbying disclosures — lda.senate.gov/api (JSON) | policy, gov-affairs agents |
| KYC/compliance | GLEIF LEI — api.gleif.org (JSON, no auth) | KYC, B2B onboarding agents — adjacent to UAE play |
| Company registry | UK Companies House — api.company-information.service.gov.uk (free key) | due diligence — gated-ish = mild moat |
| Gov procurement | EU TED tenders — api.ted.europa.eu (JSON) | sales-intel for gov contractors |
| Economics | World Bank indicators — api.worldbank.org (JSON, no auth) | research, market-sizing agents |
| Finance/macro | FRED — api.stlouisfed.org (free key) | finance, analyst agents |
| Food/consumer | OpenFoodFacts — world.openfoodfacts.org/api (no auth) | nutrition, retail, consumer agents |
| Culture | Met Museum / Art Institute of Chicago APIs (no auth) | content, education agents |
| Books | OpenLibrary — openlibrary.org/search.json (no auth) | research, content agents |
| Sports | TheSportsDB (free tier) | content, betting-adjacent (careful), fan apps |
| Gaming | Steam storefront API (JSON, undocumented-stable) | market intel for game studios |
| Crypto | CoinGecko free tier (expect SATURATED — gate will tell) | trading-adjacent agents |
| Trademarks | USPTO TSDR (free key) | brand-protection agents |

## Already tried — do NOT retry without new information
- ~~PatentsView~~ — probe failed (2026-06-11)
- ~~USAspending~~ — wrong shape (2026-06-11)
- ~~npm / PyPI registries~~ — non-list shapes (2026-06-11)
- ~~Dubai Pulse / UAE open data~~ — geo-blocked, needs UAE-IP credential (uae-business-verify PARKED — flagship when unblocked)

## Lessons (append as the market teaches)
- 2026-06-12: 12 actors across "different" topics failed identically — diversity must be in
  vertical + buyer type + competition verdict, not topic names. The gate now enforces the
  check; this pool enforces the spread.
