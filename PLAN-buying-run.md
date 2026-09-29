# Plan: the buying run on real pages (for a session after the mini-AI one)

Written 2026-09-29 at the owner's request ("consolidate all, and create a
plan for next session"), after the friend's first live report on 3.15.1.
Nothing here is built. Restate it to the owner and get their order before
building; mockups before anything changes the look; a failing test before
each fix; check it in the harness, then on the owner's real pages (read
only - pages the owner opens).

## What the friend hit (3.15.1, 2026-09-29 23:00-23:21)

From his Report a problem zip (report.txt, problem-log.txt, a Ledger
screenshot) and the owner's messages:

1. **"A trader went offline and now I'm stuck with these items with no flip
   plan for them"** - expected "a flip plan for the item if ever the trader
   that I bought these items for went offline".
2. **The Checkout list can't be scrolled** (the owner).
3. **It doesn't check whether he already put the bought items in the trade**
   (the owner, twice).
4. **It doesn't show the extra items he bought while buying the list** (the
   owner).
5. **The report form kept his text, screenshot and log after Download** - he
   had to clear the log by hand (the owner).

What the log and screenshot show: he accepted a Red Fox Plushie trade
(23:12:44), pressed Next bazaar ~14 times in 23:13-23:14, each followed 1-2 s
later by "Next bazaar (said: did not buy)"; his Ledger shows he bought
**534 Red Fox Plushie** (4 bazaars, ~$16.4M) and **362 Peony** (~$19.7M) in
exactly that window.

## One root cause behind 1-4

**The script never knew what he bought.** On the real bazaar page it did not
recognise the listing (the card markup was never read live - `buyStepHere`,
the stock scan behind `boughtFromStock` / `stockBuys`), so each Next asked
"Did you buy N?" - and the question's buttons appear where the Next button
was, so a quick second press answered "Did not buy". Nothing recorded, so:
Checkout and Bought stayed empty (4), the trade-page checklist had nothing to
check (3), Cancel trade kept no leftovers, and Torn Bids does not know he
holds the items until his inventory is read (hourly, and Torn caches it about
an hour) - and even then items you hold are not in trade plans (main.js
`held: []` since 3.14; only "Where to sell" on that item's desk) (1).

Also in the zip, not bugs: "Torn API 21: Incorrect category" is the expected
inventory fallback (`isCategoryError`) logged as an error by the clients'
`onFailed`; one TornExchange timeout. API use that hour was healthy (Torn
~4-5 a minute, TornW3B ~9, TornExchange ~1).

## The work, in the proposed order

1. **Ship the report reset (5)** - written, tested in no browser yet: after
   Download report the text boxes, screenshots and log are cleared, with
   "Download it again" (the zip kept in memory). The change (41 lines, in
   `ReportView.download` + a new `saveZip`) was taken back out of the
   working tree on 2026-09-29 so nothing untested gets committed by
   accident; redo it from this description. Also: don't log the inventory
   category fallback (code 21 while `fetchInventory` tries categories) as an
   error.
2. **Confirm buys from the Ledger (fixes 3, 4 and most of 1).** Torn's log
   1225 "Bazaar buy" gives `{seller, items: [{id, qty}], cost_each}` - enough
   to match every buy after "X accepted" to the plan: planned steps tick off
   (To buy, Bought, leftovers, the trade checklist), everything else is an
   unplanned buy. Independent of reading the bazaar page or of what was
   pressed. **Decision for the owner:** the Ledger (Full key) runs only in
   Torn Bids and only while that tab is visible, and during a buying run the
   player is on Torn's pages. Options: (a) while a trade is accepted, let
   Torn Bids read the log in the background (about once a minute, the low
   lane) - a change to the "Torn API calls only in view" rule; (b) read it
   when Torn Bids is next opened (slow); (c) check whether the overlay's own
   key may read the log (Torn's docs; the Full key itself is never in the
   overlay - an earlier rule). The player needs a Ledger (Full) key saved;
   the friend has one.
3. **The "Did you buy?" misclick (part of 1).** The question must never appear
   under the pointer where Next was: move it, or ignore a press within about
   a second of it appearing. With (2) in place the question is rarely needed.
4. **The Checkout window fits the screen (2).** It is fixed to the screen with
   no height limit. Cap it at the screen's height with the list scrolling
   inside it (the owner dislikes inner scrollbars - say why there is no
   other way for a pinned window), and fold finished rows into one line
   ("✓ 5 bought"). Check at his screen size (1536x960) with 10 extras.
5. **The trade-page check (3).** Beyond (2): `readTradeView`
   (src/sources/dom/trade.js - `.trade-cont`, `.user.left/.right`,
   `ul.cont > li.color2 ul.desc > li .name`) was never verified on Torn's real
   trade page. Also show "in the trade ✓ / add N" on the To buy rows, not
   only in Bought.
6. **Read a real bazaar page and a real trade page with the owner** - they
   open them in the Claude tab group, the session only reads (Torn's rules:
   no automated navigation or clicks). Fix the card detection (listing mark,
   stock, Buy / Fill boxes) from the real markup; save a scrubbed copy as a
   harness fixture only with the owner's OK.
7. **"Sell what you're holding" (1).** When the trader drops out (offline,
   declines, Cancel trade): from Checkout, one press to plan the items you
   bought with the next-best trader - bought quantities from (2), not
   waiting for the inventory; items you hold back in trade plans (re-enable
   the "Yours" rows, `held: []` in main.js). Mockups first.
8. **Unplanned buys the trader does not buy (4):** left off today (the
   owner's 3.14.3 rule). Ask whether to show them too, greyed, so nothing
   bought is invisible.

## Questions to ask the owner first

- The order above, or another?
- Ledger in the background during an accepted trade (2a) - OK?
- Unplanned buys the trader does not take: show them (greyed) or keep them
  off (8)?
- A scrolling Checkout list (4) - OK, given no other way?
