# Handoff: Torn userscript (for the next session)

Read this first, then `README.md`. The README holds the product and the binding
rules; this file holds where we are, how the owner works, and what is settled.

## Where things stand

- **Version 3.8.1**, branch `claude/optimistic-ride-1gqguu`, commit `0210c53`.
- **`main` is still at 2.9.3.** The script's `@updateURL` points at `main`, so
  installs are done from **pinned links**:
  `https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/<commit>/torn-moneymaker.user.js`
  Merging to `main` would make every install auto-update. Only do that when
  the owner asks.
- `claude/trusting-ride-m6bvhg` is an older branch (3.4.1). It is fully
  contained in this one.
- Who uses it: the owner and his friend, who plays Torn. "He" in the owner's
  messages usually means the friend.

## How the owner works (follow these exactly)

1. **Commit only when told.** "Don't code yet" means brainstorm only.
2. **Bump the version on every release**, and give the **pinned install link**.
3. **Research first, then build exactly what he said.** Don't swap in your own
   design. If something looks necessary but is outside what he asked, **stop
   and ask**. At the end, report honestly anything that was out of scope.
4. **Restate his spec in his words before building a large feature,** and get
   a yes. Past failures:
   - a buying page built when he asked for a selling page;
   - a panel tab built instead of the separate page he asked for;
   - a question about his Cash chip, which he'd typed in digits, answered
     with a shorthand-parsing ("1m") explanation that didn't apply.

   Read what he actually wrote.
5. **Tests pass ≠ it works.** Reproduce the bug first. Prove each new check
   **fails without the fix**. Look at screenshots yourself.
6. **The UI must look professional and native to Torn,** not "AI-made": see
   the design rules below. He notices small text, bad alignment and AI-sounding
   wording immediately.
7. For the 3.8 build he had a **Fable** agent implement, and the session
   reviewed and tested its work. He has also asked for Fable to be consulted
   on UI.

## Build and test

```bash
npm run build      # src/ -> dist/ and torn-moneymaker.user.js (the release file)
npm test           # unit tests (125)
npm run check      # build + syntax check + unit tests
PWPATH=$(npm root -g)/playwright node test/ux-check.mjs   # real-browser checks
```

- **The bundler** (`build.mjs`) flattens every module into one scope. It fails
  the build on duplicate top-level names.
- **`test/harness-live.html`** boots the real built script. It stubs GM_* and
  answers GM_xmlhttpRequest with canned Torn API, TornW3B and TornExchange
  data. URL parameters:
  - `?ttv2=traders` boots the selling page;
  - `&sellkeys=1` saves both of its keys;
  - `&sellprefs=<json>` sets its preferences;
  - `&slow=1` answers status lookups slowly;
  - `&nofeed=1` turns the feed off.
- **The harness sets Torn's light `--default-bg-panel-color` on `:root`**, as
  torn.com does, to catch theme leaks.
- **`test/discovery.test.js`** simulates 10 minutes of the feed. It must find at
  least 12 of 20 hidden Item Market deals. 3.7.0 found 0; 3.8.x finds 14.

## What the product is (3.8.1)

### Overlay: buying, with a **Public** key
- Finds Bazaar and Item Market listings below an exit price.
- **Sell to chips:** NPC (on by default), My bazaar, Market. **Min** and
  **Cash** chips.
- **Cash accepts any value:** `1234567`, `1,234,567`, `$1m`, `1.5m`.
  Unreadable input keeps the old value and shows an error.
  - Items you can't buy at least one of are always hidden.
  - Partly affordable rows show "×2 of 10", with the profit for those 2.
  - The header total stops at your cash.
- **Discovery respects Cash and Min.** Unaffordable items are never fetched, and
  the rest are ranked by what your cash can make.
- **Other features:**
  - the seller's online status on each bazaar row;
  - the bazaar owner's badge on Torn's banner;
  - closed bazaars are hidden;
  - padlocked $1 listings are skipped;
  - the ` key toggles the panel;
  - the "Open deals in a new tab" setting.
- **Fixed panel height:** 75% of the window, up to 640px, the same on every
  tab. Always dark.
- **Own-bazaar pricing helper** on `bazaar.php#/add` and `#/manage`: the pages
  with no `userId`, detected by `route.ownBazaarPage`.
  - Each row gets a tag after the item name: "IM $x · Bazaar $y".
  - Pressing the tag opens the panel's "My bazaar" view:
    - current lowest asks;
    - Torn's market value;
    - 1h / 6h / 24h / 7d / 30d averages, each with the share of the window
      actually recorded;
    - a 24h / 7d / 30d graph.
  - Tag presses are caught on `window` in the capture phase, because Torn
    redraws the row on the press.

### Selling page ("Sell" button → always its own tab, `index.php?ttv2=traders`)
- For **selling what he holds.** There is no buying on it.
- **Its own settings:**
  - his **Limited** Torn key: inventory, market values and traders' status,
    sent only to api.torn.com;
  - his **TornExchange API key**: sent only to tornexchange.com.

  Torn's key-use table sits beside the Limited key. Its preferences are
  separate from the overlay's (GM key `sellingPage`).
- **Each held item** shows: best trader offer (**always highest first**), trader
  and status, market value, traders' average (marked "top 3" until the full
  list loads), and total.
  - Clicking an item shows every buyer, highest first, with **Profile** and
    **TE list** links.
