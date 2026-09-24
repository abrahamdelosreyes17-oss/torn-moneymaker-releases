# Torn Trading — buyer-side opportunity scanner, and a selling page

Finds Bazaar and Item Market listings priced below what an NPC shop pays (or below
market value), ranks them by the profit you could actually realize, and links you
straight to them - from the page you are viewing, **and live from any Torn page**
via the Torn API and, if you opt in, TornW3B's bazaar feed.

Two more things, since 3.8.0: on **your own bazaar's add / manage pages** it shows
what each item is currently going for (and what it has gone for, recorded by the
script), and a **selling page** in its own tab lists every item you hold with the
TornExchange trader who pays most for it.

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
  - Item Market items with a live opportunity are re-checked before their data is
    a minute old (sooner when the budget allows); one that misses two refreshes
    (75 s) is removed;
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
- **Your own bazaar** (bazaar.php, no `userId`, `#/add` or `#/manage`): a price
  tag after each item's name - *IM $30 · Bazaar $28* - the lowest current Item
  Market ask (Torn API, one call per item on screen, 30 s cache) and the lowest
  current bazaar ask (TornW3B's one-call summary, which the watcher already has).
  The panel switches to **My bazaar**: every item found, and for the selected one
  the averages over the past 1 hour, 6 hours, 24 hours, 7 days and 30 days, with a
  graph. **No API publishes price or sale history for ordinary items**, so those
  averages are of asking prices *this script recorded itself, from the moment it
  was installed* - 5-minute points for 24 h, hourly for 7 days, 6-hourly for 30 -
  and every window says how much of it is actually covered ("Recorded 8%"); a
  window with nothing recorded says *no data* rather than a number. Torn's market
  value (the daily average of actual sales) is the one sale-based line. The
  hash changes without a page load, so the tags follow `#/add` ↔ `#/manage`.
  Tampermonkey menu › *Show my bazaar diagnostics* says which page was detected
  and how many rows were read - the real markup has not been captured here; the
  selectors come from a working 2026 price-filler script for these pages.
- **Sell** (the blue button; also under Settings): the selling page, always in
  its own tab (`index.php?ttv2=traders`, which the script turns into the page).
  Everything about it is its own - see *The selling page* below.
- **Cash and Min steer what is checked, not just what is shown.** Every item's
  cheapest bazaar price (one TornW3B summary) and value (the cached item
  database) are free, so before any request: an item you cannot afford one of,
  or that cannot reach your Min with your cash, is never fetched, and the rest
  are checked in order of what your cash can make. **With cash set, the list
  shows only what that cash can buy**: a row you cannot afford one of is hidden
  in every case (known or unknown quantity, whatever Min is); a row you can
  afford part of shows that part and its profit; and the header total is what
  the cash can make, best rows first, the last row only for the units the
  remaining cash buys, nothing after it. The Cash and Min boxes read `1234567`,
  `1,234,567`, `$1.5m`, `500k`, `2b`; anything they cannot read keeps the old
  value and says so. An empty list says what Cash and Min hid.
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
- **Settings** replaces the list (← Back or Esc returns): the Public API key with
  Torn's key-use disclosure, the watching switches, and **Open deals in a new
  tab** (on by default; untick it and Go opens the listing in the tab you are
  in). The selling page's keys are not here: it has its own settings.
- **Tampermonkey menu** (maintenance, out of the way): Open settings, Re-download
  item data, Reset panel position, Show scan diagnostics, Show my bazaar
  diagnostics, Key safety.
- An empty list always says why and offers the one button that would help.

Item data (Sell price, Value) is refreshed hourly.

### The selling page

"Which trader pays most for what I already hold?" Its own tab, its own keys, its
own settings and preferences - nothing is shared with the panel except the cached
item database (market values).

- **Settings** (⚙, and where the page opens until both keys are saved):
  - **Torn API key for this page - a Limited key.** Used only here, only to read
    your inventory (`/v2/user/inventory`, which needs Limited access), the item
    database when the shared cache is stale, and traders' public profiles for
    their online status. Torn's key-use table sits beside the field. Sent to
    `api.torn.com` and nowhere else; the same hostname assertion as the panel's
    client. Torn error 2/13/18 stops it until a new key is saved; error 16 says
    the key needs Limited access.
  - **TornExchange API key** - the key from your tornexchange.com account. Sent
    to `www.tornexchange.com` and nowhere else, never to Torn. The page refuses
    to save a Torn key in this field.
  - *Open links in a new tab* (on by default), and *Online only* is remembered.
- **Items** = your inventory, stacks merged by item, equipped and faction-owned
  copies left out; cached 15 minutes (Torn caches it an hour), ↻ re-reads it.
- **Each row**: item, quantity, **best offer** (always the highest price), the
  trader with their online status, **market value** (Torn's daily sales average,
  `value.market_price`), **traders avg** (the average of every TornExchange buy
  price for the item - marked *top 3* until the full list is loaded) and
  **total** (quantity × best offer). Best totals first; items no trader buys last.
- **Click a row** for every trader who buys it, highest first, each with status,
  price, total, **Profile** (their Torn profile, `profiles.php?XID=`) and
  **TE list** (`tornexchange.com/prices/{id}/`). A trader known only by name from
  the full list gets their id from TornExchange's active-traders list; failing
  that, the TE list link still works by name and the status reads *unknown*.
- **Online only** keeps only traders known to be online - still highest price
  first - and hides items with no online buyer. Statuses come from public
  profiles with the page's key: the best traders first, at most 20, refreshed
  every 60 s, only while the tab is visible, inside the shared 70/min budget.
- **TornExchange calls**: one `/api/all_best_listings` (the top three buyers of
  every item) every 30 minutes, one `/api/active_traders` every 30 minutes, and
  `/api/listings?item_id=` only for an item you open, kept 30 minutes. Never
  closer than 10 s apart (at most 6 a minute against its 10), never retried on
  their own, and a 429 waits out `retry_after`.
- Below ~700px the table becomes stacked cards. Nothing is traded or listed for
  you; every link is one you follow yourself.

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
    feed.js      live feed: exits, candidates, snapshots, expiry, the sweep
                 order, and the two-way correction between the page and the feed
    leader.js    which tab runs the feed (one, visible)
    inventory.js your inventory: parsing, merging stacks, cache
    selling.js   the selling page: offers highest-first, online filter,
                 traders' average, merging TornExchange's lists
    history.js   the price history the script records (buckets, averages,
                 coverage)
  feed/
    controller.js  polls within budget in the leader tab; storage is the truth
  api/
    client.js    THE only code that talks to api.torn.com: one rate-limited
                 queue shared by every tab, dedup, backoff, dead-key detection
    torn.js      endpoint wrappers (items, shops, key access, item market,
                 profiles, inventory)
    w3b.js       TornW3B client: weav3r.dev only, never holds the key
    te.js        TornExchange client: tornexchange.com only, its own key
  sources/
    route.js     which Torn page are we on
    dom/         reading listings (and your own bazaar's rows) out of the
                 page being viewed
  ui/
    panel.js     the ranked list, My bazaar, settings
    selling-page.js  the selling page (its own tab)
    graph.js     the recorded-price graph (SVG)
    overlay.js   row marking
    styles.js    all CSS and the colour tokens
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
   `torn.com` anywhere — only `api.torn.com` (from `src/api/client.js`),
   `weav3r.dev` (from `src/api/w3b.js`) and `www.tornexchange.com` (from
   `src/api/te.js`). Do not add page scraping, and do not
   "verify" a listing by loading a bazaar in a hidden tab or iframe.
3. **Public API key only for the panel.** Nothing the panel does needs more. The
   selling page keeps a **separate Limited key**, used only there and only for
   your own inventory, the item database and public profiles - the selections
   its disclosure table names. Neither key is ever used for the other's job.
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
7. **Third parties are disclosed, and never get a Torn key.** TornW3B is on by
   default, which Torn's API ToS allows for an automatic integration when the
   tool's own terms cover it: Settings names it, says it receives item ids only,
   and links its terms, and the Bazaars list credits it. Unticking it stops every
   request to it. Only item ids are sent; never a key.
   **TornExchange** is used only by the selling page, only with the TornExchange
   API key from the user's own tornexchange.com account, saved in that page's
   settings. That key goes to `www.tornexchange.com` (asserted on the resolved
   hostname) and nowhere else; no Torn key ever goes there (the page refuses to
   save one in that field). At most 6 calls a minute, never retried on their
   own, and a 429 waits out TornExchange's `retry_after`: it allows 10 requests
   a minute per IP, and every request over that doubles a penalty that reaches
   48 hours.
9. **One key's worth of API.** Torn's limit is 100 a minute **per user, across
   all of their keys**, so extra keys add nothing. Using other players' keys to
   pool the limit needs each owner's informed opt-in under a disclosed ToS, and
   extra accounts are banned outright. Do not add key rotation.
8. **Stop on a dead key.** Torn error 2, 13 or 18 marks the key dead and nothing is
   sent until the user saves another - each key separately. Torn warns that
   repeated invalid-key requests can earn an IP ban.
10. **Your own bazaar is read, never written.** The add / manage helper reads the
    rows of the page you are viewing and adds a text tag after the name. It never
    fills a price or quantity box and never clicks anything of Torn's.

### API key terms of use (Torn API ToS disclosure)

Shown where each key is entered, as Torn requires. The panel's key:

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Competitive advantage: finding Bazaar and Item Market listings below NPC / market value | Stored locally / Not shared | Public (torn: items, cityshops; market: itemmarket; key: info; user: profile - bazaar owners' public online status, for the bazaar you view and the sellers on the Bazaars list) |

Plus a line naming the automatic integration: *TornW3B (weav3r.dev), for bazaar
prices; receives item ids only, never the key* - with a link to its terms beside
the Settings toggle and on the Bazaars list.

The selling page's key (a separate table beside its own field):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Personal gain: pricing the items you hold against traders' offers | Stored locally / Not shared | Limited (user: inventory - your own items; torn: items - market values; user: profile - traders' public online status) |

Plus: *TornExchange (tornexchange.com), with the separate TornExchange key entered
below; this Torn key never goes there.*

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
   parameter at all, and strips every query parameter except `comment`. The
   TornExchange client (`src/api/te.js`) asserts `www.tornexchange.com` and only
   ever holds the TornExchange key. The selling page's Limited key lives in its
   own `TornApiClient` (same assertion, same shared request window). All tested.
5. **Rate limit + backoff**, so the key cannot trip Torn's abuse detection.
6. **No auto-actions**, so the account cannot be flagged as botting.
7. **Item names are never interpolated into HTML.** The panel builds DOM nodes and
   sets `textContent`; nothing from Torn's page or TornW3B reaches `innerHTML`.
8. **No key is left in the page.** A value in an `<input>` on torn.com is
   readable by every script on the page, so a saved key is only put into its
   field while the user has pressed *Show* - the panel's Public key and both of
   the selling page's keys alike. Error text is redacted with `redactKey()` for
   whichever key a client holds.

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
Torn API, TornW3B and TornExchange responses (including `/v2/user/inventory`,
which only answers the Limited key), waits for the live feed, and prints the
rows, every request URL, and whether a key ever reached weav3r.dev (it must
not). With `?ttv2=traders&sellkeys=1` it boots the selling page with its keys.

`test/ux-check.mjs` clicks every control in the panel and the selling page in
Chromium against the built script - the cash rules, your own bazaar's add page
(fixture rows), the selling page's table, Online only, Profile / TE list links
and where each key goes - and fails if any click does nothing visible or any
text is under 12px (11px uppercase labels excepted). `SHOTS=<dir>` keeps the
screenshots.

`test/discovery.test.js` is the Item Market regression as a permanent test: ten
simulated minutes of the feed over 1,000 items must find most of the 20 planted
Item Market deals with NPC only, NPC + Market, and NPC + Market + cash.

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

**Item Market discovery (3.8.0):** every item with an exit is swept, NPC items
first (closest NPC price to value first), then resale-only items; discovery gets
a slot every cycle; a fetched item is re-checked only while one of its listings
beats an exit. 3.6.0 swept only items whose NPC price beat 85% of value, and 3.7.0
re-checked every item it had ever fetched until the sweep stood still; the
simulation in `test/discovery.test.js` found 3/20 and 0/20 then, 14/20 now.

**Phase 2 (live feed) is built in v3.0.0, and verified against simulated responses
only.** The Torn API and TornW3B response shapes it reads come from their published
specs and from other tools' source, and it runs correctly against those shapes in a
real browser. It has not yet been run against the live services. First live check:
turn on TornW3B, sit on any Torn page for a minute, and confirm the *Live feed* line
reads `on | Item Market | bazaars (N leads)` with no warning (hover it for the last
error, if any).

Phase 3 (standalone app reusing `core/` + `api/`) is not started.
