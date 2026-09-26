# Handoff: Torn userscript (for the next session)

Read this first, then `README.md`. The README holds the product and the binding
rules; this file holds where we are, how the owner works, and what is settled.

## Where things stand (3.10.3, 2026-09-26)

- **Version 3.10.3** (`f48072c`) on branch `claude/optimistic-ride-1gqguu`,
  on top of 3.8.1 (`0210c53`) and the cloud session's handoff commits.
  Last install link given to the owner (3.10.3):
  `https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/f48072c53287869ddc31e18fda945c898f43dc92/torn-moneymaker.user.js`
- **`main` is still at 2.9.3.** The script's `@updateURL` points at `main`, so
  installs are done from **pinned links**:
  `https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/<commit>/torn-moneymaker.user.js`
  Merging to `main` would make every install auto-update. Only do that when
  the owner asks.
- `claude/trusting-ride-m6bvhg` (3.4.1) is fully contained in this branch.
- Who uses it: the owner and a friend who plays Torn.
- The owner's last word on 3.10.1: "nice, good work". Nothing is waiting on
  an answer from them.

### Start here next session

1. Ask the owner to install 3.10.2, set Cash, and open Torn Bids and a Torn page, then
   look in their Chrome (pages they opened only): Torn Bids with their 222
   items at their screen width, and the panel beside Torn's real content.
   Everything since 3.9.4 is checked in the harness only.
2. Run `test/ux-check.mjs` once Playwright is available (updated for Torn
   Bids, never run).
3. Then the open list at the end of "Not done / open" - ask which first.

**3.10.3 - weapon and armour listings get amber below Min (the owner's report, 2026-09-26).**
- What the owner saw: Item Market, Fiveseven, Min $1,000. A listing at
  $6,615 → NPC $7,500 (+$885 each) stayed green and listed; changing Min
  changed nothing. The panel said "qty unknown".
- Cause: on the Item Market a quantity is only trusted from a seller row's
  "N available"; otherwise it is "unknown", and Min is deliberately not
  applied to unknown quantities (commit 489e70a: a stackable item's tile
  shows the market-wide total, not how many are at its price). So it could
  never go amber.
- But a weapon or armour card is ONE item. Read off the owner's own open
  page (no clicks, no navigation): all 60 Fiveseven cards carry their own
  stats (`aria-label="53.47 damage points"`, `"49.31 accuracy points"`)
  and a Buy label "…, 1 in total."; the Xanax tile has no stats and
  "13,531 in total". Torn's API schema agrees: non-stackable listings carry
  `item_details` whose only stats are damage, accuracy and armor.
- Fix (`sources/dom/scan.js`, `isOneItemListing`): on the Item Market, a
  card with its own damage / accuracy / armo(u)r points and "1 in total" is
  one item at that price, so Min applies: below Min but profitable is amber
  and out of the list; at or above Min is green and listed. Stackable tiles
  keep the old rule.
- Not verified: an armour card's exact label (assumed "armor points" /
  "armour points"), temporary weapons (believed stackable), and bazaars
  (they already read "in stock"). Tests in `test/core.test.js`.

