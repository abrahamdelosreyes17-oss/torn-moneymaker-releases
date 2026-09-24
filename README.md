# Torn Trading — buyer-side opportunity scanner

Finds Bazaar and Item Market listings priced below what an NPC shop pays (or below
market value), ranks them by the profit you could actually realize, and links you
straight to them - from the page you are viewing, **and live from any Torn page**
via the Torn API and, if you opt in, TornW3B's bazaar feed.

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

- **On a Bazaar or the Item Market**, profitable listings on the page get a green
  highlight and a profit label, and the panel ranks them; `>` scrolls to one.
- **Anywhere in Torn**, the live feed (on by default) watches the Item Market
  through the Torn API. Tick *Settings → Also watch bazaars, using TornW3B* to add
  bazaar listings. Each row says where it is (`Bazaar - SellerName` or
  `Item Market`), where the data came from, and **how old that data is**; `>`
  opens the seller's bazaar - with the listing highlighted - or the item's market
  page. Nothing is ever bought for you.

Every row carries the age of the data behind it, and fades once that passes a
minute. A feed row is only as fresh as its source: TornW3B re-checks a bazaar every
30 s-5 min, and Torn caches the Item Market for 30 s. The feed therefore drops what
it cannot vouch for rather than showing it:

- a new fetch for an item **replaces** everything known about it, so a sold listing
  disappears on the next refresh instead of lingering;
- bazaar rows TornW3B has not re-checked in 5 minutes are dropped, and any feed data
  not refreshed within 5-10 minutes expires;
- an item whose cheapest bazaar price stops being a deal loses its rows at once;
- **the page you are viewing overrules the feed**: open a bazaar or the market and
  any feed row the page contradicts (a higher price is showing) is removed;
- a row you opened is dimmed and re-verified first, and lights up again only if
  the source re-confirms it.

**Resale exit.** "Market value" is priced as a resale in **your own bazaar** by
default, which is untaxed, so a listing 1% under market value shows as a 1% margin.
Untick *Filters → resell in my bazaar* to price it as an Item Market sale instead,
where the 5% tax makes that same listing a loss. Each row says which exit it assumed.
Market value is refreshed hourly (it was cached for a week).

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
    ledger.js    what pages you visited showed, stamped with when they showed it
    feed.js      live feed: candidates, snapshots, expiry, page reconciliation
    leader.js    which tab runs the feed (one, visible)
  feed/
    controller.js  polls within budget in the leader tab; storage is the truth
  api/
    client.js    THE only code that talks to api.torn.com: one rate-limited
                 queue shared by every tab, dedup, backoff, dead-key detection
    torn.js      endpoint wrappers (items, shops, key access, item market)
    w3b.js       TornW3B client: weav3r.dev only, never holds the key
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
   or scrolls. A user click never triggers a chain of game actions, and nothing is
   clicked or pre-filled for you.
2. **Never fetch a Torn page the user is not viewing.** There is no `fetch` of
   `torn.com` anywhere — only `api.torn.com` (from `src/api/client.js`) and
   `weav3r.dev` (from `src/api/w3b.js`). Do not add page scraping, and do not
   "verify" a listing by loading a bazaar in a hidden tab or iframe.
3. **Public API key only.** Nothing this script does needs more.
4. **Rate-limit everything.** All Torn API calls pass through one queue capped at
   70/min, **shared by every open tab**, with dedup and backoff; the live feed
   spends at most 20/min of it. Torn's 100/min is per user across all tools. Do not
   add a code path that bypasses `TornApiClient`.
5. **No captcha handling, no automating anything that looks like playing.**
6. **Nothing from an unfocused page, and no alerts.** rules.php forbids software
   that works from unfocused pages to "generate alerts, or draw attention to itself
   or another window". The feed runs only in a visible tab (a hidden leader steps
   down), and results appear only in the panel: no notifications, sounds or title
   flashing. Do not add them.
7. **Third parties are opt-in, and never get the key.** TornW3B is off until the
   user ticks it, next to a link to its terms, as Torn's API ToS requires for an
   opt-in integration. Only item ids are sent to it.
8. **Stop on a dead key.** Torn error 2, 13 or 18 marks the key dead and nothing is
   sent until the user saves another. Torn warns that repeated invalid-key requests
   can earn an IP ban.

