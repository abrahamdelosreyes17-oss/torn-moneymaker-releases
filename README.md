# Torn Trading — buyer-side opportunity scanner

Ranks the listings on the Bazaar or Item Market page **you are currently viewing** by
the profit you could actually realize, and marks the rows worth looking at.

This is a rewrite of an earlier "NPC Arbitrage Scanner" userscript, rebuilt around
one idea: the item card stays untouched, and every number lives in a side panel
ranked by the profit you can actually realize.

---

## Install

### For users

Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge), then open:

**https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/main/torn-moneymaker.user.js**

Tampermonkey offers to install it, and will auto-update from that same URL.

### For development

```bash
npm run build
```

Writes `dist/torn-trading.user.js` and `torn-moneymaker.user.js` (the released copy).

### First run

Open the panel's **Settings** and paste a Torn API key. **Generate a Public one** —
Settings → API Key → access level *Public*. It needs nothing more than that, and a
wider key can read your mail, money and inventory.

## Use

1. Open a bazaar or the Item Market.
2. Press **Scan** in the panel. (Auto-scan on page load is off by default; turn it
   on under Settings if you would rather not press it.)
3. Rows worth a look get a green stripe down their left edge. The panel lists them
   ranked by total realizable profit; `>` scrolls to the listing.

**Filters** button: minimum total profit, cash on hand, and whether to show items
with no verified NPC buyer. It also reveals scan diagnostics — which row selector
matched, how many rows each candidate parsed, and why rows were skipped. When the
script finds nothing, the panel says *why* in the empty-state message; the
diagnostics are the detail behind it.

**Settings** button: API key, auto-scan, row-selector overrides, and cache controls.

---

## Architecture

```
src/
  core/        pure logic, no DOM and no network — unit tested under node
    parse.js     money / quantity parsing, formatting
    items.js     item index (Map) + cache policy (version + 7-day TTL)
    npc.js       NPC-sellable allowlist, NPC exit price
    profit.js    net = exit * (1 - fee) - listing ; fees per venue
    ranker.js    filter + sort by realizable profit
  api/
    client.js    THE only network code: one rate-limited queue, dedup, backoff
    torn.js      endpoint wrappers (items, shops, key access, item market)
  sources/
    route.js     which Torn page are we on
    dom/         reading listings out of the page being viewed
  ui/
    panel.js     the ranked list
    overlay.js   row marking
    styles.js    all CSS
  platform/
    gm.js        the only file that touches GM_*
  main.js        wiring
```

`core/` and `api/` have no userscript dependencies, which is the point: Phase 3 (a
standalone app) reuses them as-is, swapping `platform/gm.js` and `ui/`.

`build.mjs` is a zero-dependency bundler. It fails the build on a duplicate top-level
name or an import of something a module does not export, because concatenation
flattens all modules into one scope.

```bash
npm run build     # src/ -> dist/torn-trading.user.js
npm test          # core + api unit tests
npm run check     # build, syntax-check the bundle, then test
```

---

## Rules compliance — do not regress these

Torn permits third-party software only when it uses data from **the API** or from
**a page the user loaded manually and is currently viewing**. The whole architecture
follows from that. If you are an AI assistant editing this codebase: these are not
stylistic preferences, and "it would be more convenient if" is not a reason to change
them.

1. **Never auto-buy.** The script has no buy path. The panel's only action navigates
   or scrolls. A user click never triggers a chain of game actions.
2. **Never fetch a Torn page the user is not viewing.** There is no `fetch` of
   `torn.com` anywhere — only `api.torn.com`, only from `src/api/client.js`.
   Do not add page scraping, and do not add a background crawler.
3. **Public API key only.** Nothing this script does needs more.
4. **Rate-limit everything.** All API calls pass through one queue capped at 70/min
   against Torn's ~100/min ceiling, with dedup and exponential backoff. Do not add a
   code path that bypasses `TornApiClient`.
5. **No captcha handling, no automating anything that looks like playing.**

### On the bootstrap requests

Loading reference data costs up to three API calls the first time you scan: the item
database, the city shop inventories, and an advisory key-access check. These are
one-time reference-data loads, cached for 7 days and rate-limited like everything
else — they are not game actions. Later scans read the cache and the page and make
**zero** requests, with one exception: if the key-access check is inconclusive it is
not cached, so it retries on the next scan.

