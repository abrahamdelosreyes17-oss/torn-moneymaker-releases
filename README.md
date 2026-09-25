# Torn Trading — buyer-side opportunity scanner, and Torn Bids

Finds Bazaar and Item Market listings priced below what an NPC shop pays (or below
market value), ranks them by the profit you could actually realize, and links you
straight to them - from the page you are viewing, **and live from any Torn page**
via the Torn API and, if you opt in, TornW3B's bazaar feed.

Two more things: on **your own bazaar's add / manage pages** it shows each item's
**Item Market Average** with a graph, and **Torn Bids** (the traders page) in its own tab lists
every item you hold with the trader who pays most for it - from TornExchange and
TornW3B price lists.

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

- **Never over Torn's content.** The panel floats in front of the page, in the
  empty space to the right of Torn's content: it is sized to that space (up to
  430px) and can't be placed or dragged across Torn's content. Torn's page is
  never moved or resized. The header, the filter chips and the tab row are
  each always ONE row: in less room they use slightly smaller type and tighter
  spacing (measured, three steps at most), never cutting or wrapping anything,
  and a few pixels may be borrowed from the window edge and the gap - never
  from Torn's content. Min and Cash show as few characters as say the amount
  ($1.5m, $25m). Only the status line wraps, rather than cut its message. With
  less than 240px of room (a very narrow window) it floats bottom-right as it
  always did.
- **Header:** **Sell** · **Scan** (re-reads this page and refreshes every price -
  one button, it used to be Scan and ↻) · ⚙ Settings ·
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
- **Your own bazaar** (bazaar.php, no `userId`, `#/add` or `#/manage`): a tag
  after each item's name - *Item Market Average $830,000* - Torn's market value,
  its average of what the item actually sold for (refreshed hourly with the item
  list). The panel switches to **My bazaar**: every item with its average, and
  for the one picked, the average in large type over a graph (24 h / 7 d / 30 d)
  with a price scale and time marks. The graph's two lines: the **Item Market
  Average**, one value a day, and the **lowest listing** this script saw (one
  Item Market call per item on screen, recorded since install - 5-minute points
  for 24 h, hourly for 7 days, 6-hourly for 30). **No API publishes sale history
  for ordinary items**, so this record is the script's own; hours with nothing
  recorded are bridged with a faint dotted line, a troll listing far off the
  scale is pinned to the edge as an arrow, and pointing at the graph reads out
  the date, the average and the lowest price there. The hash changes without a
  page load, so the tags follow `#/add` ↔ `#/manage`.
  Tampermonkey menu › *Show my bazaar diagnostics* says which page was detected
  and how many rows were read - the real markup has not been captured here; the
  selectors come from a working 2026 price-filler script for these pages.
- **Highlights on the page:** green for listings that meet your Min (the brighter
  green for the top three), **amber** for listings below your Min that still
  make a profit. The list shows only what meets your Min; Cash still hides what
  you cannot afford one of.
- **Sell** (the blue button; also under Settings): the traders page, always in
  its own tab, on a page of our own rather than Torn's
  (`abrahamdelosreyes17-oss.github.io/torn-moneymaker-releases/traders.html`, a
  blank GitHub Pages page the script draws over; the old `torn.com/?ttv2=traders`
  address forwards there).
  Everything about it is its own - see *The traders page* below.
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
  in). The traders page's keys are not here: it has its own settings.
- **Tampermonkey menu** (maintenance, out of the way): Open settings, Re-download
  item data, Reset panel position, Show scan diagnostics, Show my bazaar
  diagnostics, Key safety.
- An empty list always says why and offers the one button that would help.

Item data (Sell price, Value) is refreshed hourly.

### The traders page: Torn Bids

"Which trader pays the most for what I hold?" Its own tab, its own keys, its own
settings - nothing is shared with the panel except the cached item database.
Nothing is traded, listed or clicked for you; in Torn you trade by messaging the
trader, and every link here is one you follow yourself.

- **My items** first: everything in your inventory (stacks merged, equipped and
  faction-owned copies left out), each with its **best price per item** and who
  pays it, their online status beside the name. Items with a trader first,
  highest price first; an item nobody buys says **No Trader Found** - but only
  once every source has answered ("Checking…" until then, "No traders yet" when
  no trader is known at all). The **search box** narrows it: typing *xanax*
  shows only Xanax and its traders.
