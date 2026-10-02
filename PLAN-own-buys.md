# Plan: listings you already bought are still suggested

**BUILT as 3.16.4 on 2026-10-02 (the owner: "build all"), in the working
tree only - not committed.** What was built differs from "Proposed design"
below in one way, for a reason found while building: the page does not store
"a buy of N" (which would then have to be matched against the same buy in the
log), it stores **the stock the listing shows after it dropped** - an
absolute number - so nothing can be counted twice: log buys made before that
sighting are already in it, only log buys clearly after it come off it.

- `core/flips.js`: `withOwnBuys(rows, itemId, {stock, bought})`, `liveStock`,
  `noteStock`, `liveBought`, `addBought`, `SEEN_MARGIN_MS` (60 s).
- Stores: `sellStock` (the overlay: `trackSeenStock` in `main.js`, every
  bazaar page, with or without an accepted trade) and `sellBought` (Torn
  Bids: `noteOwnBuys`, from the minute log read and from the Ledger's run).
  A listing emptied in front of you is a gone mark (`sellGone`), now also on
  a long bazaar not read whole (`listingBoughtOut`).
- Applied in `sellersOf` only; `sell.bazaars` is never written.
- The owner's answer 2 ("nothing should be missed"): page + log + Ledger all
  feed it. The one case nothing sees: a buy with the overlay off and no
  Ledger key.
- Tests: `test/own-buys.test.js`. Harness: `&bigflip=1&ownbuys=1`.
- In the same release: leftover cards go by themselves (README, "Leftover
  cards go by themselves").

The rest of this file is the plan as it was written, kept as the record.

Written 2026-10-02 by the session that built 3.16.3, for the session
**"Torn bids standby"**. The owner said: **do not code yet** - trace it, know
whether it can be done safely, and be in line with them first. Nothing below
is built. Re-verify every code reference before relying on it.

## What the friend said (2026-10-02, Tagalog; the owner relayed it)

> "kunware, si player 1 nagibibli ng xana, tapos tinrade ko na sa kanya yun.
> si player 2 naman kapag inano ko yung trade nya, pinapakita parin ni torn
> bids yung xanax na binili ko for trader 1, kasama parin sya sa flip plan
> kahit wala, kasi wala na eh binili ko na nga yun for player 1, syempre wala
> na sa bazaar, pero sinusuggest parin yung items na nabili ko na, parang
> nagrerely parin sya sa tornw3b pero minsan dba late mag update tornw3b"

In English: player 1 buys Xanax; he bought it from bazaars and traded it to
player 1 - done. Then he opens player 2's trade, and Torn Bids still puts the
Xanax listings he bought for player 1 in the flip plan. They are not in those
bazaars any more - he bought them. Torn Bids seems to rely on TornW3B, and
TornW3B is sometimes late to update.

His follow-up the same day, on hearing what 3.16.3 does: "yung inayos sa
last session baka yung pag iba bumili tapos sinuggest parin. eto ako bumili
pero sinusuggest parin sakin" - what was fixed is maybe the case where
someone else bought it; his case is that HE bought it and it is still
suggested to him. Which of the uncovered cases below was his is not known:
there is no log or zip for it. Ask for one.

**The owner's question:** how do we do this without breaking Torn Bids - the
update feature (what gets re-read and when), the calculating (plans, profit),
and the suggestions (flips, Your traders)?

## What the code does today (traced 2026-10-02, at 3.16.3 uncommitted)

- A flip plan is made from TornW3B's listings of the item: `sell.bazaars`
  (`{at, rows}` per item, `loadBazaars` in `src/main.js`), each row
  `{sellerId, sellerName, price, qty, dataAt}` - `dataAt` is TornW3B's own
  `last_checked` for that listing (`normalizeW3bListings`, `core/feed.js`).
- **Every reader goes through one closure, `sellersOf(id)`** in
  `renderSellingNow` (`src/main.js`): `bazaarSellers(withoutGone(b.rows, id,
  gone), ...)`. Its users: `planOf`, `tradeDesk` (`stepState`,
  `replacementFor`), `lowestOf` (-> `effective` -> `flipCandidates`: which
  items' bazaars are read next), `bazaarDepthOf`, `kindOf` (liquidity),
  `priceHeld` (held / pinned trades), and the desk's listing rows.
- The raw rows are used directly only by: `noteMovement` / `unitsMoved` (how
  fast an item leaves the bazaars - previous read against new read),
  `bazaarsDue` (when to read again, by time) and the sweep. **A filter inside
  `sellersOf` that never changes `sell.bazaars` leaves those alone.**
- A listing is "stale" - shown greyed, never planned on - once TornW3B has
  not checked it for 30 minutes (`FLIP_FRESH_MS`, `core/flips.js`).
- Nothing subtracts what you bought. After you buy 80 Xanax from seller S,
  TornW3B's row for S keeps saying 80 until TornW3B checks S again.

### What 3.16.3 already covers (uncommitted, see HANDOFF.md)

"Gone" marks (`core/flips.js` `markGone` / `liveGone` / `withoutGone`, store
`sellGone`): written by the overlay on a bazaar page when **every row of the
bazaar was read and the item is in none**, including right after you bought a
listing out. Torn Bids then leaves that seller's row out until TornW3B's
`dataAt` for it is newer than the mark; a mark lasts 30 minutes.

So the friend's case is already fixed **when** he bought the whole listing,
the bazaar fits in the page (most do: about 54 listings are in the page),
and the overlay was running on that bazaar page.

### What it does not cover

1. **Bought part of a listing** (40 of 100): TornW3B still says 100, the
   next plan counts on 100 there. No mark is made (the item is still listed).
2. **A long bazaar** not scrolled through after the buy-out: no mark.
3. **A buy the page did not count** (overlay off, card not read): no mark.
   **A buy with no accepted trade still to buy for**: `trackTradeBuying`
   returns before any mark when nothing is pending - both `noteGoneListing`
   calls sit inside the buying run for a step at that seller.
   His Torn-log buys (`sellLogBuys`) only tick plan steps; they never mark a
   listing gone or lower its stock.
4. **TornW3B checking again but still showing it.** A mark gives way as soon
   as `dataAt > mark.at`. If TornW3B's `last_checked` moves forward while its
   quantity is still the old one ("late to update"), the listing comes back.
   **Not known whether this happens - it has to be measured** (below).

## What we know about your own buys (the data is already there)

No new API call is needed for any of this.

| Source | What it has | When | Lives |
|---|---|---|---|
| The buying run's page count (`recordBuy`, overlay `onBuyNext`) | seller, item, how many, `boughtAt` (your clock) | at Next | in the accepted trade (`sellAccepted`) until the trade closes |
| Unplanned page buys (`addExtraBuy`) | seller, item, qty, price, `at` | as counted | `trade.extra`, same |
| Your Torn log, log 1225 (`watchAcceptedBuys`, 3.16) | log id, seller, item, qty, each, `t` (Torn's clock) | once a minute while a trade under 3 h old is accepted, hidden tab too | `sellLogBuys` - **emptied when no trade is watched; a closed trade's buys are set aside (`forgetLogBuysOf`)** |
| The Ledger (`runLedger`) | every bazaar buy: seller (`who`), item, qty, `t` | every 5 minutes, **only while Torn Bids is in view** | Torn Bids' IndexedDB (`led.data.rows`), a year |
| A manual Bought tick in Torn Bids (`tickAccepted`) | seller, item, planned qty - **no time** | when ticked | the accepted trade |

The friend's case is exactly the hole: trade 1 **closed**, so its steps and
its log buys are gone from the two stores a plan could look at, and the
Ledger may be minutes behind.

## Proposed design (to restate to the owner before building)

**Your own buys come off TornW3B's quantities.** One small pure function
beside `withoutGone` in `core/flips.js`, e.g. `withoutBought(rows, itemId,
buys)`: for each row of seller S, take off what you bought from S of that
item **after** TornW3B last checked that row (`buy.t > row.dataAt`); a row
left with nothing goes. A row TornW3B has checked since the buy is used as it
is. Applied in `sellersOf`, next to `withoutGone` - one place, the same place
3.16.3 already filters.

**A small shared store of recent own buys** (e.g. `sellBought`: `[{id?,
sellerId, itemId, qty, t}]`), kept 30 minutes (after that any row not checked
since is stale and never planned on - the same reasoning as the gone marks):

- written by the overlay when Next records a page-counted buy, and for
  unplanned page buys;
- written by Torn Bids when the log read brings buys (they carry Torn's log
  id and Torn's clock - the authority);
- **never counted twice:** a page-counted entry goes once the log has been
  read past its time (the rule `applyLogBuys` already uses: the log has it,
  or it was not yours). Without a Ledger key the page entries stay.

Why a store of its own and not "look in the accepted trades": the trade that
bought them is closed by the time the next plan is made - that is the report.

### Does it break the update, calculating and suggestion features?

Traced answer: **it should not, if the filter stays inside `sellersOf` and
never writes to `sell.bazaars`.**

- **Update (what is read, when):** `bazaarsDue`, the sweep and the movement
  record use the raw rows and times - untouched. `lowestOf` does go through
  `sellersOf`, so an item whose cheapest listing you bought out ranks as a
  flip by its next cheapest - which is the truth, and what the gone marks
  already do.
- **Calculating:** `flipPlan` / `planTrade` only see fewer units at that
  seller; same maths. `priceHeld` re-prices held and pinned trades from the
  same rows.
- **Suggestions:** the flips list, Your traders and the desk all read
  `sellersOf`; they stop offering units you already took.
- **An accepted trade's own steps:** a bought step reads as 'bought' before
  its listing is looked at (`stepState`), so subtracting your buy does not
  turn your own step into "gone". A *second* accepted trade that planned the
  same listing will rightly read 'short' or 'gone' and offer a replacement.

### Risks to check before and while building

1. **TornW3B "late" with a newer `last_checked`** (item 4 above). Measure
   first: read `weav3r.dev`'s listings for an item, note a seller's
   `last_checked` and quantity, and after a real buy by the friend (or the
   owner) see whether `last_checked` advances while the quantity stays. If it
   does, "TornW3B checked since" cannot be trusted and the subtraction needs
   another rule (e.g. keep subtracting until the quantity TornW3B reports has
   dropped). Only documented TornW3B endpoints, at a polite pace - see the
   Cloudflare warning in HANDOFF.md.
2. **Counting a buy twice** (page count + log line of the same buy): the
   dedup rule above; test it like `test/logbuys.test.js` tests `applyLogBuys`.
3. **Clocks:** a page-counted buy carries your clock, `dataAt` TornW3B's. The
   log's time is Torn's - prefer it. `LOG_BUY_SLACK_MS` (60 s) is the
   project's usual allowance.
4. **A manual Bought tick has no time** (`tickAccepted`): decide whether it
   counts as "now", or is left out.
5. **Two things filtering the same row** (a gone mark and a subtraction):
   the mark removes the row; make sure nothing subtracts into a negative or
   resurrects it.
6. **Do not feed the movement record** (`unitsMoved`) from filtered rows -
   your own subtraction would read as the market moving.
7. **The Ledger is only read while Torn Bids is in view**; do not make the
   plan depend on it. The log-buys read (hidden tab, once a minute) and the
   page count are the timely sources.

### Tests to write (pure, `test/`)

The friend's case (trade 1 closed, plan for trader 2 leaves the units out);
part of a listing bought; TornW3B checked after the buy (no subtraction);
page count then the log line of the same buy (once); no Ledger key; a gone
mark and a subtraction on the same row; the movement record unchanged.
Harness: `test/harness-live.html?ttv2=traders&sellkeys=1&bigflip=1` has
flips to plan on; add a param that seeds the new store.

## Measured 2026-10-02 (the session "Torn bids standby", with the owner's OK)

`GET /api/marketplace/206` (Xanax), 11 reads 75 s apart, 100 listings each,
every read a 200. No buy of ours was in it - this is how TornW3B's clocks
behave, not yet proof against a real buy.

- **A quantity or price never changed without `last_checked` moving:** 11
  changes, 11 with a newer `last_checked` (and `content_updated`).
- `last_checked` moved with nothing changed 138 times: an ordinary re-check.
- **`content_updated` is per bazaar, not per listing:** it moved 18 times
  while that seller's Xanax row was the same (something else in the bazaar
  changed), and when it moves it equals `last_checked` to the second. So it
  says nothing `last_checked` does not - "content changed since your buy" is
  no better a rule than "checked since your buy".
- **How late TornW3B is:** the same bazaar is checked again after 5 minutes
  (median), 10.5 minutes (9 in 10), up to 2 hours (those rows are stale at 30
  minutes and never planned on). The answer itself is a copy made 45-170 s
  before the read (`generated_at`), remade about once a minute.
- Still not known: whether a check made within seconds of a buy can carry the
  quantity from before it (Torn's own API caches for some seconds). So the
  rule keeps a margin: a row counts as "checked since your buy" only when its
  `last_checked` is later than the buy by `LOG_BUY_SLACK_MS` (60 s) or more.
  The friend's next problem report is the live check - log one line per
  subtraction (what TornW3B said, when it checked, when you bought).

The owner's answers (2026-10-02): 1 - only that item's number at that bazaar
comes down ("yung item lang na yun"); 2 - no buy may be missed: page count,
Torn log and Ledger all feed it; 3 - just the smaller number, no words; 4 -
measure (done above). **Not yet said: "build it".**

## Questions for the owner (ask, do not assume)

1. Is "your own buys come off TornW3B's numbers until TornW3B has checked
   that bazaar again" what you mean - or should a listing you bought from be
   left out altogether for a while?
2. Without a Ledger key only the page count knows your buys. Good enough?
3. Should Torn Bids say anything ("30 left after what you bought"), or just
   show the smaller number? (The owner's rule: the software does the
   thinking, no "why" lines in the trade flow.)