Auto-scan (off by default) makes those same calls on page load rather than on a
click. Torn's rules do not require a click before an API call, but if you want the
strict "nothing happens until I press Scan" behaviour, leave auto-scan off.

---

## Security measures — do not regress these either

The concern that started this: was the API key exposed? It was not — V1 never wrote
the key to a file, never logged it, and sent it only to `api.torn.com` over HTTPS.
The real risk is the key's **access level**, which is a user setting rather than a
code flaw. These measures address both halves.

1. **Public-key-only, stated in the settings panel.** The key field is a password
   input with an explicit Show toggle, above a note explaining why Public is enough.
   After the first successful call the script checks the key's access level via
   `key/info`; if it is above Public, the settings panel shows a standing warning.
   The check is advisory — if it cannot determine the level it says nothing rather
   than raising a false alarm.
2. **Key rotation guidance in-app.** Tampermonkey menu → *Key safety / rotate key*
   explains the risk and opens Torn's API key settings. Settings → *Forget key*
   clears it.
3. **The key is never logged.** There is no `console.log` of the key anywhere, and
   `redactKey()` scrubs both the stored key and anything matching `key=…` out of
   every error message before it can reach the panel or an alert. Covered by tests.
4. **One destination.** `TORN_API_BASE` is a constant, callers pass a *path*, and
   `requestOnce()` asserts the resolved hostname is `api.torn.com` before the key is
   attached. The constant alone was not enough: an absolute URL overrides a base, so
   the assertion is what actually enforces this. Tested both ways. If a
   crowd-sourced bazaar feed is ever added (Phase 2), it gets its own client and
   **never receives a Torn key**.
5. **Rate limit + backoff**, so the key cannot trip Torn's abuse detection.
6. **No auto-actions**, so the account cannot be flagged as botting.
7. **Item names are never interpolated into HTML.** The panel builds DOM nodes and
   sets `textContent`; nothing from Torn's page reaches `innerHTML`.

### Out of scope, deliberately

Probing or stress-testing Torn's own API is not "testing our security" — it is
testing a third party's, without permission. App security here means securing our
code and the key handling, which is what the list above does.

---

## What changed from V1

| V1 | V2 |
|---|---|
| `sell_price > 0` treated as "an NPC will buy this" | allowlist built from shop inventories; anything else is flagged unverified and hidden by default |
| first `$` found in an element's text | name, price and quantity read from specific cells in one row; ambiguous rows are skipped, not guessed |
| no quantity, ranked per-unit | quantity parsed; ranked by profit × quantity, capped by cash on hand |
| `getItemNames()` rebuilt + re-sorted ~1,500 names per element over `body *` | one `Map`, built once; lookup is a hash hit |
| badge appended into Torn's DOM with `position: relative`, covering the Buy button | one class, `box-shadow: inset` — zero layout impact, nothing appended |
| `Clear` left the dataset flag, so Scan → Clear → Scan found nothing | `clearMarks()` removes classes *and* flags, including orphaned ones |
| both scanners ran on every Torn page | `detectPage()` runs exactly one scanner, or none |
| no `MutationObserver`; markers vanished on re-render | debounced observer re-marks after Torn re-renders |
| cache never expired | version string + 7-day TTL |
| "margin" was actually ROI | named `roi`; fee model in place for all venues |

---

## Status

**Phase 1 complete, with one caveat.**

The row selectors in `src/sources/dom/selectors.js` are **unverified against the live
site**. Torn ships hashed CSS-module class names that change when it rebuilds its
frontend, and these were written from the structure described in the V1 review rather
than read off a live page. Everything else — profit model, ranking, caching, API
client, key handling — is unit tested.

To verify: open a bazaar, press Scan, and read the empty-state message and the
diagnostics under **Filter**. `row selector: NO MATCH` means the selector list needs
an entry for your page; you can paste one into Settings → Row selectors without
editing the script. `skipped - unknown item` counts rows whose name cell was not
found.

Also unverified: the rule that **an item stocked by a city shop is one that shop buys
back**. That inference is what the whole verified/unverified split rests on, and
nothing in this repo proves it.

Phase 2 (API-driven Item Market sweep, so the list is global rather than
"whatever page I am on") and Phase 3 (standalone app reusing `core/` + `api/`) are
not started.
