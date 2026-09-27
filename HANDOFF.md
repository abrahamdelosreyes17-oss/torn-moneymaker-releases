# Handoff: Torn userscript (for the next session)

Read this first, then `README.md`. The README holds the product and the binding
rules; this file holds where we are, how the owner works, and what is settled.
Everything below "History" is the record of how we got here.

## Start here (state on 2026-09-27, end of session)

- **Released: 3.12.7** (`d69907c`), branch `claude/optimistic-ride-1gqguu`,
  pushed. Last install link given to the owner:
  `https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/d69907c1f9af4bb3cda564b10e6df147a0eafa07/torn-moneymaker.user.js`
  Earlier today: 3.12.5 (`aab7e53`), 3.12.6 (`fe49df0`).
- **`main` is still at 2.9.3.** The script's `@updateURL` points at `main`, so
  installs go through **pinned links** (`.../<commit>/torn-moneymaker.user.js`).
  Merging to `main` makes every install auto-update: only if the owner asks.
- Nothing uncommitted except `mockups/` and `.claude/` (untracked on purpose).
- 231 unit tests (`npm test`); `test/ux-check.mjs` (Playwright) has never run
  here - Playwright is not installed.
- Who uses it: the owner and a friend who plays Torn (the friend's requests
  come through the owner, often in Tagalog - translate, then restate). **Desktop
  only.** Stays a **Tampermonkey userscript** (no extension, no Web Store fee).

### Open question the owner asked at the very end - answer it first

