# Plan: the same work, faster - on any laptop

**Part 1, Part 2 and the bench are BUILT as 3.17.0 (2026-10-02/03, the
session "Torn bids standby"), in the working tree only - not committed; the
owner said "wait on commits". Part 3 is not started.** What was built, and
where it differs from the text below:

- The speed log: `src/core/speed.js` (pure), `src/platform/perf.js` (the
  recorder), a probe in `src/platform/gm.js`. The stored record (`speedLog`)
  is by the hour for ONE day (not two), then by the day for a week, with each
  label written once - about 20 KB for a week of ordinary use, not "a few
  KB": per-hour, per-kind detail does not fit in less.
- Both zips carry `speed/` and `trades/` (`exportExtras` in `main.js`,
  `src/core/trades-export.js`). The zips' own words and the Ledger key's
  Data sharing cell in Settings say the trades name the other traders.
- The tidy-up: `src/core/tidy.js`, `cleanStoredOnce` / `tidyStored` in
  `main.js`. NOT done, with reasons (README, "Left alone, and why"): removed
  fields inside `settings`, `opened`, the trade page's sessionStorage notes,
  and the orphaned per-tab request windows (no `GM_listValues` grant was
  added: whether Tampermonkey asks a player to approve an update that adds a
  grant could not be established from its documentation - test it on the
  owner's own Tampermonkey before adding one).
- The bench: `node test/bench.mjs` (five scenes, processor slowed 4x,
  `&bigstore=2000`, `&ttbusy=1`); `--compare <build>` runs each scene on two
  builds and says whether both sent the same requests and drew the same
  page (3.16.4 beside 3.17.0: the same, but for the Ledger table's new
  wording).
- First numbers, on the owner's laptop slowed 4x with a 1.2 MB trader
  database (the harness, not the friend's machine): Torn Bids' redraw 538 ms
  each (longest 2.0 s), of which the page rebuild is 80 ms - the working out
  is the cost; 24 freezes in 14 s on Torn Bids; a bazaar scan 20-40 ms; the
  trade page scan 75 ms each; `traderDb` 20 ms a read and 53 ms a write.

**Part 3 A, first cut, is BUILT as 3.17.1** (the owner: "optimise now").
A profile showed storage reads were under 1% of Torn Bids' redraw, so steps
1 and 2 were left out as not worth a change; done: lazy favourites on a tie
(not in the plan - the profile found it), one collator for names, step 3
(`sellersOf` kept within a redraw), step 5 (a hidden Torn tab's panel waits
for the feed; the one-second ticker NOT yet), step 7 (the trade page's bar
found once a scan). Torn Bids' redraw 522 -> 378 ms each on the bench.
Still open in A: 4 (marks only where they differ), 6 (feed written only
when changed), 8, 9, and the ticker. What dominates now is
`buyersForItem` for every item every redraw (4.5 s of 12 s profiled) and
`indexW3bByItem` (1 s): that is Part 3 B, steps 11 and 14.

**Part 3 B, step 11, is BUILT as 3.18.0** (not released as this is
written): `src/core/kept-buyers.js`, proven by `test/kept-buyers.test.js`.
The friend's first speed log (3.17.1, 2026-10-03) said 788 ms a redraw on his
laptop, twice the bench. On the bench (4x, 40 s): 355 -> 189 ms each. What
is left, in order: `indexW3bByItem` rebuilt whole on every list read (step
14), the page rebuild (step 12), the shown list per item (favourites first,
online, trusted), `nextW3bTrader` walking every trader per read.

The rest of this file is the plan as written.

Written 2026-10-03, after 3.16.4. **Nothing below is built.** The owner said
"make the plan", then answered its questions (see "The owner's answers" at
the end) and handed the building to the session "Torn bids standby". Every code reference was read on 2026-10-03 at `a8e1cfe`;
re-verify each one before relying on it.

## What was said

- The friend: it lags on his laptop.
- The owner: "i think torn bids was optimised for my laptop... any ways to
  optimise latency etc?" Then: "we want it to still do its job, nothing
  compromised, just faster. same with my laptop, so whoever uses it in
  whatever laptop would be fine."
- The friend will not restart his laptop or change Windows settings to help
  us, and will not take screenshots of Chrome's task manager. The owner: "we
  should just have something here in settings that exports his logs (that
  also doesnt lag and will delete any unused memory) we can include it in the
  zip file he already gives us and his trades".

So three things are wanted:

1. **Faster, with nothing given up:** no fewer reads, no slower refresh, no
   feature dropped, the same look, on every laptop.
2. **The script collects its own evidence:** a speed log, kept cheaply, that
   rides in the zip he already sends - and his trades in that zip too.
3. **Stored data nobody uses is deleted** by the script itself.

## What we know about his laptop (his PC check, 2026-10-03)

ASUS Vivobook X1605ZA: i5-1235U (2 fast cores + 8 slow ones, a low-power
chip), 16 GB, NVMe SSD, Chrome 154 with **Tampermonkey and TornTools** in his
Torn profile, 12 Chrome tabs or frames, 17 days since a restart, Windows on
Balanced. During the 15 seconds measured his PC was idle (5% busy), so the
lag comes in bursts. Memory, disk and heat are ruled out.

The owner's laptop: i7-13650HX (6 fast cores), no TornTools. Every speed
number in this project was measured there. **The script has never been run
beside TornTools here.**

Not known: where it lags (Torn pages or the Torn Bids tab; typing, scrolling
or opening a page) and how big his stored data is. Part 1 exists to answer
that without asking him for anything new.

## What the code does today (read, not measured)

No speed is measured anywhere today. The only timings (`SCRIPT_START_MS`,
`app.panelShownAt`, `src/main.js`) show in a Tampermonkey menu on torn.com
and go into no zip.

### Stored data

- Every stored value is JSON text. `gmGet` (`src/platform/gm.js`) parses it
  again on **every call**; nothing keeps the parsed copy.
- The code's own notes say Tampermonkey hands every stored value to the
  script before it starts, on every page of all three sites
  (`src/platform/idb.js`, `storageSizes` in `main.js`).
- Only the Ledger rows live in IndexedDB. Everything else is a Tampermonkey
  value, including the largest: `traderDb` (every trader's price list -
  estimated 0.6 MB to several MB), `priceHistory` (~0.9 MB), `teLists`,
  `itemsCache`, `apiUsage`, `feed`. Sizes are estimates from the code's caps;
  his real sizes are unknown.
- Values rewritten whole on a short timer: `feed` and `feedLeader` every 3 s
  by the leading Torn tab, `apiUsage` every 10 s, `problemLog` and
  `sellPresence` 5 s after a change, `sellMoves` and `priceHistory` every
  30 s, `traderDb` every 60 s. Each write is told to every other tab that
  listens for it.

### The Torn Bids tab

- `renderSellingNow` (`main.js`) recomputes **everything** on every redraw:
  buyers for every item, a flip plan per item and buyer, the desk's trade for
  up to 12 traders. Nothing is kept between redraws except the "Your traders"
  scan (10 s) and three small indexes. `sellersOf` is not even kept within
  one redraw.
- One redraw makes about **40 storage reads, each a fresh parse**:
  `sellPriceRecords` four times, `sellBlacklist` four times, `ledgerKey` and
  `sellKey` four or five times each, the whole `w3bSummary` once.
- A redraw is asked for after every TornW3B read (60 a minute), so about
  **once a second** while the tab is in view.
- The page then rebuilds each changed section from nothing (`SellingPage`
  in `src/ui/selling-page.js`: `textContent = ''`, then every row again),
  roughly 800-1,200 elements (an estimate), and the sections' signatures
  change on almost every redraw.
- Each TornW3B request reads the shared rate window three times
  (`src/api/w3b.js`): about 9 storage reads plus 3 per other open tab, 60
  times a minute.

### Torn pages (the overlay)

- A rescan reads the **whole document** each time (`rescan`, `scanDom`,
  `readBazaarList`), with no "nothing changed" check. It runs every 2.5 s on
  market and bazaar pages, six times after every page change, and 400 ms
  after any change inside the watched rows.
- Our observer ignores only our own tags (`isOwnTagMutation`). **Every edit
  TornTools makes inside those rows starts a full rescan.**
- `markRows` (`src/ui/overlay.js`) clears and re-applies every mark on every
  rescan even when nothing changed - the one write of ours another extension
  would see every 2.5 s. Whether TornTools reacts to it is unknown (its code
  is not here).
- On the trade page two whole-document walks run every 2.5 s, even with no
  accepted trade (`showFillNote`, `showFillAll`).
- The leading Torn tab rewrites the shared `feed` every 3 s; **every other
  Torn tab, hidden ones too, recomputes and redraws its panel each time.**
  The panel's one-second ticker also runs while hidden or collapsed, and
  rebuilds part of the header every second.
- Every page load counts as a Scan: it empties the shared feed
  (`requestRefresh` from `onScan`) and the leading tab fetches it all again.
- On a bazaar page, and on any Torn page while a trade is accepted, the
  whole `traderDb` plus five TornExchange values are parsed again every 60 s
  to work out the trader tags (`trustedBuyerOf`).
- The panel refits itself on every size change of Torn's page, with no
  pause between (`ResizeObserver` in `src/ui/panel.js`).

### The file

1.39 MB, one file for all three sites, not minified: about 370 KB of
comments and 265 KB of indentation. The Torn Bids screens (about 280 KB) are
read by the browser on every Torn page although they never show there.

## Part 1 - the speed log (so we stop guessing)

A recorder inside the script. No new button: it goes into the two zips that
exist (Settings › Report a problem, Settings › API use › Export).

**What it records** - names, counts and milliseconds only; never an item, a
price, a key, a name or an id:

- Start-up: script start, panel shown, item data loaded.
- Each kind of work, per hour: how many times, total time, longest. Rescans
  (by page type and by what started them: the timer, the page change, the
  observer, another tab), panel redraws, Torn Bids' recompute and its page
  rebuild, storage reads and writes (per stored value: count, time, size).
- Freezes: every stretch the tab was stuck for 50 ms or more (the browser
  reports these itself), and every click or key press that took over 100 ms
  to show (also reported by the browser), by kind.
- The 50 slowest single events of the week, with what they were.
- How many changes inside the watched rows did not come from us, per minute
  (this is the TornTools question, answered without knowing its code).
- The machine: processor threads, memory class, screen, how many tabs of the
  script were open. All of it is what the browser already tells any page.
- Every stored value's size (the menu's list, completed - it misses 17).

**Why it will not lag:** it only adds two clock reads around work that is
already happening and bumps counters in memory. It writes to storage at most
once a minute and when a tab closes, merged across tabs the way `apiUsage`
is, capped at 7 days and a few KB.

**In the zip:** `speed/speed.txt` (readable, worst first) and
`speed/speed.json`.

**His trades in the zip:** `trades/` with the Ledger's finished trades and
receipts, the prices each accepted trade recorded (`sellPriceRecords`), and
his leftovers. This is also the outcome data the trainer plan asked for.
It changes what the zip promises: `report.txt` says today "No API key,
player id or name is in these files" - trades name the other traders.
The owner's answer 1: include the names.

## Part 2 - delete what is not used (automatic)

- Remove dead values: `npcManual` (read, never written), `tradersPage` (left
  by 3.7.0), the old `apiWindow` / `w3bWindow` arrays (still looked for on
  every page load), the old copy of the Ledger, removed fields kept inside
  `settings`.
- A housekeeping pass, in one tab, about once an hour: drop what has expired
  but is only removed on the next write today (`sellAccepted`,
  `sellCancelUndo`, `sellBought`, `sellLeftovers`, `sellPinned`, `teLists`
  past 30 minutes, `teCache` past a day, `opened`, the trade page's
  per-trade notes in sessionStorage).
- Per-tab rate-window values orphaned by a closed tab: the script cannot
  list its own values today (no `GM_listValues`). Either add that grant
  (check first whether Tampermonkey then asks him to approve the update) or
  reuse a small fixed set of slots so nothing can be orphaned.
- Nothing a feature reads is deleted. Each removal gets a test that the
  feature's output is the same before and after.

## Part 3 - the same work, cheaper

In the order to build them. Each step is measured before and after with the
speed log's own numbers on the harness (see "How we prove it").

**A. Waste that cannot change a result** (first release)

1. One redraw reads each stored value once and passes it along (about 40
   parses become about 15).
2. The TornW3B and Torn clients read the rate window once per request.
3. `sellersOf` kept within a redraw.
4. Marks are changed only where they differ; the owner badge's title too.
5. A hidden Torn tab does not recompute its panel on every feed write; it
   does it once when it comes back into view (Torn Bids already works this
   way). The one-second ticker stops while hidden.
6. The leading tab writes `feed` only when it changed.
7. The trade page's two document walks: leave at once when no trade is
   accepted; look only inside Torn's trade box otherwise.
8. sessionStorage is written only when its content changed.
9. The panel refits once per frame, not once per size change.

**B. Kept results, each proven equal to today's** (second release)

10. A parsed copy per stored value, reused until the stored text changes.
    Risk: code that edits what it read. Readers on hot paths move to a
    read-only call; tests freeze the copy so an edit fails loudly.
11. Torn Bids keeps each item's buyers and plans between redraws and redoes
    only the items whose inputs changed (that item's bazaar read, a price
    list, a setting). Proof: a test replays a long session and compares the
    kept result with a full recompute at every step.
12. The list updates the rows that changed instead of rebuilding the
    section. Proof: the page's elements are identical to a full rebuild.
13. A rescan first compares a cheap print of the rows (their text) with the
    last one and stops when nothing changed and no stored value it uses
    changed. Proof: the marks and the panel are identical with and without
    it on every harness page, TornTools-style rows included.
14. The overlay's trader tags read a small ready-made list ("best buyers per
    item") that is rewritten whenever `traderDb` is, instead of parsing the
    whole database every minute. Proof: identical tags on the same data.

**C. Only if the speed log says start-up is the problem**

15. Move the large Torn Bids-only values (`traderDb`, `teLists`, `teCache`,
    `apiUsage`, `sellMoves`) into IndexedDB beside the Ledger, so Torn pages
    stop loading them. Needs 14 first.
16. Strip comments and indentation from the released file with a real tool
    (the build has none today and a regex strip is unsafe - CSS lives in
    template strings). Keeps a readable copy; error lines in the problem log
    then need that copy to be read.

**Not in this plan, because it changes behaviour:** a page load emptying the
shared feed. It costs requests and a redraw in every tab on every page
change, but stopping it changes when data is fetched. See question 3.

## How we prove nothing is compromised

- **Same answers:** for every step, a test that runs the old path and the
  new path on the same input and compares the whole result.
- **Same requests:** a scripted harness session must send exactly the same
  requests in the same order before and after (the request log is already
  tagged for the API use tab).
- **Same look:** the harness pages' elements compared before and after at a
  fixed clock.
- **Faster:** a bench (`test/`) that drives the harness with the processor
  slowed four times (Chrome can do this itself), with TornTools-style rows
  (`&ttvalues=1`) and with large stored values, and prints the speed log.
  The numbers go in the commit message.
- `npm run check` green; nothing removed.

## Order

1. Part 1 + Part 2 + the bench, as one release. His next zip then says
   where his time goes.
2. Part 3 A.
3. Part 3 B, one step per commit, each with its proof.
4. Part 3 C only on the numbers.

## The owner's answers (2026-10-03)

1. **Trades in the zip: include the other traders' names and ids.** The
   zip's "No API key, player id or name is in these files" line and the
   README's data table must be changed to say so. Keys never go in. The
   speed log itself still holds no name, id, item or price.
2. **No new button.** The speed log and the trades ride in the two zips
   that exist.
3. **A page load emptying the shared feed: not answered.** It stays as it
   is today; it is not part of this plan.
4. **Release the speed log first** (Part 1 + Part 2 + the bench), before
   any of Part 3.
5. **"Wait on commits":** build and report to the owner; commit and push
   only when they say so. `HANDOFF.md`, the trainer's files and `mockups/`
   stay uncommitted as they are.

Said in the same message, not part of this plan: "the fill works. for bazar
fill all leave it" - Fill is confirmed working by the owner; no Fill all for
the bazaar page; the bazaar page stays as it is.