- **All items** (the other tab): every item any known trader buys, searched
  with the same box (each tab keeps its own search), 50 at a time.
- **Open an item** for every trader buying it, **highest price first**, each
  with name, online status, price per item, and fixed link slots - **Profile**
  (their Torn profile), **TE list** (their TornExchange price list) and
  **W3B list** (their TornW3B price list) - so each link sits in the same place
  on every row and the prices stay in one column.
- **One row per trader**: a trader on both TornExchange and TornW3B shows once,
  at the higher of their two prices, with both lists linked.
- **Show** (right column): **Buyers online only** keeps only traders known to
  be online, order unchanged; **Trusted buyers only** keeps traders with the
  Trusted badge. Both apply to the whole page, Who to message included. Our
  own online checker asks Torn's public profile for every trader of every item
  you hold (best first), at most 30 a minute inside the shared 70/min, each
  again every 10 minutes (90 s while its item is open), visible tab only; an
  item says "Checking…" until its traders are known. Online but in hospital,
  in jail or flying shows orange, "Online · Hospital". A status not known yet
  shows nothing.
- **Layout** (the owner picked mockup E): the full width of the window. A
  header with the name, one search box (`/` jumps to it) and every source as a
  pill (dot, progress, the detail on hover); a line of headline numbers (items
  you hold, with a buyer, buyers online, traders known); your items on the
  left; **Who to message** pinned on the right (the five traders with the best
  price on the most of your items - in Torn you trade with one person at a
  time; click one to see just their items). One scrollbar: the page scrolls,
  the right column stays put.
- **Three views, switched like a file explorer's**: **Cards** (a tile per
  item), **Rows** (item, top bid, buyer, next bid, traders) and **Table** (the
  same, dense). Click a column header in Rows or Table to sort by it, again to
  turn it round; items nobody buys stay last. The view is remembered.
- **Click an item**: its traders slide in from the right, over the page -
  nothing under it moves. ✕ or Esc closes it. On a phone it takes the screen.
- **Phones** (under 1000px): one column, Who to message (top three) above the
  items, the view switch on its own row.
- **Trust badge** beside a trader: Trusted (100+), Known (20+), New (0-19) or
  Caution (below 0), from the better of their TornExchange vote score and
  their TornW3B rating (ups minus downs); hover for the numbers.
- No quantities, totals or bundle maths: a price list is prices per item.
- **Built to be read** (eye-tracking and layout research): pictures and names
  down the left edge where the eye scans first, the answer (best price) as the
  largest, brightest figure in one right-aligned column of tabular numbers, who
  pays it right beneath it, colour only where it means something (green = best
  price / online, blue = link), whole rows as click targets, and a list's order
  frozen while the pointer is over it so a row never moves under a click.

**No one source can empty the page.** It starts from a built-in list of TornW3B's
public traders (no key needed); while TornExchange has no working key it asks
TornExchange's keyless `/api/best_listing` for the best buyer of each item you
hold; and each source has its own pill in the header. A rejected
TornExchange key shows TornExchange's own words, is retried every 10 minutes,
and can be retried at once with **Try again**.

**Where traders come from - our own trader database.** Traders publish buy
prices in two places, and TornW3B has no list of its traders, so the script
keeps its own:
- every active **TornExchange** trader (`/api/active_traders`, with ids), and
  the top three buyers of every item (`/api/all_best_listings`, every 10 min);
- every trader a **TornW3B** page you open links to (`/pricelist/{id}` links:
  its Highest Rated and Most Trades lists, Search Deals). On weav3r.dev the
  script only reads the page you are on, sends nothing and changes nothing;
- each known trader's **TornW3B price list** (`/api/pricelist/{id}`, no key) is
  read one at a time, at most 24 a minute: never-read lists first, then lists
  of traders who buy something you hold (every 10 min), then the rest (hourly);
  a trader with no list is checked again daily. A list older than 6 hours is
  not shown.

**Settings** (⚙, and where the page opens until the Limited key is saved):
- **Torn API key - a Limited key.** Used only here: your inventory
  (`/v2/user/inventory`), the item database when the shared cache is stale, and
  traders' public profiles. Torn's key-use table sits beside the field. Sent to
  `api.torn.com` only. Error 2/13/18 stops it until a new key is saved; error 16
  says the key needs Limited access.
