# Handoff: Torn userscript (for the next session)

Read this first, then `README.md`. The README holds the product and the binding
rules; this file holds where we are, how the owner works, and what is settled.
Everything below "History" is the record of how we got here.

## The agenda for the fifth session (start here)

State: **3.15.0 released** (`5350ec7`), `main` = 3.15.0 (installs
auto-update; release = bump, commit, push the branch, fast-forward `main`,
push `main`, check the raw `main` URL shows the new @version). 335 tests.
Nothing of 3.14.x / 3.15.0 has been seen on real Torn pages - harness only.

1. **Bugs first: the owner will relay them** ("next bugs I'll tell the next
   session"). Ask for the friend's **Report a problem** zip (Torn Bids ›
   Settings › Help): read `problem-log.txt` first (failed requests and why,
   script errors, his last steps), then `report.txt` and the screenshots.
   Reproduce in the harness before fixing; a failing test first.
2. **Ask for the friend's Export API usage zip** (Settings › API use) after a
   day or more on 3.15.0: is Torn still near 70 (by-minute.csv, `t.*` rows)?
   What does TornW3B spend (`w.*`)? `state.json` has his switches and
   coverage (flips checked, every-item sweep, TE lists scanned).
3. **Learned read scheduling ("mini AI"), the owner said yes (2026-09-29) -
   after the zips show real numbers:** per item, remember how often a
   bazaar read found a flip and how big; spend TornW3B's reads on items that
   tend to pay (a bandit - e.g. Thompson sampling / UCB) instead of fixed
   timers (`W3B_CANDIDATE_MS`, `W3B_SWEEP_MS`, the 150 `SELL_FLIP_CANDIDATES`).
   Then: per-trader list refresh by how often their list changes; listing
   speed (`sellMoves`) to re-check fast-selling cheap listings sooner. All
   local, no server. NOT trader-acceptance learning without asking (the
   owner's "never a ranking bias toward a named trader"). Restate + measure
   (flips found per 100 reads, harness `&bigflip=1`) before and after.
   **The owner, 2026-09-29, wants it to self-train and to learn the API
   budget too** ("the AI can also see the API usage and how to utilise it...
   self-train... neural networks?"). Agreed direction: (a) FIRST log
   outcomes - each read, what it was for, and what it found (a flip? profit?
   a price list changed?) - into the Export API usage zip (the learning data,
   and what the session reads); (b) a bandit over where the budget goes
   (flips vs sweep vs price lists vs the TornExchange scan vs Torn statuses),
   reward = profit found per request, learning online in the browser; (c) a
   small neural network only later, trained offline on weeks of both
   players' exports, if the bandit shows patterns worth more (told the owner:
   too little data, a market that shifts hourly, and no way to see why for
   a network now). Show what it learned in Settings › API use ("reads Xanax
   often: 40% found a flip").
4. **The overlay shopping cart** (the friend): once "X accepted", the whole
   still-to-buy list in the overlay (today the buying box shows one bazaar
   at a time). Mockups first.
5. From before, still open: live check (the owner's pages, read only; ask
   first whether the script is on and shows 3.15.0); **Unplan** (take back
   a Plan trade without Declined); **number boxes' cursor at the left**;
   **favourites list + Plan flip**. Held, remind only: the faction rule;
   trader capacity / "Sell fast".

Known, not fixed: on a first-ever load (no stored votes) an unrated trader
shows until TornExchange's votes arrive, then is hidden with the "Trusted
buyers only hides N" line. The browser pane shows the harness zoomed in
(screenshots crop the right side; read the DOM instead). The harness server
(`preview_start` name `harness`) stops between turns sometimes: start it
again.

## Start here (state on 2026-09-29, fourth session)

- **Released: 3.15.0** (API efficiency; README "API use and efficiency
  (3.15)"). The friend: "parang hirap siya sa API nag mamax"; the owner: it
  "doesn't see all trades", "use more TornW3B", "we rarely use the market",
  statuses fine "but there must be a way it doesn't hit our limits", and an
  API use tab with a graph in Anthropic's style, plus Export to read the
  friend's use. Built: Torn API lanes (`API_PRIORITY`, `LOW_RESERVE` 20,
  `NORMAL_RESERVE` 5 in api/client.js), tags on every request
  (core/usage.js, `STORE_API_USAGE`), the Item Market feed gated on
  `STORE_IM_WATCH`, narrowed statuses (`sellWatch`) + `STORE_SELL_PRESENCE`,
  TornW3B 60/min + 150 candidates + near-misses + sweep + `/traders`
  (`fetchW3bItemTraders`, `sell.itemTraders`, `sell.activity`), TornExchange
  urgent queue + partial pages + active-trader scan (`stepTeScan`,
  `recordTeScan` in the trader db), ui/usage-view.js (Export API usage =
  a .zip, core/zip.js), Settings › Report a problem (ui/report-view.js,
  core/errlog.js, `STORE_PROBLEM_LOG`, `logProblem` / `logAction`, the
  clients' `onFailed`). When the friend reports a bug, ask for the report
  zip: problem-log.txt first. Harness numbers: see the commit. **Not seen
  live:** ask the friend for an Export API usage zip after a day.
  Ideas not built (the owner asked "can't we train this like a mini AI?"):
  see memory `api-efficiency-plan`.
- **Released: 3.14.5** (2026-09-29, fourth session), and **`main` now follows
  every release** (the owner: "yes please move to main on each new release"):
  every install auto-updates from `main` (Tampermonkey checks about daily, or
  at once with "Check for userscript updates"). Release = bump, commit on the
  branch, push the branch, then fast-forward `main` to it and push `main`.
  No more pinned links needed (they still work).
  3.14.5, all from the friend's reports (through the owner, in Tagalog):
  - **Buyers vanished from the desk** ("the list of buyers suddenly
    disappears and it says loading more buyers"): reproduced with harness
    `&teslow=1` + `&w3btrader=1` (Bottle of Beer). Cause: *Trusted buyers
    only* - votes come only with an item's top three, so a trader out of every
    top three (a refresh, a late load) lost the badge and was hidden, and the
    card said "Checking…" forever. Fix: votes remembered a week
    (`rememberVotes`, `STORE_TE_VOTES`); the desk says "Trusted buyers only
    hides N traders here · Show them" (`hiddenBuyers`). First-ever load can
    still show an unrated trader until votes arrive (then it is hidden, with
    that line).
  - **Cancel trade** (the friend: a cancelled trade was still remembered next
    time; accepted trades live 24 h): overlay buying box, Bought window, Torn
    Bids' accepted card; asks first; `cancelSellAccepted` (bought -> leftovers,
    counted up to the bazaar you are on; price record dropped; not declined;
    pins stay) and `STORE_SELL_CANCELLED` so Torn Bids lets go of the pick.
  - **Add all** on "X buys N more items… Show them" (the friend wants more
    than 10 extras sometimes; the owner: Extras per trade is a setting, not
    their rule). Fixed on the way: Add on a held trade dropped an item whose
    bazaars were not read (`editHeld` now adds it as an ≈ line).
  - Not done, next: the overlay **shopping cart** (the whole still-to-buy list
    in the overlay once accepted; today the buying box shows one bazaar at a
    time) - mockup first. Then the fourth-session agenda below (live check,
    Unplan, cursor, favourites list).
- Before it: **3.14.4** (3.14.3 + unplanned buys in the Bought window; see
  "What the 2026-09-28 third session did"), pushed (`9b7cd49`). Install link
  given to the owner:
  `https://raw.githubusercontent.com/abrahamdelosreyes17-oss/torn-moneymaker-releases/9b7cd49377c8219c3bc3d6e73192a4880613f749/torn-moneymaker.user.js`
  Nothing of 3.14.3/3.14.4 has been seen live yet: check it first (ask
  whether the script is on and shows 3.14.4).
- Before it: 3.14.3 (`fd73fcf`), 3.14.2 (`ac4c3cb`), 3.14.1 (`9ceda80`, background refresh, Chat mark), 3.14.0 (`b9b99e9`).
- Before it: 3.13.1 (`e3b4fc5`). Branch `claude/optimistic-ride-1gqguu`. Earlier: 3.12.10 (`711f893`),
  3.12.5 (`aab7e53`), 3.12.6 (`fe49df0`), 3.12.7 (`d69907c`), 3.12.8 (`8991095`), 3.12.9 (`c45a227`).
- **Remind the owner (they asked, 2026-09-28: "dont build, but remind the
  next session"):** Favourites on the Ledger's traders page (3+ trades = auto,
  editable, click one = "what can I sell them now"); the faction rule (skip a
  trader in the same faction as the bazaar you bought from); trader capacity
  (price vs how much they take - networth, reselling bazaar, W3B bulk prices,
  own history - and a "Sell fast" line in Where to sell: the Vladbull case,
  never a ranking bias). Details in memory `remind-next-session`. The owner
  added at the end: our trusted traders, receipts by trader, favourite /
  blacklisted traders, and scanning for flips with trusted traders - all in
  the agenda below, not built.
- **The owner had the script switched off** in Tampermonkey while testing the
  trade page (2026-09-27): when something "isn't there", ask them to check the
  Tampermonkey icon (script on, version) before anything else.
- **`main` = the latest release** since 3.14.5 (it was 2.9.3 until then).
  The script's `@updateURL` points at `main`: moving `main` IS releasing to
  the owner and the friend.
- Nothing uncommitted except `mockups/` and `.claude/` (untracked on purpose).
- 324 unit tests (`npm test`); `test/ux-check.mjs` has never run here. For
  screenshots, 2026-09-28 used `playwright-core` installed in the session's
  scratchpad with the system Chrome (`executablePath`), never the repo. **Block
  torn.com in every Playwright context** (`ctx.route(/torn\.com\//, r =>
  r.abort())`): the harness's Next / Go to trade / Trade links go to real
  Torn pages, and one unblocked press loaded trade.php once (no login, no
  action) on 2026-09-28.
- Who uses it: the owner and a friend who plays Torn (the friend's requests
  come through the owner, often in Tagalog - translate, then restate). **Desktop
  only.** Stays a **Tampermonkey userscript** (no extension, no Web Store fee).

### Decided at the end of the session (3.12.8)

The owner's flow, built as agreed ("yes on above"): once a trader accepts,
**Start buying** / **Next bazaar** - one press opens ONE bazaar (never several
at once: that would be many Torn pages from one click), the listing marked;
what you took is counted from the listing's stock on the page; then on the
trade page the partner check, the money check, and **Fill per row** (one press
types one row's quantity; you press ADD TO TRADE / Accept). "Fill all in one
click" was NOT built, deliberately: it is the chained-action pattern this
project has always left out (see Fill in History). If the owner asks again,
offer to read Torn's scripting-rules page with them (read only).

### Open after 3.13.0 (check live first, read only)

- **The bazaar card strip** (Buy N · Fill N · Next ›, across the top of the
  marked card) and **Fill's quantity box** were only seen on the harness card:
  the real bazaar card's markup (is the Qty box on the card, or only after
  pressing its buy button? does the strip cover anything needed?) was never
  read. `buyQtyInput` guesses (number / "quant" / "qty" / "amount" boxes,
  else the first text box). Ask the owner to open a bazaar during a buying
  run and read it.
- Movement (fast / slow from bazaar reads) needs hours of the Torn Bids tab
  open to say anything; until then the type decides. Check `sellMoves` after
  a day (Tampermonkey storage).
- **3.13.1** (same day): the desk's two columns are stacked separately (a
  long plan beside the traders had stretched the grid rows, leaving a big gap
  above Bazaars sell / Where to sell), and `anonymous: true` on requests was
  taken out again - untested live, and the owner saw small flips right after
  (3.12.10 and 3.13 give identical flips on the harness with $100m Cash, so
  the flip logic is not it; likely the market or trader lists at that moment -
  check the TornW3B / TornExchange pills if it persists).
- Deferred from the 3.13 review (Low): requests without cookies (verify live
  first), Torn v2 calls could send the key as an
  `Authorization: ApiKey` header instead of `?key=`; the Ledger lives on the
  github.io user-site origin (any other Pages project of that account shares
  it - note in the ToS table); a removed leftover has no Undo.

### The agenda for the fourth session (start here)

1. **Check 3.14.4 live first** (read only; pages the owner opens in the Claude
   tab group; ask first whether the script is on and shows 3.14.4). Nothing
   of 3.14.3 / 3.14.4 has been seen on real pages:
   - Torn Bids: flips checked while hidden (the Bazaars pill "N of 30" on
     coming back); Your traders; ☆ / ⊘ and "Traded 7×"; Settings with no
     Save buttons (Enter / Tab / click away, Esc, red reason, Cash No limit /
     Up to); a Public key refused; Ledger › Traders and Receipts' trader
     picker (needs the Full key).
   - A real buying run: the Bought window (above NPC Arbitrage, drag, fold),
     planned buys counted from the card's stock, an unplanned buy (orange /
     red), and the trade page checklist ("✓ in" / "Not in the trade yet").
     The real bazaar card's markup (Buy button, Qty box, stock text) was
     never read: if counting misses, read that page with the owner.
   - Still from before: A4 one row per pinned item, A5 Declined moves on,
     A6 "Other" never flipped, A7 the light-red opened-listing mark, and
     the friend's A1 screenshot.
2. **Unplan (the owner, end of the third session, asked for next time):**
   "there's declined, but then there's also - I press plan, they didn't
   decline but I just want to unplan". Restated: after **Plan trade** on a
   trader, a way to take that pick back - the desk goes back to what it
   showed before you picked (the best trade), and the trader is NOT marked
   declined (their trades keep showing as usual). Code today: Plan trade is
   `onTradePick(itemId, key)` (main.js, sets `sell.tradePick`, `selected`,
   `pickedByYou`); the first press on a trade also takes a hold
   (`sell.tradeHold`, core/held.js); pins and accepted trades are separate
   (Unpin, Traded - done / Back). Likely: an "Unplan" beside "X accepted /
   X declined" on the flip plan (and on the "Planning" chip of the Traders
   pay row) that clears the pick and releases the hold - never a pin or an
   accepted trade. **Before building:** restate it, and mockups for the
   label and where it sits (the owner decides; labels 6 words or fewer).
