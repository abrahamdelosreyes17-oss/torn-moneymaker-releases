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

**What it is for:** finding items players are selling cheaply - in bazaars or on
the Item Market - **below what an NPC shop pays** for them (the item's *Sell*
price), so you can buy and sell to the NPC for a guaranteed, untaxed profit. An
item whose Sell is *N/A* is never shown: no NPC buys it. The item's *Value* (the
average Item Market price) is a different number and is never used as an NPC price.

The panel has two lists, **Bazaars** and **Item Market**, never mixed. It shows the
one matching the page you are on (switching as you move between them), and the one
you last picked anywhere else. It works from any Torn page: the Item Market is
watched through the Torn API, bazaars through TornW3B (*Settings → Watch bazaars
too*, on by default). Each row says where the listing is (`Bazaar - SellerName` or
`Item Market`), where the data came from, and how old it is; its button opens the
seller's bazaar - with the listing highlighted - or the item's market page, or
scrolls to it when it is on the page you are viewing. Nothing is ever bought for you.

### Only live listings

- **The list refreshes itself every 30 seconds**, and **Scan** refreshes it at once:
  it throws everything away and rebuilds from fresh data.
- **Nothing is greyed out.** A listing the latest refresh does not confirm is
  removed:
  - a new fetch for an item **replaces** everything known about it, so a sold
    listing disappears on the next refresh;
  - bazaar listings TornW3B has not checked in the last 2 minutes are not shown;
  - Item Market items with a live opportunity are re-checked every 30 s; one that
    misses two refreshes is removed;
  - **the page you are viewing and the feed correct each other**: a feed row the
    page contradicts is removed, and a listing on the page that a later re-check
    shows has sold is removed (and loses its highlight) - Torn's page does not
    update itself, and this script may not reload it.
- **Locked listings are never shown.** Torn locks every **$1** bazaar item to a
  random few percent of players; for everyone else the card shows a red padlock
  (an `isBlockedForBuying___` element). A padlocked card is skipped before it is
  priced, so it is never highlighted however cheap it looks. There is no
  seller-set lock, and neither the Torn API nor TornW3B flags locked items, so
  **TornW3B's $1 bazaar listings are never offered from the feed** - there is no
  way to know if you could buy one. A missing price is never read as "locked".
- **Two limits no script can get past:** TornW3B serves each answer for 60 s and
  checks each bazaar every 30 s-5 min; Torn refreshes the Item Market every 30 s.
  Every row shows its real age rather than pretending to be newer.

### The panel

- **Header:** **Scan** (re-read this page now) · ↻ refresh everything · ⚙ Settings ·
  – collapse. Drag it anywhere; the position is remembered. Collapsed, it still
  shows *N deals · +$total*; click it to expand.
- **` (backtick)** shows and hides the panel from anywhere on the page - except
  while typing in chat or any other text box.
- **Scan** plays a short animation every time (the button pulses, a line sweeps
  under the header) and says what it found. A new page is scanned by itself as
  soon as its listings draw - Torn changes pages without an event, so the
  address is checked every 250 ms - with the same animation.
- **On a player's bazaar:** a badge after the owner's name in Torn's banner
  (*● Offline · 3h ago · Traveling to Mexico*) and the same line in the panel.
  One public-profile call when you open it, then at most every 30 s while you
  stay. If the banner says the bazaar is **closed**, its listings are not shown
  as deals, here or in the feed, until it is seen open again.
- **Seller status on every bazaar deal:** each row in the Bazaars list shows the
  owner's status right after their name (*Bazaar - Garrett89 ● Offline 3h ago ·
  Traveling*; hover for the full line), so you know whether they are around
  before you click. One public-profile call per seller for the first 10 sellers
  on the list, then at most once a minute each - about 10 calls a minute for a
  full list, inside the shared budget - and only while the Bazaars list is on
  screen in a visible tab.
- **Status line:** this list's deals and total on the left; on the right whether
  the feed is live and when it next refreshes (hover for the last error).
- **Sell to** chips, always visible - one click each:
  - **NPC** (on): listings under the item's Sell price.
  - **My bazaar** / **Market** - *trading*, off by default: listings under the
    item's average value, relisted in your own bazaar (untaxed) or sold on the
    Item Market (after the 5% tax).
  - **Min** and **Cash** chips: click to type a minimum total profit or the cash
    you have; Enter saves, Esc cancels.
- **Settings** replaces the list (← Back or Esc returns): the API key with Torn's
  key-use disclosure, the live feed switches, and **Open deals in a new tab**
  (on by default; untick it and GO TO BAZAAR / GO TO MARKET open in the tab
  you are in).
- **Tampermonkey menu** (maintenance, out of the way): Open settings, Re-download
  item data, Reset panel position, Show scan diagnostics, Key safety.
- An empty list always says why and offers the one button that would help.

Item data (Sell price, Value) is refreshed hourly.

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
    feed.js      live feed: exits, candidates, snapshots, expiry, and the
                 two-way correction between the page and the feed
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
   spends at most 30/min of it; TornW3B gets at most 60/min of its 100/min. Torn's 100/min is per user across all tools. Do not
   add a code path that bypasses `TornApiClient`.
5. **No captcha handling, no automating anything that looks like playing.**
6. **Nothing from an unfocused page, and no alerts.** rules.php forbids software
   that works from unfocused pages to "generate alerts, or draw attention to itself
   or another window". The feed runs only in a visible tab (a hidden leader steps
   down), and results appear only in the panel: no notifications, sounds or title
   flashing. Do not add them.
7. **Third parties are disclosed, and never get the key.** TornW3B is on by
   default, which Torn's API ToS allows for an automatic integration when the
   tool's own terms cover it: Settings names it, says it receives item ids only,
   and links its terms, and the Bazaars list credits it. Unticking it stops every
   request to it. Only item ids are sent; never the key.
8. **Stop on a dead key.** Torn error 2, 13 or 18 marks the key dead and nothing is
   sent until the user saves another. Torn warns that repeated invalid-key requests
   can earn an IP ban.

### API key terms of use (Torn API ToS disclosure)

Shown in Settings next to the key field, as Torn requires:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Competitive advantage: finding Bazaar and Item Market listings below NPC / market value | Stored locally / Not shared | Public (torn: items, cityshops; market: itemmarket; key: info; user: profile - bazaar owners' public online status, for the bazaar you view and the sellers on the Bazaars list) |

Plus a line naming the automatic integration: *TornW3B (weav3r.dev), for bazaar
prices; receives item ids only, never the key* - with a link to its terms beside
the Settings toggle and on the Bazaars list.

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

`test/ux-check.mjs` clicks every control in the panel in Chromium against the
built script and fails if any click does nothing visible.

All four exist because unit tests passed for days while the scanner could not read
a single real page, and because a release once shipped that no browser could parse.
**Run all four before every release.**

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

To verify: open a bazaar and read the empty-state message and the scan
diagnostics (Tampermonkey menu › *Show scan diagnostics*). `listing cards: 0` means
the card finder needs an entry for your page; `skipped - item not in database`
counts cards whose item could not be identified.

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