- **TornExchange** - TornExchange's API key *is* the Torn key you log into
  tornexchange.com with (it checks `?key=` against the key you logged in with),
  so it is often your Limited key: *Use my Limited key* fills it in. It goes to
  `www.tornexchange.com` only, which already has it. Calls are at least 10 s
  apart (6 a minute against its 10 per IP), never retried on their own, shared
  by every tab, and a 429 waits out `retry_after`; saving or forgetting the key
  never resets that wait.
- *Open links in a new tab* (on by default); *Online only* is remembered.

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
    selling.js   the traders page: TornExchange caches and timing
    traders.js   our trader database (TornExchange + TornW3B), one row per
                 trader per item, highest first, which price list to read next
    history.js   the price history the script records (buckets, averages,
                 coverage)
  feed/
    controller.js  polls within budget in the leader tab; storage is the truth
  api/
    client.js    THE only code that talks to api.torn.com: one rate-limited
                 queue shared by every tab, dedup, backoff, dead-key detection
    torn.js      endpoint wrappers (items, shops, key access, item market,
                 profiles, inventory)
    w3b.js       TornW3B client: weav3r.dev only, never holds a key;
                 bazaar prices and traders' price lists
    te.js        TornExchange client: tornexchange.com only, with the key
                 you log into TornExchange with
  sources/
    route.js     which Torn page are we on
    dom/         reading listings (and your own bazaar's rows) out of the
                 page being viewed
  ui/
    panel.js     the ranked list, My bazaar, settings
    selling-page.js  the traders page (its own tab)
    graph.js     the add-page graph: scale, gaps, outliers, hover readout
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
   "verify" a listing by loading a bazaar in a hidden tab or iframe. On
   weav3r.dev (not a Torn page) the script only reads the page you opened for
   the traders it links to; it sends nothing from there.
3. **Public API key only for the panel.** Nothing the panel does needs more. The
   traders page keeps a **separate Limited key**, used only there and only for
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
7. **Third parties are disclosed, and never get a key they do not already have.** TornW3B is on by
   default, which Torn's API ToS allows for an automatic integration when the
   tool's own terms cover it: Settings names it, says it receives item ids only,
   and links its terms, and the Bazaars list credits it. Unticking it stops every
   request to it. Only item ids are sent; never a key.
   The traders page reads traders' public TornW3B price lists the same way: no
   key, only the trader's id in the path.
   **TornExchange** is used only by the traders page. Its API key *is* the Torn
   key the user logs into tornexchange.com with (TornExchange checks `?key=`
   against it), so that key - often the same Limited key - is sent to
   `www.tornexchange.com` (asserted on the resolved hostname) and nowhere else,
   which already holds it. (3.8.1 refused a Torn key there, which left the page
   with no traders at all.) At most 6 calls a minute, never retried on their
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

The traders page's key (a separate table beside its own field):

| Data storage | Data sharing | Purpose of use | Key storage & sharing | Key access level |
|---|---|---|---|---|
| Only locally | Nobody | Personal gain: finding who pays most for your items | Stored locally / Not shared | Limited (user: inventory - your own items; torn: items - item names; user: profile - traders' public online status) |

Plus: *TornExchange, only with the key you log in there with.*

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
   ever holds the key you log into TornExchange with. The traders page's Limited key lives in its
   own `TornApiClient` (same assertion, same shared request window). All tested.
5. **Rate limit + backoff**, so the key cannot trip Torn's abuse detection.
6. **No auto-actions**, so the account cannot be flagged as botting.
7. **Item names are never interpolated into HTML.** The panel builds DOM nodes and
   sets `textContent`; nothing from Torn's page or TornW3B reaches `innerHTML`.
8. **No key is left in the page.** A value in an `<input>` on torn.com is
   readable by every script on the page, so a saved key is only put into its
   field while the user has pressed *Show* - the panel's Public key and both of
   the traders page's keys alike. Error text is redacted with `redactKey()` for
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
not). With `?ttv2=traders&sellkeys=1` it boots the traders page with its keys (`&sellsame=1`: the same Limited key for both; `&w3btrader=1`: a trader known only from TornW3B; `?ownbazaar=1&page=bazaar#/add`: your own add page with a week of recorded prices).

`test/ux-check.mjs` clicks every control in the panel and the traders page in
Chromium against the built script - the cash rules, your own bazaar's add page
(fixture rows), the traders page (same-key setup, My items / All items, filter, Online only, Profile / TE list / W3B list links)
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