The owner's idea (2026-09-27): once a trader accepts, **one button that opens
every bazaar to buy from** (each highlighting the listing - `bazaarUrl` already
points at it and the overlay marks it), and on Torn's trade page **highlight
the items to send and fill them all automatically**, like Fill on the bazaar
add page. They asked: **"is that against TOS? we already have our bazaar
fill."** Not answered yet. The honest position to bring:
- Torn's scripting rule as this project has always read it: one click = one
  action / one request, no chaining, never automate navigation (README "Rules
  compliance"). **Opening N bazaar tabs from one click** is N Torn page loads
  from one click - against that reading. Offer instead **"Next bazaar"**: one
  click opens the next unbought step's bazaar (already highlighted), ticks move
  on - nearly as fast, compliant.
- **Fill on the trade page:** our Fill is one row per click (typing into Torn's
  boxes, never pressing Torn's buttons) - the same on the trade page is fine.
  **"Fill all" in one click** was left out of Fill on purpose (see "The Fill
  button" in History: "Left out on purpose: Fill All / Select All"): typing many
  rows on one click is the chained-action pattern. Offer per-item Fill ticks,
  with the items to send highlighted.
- If the owner wants certainty: they can open Torn's scripting-rules thread in
  the Claude tab group and you read it (read only). Do not decide for them.
- Either way it needs **the trade page's markup** (add-items step, the money
  box): the owner opens a trade page, you read it, read only.

### The agenda for the next session (let the owner choose the order)

1. **The owner tries 3.12.7 on real data**, and you read along (read only, in
   the Claude Chrome tab group - see "How the owner works"). Watch:
   - **weapons / armour / cars no longer flipped** - the fix covers both type
     spellings because the real v2 `type` values were never seen: confirm on
     the real item list (the Category dropdown shows the type names Torn sends);
   - the trade flow: Plan trade on a trader row, X declined / X accepted, the
     frozen trade's live checks, the panel's list on Torn's trade page;
   - how fast "≈" rows fill (up to 30 items, 24 TornW3B calls a minute);
   - the Ledger in IndexedDB on the real github.io page (not verified inside
     Tampermonkey's sandbox; "Show storage sizes" has no `ledger` key once moved);
   - Fill after Torn redraws a row (#/manage), the "!" marker, BP chips;
   - the Ledger's mugging amount field (8156 undocumented; "not read" shows the
     field names seen - fix from that).
2. **Trading partners - asked for three times; NOT built.** Mockup first:
   - Ledger › a **Traders** tab (from the Ledger's finished trades - no new
     calls): who, how many trades, totals, last trade, items, FIFO profit;
   - Torn Bids trader rows: **"Traded 7× · last 3d ago"** beside Plan trade;
     repeat customers first (ask: badge, tie-break, or trust);
   - **"Did they pay their list?"** per trade (the ID Badge loss, per trader).
     The accepted trade (`sellAccepted`) now records what they should pay:
     comparing it with the finished trade in the Ledger gives this directly.
   Needs the Ledger's Full key; the log gives ids only (names are open).
3. **The trade page, part 2** (after reading its markup): per-item Fill of the
   quantity to send, highlight the rows, a **money check** ("offers $10.5m,
   the trade says $14m: $3.5m short"). See the open question above.
4. **Weapons / armour flips done properly** (researched, not built; now they
   are simply excluded): plain copies to Big Al's or one-per-trader; RW gear
   under its Bunker Bucks floor (ask if they have the Bunker); notes in memory
   `trader-sources`.
5. **Verify, then maybe use:** TornW3B `/api/marketplace/{id}/traders` and
   TornExchange API `prices/{id}` (a TE-only trader's whole list).
6. Smaller: the Sell-to-by-trader view could show traders who make no flip on
   this item but whose other items make a trade (today Plan trade works on any
   trader row shown); Ledger names / export; run `test/ux-check.mjs`.

## What this session did (2026-09-27)

- **Bug the friend hit (fixed in 3.12.5):** Torn Bids showed SilentStorm77
  paying $140,000 for ID Badges; his TE list said $105,000 and they traded at a
  loss. `buyersForItem` kept the HIGHER of TornExchange's top-3 price and the
  item's full-list price for one trader. Now the lower counts, amber "Lists
  differ: TE top 3 … · TE full list …". Harness `&tedrop=1`.
- **3.12.5** (`aab7e53`): TornW3B limits (a $1 Dollar Sale made the feed
  re-read an item every 3 s: 126 calls/min for 6 items, now 12; one 80/min
  TornW3B window for all tabs and one 429 wait); "save API calls" stops only
  Torn API calls, bazaars stay watched, the two watching switches are
  independent; **$1 is for NPC only** - resale deals and flips need 1% of the
  price per item (overlay `resaleMinPct`, Torn Bids `minProfitPct`); NPC
  prices ready for Torn removing `sell_price` on 2027-01-01; overlay button
  **Sell → Bids**. Then **every finding of a three-pass review** (security /
  bugs / usability, run by a Fable agent; the owner: "fix everything;
  latency is important, prices must stay live"): CSS-masked key boxes
  (`ui/mask.js`; the Ledger's Full key was a password box), v1 item fallback
  gives no NPC prices, shared pause after Torn 5/8/9, nothing sent from a
  hidden tab, per-tab request windows (`platform/tab-window.js`), settings and
  dead keys follow across tabs (`gmOnChange`), Ledger rows in IndexedDB
  (`platform/idb.js`), stores pruned, Fill undo survives redraws, Fill notes in
  the panel, BP from one summary call, overlay list updated in place, Where
  to sell counts only the units listed near a price ("first 900, rest to
  trader"), a 4× cheaper card search, validation messages, accessibility.
- **3.12.6** (`fe49df0`): **one trade per trader** - mockups N1/N2/N3 made
  (`mockups/N-one-trade.html`); the owner picked **N3** plus a **Sell to**
  picker (pick ONE trader, ranked by what the WHOLE trade makes - chosen over
  splitting items across several traders). The desk's flip plan is the whole
  trade: this item first, the trader's other flippable items, your held
  items where they are the best buyer; one Cash; Most per flip per item;
  their networth share for the whole trade; a tick and a number per row;
  the **keep list** for your own items (prefs.keep, Settings › Flips › Keep
  for yourself). Code: `core/trade.js` (planTrade, keepAfter; tested),
  `tradeDesk` in `renderSellingNow` (main.js), `SellingPage.tradeCard`;
  items not read yet are estimated from the summary (≈) and read first
  (`sell.tradeWanted` in `nextW3bJob`). Harness `&manybuyers=1`.

- **3.12.7**: from the owner's and the friend's first real use of 3.12.6:
  - **the trader is picked on the Traders pay card** (the owner: "a button on
    the trader - trader 1 didn't want to trade, click trader 2 to see the flip
    plan there"): each row shows "whole trade +$X · N items" and **Plan
    trade**; the plan card's old Sell to list is gone. **X declined** passes a
    trader over for an hour (greyed at the bottom, Undo; `sellDeclined`).
  - **"it suddenly disappeared"** (the friend, mid-trade, Tagalog): the desk
    followed the best flip and the trader followed the best trade. Now any
    click in the trade pins item and trader (`onTradePin`); the trade's items
    are re-read every 2 min (`sell.tradeLive`, in `nextW3bJob` after the
    picked item); an item that drops out stays listed with why (`sell.tradeSeen`);
    each buy step says "seen N min ago".
  - **X accepted** (the owner: "the thing that says trader accepted/declined"):
    freezes the trade (`core/accepted.js`, tested; stored as `sellAccepted`
    in GM storage, 24 h, keyed per trader); each buy step checked live (still
    listed / re-priced / fewer left / gone) with a bought tick; each line
    ('flip:<id>' / 'yours:<id>' - one item can be in a trade twice) a sent
    tick; Traded - done / back to the live plan.
  - **Torn's trade page** (the friend: "how do I remember the items I will send
    him?"): the overlay's panel lists each accepted trade - what to send, how
    many, what they should pay - with a tick per item, shared with Torn Bids
    (`showTradeChecklist`, `Panel.setTrades`, `isTradePage` in route.js;
    harness: `?page=trade`). Reads only our own saved list.
  - **Weapons, armour and cars are never flipped** (the owner: "no one is
    buying 100 weapons/armor", "same with cars"): `isStatType` / `isStatItem`
    in flips.js cover Melee / Primary / Secondary / Defensive AND v2's Weapon /
    Armor, and Car; Temporary weapons still flip. The v2 `sub_type` is now
    kept on the item index. The real v2 type names were never seen - check.
  - No-flip wording gives the real reason (one-of-a-kind items, least profit,
    buyers who cannot take it).

## The product today - two separate things

**1. The overlay (the "NPC Arbitrage" panel on torn.com).** Keep it separate from
Torn Bids: the owner was alarmed when Fill settings started to appear in Torn
Bids ("TORN BIDS IS DIFFERENT FROM ARBITRAGE").
- The deals list: bazaar and Item Market listings under the NPC price / market
  value, live feed (one leader tab), Min / Cash, highlights, trader tag on
  bazaar cards. Header: **Bids** (opens Torn Bids) · Scan · ⚙ · –.
- Settings › Watching: **NPC deals: save API calls** (Item Market watching and
  sellers' status off: 0 Torn API calls; bazaars still watched via TornW3B),
  Watch the Item Market, Watch bazaars via TornW3B, **Least profit per item %**
  (resale deals; NPC counts from $1), Torn API calls in the last minute.
- **Your bazaar's add page (#/add):** each row stays one line. In Torn's own
  value column: **IMA $X** · **BP $Y** · **☐ Fill** (filled: "$100", with "!"
  when it needs you - e.g. tick Torn's box on weapon rows; the words are in
  the panel).
- **Fill** (the friend's request): tick = type that row's price (lowest bazaar
  −$1 by default) and quantity; untick = put back what was there. Never presses
  Torn's buttons; never undercuts your own, $1, sponsored, stale or troll
  listings; never below the NPC price. #/add, #/manage, the Item Market's
  #/addListing and #/viewListing. **Settings only in the overlay** (Settings ›
  Fill; a "Fill settings" link in Torn's links bar). Code: `core/fill.js`,
  `sources/dom/fill.js`, the Fill section of `main.js`, `ui/fill-form.js`.
- Tampermonkey menu: "Show storage sizes and start time" (names and sizes only).

**2. Torn Bids** (our page on github.io; the overlay's **Bids** button opens it).
- The item desk (mockup H): best flips, every item, traders pay / bazaars
  sell / **flip plan = one trade** (3.12.6) / where to sell.
- Settings (mockup J layout); **Category** dropdown (mockup M).
- Flips: Cash, Most per flip, **Trader can pay** (10% of networth), **Least
  profit per item** (1%), **Keep for yourself**. Weapons, armour and cars are
  never flipped.
- **The desk's trade** (3.12.6-3.12.7): Plan trade / X declined on each
  Traders pay row; the flip plan is the whole trade with that trader; X
  accepted freezes it; the same list shows on Torn's trade page.
- **Lower of two prices:** TE vs W3B, and TE top 3 vs TE full list - the lower
  counts, marked amber (the friend lost money on the higher, twice now).
- **Where to sell your N:** trader now vs your bazaar vs the Item Market; a
  listing is counted only for the units listed near its price.
- **Torn Ledger** (Ledger button): FIFO profit from the owner's own log and
  trades, after fees; NPC shop sells; Mugged tab; its own **Full key** (walled
  client: `/v2/key/info`, `/v2/user/log`, `/v2/user/trades`, `/v2/user/{id}/trade`
  only). Rows in the page's IndexedDB since 3.12.5.

### Verified, and not

- **Checked live, read only, on the owner's real #/add page (3.11.1):** the row
  markup Fill needs (`li.clearfix`, `.item-amount.qty`, `.amount input`,
  `.price input.input-money` + a hidden `name="price"` twin, weapon rows
  `div.amount.choice-container`, `#torn-user`, links bar
  `[class*=linksContainer___]`, value column `.info-wrap`).
- **Everything since was tested in the harness only** (see agenda item 1).
- **Known, left:** the BP chip uses TornW3B's summary until an item's own
  listings are read, so it can show your own listing as the lowest. A Torn tab
  opened in the background now loads only when you look at it (visible-tab rule).

## How the owner works

- **"Don't code" means discuss only.** "Go build" / "fix everything" means
  build. **Asking for the link means: release** (bump the version, commit,
  push, give the pinned link). Commit only then.
- **Mockups first** for anything that changes the look (HTML in `mockups/`,
  untracked; several variants side by side; send the file, let them pick).
  Build only what they picked; self-review at desktop widths, measure overflow.
- **Restate the spec in their words** before a big feature (AskUserQuestion
  with previews works well for picking between designs).
- **They ask things mid-task** (sometimes "is X there?" about something not
  built): answer plainly in a line - say "not built" when it isn't - then
  continue.
- **Latency matters, and prices must stay live** (their words when fixing the
  review): no added waiting on the normal path; update in place, follow other
  tabs at once.
- **They lose money on bad data:** prefer the conservative number and say so
  on the page (lower of two lists; "first N"; "≈" for estimates; "check their
  list before buying").
- **$1 is for NPC only:** anything sold to a person needs a real margin.
- **Desktop only.** No phone layouts.
- **On torn.com: read only.** "remember read only do not touch this is torn."
  Only read or screenshot pages the owner opened in the Claude tab group;
  never click, type or navigate there. Our own github.io page and the local
  harness may be used freely.
- **The overlay and Torn Bids are separate products.**
- No paid services. They like full deliverables lists with what needs their
  decision at the end.

## Working notes for the agent (learned the hard way)

- **Release procedure:** bump `package.json` version → `npm run check` (builds
  `torn-moneymaker.user.js` and `dist/`, runs tests) → `git add HANDOFF.md
  README.md package.json torn-moneymaker.user.js src test` (never `mockups/`,
  `.claude/`) → commit → `git push origin claude/optimistic-ride-1gqguu` →
  check `curl -s https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/<sha>/torn-moneymaker.user.js | grep -m1 @version`
  → a second commit putting the link at the top of this file.
- **Finding code:** `nexus_locate` first for "where is X" (the owner asked if
  it was being used); Grep for exact names; LSP for definitions.
- **Line endings:** the working tree is CRLF (`core.autocrlf=true`). Scripted
  multi-line replacements must match `\r\n`.
- **Shell heredocs eat one level of backslashes** (`\\s` arrives as `\s`, then
  a JS template turns it into `s`): edit anything with a regex or `\'` with
  the Edit tool, or write the script to a file with the Write tool first.
- **The browser pane:** it is often hidden, and the script (correctly) sends
  nothing from a hidden tab - take a screenshot to bring it forward, then
  check `document.visibilityState`. Screenshots sometimes time out or render
  half; retry, or read the page with JS. The harness server is `harness` in
  `.claude/launch.json` (python http.server on 127.0.0.1:8765).
- **The harness** (`test/harness-live.html`) resets its GM storage on every
  load; IndexedDB persists across loads. Parameters are listed under "Build
  and test".
- **Reloading the harness:** navigating to the same address with only a
  different `#hash` does NOT reload the page - the old build keeps running
  and every test "fails" mysteriously. Use `location.reload()` or change the
  query (`&r=1`). Check with `[...document.scripts].map(s => s.src)` (the
  `?v=<time>` shows when the script was loaded).
- **Line endings, again:** files committed from here come back LF, while Git
  Bash's `grep -c $'\r$'` reports CRLF regardless. In scripts, detect with
  `s.includes('\r\n')`, never assume.
- **Prove each new test fails without its fix** (swap the old file in from
  `git show HEAD:<file>` and run it) - the owner's rule, and it caught two
  real mistakes this session.

## History

**3.11.0 - Torn Bids is the item desk (mockup H, picked 2026-09-26).**
- What the owner asked: the bazaar side next to the trader side - the cheapest
  bazaars to buy from, "is it better to sell to a trader or in my bazaar", and
  the combination (buy from this bazaar, sell to this trader), prioritising
  trusted traders; fewer pages; every link clickable. Three mockups (F four
  tabs, G one board, H item desk, in `mockups/`); the owner picked H, asked
  for "Sell to trader" (not "Sell now") and found the old "sell or list" card
  confusing - it became "Where to sell your N" (totals, when you get paid).
- Built (`src/core/flips.js`, `src/ui/selling-page.js` rewritten,
  `renderSelling` and a shared TornW3B scheduler in `main.js`):
  - **Best flips with your cash** across the top; **the desk**: All / Mine /
    Flips on the left with badges, and on the right Traders pay, Bazaars sell,
    Flip plan and (for what you hold) Where to sell - all at once.
  - Flips: cheapest first, only under a trader's price, only listings TornW3B
    saw in 30 min, never more than **Cash** (Torn Bids' own setting - the
    owner chose that over the panel's Cash), your own listings left out (your
    id from one `user` basic call).
  - Where to sell: trader now vs your bazaar at cheapest − $1 vs the Item
    Market after 5% (one Item Market call for the item on the desk); the
    trader wins unless waiting pays 1% more.
  - **Trusted buyers only is on by default** (the owner: "we prioritize
    trusted"). **Buyers online only** kept (the owner chose it); **Who to
    message, Cards/Rows/Table, the drawer and the stats line are gone** (the
    owner chose to drop Who to message and the views; H had no stats line).
  - Every link opens through `onOpenUrl`: item name → Item Market; trader
    name → profile, Trade (`trade.php#step=start&userID=`), TE list, W3B list;
    seller name → profile, Open bazaar (`bazaarUrl`, points at the listing);
    flip steps; each Where-to-sell row → Trade / `bazaar.php#/add` /
    `page.php?sid=ItemMarket#/addListing`.
  - Data: TornW3B `/api/marketplace` (every 5 min), `/api/marketplace/{id}`
    for the desk item (2 min) and up to 30 possible flips (10 min), sharing
    the 24/min with price lists (strict turns). TornExchange's full buyer list
    only for an item **you** pick (the desk following flips never spends it).
  - **The panel tag** (the owner said yes): on a player's bazaar, a listing a
    **Trusted** trader buys for more gets "NAME pays $X / +$Y each" on its
    card (`markTraderTags`, `.ttv2-trader::after`; combined with the profit
    label on a deal card). Reads only what Torn Bids stored.
- H shows quantities and totals (flip units, cash needed, Where-to-sell
  totals): this reverses the 3.10 "prices per item only" rule, because the
  owner picked H.
- Checked in the harness (browser pane, 1600/1200/430): every number, every
  link (14 on one desk), filters, search, both toggles, Cash (bad input,
  500k, blank), own listing skipped, stale listing skipped, the tag on a
  123px card, the panel's feed unchanged; each new unit test fails when its
  rule is broken. 163 unit tests.
- **Not verified live:** `user` basic's `player_id` (v1, believed right);
  the trade URL (taken from another Torn script); the Item Market
  `#/addListing` hash; the tag on real Torn bazaar cards (their `::after`);
  Torn Bids with a real trader database's size.

**3.11.1 - released (`f34a05a`) when the owner asked for the link.**
Done: the flip plan's sell step links Trade / TE list / W3B list; **Most per
flip** setting (default 100; "N flipped (of M under the bid)"); a flip sells
only to a believable buyer (`flipBuyer`: bid at most 3× the Item Market
Average; no flip on items with no average or on Melee / Primary / Secondary /
Defensive, whose copies have their own stats); Trusted buyers only turned back
on once (`trustedOn311` flag in the stored prefs); each seller named once on
a flip card; the strip title says each flip is within your cash on its own;
Cash "0" says it must be more than $0. 165 tests (each new rule fails its test
when broken); harness checked. **Not done from 3.11.1:** the networth "could
they pay" check (item 5 below) - test v1 `personalstats` vs v2
`personalstats?cat=networth` on one real trader first. Next: check it in the
owner's Chrome (Torn Bids with real data).

**The plan after 3.11.0 (agreed 2026-09-26).**
Releases in this order, each with mockups first where the look changes:
- **Done, not committed:** the flip plan's sell step has Trade, TE list and
  W3B list (check the trader's page before trading).
- **3.11.1 - flip fixes** (from the owner's live data: $92b troll bids, a
  2,188-item plan):
  1. Trusted buyers only turned back on once (the owner's old stored `false`
     beats the new default).
  2. "Most per flip" setting, default 100; the plan says "Buy 100 (of 2,188
     under the bid)".
  3. Ignore bids above 3× the Item Market Average; skip items with no Item
     Market value.
  4. No flips on weapons/armour with their own stats.
  5. Networth "could they pay": never a flip where the trader pays more than
     X% (10% suggested) of their networth (`user/{id}` personalstats
     `networth`, or v2 `personalstats?cat=networth` - test which before
     building); networth shown by each trader; key-use table updated.
  6. Cash wording: each flip card uses all your Cash on its own - say so, or
     split it; "0" says "Cash must be more than $0". (The cash maths itself was
     fuzzed against a brute force, 20,000 cases: correct.)
  7. Each seller named once on a flip card.
- **3.12.0 - Settings redesign** (mockups `I-settings-grid`, `J-settings-sidebar`
  ready, K - a side pop-out - not made; the current page is a narrow middle
  column the owner dislikes) and **the category filter** (Plushies, Flowers,
  Armour, Weapons, Special… from the item index's `type`; mockups: a
  full-width row between the flips and the desk vs a "Category" dropdown;
  it filters the flips and the list together).
- **Torn Ledger, inside Torn Bids (in 3.12.0):** every buy and sell from the
  owner's Torn logs (bazaar buy 1225 / sell 1226, Item Market buy 1112 /
  sell 1113, trades category 94, $0 acquires), FIFO profit after the 5% IM
  fee, totals per day / week / month, graphs (profit over time, by item),
  filters (dates, item, category, venue, trader/seller), flips done through
  Torn Bids shown as bought-from → sold-to. TornW3B's Premium does the same
  (`/v2/user/log`, FIFO); TornExchange only knows its receipts. Mockups first.
  **Key: a Full key, used only by the Ledger** (the owner chose Full over a
  Custom key), with its own field in Torn Bids Settings, apart from the
  Limited key. Security, all of it required:
  - its own storage entry and its own API client whose URL check allows only
    `api.torn.com` `/v2/user/log` (and `key/info` to check the key) - any
    other path is refused in code, so a bug cannot spend it elsewhere;
  - read only on the Torn Bids tab; the panel on torn.com never reads it;
    never sent to TornExchange or TornW3B (their clients carry no Torn key);
  - on Save: `key/info` must say Full; anything else is refused with why;
  - never shown again after Save (no "Show"; paste a new one to change it),
    masked while typed, redacted in every error, never logged;
  - Forget key deletes the key AND the stored ledger; a dead key (2/13/18)
    stops it until a new one is saved;
  - only derived rows are stored (time, item, qty, price, venue,
    counterparty), never raw log text; local only;
  - its own Torn API-terms table beside the field (storage local, sharing
    nobody, purpose "personal: profit tracking", access Full - logs only);
  - paced inside the shared 70/min; the log is read incrementally (only new
    entries since the last read).
- **The Fill button (in 3.12.0)** (list below).
- Checks in the owner's Chrome after each: Torn Bids with Trusted on, the
  trader tag on a real bazaar, and for the Fill button the markup listed.

**The Fill button (in 3.12.0; agreed 2026-09-26, mockups first).** The
friend's request, modelled on Greasy Fork's "Customizable Bazaar Filler"
(527925) and "Torn Market Filler" (513920) - an add-on to My bazaar, not a
copy. The owner chose **fill on click** (one click fills one row; the player
presses Torn's confirm). Deliverables:
1. My bazaar stays (tags, average, graph); the row tag adds *Lowest bazaar $Y*.
2. A Fill button per row on `#/add` (price + quantity) and `#/manage` (price);
   clicking again restores what was there; never presses Torn's buttons. On
   weapon/armour rows the player ticks Torn's box; Fill types the price only
   (one click, one action).
3. Prices read fresh at the click (TornW3B listings, the Item Market), 60 s
   reuse, through the existing limits.
4. Only real competition: skip $1 padlocked, sponsored, stale (30 min),
   troll (under 25% of the average) and **your own** listing.
5. Floors: never below the NPC price; optional floor at the Item Market
   Average.
6. After filling, a line vs the average (green/amber) and any floor applied.
7. Weapons/armour: stats differ - say so, don't blindly undercut.
8. My bazaar panel: the 5 lowest bazaar and Item Market listings (IM after
   the fee), yours marked; clicking a price uses it.
9. A marker on the graph at the price about to be listed.
10. Item Market pages (add listing, your listings) in the same release: the
    same button, the same rules, after-fee price shown.
11. Settings, two rows (bazaar, Item Market): undercut the [lowest / 2nd /
    3rd…] listing by [amount] [$ / %] (default lowest, $1) - the friend's
    "listing index" and "margin"; quantity all / all but 1; floor at the
    average on/off.
12. README rules 1 and 10 rewritten (fills only on your click, one row, never
    presses Torn's buttons); the key disclosure updated.
13. Mockups first (button, row tag, lowest-5, settings) at 1600/1200/430.
14. Live checks in the owner's Chrome: `#/manage` and the Item Market
    add-listing markup, that Torn accepts a filled box, the IM fee and how IM
    listings are grouped, the armour label (3.10.3).
15. Tests (each shown to fail without its fix); release 3.12.0, pinned link.
Left out on purpose: Fill All / Select All, "Black Friday" $1, the formula
language, favourites/exclude stars, the floating bar, random delays.

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
  - Torn Bids (3.11: the desk, flips, where to sell), the trader tag on real
    bazaar cards, and the panel's fit beside Torn's real content (3.9.5+);
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
- **Findings from the 2026-09-25 code review - all fixed in 3.12.5** (with the
  2026-09-27 three-pass review); kept here as the record:
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
npm test           # unit tests (221)
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
  - `&manybuyers=1` adds Carol and Alice as Dynamite buyers (three traders to plan with);
  - `?page=trade` stands in for Torn's trade page (the panel's send list; save a
    `tornTrading.v2.sellAccepted` value with GM_setValue, then fire a hashchange);
  - `&tedrop=1` makes Alice's full TornExchange list for the Hammer $100
    while the top three still say $115 (lists that disagree);
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
- **Desktop only** (the owner, 2026-09-26: "we're only doing desktop"). The
  phone layouts earlier sessions added stay, but nothing new is designed or
  checked for phones. The overlay's 240-430px sizes are the free space beside
  Torn's content in a desktop window, and still matter.
- No sideways scroll.
- Nothing cut with "…"; the panel's header, chips and tabs are one row each.
- Pages use the full width; no inner scrollbars (one page scroll).

**Torn Bids** follows the approved mockup H (3.11.0; E before it), which adds
a few sizes to the type scale above: 14px names on the flip cards, 20px for
the item on the desk, 21px flip-card money, 22px for the flip plan's total,
10px trust badges. Keep them unless the owner asks.

## Code map

- **`src/core/`** holds pure logic, tested under node:
  - `traders.js`: the trader database, merging, ranking, which list is next;
  - `selling.js`: TornExchange caches;
  - `flips.js`: Torn Bids' buy side - flip plans, where to sell, which items
    to check, the bazaar-page trader tag's words;
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
  - `selling-page.js`: Torn Bids, the traders page (the best flips, the
    item list, the desk's four cards, settings);
  - `overlay.js`: marks on Torn's cards (deals, the trader tag);
  - `graph.js`: the add-page graph;
  - `styles.js`.
- **`src/main.js`** wires everything, including `bootSellingPage()` and
  `bootW3bHarvest()` (weav3r.dev).
- **Added in 3.12.5-3.12.7:** `core/trade.js` (planTrade, keepAfter - one
  trade with one trader), `core/accepted.js` (a trade the trader accepted:
  frozen, step checks, ticks), `ui/mask.js` (masked key boxes),
  `platform/tab-window.js` (per-tab request windows), `platform/idb.js`
  (IndexedDB for the Ledger's rows); in main.js `tradeDesk` / `tradeWith` in
  `renderSellingNow`, `showTradeChecklist`; in selling-page.js
  `tradeCard`, `acceptedCard`, `tradeLine`; in panel.js `setTrades`.
- **Added in 3.12:** `core/fill.js` (Fill's price), `sources/dom/fill.js`
  (Torn's price / quantity boxes), `ui/fill-form.js` (Fill settings),
  `core/ledger.js` (rows, FIFO, totals, muggings), `api/ledger.js` (the Full
  key's walled client), `ui/ledger-view.js` (the Ledger page); `main.js` has
  the Fill section and the Ledger section (`runLedger`).