- **Sort:** "Per item | Bundle". Per item by default; Bundle means quantity ×
  offer.
- **"Online only"** removes offline traders and keeps highest-first order.

## Settled facts (don't reopen these)

- **NPC price:** an item has one only if it has a `sell_price` **and** a Torn
  city shop stocks it. "Sell: N/A" items never appear.
- **$1 listings:** Torn locks every $1 bazaar listing to a random few players.
  Padlocked cards are skipped, and TornW3B $1 rows are dropped.
- **Torn rules:**
  - Use only the API or the page he is viewing.
  - Never fetch a torn.com page yourself.
  - Never auto-buy or chain actions.
  - No alerts from an unfocused tab.

  Details are in the README.
- **API limit:** 100 calls a minute per **player**, across all of his keys.
  Extra keys add nothing; extra accounts are banned. Don't add key rotation.
  Our limit is 70 a minute shared by all tabs, and the feed uses up to 30 of it.
- **Inventory:** v2 `GET /v2/user/inventory` needs a Minimal key or higher, and
  Torn caches it for about an hour per category. The old v1 inventory selection
  has been dead since October 2023.
- **TornExchange API:**
  - It needs `?key=`: his TornExchange key.
  - Its limit is **10 requests a minute per IP**. Every request over the limit
    doubles a penalty, up to 48 hours.
  - We pace at 10 seconds per request (6 a minute), shared across tabs and
    reloads, and honour `retry_after`.
  - `all_best_listings` returns the top 3 buyers per item. `listings?item_id`
    returns every buyer, with names only; ids come from `active_traders`.
- **Price history:**
  - No API gives item price or sale history for ordinary items.
  - TornW3B, TornExchange and YATA keep history but don't expose it.
  - The helper therefore **records asking prices itself** from 3.8.0 onward.
    It samples every 5 minutes from the TornW3B summary on any Torn page, for
    up to 60 items seen in his bazaar or inventory.
  - Torn's market value is the one number based on actual sales.

## Unverified live (couldn't reach torn.com or tornexchange.com from the cloud)

1. **Whether `/v2/user/inventory` needs `cat`.** The spec says it's optional.
   The code falls back to asking category by category.
2. **His real TornExchange key and its responses.**
3. **The real `#/add` and `#/manage` markup.** The selectors come from a working
   2026 filler script. If the tags are missing, use Tampermonkey menu →
   **Show my bazaar diagnostics**.

## Open items (not done, or waiting on the owner)

- **Idea, not researched or built:** when he opens an item's info in game,
  Torn shows a market-value graph over time. The script might read that data
  from the page he opened (allowed), which would give the helper past trends.
  Research the data format first, and ask before building.
- **Item Market history is patchier than bazaar history.** It's only recorded
  when the feed or the helper happened to check that item.
- **README:** doesn't mention the Per item / Bundle switch yet.
- **Minor:** the selling page's "←" shows briefly before it's needed.
- **Own storefront:** `bazaar.php` with no hash can mark his own listings as
  deals. **The owner said to leave this alone for now.**

## Design rules (the UI checklist; reject a release that fails any)

**Type**
- Arial, and only four sizes: 11px (uppercase labels), 12px, 13px, and 15px
  bold for the key number. Page titles are 20px.
- Nothing under 12px except those 11px labels.

**Spacing:** steps of 4, 8, 12 and 16px only.

**Money:** right-aligned, tabular figures, in columns that line up.

**Colours:** tokens only, and always dark. Never borrow Torn's CSS variables for
backgrounds (that caused the 3.8.0 light-mode regression). Text contrast at
least 4.5:1.

**Buttons:** one primary button per view, and no full-width button in every row.

**Separators:** one kind per line, and no dangling ones.

**Copy**
- Labels of 6 words or fewer, messages of 12 or fewer, in players' words (IM,
  TE, NPC, bazaar).
- No " - " clauses, no "X, not Y", and no explaining how the script works.
- Never "overlay", "chip" or "feed" in the UI.

**Layout:** nothing wraps onto an orphan line at 430px.

## Code map

- **`src/core/`** holds pure logic, tested under node:
  - `feed.js`: exits, candidates, sweep, feed rows;
  - `ranker.js`: filtering, cash, totals;
  - `profit.js`, `npc.js`, `items.js`, `parse.js`;
  - `selling.js`: selling page rows;
  - `inventory.js`;
  - `history.js`: the price-history store.
- **`src/api/`** holds network clients:
  - `client.js`: Torn, with the host check and the shared rate limit;
  - `torn.js`: endpoint wrappers;
  - `w3b.js`: TornW3B;
  - `te.js`: TornExchange, its client and paced queue.
- **`src/feed/controller.js`** is the live feed: leader tab, budget and planner.
- **`src/sources/`** holds page detection and DOM reading:
  - `route.js`;
  - `dom/scan.js`: the buying scanner;
  - `dom/owner.js`: bazaar owner status;
  - `dom/ownbazaar.js`: the helper's rows.
- **`src/ui/`** holds the interface:
  - `panel.js`: the overlay;
  - `selling-page.js`;
  - `graph.js`;
  - `styles.js`: tokens and CSS.
- **`src/main.js`** wires everything together.