### API key terms of use (Torn API ToS disclosure)

Shown in Settings next to the key field, as Torn requires:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Competitive advantage: finding Bazaar and Item Market listings below NPC / market value | Stored locally / Not shared | Public |

The research behind these rules - the rules.php and api.html text, how TornTools and
others use TornW3B, and the data sources' real caching - is summarised in
`docs/research/` where that folder is available.

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
4. **One destination per client.** `TORN_API_BASE` is a constant, callers pass a
   *path*, and `requestOnce()` asserts the resolved hostname is `api.torn.com` before
   the key is attached. The constant alone was not enough: an absolute URL overrides
   a base, so the assertion is what actually enforces this. The TornW3B client
   (`src/api/w3b.js`) makes the same assertion for `weav3r.dev`, has no key
   parameter at all, and strips every query parameter except `comment`. Both tested.
5. **Rate limit + backoff**, so the key cannot trip Torn's abuse detection.
6. **No auto-actions**, so the account cannot be flagged as botting.
7. **Item names are never interpolated into HTML.** The panel builds DOM nodes and
   sets `textContent`; nothing from Torn's page or TornW3B reaches `innerHTML`.
8. **The key is not left in the page.** A value in an `<input>` on torn.com is
   readable by every script on the page, so the saved key is only put into the
   field while the user has pressed *Show*.

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

## Verifying a change before release

`test/fixture.html` holds markup captured from live Torn pages. Serve the project and
open it to run the real scanner against it in a real browser:

```bash
python -m http.server 8777
```

Then open `http://localhost:8777/test/fixture.html`. The page prints the diagnostics,
what was parsed, and the ranking, and marks the profitable cards exactly as the
script does on Torn.

`test/harness.html` boots the REAL built userscript with GM_* stubs and checks the
panel actually mounts. Unit tests and a syntax check both pass on a bundle whose UI
throws on load, so this is the one that catches "installed, and nothing appears".

`test/harness-live.html` boots the real bundle on a non-market page with canned
Torn API and TornW3B responses, waits for the live feed, and prints the rows, every
request URL, and whether the key ever reached weav3r.dev (it must not).

All three exist because unit tests passed for days while the scanner could not read
a single real page, and because a release once shipped that no browser could parse.
**Run all three before every release.**

## Status

**Phase 1 complete, with one caveat.**

The scanner reads Torn's own ARIA labels and image paths rather than its CSS classes:

- `aria-label="Buy item Hammer, $100, 1 in total."` gives the name, unit price and
  quantity in one structured string — no text scraping, no first-`$` guessing.
- `/images/items/206/large.png` gives the item id directly, so nothing depends on
  matching item names.

Both were captured from live Item Market markup on 2026-09-23. Hashed class names
(`itemTile___gJeSo`) are used only to snap from an image up to its card, and a
generic climb handles the case where they change.

**Item Market is verified. Bazaar pages are not** — that markup has not been captured
yet. v3.0.0 reads a bazaar card's own text nodes (so a price sharing its element with
the "↓1%" badge still reads as $838,745, not $8,387,451) and treats "(N in stock)" as
that seller's quantity, and both work on a card reconstructed from a screenshot —
but that is not captured markup.

To verify: open a bazaar, press Scan, and read the empty-state message and the
diagnostics under **Filter**. `row selector: NO MATCH` means the selector list needs
an entry for your page; you can paste one into Settings → Row selectors without
editing the script. `skipped - unknown item` counts rows whose name cell was not
found.

Also unverified: the rule that **an item stocked by a city shop is one that shop buys
back**. That inference is what the whole verified/unverified split rests on, and
nothing in this repo proves it.

**Phase 2 (live feed) is built in v3.0.0, and verified against simulated responses
only.** The Torn API and TornW3B response shapes it reads come from their published
specs and from other tools' source, and it runs correctly against those shapes in a
real browser. It has not yet been run against the live services. First live check:
turn on TornW3B, sit on any Torn page for a minute, and confirm the *Live feed* line
reads `on | Item Market | bazaars (N leads)` with no warning (hover it for the last
error, if any).

Phase 3 (standalone app reusing `core/` + `api/`) is not started.