3. **Number boxes: the cursor starts at the left** (the owner, end of the
   third session, with a screenshot of the trade card's quantity box - Gift
   Card, "1" selected, right-aligned, green focus ring - "when you click this
   as well cursor starts at left not from right, again for next session").
   The trade card's `.sp-qty` (and Settings' `.sp-pctin`) are right-aligned:
   the digits sit at the right, so a click in the empty part of the box - left
   of the digits - puts the caret before the number (the browser's own
   behaviour), and typing goes in front of it. `selectOnFocus`
   (selling-page.js) only selects on the click that focuses the box. Likely
   fix: a click that leaves the caret collapsed left of the text puts it at
   the end instead (`setSelectionRange(len, len)`), on every number box
   (desk, accepted card, Settings, the overlay's chips and Fill amount).
   Reproduce in the harness with a real mouse first (click in the empty left
   part, with and without the box focused), then a test that fails before.
4. **Favourites: no list, and no "plan flip" for them** (the owner, end of
   the third session, live on 3.14.4 - they had starred traders: "i can
   favorite traders, but then theres no list of favorite traders, and theres
   no 'plan flip' for them, again for next session"). Today: ☆ on the desk's
   Traders pay rows and in Ledger › Traders (which lists only traders with
   finished trades - a favourite starred by hand with no trade yet is in no
   list at all); favourites feed "Your traders" under Best flips (with
   Trusted-badge traders mixed in), whose "Put on desk" works only when a
   trade with them exists now ("No trade now" otherwise), and the section can
   be folded. First, on the owner's page (read only): is "Your traders"
   there, folded or open, and what do the favourites' cards say? Then restate
   and mockup: a favourites list (probably its own place - e.g. a
   "Favourites" filter in Your traders, or a Settings/Ledger list with
   Remove), each with "Plan flip" = the best whole trade with them on the
   desk (`onTradePick(mainId, 'id:'+id)` as Put on desk does), and when
   there is none, say why ("nothing in bazaars under their prices" / "their
   list not read yet").
5. **Held, remind only:** the faction rule (skip a trader in the same
   faction as the bazaar you bought from); trader capacity and "Sell fast"
   (the Vladbull case, never a ranking bias).

### The plan (third session, 2026-09-28 - its live check so far)

Written down so it is not lost. Nothing on the agenda (C) is built yet; A
checks what 3.14.0-3.14.2 built; B are bugs the live check found.

**A. Live check of 3.14.2 (read only)**

| # | Check | Status |
|---|---|---|
| A1 | The friend's add step: what the line after "ADD TO TRADE · Clear all" says | not seen - his screen; needs his screenshot |
| A2 | Chat -> profile with Start chat outlined blue | the owner: fine - dropped |
| A3 | Torn Bids in the background: TornExchange pill in minutes; flips already checked on coming back | **pill passed; flips failed** (3 of 30 in ~5 min; third session on 3.14.2: 5 of 30 after ~2.5 min, 0 of 30 after 1.5 min on 3.14.1) -> B2 |
| A4 | Pins on Best flips cards and list rows, one row per pinned item | **half seen (3.14.2, third session):** pins on all 4 cards and every flip row, rows say *Buy $X · Sell $Y*. One row per pinned item not seen yet (the owner had 3.14.1 until then; the agent pressed Stealth Virus's card pin once, then stopped - live clicks are the owner's) |
| A5 | Declined per trade; the desk goes on to the next flip | to do |
| A6 | "Other" in Never flip | to do |
| A7 | The overlay's light-red mark on the listing you opened | to do |

**B. Fixes from the live check**

| # | Fix | Done when |
|---|---|---|
| B1 | The buying box: its button label is not cut off, the status does not wrap mid-line, the time reads "yes 1h 40m ago" (the box is 3.13's) | **done, unreleased:** `buyingStatus` (core/accepted.js), `.ttv2-buynext` wraps, `.ttv2-nobr` parts; harness at 430/288/240 (old: label 291px in a 217px button) |
| B2 | Possible flips checked while Torn Bids is hidden | **done, unreleased:** hidden = flips before lists (`nextW3bRead` `hidden`), 20 reads/min (`W3B_HIDDEN_PER_MIN`), lists at most 6 of them (`backgroundListSlot`), flips worked out at once on new data (`flipsStale`). Harness, 6 s in view then ~2 min hidden: 18/18 checked (3.14.2: 7/18) |
| B3 | TornExchange "did not answer": why | hover seen live (3.14.1): "TornExchange did not answer. Trying again soon." - the same text for timeouts, no connection, HTTP errors and TE error replies. **Unreleased:** the hover now says which (`teFailText`); read it next time to tell theirs from ours |

B2, what 3.14.1 does (the previous session's note - it only ever checked
that background reads happen, 6 in 45 s on the harness, never that all 30
possible flips get covered, so "flips already checked when you come back"
was an overclaim):
- `backgroundSlot` (core/desk.js) caps TornW3B at `W3B_HIDDEN_PER_MIN` = 6
  reads a minute while hidden;
- `nextW3bRead` alternates possible flips and traders' price lists (`turn`),
  so about half of those go to price lists (the owner's page: 282/293 lists
  still being read);
- the candidates are recomputed only every `HIDDEN_RENDER_MS` (30 s) while
  hidden (`renderSellingNow`);
- Chrome throttles a hidden tab's timers to once a minute after ~5 minutes;
  `stepW3b` chains the next read from the last one's end only while
  `backgroundSlot` allows, then waits for the (throttled) 15 s / 2.5 s timers.
Likely direction (measure first): while hidden, the flips before the price
lists (lists can wait), and a higher background pace for the flips alone
(TornW3B allows 100 a minute per IP; in view Torn Bids uses 24).

**C. The agenda (the owner's order)**

| # | Deliverable | Before building | The owner decides |
|---|---|---|---|
| 1 | **"Bought since you accepted":** a separate overlay, shown only while a trade is accepted, listing every item bought since; Fill and the trade page's highlight come from that list | research the source (Torn's bazaar purchase message vs Torn Bids reading the log - the Full key never in the overlay); mockups | a mockup |
| 2 | **Extras per trade** in Settings › Flips: a number or unlimited, default 5 | none (a setting) | does "unlimited" also lift the 3-bazaars-per-extra rule? |
| 3 | **Our trusted traders:** Ledger › Traders tab (who, trades, totals, last trade, did they pay their list) + "Traded 7× · last 3d ago" on trader rows | mockup | automatic (N trades, all paid) or picked? |
| 4 | **Favourite / blacklisted traders:** favourite = 3+ trades, automatic and editable; blacklist = never planned, never a buyer, with Undo | mockup | 3 trades total or on different days? blacklisted hidden or greyed at the bottom? last-paid prices for a favourite with no list? |
| 5 | **Receipts by trader** (a picker + totals), and each line's profit split by the trader's accepted prices | mockup | picker + totals, or is the Who box enough? |
| 6 | **Scan trusted / favourite traders:** the best whole trade with each now, one press to the desk | research TornExchange's per-trader list endpoint | none until the research is back |

**The owner's decisions (third session, 2026-09-28):**
- C2: Extras per trade = a number, **default 5, 1-10** ("unlimited" meant every item we can flip to that trader, capped at 10); the 3-bazaars-per-extra rule stays. **Built, unreleased** (`extrasPerTrade`, `EXTRA_ITEMS_MAX`, prefs `extraItems`).
- C3: "trusted" = TornExchange / TornW3B's own rating (the badge), not ours. The Ledger › Traders tab (who, trades, money, profit, last trade, did they pay their list) and "Traded 7× · last 3d ago" on trader rows: yes.
- C4: favourite = **5+ finished trades** (automatic, editable). Blacklisted = never a buyer (flips, trades, Where to sell), **their bazaars still used** to buy from. A favourite with no public list: their last-paid prices, marked "last paid".
- C5: a trader **dropdown** (most trades first) **plus a totals line** (trades, paid to you, cost, profit); and the per-item profit split by accepted prices.
- Troll bids: the item list ignores bids over 3× the Item Market Average when sorting (as flips do); the bid still shows on the item, marked as not believable.

**Picked from the mockups (`mockups/Q-*.html`, third session):**
- C1: variant B's own window, but **freely movable anywhere on the page** (the owner's choice, overriding "never cover Torn" for this window only; it starts in the free space). A **checklist** on the trade page: each bought item ticks itself once it is in the trade (read from Torn's trade view), and a warning names anything bought but not added; Fill and the highlight come from this list (Fill and the highlight were still never seen live). Items the trader does not buy: **left off**. Unplanned items the trader buys: **orange** while profitable, **red** when not.
- C3: as drawn. C4: **A** (star + ⊘ buttons on every row). Favourite = 5+ trades **and a trade within the last month** (added by hand: kept until removed). Blacklisted: **not shown in Torn Bids at all**; un-blacklist from the Ledger › Traders tab.
- C5: the agent's pick (the owner: "whatever fits our look"): **B**, four boxes like the Trading tab.
- C6: **collapsible** section; scans favourites and every trader with a Trusted badge.

**Research done (third session):** C6 - TornExchange `GET /api/prices/{torn id or name}` (key) = one trader's WHOLE buy list `{items:[{item_id,name,price}], meta:{trader, vote_score, last_updated, time_since_last_trade}}` (swagger), one call per trader at our 10 s pace. C1 - the Ledger already reads log 1225 (bazaar buys) every 5 min from Torn Bids; the bazaar page's own purchase message is still unread (needs the owner to buy with the Claude tab open).

**D. Still held (remind, do not build):** the faction rule; trader capacity
and "Sell fast".

**Also noticed live, not on the list:** troll bids (a Parcel at $99b) lead
Torn Bids' item list - flips ignore a bid over 3x the Item Market Average
(`BID_SANITY_X`), but the list sorts partly by the best bid. Ask before adding.

**Rules for every build:** a unit test that fails on the old code and passes
on the new; `npm run check` green (277 tests); nothing removed (the buying
run, Fill, leftovers, receipts, pins, held trades keep working); harness
screenshots with torn.com blocked; no money thresholds; asking for the link
means release (bump, commit, push, pinned link).

### The agenda for the next session (let the owner choose the order)

The owner, end of 2026-09-28: "write me handoff for next session. with the
trusted traders, receipt filterable by trader, and something for favourite
trader blacklisted trader, and scanning if we can flip something on our
trusted trader". Items 2-8 are theirs, NOT built: restate each in their words,
mockup first where it changes the look (see "How the owner works"), then build.

1. **Check 3.14.2 live first** (read only, pages the owner opens in the Claude
   tab group; ask if the script is on and shows 3.14.2):
   - the friend's trade add step: what the new line after *ADD TO TRADE ·
     Clear all* says - it names why Fill marked nothing (he had pressed
     accepted; likely a trade with someone else, or 0 recorded as bought);
   - Chat → the trader's profile with Torn's Start chat button outlined blue;
   - Torn Bids left in the background for a while: the TornExchange pill in
     minutes (not "1h") and flips already checked on coming back;
   - pins (Best flips cards and list rows; one row per pinned item), per-trade
     Declined (the desk goes on to the next flip), "Other" never flipped,
     the overlay's opened-listing mark in light red;
   - still never seen live: a real bazaar card's stock dropping after a buy
     (the buying run counts from it), Fill typing into the real add step's Qty,
     the real v2 type names for weapons/armour/cars.
2. **Our trusted traders.** The trust badge today is the public score
   (TornExchange votes / TornW3B rating). The owner wants their OWN trusted
   traders: the people they have traded with. Source: the Ledger's finished
   trades (Full key; `/v2/user/trades`, names open) - no new calls. Shape it
   with the old "Trading partners" ask (asked three times): a **Ledger ›
   Traders** tab - who, how many trades, total paid, profit (FIFO), last
   trade, items; **"Did they pay their list?"** per trade (the accepted trade
   in `sellAccepted` records what they should pay; the finished trade what
   they did - the ID Badge loss); on Torn Bids' trader rows **"Traded 7× ·
   last 3d ago"**. Ask: is "trusted" automatic (N trades, all paid) or picked?
3. **Favourite and blacklisted traders** (Favourites was designed 2026-09-28,
   memory `remind-next-session`):
   - **Favourite**: 3+ finished trades = automatically a favourite, editable
     (add / remove, and a removal sticks). Open questions from then: 3 trades
     in total or on different days? For a partner with no public list, use
     their last-paid prices, marked as such?
   - **Blacklisted**: never planned, never a flip's buyer, never in the
     strip, the desk's trades or Where to sell; listed with Undo. Different
     from Declined (3.14.2: one trade, one hour). Ask: hidden, or greyed at
     the bottom like Declined? Forever until removed?
   - Where: the Ledger's Traders tab (item 2) and a small control on each
     Traders pay row. Never a ranking bias toward any named trader (the
     owner's earlier rule) - favourites may be marked and sorted first on a
     tie, not given a better price.
4. **Receipts filterable by trader.** The Receipts tab already has a free-text
   **Who** box (`this.f.who`, matched in `filterLedgerRows`) - check live
   whether typing a trader's name works on receipts (receipts carry
   `who`/`whoName`). The ask is likely a proper trader picker (the traders on
   your receipts, most trades first) plus a totals line for that trader
   (trades, paid to you, cost, profit). Ask which.
5. **Scan: what can I flip with my trusted / favourite traders now.** For
   each favourite, the best whole trade with them right now (`planTrade`:
   main flip ≤5 bazaars + ~5 extras), listed like the pinned rows ("Trade
   +$X · N items"), one press = that trade on the desk. Needs each trader's
   WHOLE buy list: TornW3B `/api/pricelist/{id}` (have it for W3B traders);
   TornExchange has only the top 3 per item (`all_best_listings`) and per-item
   full lists (`listings?item_id`, 10 a minute - too slow per trader). Research
   first (no code): TornExchange `prices/{id}` or a per-trader list endpoint
   (agenda item 5 of before; memory `trader-sources`). Reads: the summary's ≈
   first, then their items' bazaars at the background pace (3.14.1) - never
   more than the shared TornW3B budget.
6. **"Bought since you accepted" - a list in the overlay, and Fill from it**
   (the owner, 2026-09-28: "have another overlay window popup, or within NPC
   Arbitrage: recent items bought ever since I clicked accepted trade. And our
   Fill items from the trading as well, cus our current Fill items and
   highlight from bought items is kinda buggy, so a list, and the highlight").
   - Today Fill / the highlight count only the PLANNED steps, from a listing's
     stock dropping on the bazaar page (never verified live) - an extra you
     buy in the same bazaar is not counted, and a missed count means no Fill
     (the friend's page, item 1).
   - Wanted: from the moment of "X accepted", every item you actually bought
     (planned or not) in one list. **Decided (the owner): a separate overlay
     of its own, apart from NPC Arbitrage, that shows up only while a trade is
     accepted** (and goes when it is Traded - done / back to the live plan).
     Mockups of how it looks first; it must never cover Torn's content (the
     panel's rule). On Torn's trade page: that list is what Fill fills and
     what gets highlighted.
   - Research first (no code): where "bought" comes from. (a) Torn's log -
     exact (1225 bazaar buys: item, qty, price, seller), but it needs the
     Ledger's **Full key**, which the overlay on torn.com must never read
     (README security rule): Torn Bids could read it (it already does every
     5 min for the Ledger) and share only derived rows (item, qty, price,
     seller, time) through GM storage - Torn Bids has to be open. (b) the
     bazaar page itself, read only: Torn's own "you bought N x item" message
     after a buy - instant, no key; its markup must be read live first. (c)
     the Limited key's inventory - Torn caches it ~1 hour: too slow. Likely
     (b) for instant + (a) to correct. Items given back by "They took fewer"
     stay leftovers as now.
7. **Receipts: each item's own profit.** A trade pays one lump sum; the Ledger
   splits it across items by Item Market Average (`rowsFromTrade` `share`),
   so a receipt's total profit is right but per-item profit can shift between
   items. When the trade was accepted in Torn Bids, `sellAccepted` has the
   trader's price per item: split by those instead (and say so on the receipt).
8. **How many extras: a setting** (the friend, through the owner,
   2026-09-28: he wants more extra items - "add unlimited, or just set the
   limit ourselves there"). Today `EXTRA_ITEMS` = 5 is fixed in code (a soft
   cap: the rest are under *Show them* with Add). Wanted: Settings › Flips ›
   **Extras per trade** - a number, or unlimited; **the default stays 5**
   (smart defaults: the owner never touches settings, the friend will). The
   other extras rules stay (route first, then one new bazaar each, at most 3
   bazaars each, fast first, slow only on the route). Ask: does "unlimited"
   also lift the 3-bazaars-per-extra rule, or only the count?
9. **How profit is counted - explained to the owner, keep in mind:** the
   Ledger is per item, first in first out (a sale matched to that item's
   oldest buys, after fees), not networth; items never bought (crimes, gifts)
   are counted apart, never as profit; a trade's money is split by Item
   Market Average (item 7).
10. **Still held, remind (not built):** the **faction rule** (skip a trader in
   the same faction as the bazaar you bought from); **trader capacity** (price
   vs how much they take - networth, reselling bazaar, W3B bulk prices, own
   history) and a **"Sell fast"** line in Where to sell (the Vladbull case).
11. Older, smaller: weapons / armour flips done properly (Big Al's, RW gear
   under its Bunker Bucks floor); a yellow TornExchange pill was never seen
   live (ask for its hover text); the trade page does not handle you paying
   them; Settings › Keep for yourself is unused since own items left trades;
   run `test/ux-check.mjs`.

## What the 2026-09-28 third session did (3.14.3, unreleased until the owner asks for the link)

Built after the owner's decisions (see "The plan (third session...)"), each with
unit tests that fail on the old code, and checked in the harness (torn.com
blocked); nothing of it seen live yet.

- **B1** buying box (`buyingStatus`, `.ttv2-buynext` wraps, `.ttv2-nobr`). **B2**
  hidden tab: flips before price lists, 20 reads/min, lists at most 6
  (`nextW3bRead` `hidden`, `backgroundListSlot`, `flipsStale`). **B3**
  TornExchange failures say why (`teFailText`).
- **C2** Extras per trade (1-10, default 5). **C3/C4** `core/partners.js`:
  partnerStats (trades, money, FIFO profit, last trade, paid their list -
  kept on the ledger rows as `agreed`, so it outlives the price records),
  favourites (5+ trades and one within 30 days; added by hand; a removal
  sticks), blacklist (`blacklistKeys`: id and name; applied on every buyer
  path incl. pins, the desk fallback, bids and the overlay's tags). Ledger ›
  Traders tab, ☆/⊘ on Traders pay rows, "Traded 7× · last 3d ago",
  Settings › Flips › Blacklisted traders with Undo (for anyone without a
  Full key). **C5** receipts: Trader dropdown + four boxes, "split by their
  prices" (price records `sellPriceRecords` saved at "X accepted";
  `rowsFromTrade(priceOf)`), "$N short". **C6** Your traders (collapsible,
  under Best flips): favourites + Trusted-badge traders, the best whole trade
  each, Put on desk; favourites' whole TornExchange lists via `prices/{id}`
  (`fetchTeTraderPrices`, paced in the shared queue, visible tab only,
  `sellTeOwnLists` pruned to favourites, failures back off); no public list =
  last-paid prices, kept apart (`lastPaidOnly`) and marked. Worked out at most
  every 10 s (`SCAN_EVERY_MS`) or at once on a settings change.
- **Troll bids**: the list sorts and Where to sell use the best believable bid
  (`listBid`, `believableBid`); troll rows are struck through, after the real
  ones, "Over 3× Item Market Average: not counted".
- **Inputs (owner: 2/10; mockup R-inputs, picked A + D)**: no Save buttons
  anywhere in Settings - the box shows the saved value, click/Tab selects it,
  Enter/Tab/click away saves ("Saved ✓" 2 s), Esc restores, a bad value is red
  with the reason under it and the old value stays, an emptied box restores.
  Cash for flips: "No limit" / "Up to [amount]" (`cashLast` keeps the amount).
  Keys save on Enter or leaving the box (and are checked first: format, Torn
  accepts it, not Public/Minimal - `keyTooLowForInventory`). Desk quantity
  boxes: never redrawn while you are in one (unless the window lost focus),
  Enter leaves and saves, Esc restores, bad input said beside the box, more
  than listed is cut and said ("11 listed - 999 is more than bazaars have").
  The Ledger keeps focus and selection; dates apply when finished.
- **Review of the session (3 passes, all findings fixed)**: see the list of
  fixes in the commit; the top ones: a Public key replaced the Limited key;
  blacklisted traders came back through pins/fallbacks/overlay tags; the star
  did not redraw; no Undo without a Full key; last-paid prices counted as live
  bids; decline focus landed on the next trader's decline; the scan planned
  every trader on every redraw; the Fill note counted hidden duplicate rows
  and now names items missing from the list; faded rows by colour (contrast);
  at 1000px the list comes before the desk.
- **C1 Bought since you accepted** (`core/accepted.js` `boughtSince`,
  `ui/bought-window.js`): its own window on Torn's pages while a trade is
  accepted, ending just above NPC Arbitrage; dragged by its title anywhere
  (kept in `boughtWindow`), folds to one line; every buy recorded for the
  trade (steps now carry `boughtAt`), cost / they pay / profit, still to buy;
  on the trade page a checklist ("✓ in" / "add 20") and "Not in the trade
  yet: X ×20" or "Everything you bought is in the trade ✓"; gone at Traded -
  done. **Unplanned buys (3.14.4)** (orange while profitable, red at a loss;
  ones the trader does not buy left off): the owner asked "do you really need
  [the live read]? ... the way the script is written?" - no: `stockBuys`
  counts them as the planned buys are counted, from each card's stock on the
  bazaar page you are on (every card not planned at that seller; a card that
  vanishes counts only if you pressed a button on it - `bindExtraPress`, read
  only; a card with no stock shown never counts). The trader's price comes
  from the overlay's own lists (`traderBidOf`). Stored as `trade.extra`.
  Torn's own purchase message would be exact; still never read live.
- **Overlay (review + inputs A/D):** the Min and Cash chips save on Enter / Tab
  / click away, errors under the chips, Cash has "Any" (0 is refused);
  Settings › Fill's amount the same; the Seller line wraps (no "…"); the add
  page header and rows fit at 240px; the buying box's grey is readable.
- **Still open:** everything above is unseen live; the friend's A1
  screenshot; A4 (one row per pinned item), A5, A6, A7 live. Held (remind):
  the faction rule; trader capacity and "Sell fast".

## What the 2026-09-28 second session did (3.14.0)

The owner: "before 3.12.6 the flip tool worked... since 3.13 it feels
underwhelming: candy flips of a few thousand, and it doesn't lead with the
best flip". Their plan, restated and agreed (explainer `mockups/P-trade-rules-explained.html`):
the MAIN flip is the big earner; extras are only cover; "5 bazaars max for the
main flip... 1 bazaar best"; "about 5 extras, soft cap"; no money thresholds
("why are we hardcoding money? make it smart"); own items not in trades; a pin;
"the only thing that updates is price/profit"; Chat instead of Copy offer.

- **Desk regression (3.13) fixed:** `deskItem` (core/desk.js) - the #1 flip
  until you pick. Proven on the harness (`&bigflip=1`) with 3.12.5, 3.12.10,
  3.13.1 and 3.14 side by side (Playwright, torn.com blocked): 3.13.1 kept the
  desk on Xanax +$20,000 for 35 s while Stealth Virus +$16.6m led the strip.
- **Main flip at most 5 bazaars** (`pickBazaars` / `flipPlan`, core/flips.js):
  bazaars added by what they add; once full (Most per flip / cash) a bazaar that
  only swaps for cheaper units must add 10% (`SWAP_GAIN`, a ratio, not money).
  Junk sinks by itself: Bon Bons +$9,633 from 38 bazaars → +$1,725 from 5. No
  "worth the stops" money rule (the owner rejected $5,000/bazaar).
- **planTrade with kindOf** (core/trade.js `planMainAndExtras`): main = the item
  that makes the most with that trader (≤5 bazaars); "Main: X · Y is cover"
  on the card; `EXTRA_ITEMS` 5 extras: route first, then one new bazaar, fast
  first, ≤3 bazaars each (`EXTRA_STOPS`), slow only on the route; `left` =
  the rest, *Show them* + Add. Without kindOf: the old plan (`planEverything`).
- **Held and pinned trades** (core/held.js): a press in the trade card holds
  it (session, 2 h); the pin on a Best flips card pins it (GM `sellPinned`,
  'item|traderKey', a week, 8 max; Traded - done removes it). Items / amounts /
  steps stay; `priceHeld` prices them live (check per step, their bid now);
  lines never vanish (red when losing); `editHeld` changes only the line you
  edit; ≈ lines resolve when read. Pinned rows on top of the list; the pin is
  absolutely positioned (the owner: "you moved the contents" - measured equal).
- **UI calm:** no desk redraw while a number box is dirty; the strip never
  re-orders under the pointer. The full keyed in-place update was NOT built
  (the hold makes redraws structure-identical).
- **Reads (the yellow Bazaars pill):** `nextW3bRead` - the desk's trade read
  its items (up to 30, for twelve traders' totals) before the possible flips,
  always; now only while a trade is under way (picked / held / pinned), and
  only the chosen trader's ≈ items. The harness found Stealth Virus at 12.5 s
  vs 15-20 s.
- **Toggles:** Online only drops only known-offline traders; Trusted only =
  Known+ (and unrated while TE votes are missing); badge shows the score. The
  overlay's bazaar tag still needs Trusted.
- **Own items out of trades** (the owner: "omit it"); Copy offer → **Chat**
  (profile; TE page for name-only traders).
- **TornExchange pill (not fixed, not found):** the pacing (10 s, shared,
  429 honoured) and the keyless per-item lookups (only without a working key)
  are fine. Yellow = no top-3 list yet ("loading") or the last call's error on
  the pill. Needs the owner's pill hover text (Claude in Chrome was not
  connected). TornW3B 6/114 is the seed traders' lists being read one per two
  slots - slow, but by design.
- **Bug hunt (two reviewers, every finding reproduced, then fixed and
  re-checked in the harness):** a zero pay cap / spent cash read as "no
  limit" in `pickBazaars`; a big seller behind 60 single units never weighed;
  greedy bazaar picks now get a swap pass (main flips); `priceHeld` shares a
  seller's stock across steps; ticking a held line back restores it as it was;
  the desk item always stays in its trade; the hold is taken AT the first press
  (the first untick used to re-plan and drop the line); no stray "Held" after
  Accept; a pin uses the trade the item's desk would show (`chooseTrade`),
  its trader even when a toggle hides them; the hovered strip keeps its
  places but updates; the pin icon shows only what was saved. Worst case
  (12 traders x 30 items x 100 listings) plans in ~31 ms.
- **Found live (read only, the owner's page):** Torn Bids showed "TornExchange
  1h" and "0 of 30" flips checked - its tab was hidden, and the page sent
  nothing while hidden. Fixed in 3.14.1: TornExchange and TornW3B keep going in
  the background (6 TornW3B reads a minute), TornExchange refreshes on coming
  back; Torn API calls stay in-view only. Torn's profile "Start chat" is a
  button with no link (`button2-profile-<id>`, class `withoutLink`); 3.14.1's
  Chat stores `chatWanted` and the overlay marks that button in blue
  (`markChatButton`). Harness: `?page=profile&XID=5001&chatwanted=1`.
- **3.14.2 (the owner, live):** "put it here as well" - the pin on every flip
  row in the list; "it created something doubled" - a pinned item is listed
  once (its row moves to the top: *Trade +$X*, trader, main flip); "it doesn't
  say how much the bazaar sells it for and how much the trader buys it for" -
  list rows *Buy $X · Sell $Y*, cards *Buy N at $lo–$hi from ...*. The owner's
  live list showed Stealth Virus +$29.2m, Armored Virus +$12.9m on 3.14.1.
  The friend's add step (screenshot, TornTools prices on the rows) had no
  Fill after he pressed accepted: why is unknown (a trade with someone else,
  or 0 recorded as bought, are the likely ones) - so 3.14.2 puts the reason
  on the page (`fillNote`, `showFillNote` after ADD TO TRADE) and matches
  the partner by Torn id too (`ttv2-tradeuser` from `#step=start&userID=`).
  Ask the friend what the new line says.
  Also in 3.14.2 (the owner): Declined is per trade (`declineKey`
  'item|trader', `declinedOn`; older per-trader entries ignored) and the desk
  goes on to the next flip; "Other" joins Never flip once
  (`neverFlipOtherOnce`, flag `otherOn3142`); items pushed out by the 5-extras
  cap go to Show them, not "no longer in the trade"; the overlay's opened-
  listing mark (`.ttv2-target`) is light red #ff8a80 instead of yellow.
- **Open:** the TornExchange pill's yellow state was never seen live (ask for
  its hover text if it comes back); a pin from a list row (only Best flips cards have the pin); Settings › Keep for yourself
  is now unused by trades (kept, harmless).

## What the 2026-09-28 session did (3.13.0)

The owner (after the 3.12.10 run): the plan asked for 100 Hand Drills for a
little profit; "the biggest profit should be the main item... we're only adding
items so we don't look sus... if we take too long buying, prices change or the
trader loses interest"; "some items even in their list they'd only buy 5, not
100"; "the software has to be smart - the default is the baseline, we never
touch settings". Research first (no code): TornW3B listings of 176 items read
twice 28 minutes apart - flowers, plushies, drugs, medical fill 25 units from
1-2 bazaars and move hundreds an hour; Hand Drills need 21 bazaars for 25 and
none moved; 75 of 176 items moved nothing; stock is not demand. Plus a UX
study (NN/g, Baymard, Fitts/Hick, OSRS flipping tools). Then built, with
the owner's "no mockups, I trust your judgement":

- **Smart extras** (`core/liquidity.js`, `planTrade` with `kindOf`): the
  picked item as before; extras by time - bazaars on the route first, then
  `extraStopBudget` (2-4) new bazaars, fast first, one bazaar per extra item,
  slow only where you go anyway; `EXTRA_CAP` fast = Most / normal 10 / slow 3,
  your own items too (typed numbers win: `edits['held:<id>']`); never the
  planned trader's own bazaar (owner's rule, memory `no-resell-to-own-trader`;
  buying from any bazaar to sell to someone else is fine). Kind = type
  (`FAST_TYPES`, any spelling), thin listings, or measured movement
  (`noteMovement` on every bazaar read, `sellMoves` store, merged across tabs;
  an empty read is not a sale; one read counts at most a quarter). The plan
  says bazaars and minutes, tags extras, counts what was left out.
- **Copy offer** (the message to the trader, one line per item).
- **Desk:** a trade's card sits beside the traders; Trade only after buying;
  no jumping between flips while loading; declining the only trader says so.
- **Accepted card:** one main button (Start / Continue buying, then Open the
  trade), SENT column, **They took fewer…** once bought (`markLeft`,
  `takenUnits`), totals on what they took; **Traded - done** keeps the rest as
  **leftovers** (`sellLeftovers`: strip cards with cost and the best OTHER
  trader, merged into held, not offered back to who refused, pruned once the
  inventory - read an hour later - shows them gone). The trade page fills only
  what they take.
- **Buying run:** the strip on the marked card (Fill types the step's amount
  into the card's box; Next); two steps at one bazaar are both counted from
  the stock on arrival (per-step `ttv2-buyrun` map) and Next stays on the page;
  the panel's box is under the header (also collapsed / Settings), "yes N min
  ago" (amber after 10), labels say where Next goes, **N** only on the bazaar
  being bought from.
- **Ledger Receipts** tab (`tradeReceipts`).
- **Fable review, three passes** (security / bugs / usability): all fixed but
  the three Lows above. Security: the Full key can never go to TornExchange;
  requests carry no cookies (`anonymous`); card buttons act only on the marked
  card; no string `on*` attributes. Bugs: empty-read movement, second step at a
  bazaar, ≈ lines frozen into an accepted trade, tick after a partial count,
  receipts under an item filter. Usability: 16 wording / keyboard / layout fixes.

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

- **3.12.8** (the friend: "I buy a lot and then can't remember", "prices change or
  they're gone, so not profitable any more; and no clothes"; the owner's
  Next-bazaar flow): the buying run (`trackTradeBuying`, `onBuyNext`, panel
  `setBuying`; counted by `boughtFromStock` from the listing's stock), the
  replacement offer / Drop it in the accepted card (`replacementFor`,
  `replaceStep`, `dropLine`), what to send = what you bought (`sendUnits`),
  **Never flip** categories (prefs.neverFlip, Clothing by default), and on
  Torn's trade page the partner check, money check, "N in", and Fill per row
  (`scanTradePage`, `sources/dom/trade.js`, read off the owner's real page).

- **3.12.9** (live test, the owner: "where's my fill?", "where's the next bazaar
  button?", "take that green info away"). Read the real add step again (read
  only): Torn keeps each row's `.info-wrap` in the page but `display: none`,
  and 3.12.8 put Fill there - never visible. Fill now goes in `.name-wrap`
  (nowrap, overflow visible, so it never drops under the picture); every
  category tab's `ul.items-cont` is read (All first); a press fills its own
  row (`closest('li')`, `tradeFill` keyed by row). The poll runs the trade
  checks before the item list has loaded. The green `::after` tag is hidden on
  `.ttv2-buyhere`. Found on the way: **the owner had the script switched off**
  in Tampermonkey when they saw no Fill / no Next bazaar - check that first.
  `mockups/O-where-next-and-fill.html` shows where each thing is.

- **3.12.10** (bug hunt of this session's work, two Fable reviewers, each
  finding checked, then fixed). Buying run: a listing re-priced since the plan
  is still matched and counted (the box says "Now $X each (planned $Y)", and
  "skip it" when it is not under their price) - before, it counted 0 and the
  step became skipped; the starting stock is kept in sessionStorage
  (`ttv2-buyrun`), so a reload after buying still counts; when the listing was
  never seen on the page (no item list, or gone before you came) Next asks
  "Did you buy N?" (**Bought N** / **Did not buy**) instead of recording 0;
  `trackTradeBuying(null)` = not scanned (never read as "gone"), and an empty
  scan before the cards are drawn is not "gone" either; Next re-checks the step
  is still that seller's (Torn Bids may have replaced it). Ticks: ticking
  Bought clears "skipped", unticking undoes Next's count. `replacementFor`
  offers the same seller when only re-priced/short. Accepting a second trade
  with a trader already under way shows that trade instead of overwriting it.
  Trade page: `[#&]ID=` (not `userID=`), partner kept in sessionStorage per
  trade, Fill tags updated in place (a rebuilt tag swallowed presses). Other:
  the Bazaars/Item Market tab switch merges into stored settings; a kept deal
  row's Show uses the latest row; an HTTP 429 from Torn pauses every tab;
  TornW3B re-checks its block after waiting for a slot; the Ledger keeps the
  newer of the GM / IndexedDB copies; traders stored without `seenAt` are
  dated from now; Fill's memory is cleared when you leave a Fill page.
  Not changed (low): orphan per-tab window keys (a tab that closes before its
  registry write), Fill's "n-th row of this item" key shifting when an earlier
  duplicate listing goes, and a note when the 24 h limit ends a trade.

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
  - `&tradeview=<name>` (+ `&offer=<n>`, `&inside=<Name:qty,...>`) draws Torn's
    trade view; with `?ownbazaar=1&page=trade#step=add&ID=5` the add rows too;
  - `&bazaarcards=1` (with `page=bazaar&userId=<seller>`) draws a player's
    bazaar with two listings; `window.__buy(id, n)` takes n off one (a purchase);
  - `?page=trade` stands in for Torn's trade page (the panel's send list; save a
    `tornTrading.v2.sellAccepted` value with GM_setValue, then fire a hashchange);
  - `&manytrades=1` (with `&ledgerkey=1`, then Ledger › Read now a few times): Bob 5 trades (a favourite), KayMalta 2 with accepted prices (one $300 short); TornExchange `prices/11` answers Bob's whole list;
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
- **The traders page pauses its Torn API requests while its tab is hidden**;
  since 3.14 its TornExchange and TornW3B reads go on slowly in the
  background (`backgroundSlot`, 6 TornW3B reads a minute, flips worked out
  every 30 s). A background preview shows little until brought forward.

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
- **Added in 3.12.8:** `sources/dom/trade.js` (Torn's trade view and add rows);
  in main.js the "A trade on Torn's pages" section (buying run, trade page).
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