**3.10.2 - Cash no longer empties the deals (the owner's report, 2026-09-26).**
- What the owner saw: NPC deals on screen (Travel Visa $120,000 → $122,500
  ×4, Magnum $15,500 → $16,000, ...). The moment Cash was set to $2m, every
  deal was gone; Refresh brought nothing back. A regression since 3.8.0.
- Cause: `selectCandidates()` (`core/feed.js`) ranked TornW3B's summary by
  profit × how many your cash buys (`reachableProfit`), as if every listing
  had unlimited stock. With $2m, a $10 item making $1 scored 200,000 and the
  Visa 40,000, so cheap junk took all 25 slots, and `refreshSummary()`
  (`feed/controller.js`) then deletes every bazaar row outside the
  candidates - the real deals included.
- Fix: rank by profit per item, cash or no cash; Cash (and Min) only leave
  out what you cannot buy one of / cannot reach. The Item Market sweep's
  tie-break had the same unlimited-stock assumption; now per item too.
- Test: `test/cash.test.js` "setting Cash never pushes out deals you can
  afford" - it failed before the fix (junk first) and passes after.
- Not verified on real Torn yet. The Item Market tab also went empty in the
  owner's screenshot: its rows are only removed by age, and Cash hides
  listings over $2m, so check whether those two deals cost more than $2m.

**3.10.0 - Torn Bids, and the panel's chips on one row.**
- The traders page is now **Torn Bids** (the owner rejected "Sell to traders"
  as a title and picked mockup E of five; the mockups are in `mockups/`,
  untracked). Full width; header with the name, one search box, a pill per
  source, ↻ and ⚙; headline numbers; your items on the left in **Cards / Rows /
  Table** (the owner asked for a file-explorer-style view switch; pref
  `view`); **Who to message** (top 5) and **Show** (Buyers online only, new
  **Trusted buyers only**, pref `trustedOnly`) pinned on the right; an item's
  traders slide in from the right (one item at a time, ✕ / Esc). Rows and
  Table sort by any column (`sortItemRows` / `nextSort` in `traders.js`,
  state `sell.sort`, not saved). One page scrollbar (the owner disliked
  mockup C's inner scroll). Phone (<1000px): one column, Who to message's top
  three first; the side panel takes the screen. The page adds a viewport
  meta tag when there is none (the harness has none; gh-pages `traders.html`
  has one, and its fallback text now says "Torn Bids"), or phones lay it out
  980px wide.
- The owner's layout rules for this page: full width, no inner scrollbars,
  nothing cut with "…", no placeholder for an unknown status.
- **Overlay:** the filter chips and the tab row are ONE row at every fitted
  width (240-430px), like the header: `fit()` measures all three rows and
  steps `ttv2-narrow` → `ttv2-tight` → `ttv2-tighter` (the last makes the
  chips 10px, which the owner allowed: "you can make the font a bit
  smaller"), then borrows at most 12px from the window edge and 6px from the
  gap - never from Torn's content. Min / Cash use `formatMoneyCompact`
  ($1.5m, not $1.50m). Checked in the harness at 430, 288 and 240px free,
  with Min $12.35m and Cash $1.23b, while editing a chip, and dragged.
- **3.10.1, after a self-review and an independent code review:**
  - a sort, search, filter or Show toggle applies at once even with the
    pointer over the list (the frozen order is only for prices arriving);
  - Rows / Table columns can shrink (names and counts wrap, prices never do),
    so nothing overflows sideways at any width (checked at 1210, 1280, 430);
  - keyboard: focus survives redraws (`data-focus` keys), moves to the side
    panel's ✕ when it opens and back to the item when it closes; on a phone
    the page behind the side panel is `inert`, and "/" is ignored there;
    sort headers are real buttons, table rows keep their row role;
  - the side panel redraws when the Show toggles change its empty message,
    and hides only after sliding out;
  - a trader picked in Who to message stays picked when a Show toggle
    hides them for a moment;
  - overlay: the chip editor re-fits the row (its box is narrower in the
    last step), and a dragged panel borrows the same few px, still clear of
    Torn's content.
- **Known, accepted:** Esc in the search box also clears it (the browser's
  own behaviour for search boxes); on a very short window the right column's
  Show box can sit below the fold until the list ends; with less than 240px
  free the panel still floats over Torn's content (as since 3.9.5 - there is
  no room for one-row chips).

**3.9.3 - the traders page moved off Torn** to our own GitHub Pages page,
`https://abrahamdelosreyes17-oss.github.io/torn-moneymaker-releases/traders.html`
(branch `gh-pages`, a blank page the script draws over), so it can be opened
and checked in the owner's Chrome like any site, and never loads Torn's home
page. The old `torn.com/index.php?ttv2=traders` forwards there. The harness
still boots it with `?ttv2=traders` on its own page.

**3.9.2 - no single source can empty the traders page** (the owner saw only
"No traders yet" while TornExchange rejected the key; they had logged in there
with the same Limited key, so the cause on TornExchange's side is still unknown):
- a built-in list of 108 public TornW3B traders (`src/core/seed-traders.js`,
  from TornW3B's leaderboards and Search Deals on 2026-09-25), so TornW3B works
  with no key and no setup; refresh it now and then;
- TornExchange's keyless `/api/best_listing` gives the best TornExchange buyer
  of each item you hold while the key is missing or rejected;
- a rejected key shows TornExchange's own words ("Invalid API key"), is tried
  again by itself every 10 minutes, and the banner has **Try again**;
- the status line reports each source on its own;
- "Checking…" is per item, until every source has answered for it;
- the owner's friend: on a bazaar or the Item Market, listings below Min that
  still profit are marked **amber** (green = meets Min); the list is unchanged,
  and Cash still hides what you cannot afford.

**3.9.1:** 3.8.1 had stored its refusal ("That is a Torn key...") in `teState`, and
3.9.0 kept showing it, with no TornExchange key saved, so every item said
"No traders yet". Stored TornExchange errors are now cleared when the page opens,
and with no TornExchange key the banner offers **Use my Limited key** in one press.

### What 3.9.0 did (the owner's corrections after 3.8.1)

1. **The TornExchange key.** TornExchange's API key *is* the Torn key you log
   into tornexchange.com with. 3.8.1 refused to save a key equal to a Torn
   key, so traders never loaded. Now the same key is accepted, and the page
   has a *Use my Limited key* button. Saving or forgetting the key no longer
   resets TornExchange's shared wait.
2. **The traders page, rebuilt to the owner's spec, in the owner's words:**
   - "My items" first: every held item, its best trader and price per item,
     with a filter ("xanax" shows only Xanax);
   - "All items" after: every item any trader buys, with a search box;
   - per item, every trader highest price first, with name, price per item,
     online status, Profile, TE list and W3B list;
   - "No Trader Found" for an item nobody buys; items are never added by hand.
3. **Removed:** Qty, Total, the Per item | Bundle switch, and "Traders avg".
4. **Our own trader database**, built from:
   - TornExchange's active traders and its top buyers;
   - every `/pricelist/{id}` link on a TornW3B page the owner opens (the script
     now also runs on weav3r.dev, only to note those traders);
   - each trader's TornW3B price list (`/api/pricelist/{id}`, no key), read one
     at a time.

   A trader on both sites shows once, at their higher price, with both links.
   The owner asked for that.
5. **Item Market Average, on the add-listing page only (for now).**
   - It's Torn's market value, "what it sold for, on average", refreshed hourly.
   - The row tag says "Item Market Average $830,000".
   - The panel shows the average in large type over one graph.
6. **The add-page graph was rebuilt** (the owner said it didn't render well):
   - the old version had no scale, no time labels, lines squashed flat, and
     one $9,999,999 troll listing flattened everything;
   - now it has a price scale and time marks, and two lines: the daily Item
     Market Average and the lowest listing seen;
   - gaps are bridged with a dotted line, off-scale outliers are pinned as
     arrows, and pointing at the graph reads out the values;
   - the old 15-number averages table and the bazaar-ask column are gone.
7. **UI, per the owner's request ("easy to look at, not stale, research how
   eyes read").** Applied:
   - F-pattern: pictures and names on the left;
   - the answer is the biggest, brightest number, in one right-aligned column;
   - proximity: who pays sits under the price;
   - colour only where it means something;
   - big click targets, and fixed link slots so the prices line up;
   - Torn's item pictures;
   - a list's order is frozen while the pointer is over it, so a row never
     moves under a click;
   - "Checking…" instead of "No Trader Found" until every source has answered.

## 3.9.4: the owner's notes of 2026-09-25, built

Found on the live traders page (3.9.3, the owner's real data):
- It worked: 222 items, TornExchange working after the owner logged in there
  again, the key boxes empty and masked, and no key text in the page.
- Very high prices such as a Balaclava bought at $12.7m are real. They match
  the trader's public TornExchange list; these are Organized Crime tools.

Fixed and built in 3.9.4:
1. **Online only works: our own online checker.** Every trader of every item
   you hold is checked, best first, from Torn's public profile with the
   Limited key:
   - at most 30 a minute, inside the shared 70/min;
   - each re-checked every 10 minutes (every 90 s while its item is open),
     like TornExchange's own job;
   - with Online only on, an item says "Checking…" until its traders'
     statuses are known.

   TornExchange checks with each trader's own key, which we don't have;
   TornW3B publishes no status.
2. **A new status colour.** Online but in hospital, in jail or flying is
   orange and reads "Online · Hospital". Plain online stays green.
3. **"Limited Access access"** is fixed.
4. **The per-item line** shows "3 traders · 1 online", and nothing for a
   single trader.
5. **The wide layout** (at 1100px and up) - *replaced by Torn Bids in 3.10.0*:
   - the list, plus a 380px side column: the item picked with all its traders
     (the list no longer jumps open), Best trader for you, and Sources;
   - Sources shows each source with a dot and a progress bar, replacing the
     grey line;
   - My items and All items are tabs.

   Narrow screens keep one column, with only the top "best trader" above the
   list.
6. **Best trader for you** (*"Who to message" since 3.10.0*): who has the best price on the most of your items,
   with trust, status and Profile / TE / W3B links. **Show these items**
   filters My items to them. In Torn you trade with one person at a time.
7. **Trust badge** (Trusted / Known / New / Caution; the numbers show on
   hover):
   - the better of the trader's TornExchange vote score (it comes with
     `all_best_listings` and `best_listing`) and their TornW3B rating (ups
     minus downs), so a trader known on one site only is not marked down;
   - Trusted is 100 or more, Known 20 or more, New 0 to 19, Caution below 0;
   - TornW3B ratings come from its leaderboards when the owner opens
     weav3r.dev, plus a built-in copy of the top 20 (`SEED_RATINGS`).

   The owner asked for "more successful trades = more trusted". Trade counts
   are only on TornExchange's and TornW3B's HTML pages, so votes stand in for
   them. **Ask** whether to also read trade counts.
8. **The panel on Torn pages: see 3.9.5.** 3.9.4 narrowed Torn's page to make
   room; the owner rejected that. It is gone.

**3.9.5 - the panel fits beside Torn's content** (the owner's screenshots: the
floating bar was right, but its left end crossed into Torn's content):
- It floats in front, as before. Torn's page is never moved or resized.
- `fit()` in `panel.js` measures where Torn's content ends (the union of
  `.content-wrapper`, `#sidebarroot` and `#sidebar`) and sizes the panel to
  the free space on the right (up to 430px, 8px clear of the content).
- `placeAt()` never lets it be placed or dragged across the content.
- It fits again on resize and when Torn changes its layout (ResizeObserver).
- **Nothing is shortened** (the owner's rule), and the header is always ONE
  row (3.9.6: the owner rejected 3.9.5's two-row header). Under 420px it uses
  12px type and tighter spacing (`ttv2-narrow`); if it still overflows, 11px
  (`ttv2-tight`); a very long headline then borrows a few px from the
  window-edge margin. This is measured in `fit()`, and re-checked whenever the
  headline changes. 3.10.0: the chips and the tab row are one row too (the
  owner: "now you ruined this" at 3.9.6's wrapped chips); see 3.10.0 above.
- **Scan and ↻ are one button** (3.9.6, the owner: "it's the same thing"): Scan
  re-reads the page and refreshes every price, then says what it found.
- With less than 240px of room (a very narrow window), it floats as it
  always did.
- **Not verified on a real Torn page:** the selectors are Torn's usual ones.
  The harness checks it with `?tornlayout=<free px>`.

Still ideas, not built:
- TornExchange's `/api/profile?user_id=` gives a trader's online status,
  votes and reviews link, one call per trader (TornExchange allows 10 calls a
  minute). Useful only for a handful of traders.
- The public `tornexchange.com/listings?item_name=` HTML shows every buyer
  with an online dot. It is fragile and loads their site; a last resort.
- TornExchange's all-time leaderboard (top 50 by votes) and 30-day trade
  counts are on HTML pages only (`main/model_utils.py` in `torn-exchange/web`).

## Not done / open

- **Not verified live** (only in the harness). Please check in the owner's
  Chrome, reading only pages the owner opened:
  - Torn Bids (3.10) and the panel's fit beside Torn's real content (3.9.5+);
  - the real TornExchange responses with the owner's key;
  - `/v2/user/inventory`;
  - the real `#/add` and `#/manage` markup.

  weav3r.dev was checked live on 2026-09-25: its `/api/pricelist/{id}`, the
  home-page leaderboards and Search Deals links all work as coded.
- **`test/ux-check.mjs` was updated for Torn Bids** (3.10.1: views, sorting,
  both Show toggles, the side panel, Esc) and the add page, but **never run**:
  Playwright isn't installed on this machine. The same checks were run by hand
  in the harness through the browser pane. Run it:
  `PWPATH=$(npm root -g)/playwright node test/ux-check.mjs`.
- **TornW3B-only traders** (not on TornExchange, not on TornW3B's top-40 lists)
  are found only once the owner opens a TornW3B page that links to them, such
  as Search Deals for an item. TornW3B has no public list of traders. Its
  Search Deals data comes from a Next.js server action, not a public API, so
  we don't call it.
- **Idea, not built:** read Torn's own market-value graph when the owner opens
  an item's info in game (a page they're viewing, so allowed). That would give
  the add-page graph real sale history. Research the data format first, and
  ask before building.
- **Findings from the 2026-09-25 code review, not fixed yet** (ask which to do):
  - the header total stops at the first row the cash can't fully buy
    (`ranker.js summarize`);
  - the green label on the page ignores Cash (`main.js cardLabel`);
  - the TornW3B refetch loop when the summary's lowest price is a $1 listing
    (`feed.js bazaarDue`);
  - the dead-key state isn't shared between tabs;
  - no feed backoff on Torn errors 5, 8 and 9;
  - the shared 70/min window can lose writes between tabs;
  - requests already waiting can still go out after their tab is hidden;
  - a crash on the own-bazaar page after "Re-download item data";
  - `userID` in a URL is matched case-sensitively.
- **Own storefront:** `bazaar.php` with no hash can mark the owner's own
  listings as deals. **The owner said to leave this alone for now.**

## How the owner works (follow these exactly)

1. **Commit only when told.** "Don't code yet" means brainstorm only.
2. **Bump the version on every release**, and give the **pinned install link**.
3. **Research first, then build exactly what the owner said.** Don't swap in
   your own design. If something looks necessary but is outside what they
   asked, **stop and ask**. At the end, report honestly anything that was out
   of scope.
4. **Restate the spec in the owner's words before building a large feature,**
   and get a yes. Read what they actually wrote, not what an earlier session
   wrote about them.
5. **Tests pass ≠ it works.** Reproduce the bug first. Prove each new check
   **fails without the fix**. Look at screenshots yourself.
6. **The UI must look professional, native to Torn, and easy to read.** Follow
   the design rules below. The owner notices small text, bad alignment and
   AI-sounding wording immediately.
7. **Stay within Torn's rules, always.** Verifying in the owner's Chrome is
   welcome: read or screenshot pages the owner opened. Don't automate
   navigation on torn.com, forums included.
8. **Redesigns start as HTML mockups** the owner opens and picks from (see
   `mockups/`, untracked); build only the one they pick, then self-review
   at every width and say what you found. "Be thorough": measure overflow,
   don't eyeball it.

## Build and test

```bash
npm run build      # src/ -> dist/ and torn-moneymaker.user.js (the release file)
npm test           # unit tests (155)
npm run check      # build + syntax check + unit tests
PWPATH=$(npm root -g)/playwright node test/ux-check.mjs   # real-browser checks
```

- **The bundler** (`build.mjs`) flattens every module into one scope. It fails
  the build on duplicate top-level names.
- **`test/harness-live.html`** boots the real built script, always a fresh
  copy. It stubs GM_* and answers GM_xmlhttpRequest with canned Torn API,
  TornW3B and TornExchange data. URL parameters:
  - `?ttv2=traders` boots the traders page;
  - `&sellkeys=1` saves both keys;
  - `&sellsame=1` makes both keys the same Limited key;
  - `&w3btrader=1` adds a TornW3B-only trader;
  - `&sellprefs=<json>` sets the page's preferences;
  - `&slow=1` answers status lookups slowly;
  - `&nofeed=1` turns the feed off;
  - `&tebad=1` saves a TornExchange key it rejects;
  - `?tornlayout=<n>` (not on the traders page) puts Torn-like content on the
    page, leaving n px free on the right (1 means a centred 976px column), to
    check the panel fits beside it;
  - `&from381=1` reproduces what 3.8.1 left behind (the Limited key saved, no
    TornExchange key, and its refusal message stored);
  - `?ownbazaar=1&page=bazaar#/add` opens your own add page with a week of
    recorded prices.
- **The traders page pauses every request while its tab is hidden** (Torn's
  rules). In a background preview it looks stuck until brought forward.

## Settled facts (don't reopen these)

- **NPC price:** an item has one only if it has a `sell_price` **and** a Torn
  city shop stocks it.
- **$1 listings:** Torn locks every $1 bazaar listing to a random few players.
  Padlocked cards are skipped, and TornW3B $1 rows are dropped.
- **Torn rules:**
  - Use only the API or the page the owner is viewing.
  - Never fetch a torn.com page yourself.
  - Never auto-buy or chain actions.
  - No alerts from an unfocused tab.
- **API limit:** 100 calls a minute per **player**, across all their keys. Our
  limit is 70 a minute shared by all tabs, and the feed uses up to 30 of it.
- **TornExchange:**
  - its key = the Torn key you log in there with;
  - 10 requests a minute per IP, and every request over the limit doubles a
    penalty, up to 48 hours;
  - we pace at 10 s per request, shared across tabs and reloads, and honour
    `retry_after`;
  - `all_best_listings` gives the top 3 buyers per item;
  - `listings?item_id` gives every buyer, with names only;
  - `active_traders` gives names and ids.
- **TornW3B:**
  - `GET /api/pricelist/{id}` returns `[{itemId, name, buyPrice,
    bulkThreshold, bulkBuyPrice}]`; buyPrice 0 means not buying; no list gives
    `[]` or a 404;
  - no key is needed, and Cloudflare blocks HTML pages to scripts, not the
    `/api/`;
  - 100 requests a minute per IP: the traders page uses at most 24, and the
    feed at most 60.
- **Price history:** no API gives sale history for ordinary items. The script
  records the lowest listing itself. Torn's market value is the one number
  based on actual sales, and it is what "Item Market Average" shows.
- **Inventory:** `/v2/user/inventory` needs a Limited key. Torn caches it for
  about an hour.

## Design rules (the UI checklist)

**Type**
- Arial, 11px uppercase labels, 12px secondary, 13px body, 15px bold for key
  figures and item names.
- 20px for page titles and the add page's average.

**Spacing:** steps of 4, 8, 12 and 16px.

**Money:** right-aligned tabular figures, in one column.

**Colour**
- Tokens only, always dark.
- Green is the best price, the average and "online"; blue is a link; grey is
  secondary.

**Copy**
- Players' words (IM, TE, W3B, NPC).
- Labels of 6 words or fewer, and no explaining how the script works.

**Layout**
- Nothing wraps onto an orphan line at 430px.
- No sideways scroll.
- Nothing cut with "…"; the panel's header, chips and tabs are one row each.
- Pages use the full width; no inner scrollbars (one page scroll).

**Torn Bids** follows the approved mockup E, which adds a few sizes to the
type scale above: 14px card names, 18px side-panel title, 21px card prices,
22px headline numbers, 10px trust badges. Keep them unless the owner asks.

## Code map

- **`src/core/`** holds pure logic, tested under node:
  - `traders.js`: the trader database, merging, ranking, which list is next;
  - `selling.js`: TornExchange caches;
  - `feed.js`, `ranker.js`, `profit.js`, `npc.js`, `items.js`, `parse.js`,
    `inventory.js`, `history.js`.
- **`src/api/`** holds network clients:
  - `client.js`: Torn;
  - `torn.js`;
  - `w3b.js`: TornW3B, including price lists;
  - `te.js`: TornExchange.
- **`src/feed/controller.js`** is the live feed.
- **`src/sources/`** holds page detection and DOM reading.
- **`src/ui/`** holds the interface:
  - `panel.js`: the overlay and My bazaar;
  - `selling-page.js`: Torn Bids, the traders page (views, sort headers,
    Who to message, the side panel, settings);
  - `graph.js`: the add-page graph;
  - `styles.js`.
- **`src/main.js`** wires everything, including `bootSellingPage()` and
  `bootW3bHarvest()` (weav3r.dev).
