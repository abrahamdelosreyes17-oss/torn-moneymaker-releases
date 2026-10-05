/*
 * 3.16.4: what you bought comes off TornW3B's number, and leftover cards go
 * by themselves.
 *
 * The friend, 2026-10-02: he bought Xanax for one trader, traded it, and the
 * plan for the next trader still counted on the same listings ("ako bumili
 * pero sinusuggest parin sakin") - TornW3B checks a bazaar again about every
 * five minutes. And his Torn Bids was two dozen "Left over" cards for things
 * he no longer had, each with a Sold ✓ to press (the owner: "the sold cards
 * should update automatically, and it shouldn't take that long").
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkedSince, withOwnBuys, withoutGone, markGone, liveStock, noteStock, liveBought, addBought, bazaarSellers, pickBazaars, goneKey, SEEN_MARGIN_MS, OWN_KEEP_MS, STOCK_MAX, BOUGHT_MAX } from '../src/core/flips.js';
import { stepState, leftoversAfterSales, leftoverFrom, cancelledLeftovers, tradedLeftovers, addLeftovers, recordBuy, LEFTOVER_SALE_MARGIN_MS } from '../src/core/accepted.js';

const NOW = 1_790_000_000_000;
const MIN = 60_000;
const XANAX = '206';

// TornW3B's Xanax listings, each last checked two minutes ago.
const rows = (checked = NOW - 2 * MIN) => [
    { sellerId: '1', sellerName: 'Ann', price: 869000, qty: 80, dataAt: checked },
    { sellerId: '2', sellerName: 'Bo', price: 872500, qty: 100, dataAt: checked },
    { sellerId: '3', sellerName: 'Cy', price: 873000, qty: 5, dataAt: checked },
];
const buy = (id, sellerId, qty, t, each = 0, itemId = XANAX) => ({ id, sellerId, itemId, qty, each, t });

test('the friend\'s case: the listings he bought for trader 1 are not in the plan for trader 2', () => {
    // He bought all 80 at Ann's and 40 of Bo's 100, a minute ago; TornW3B has not checked since.
    const bought = [buy('a:0', '1', 80, NOW - MIN), buy('b:0', '2', 40, NOW - MIN)];
    const left = withOwnBuys(rows(), XANAX, { bought });
    assert.deepEqual(left.map((r) => [r.sellerId, r.qty]), [['2', 60], ['3', 5]], 'Ann\'s is gone, Bo has 60 left');
    // The plan is made from those: never a unit he already took.
    const plan = pickBazaars(bazaarSellers(left, { now: NOW }), 950000, { maxUnits: 200, maxStops: 5, minPct: 0 });
    assert.equal(plan.steps.some((s) => s.sellerId === '1'), false);
    assert.equal(plan.steps.find((s) => s.sellerId === '2').qty, 60);
    // Only that item at that bazaar ("yung item lang na yun"): another item's rows are as they were.
    const other = rows();
    assert.equal(withOwnBuys(other, '197', { bought }), other);
    // TornW3B's own rows are never changed.
    const raw = rows();
    withOwnBuys(raw, XANAX, { bought });
    assert.deepEqual(raw, rows());
});

test('until TornW3B has checked that bazaar since - with a margin, never to the second', () => {
    const bought = [buy('b:0', '2', 40, NOW - 10 * MIN)];
    // Checked well after the buy: its number already has it.
    assert.equal(withOwnBuys(rows(NOW - 2 * MIN), XANAX, { bought })[1].qty, 100);
    // Checked before the buy: 40 off.
    assert.equal(withOwnBuys(rows(NOW - 11 * MIN), XANAX, { bought })[1].qty, 60);
    // Checked within a minute after it: Torn's own API may still have answered with the old number.
    assert.equal(withOwnBuys(rows(NOW - 10 * MIN + SEEN_MARGIN_MS), XANAX, { bought })[1].qty, 60);
    assert.equal(withOwnBuys(rows(NOW - 10 * MIN + SEEN_MARGIN_MS + 1), XANAX, { bought })[1].qty, 100);
    // A row that does not say when it was checked: taken as not checked since.
    assert.equal(withOwnBuys([{ sellerId: '2', price: 872500, qty: 100, dataAt: null }], XANAX, { bought })[0].qty, 60);
    // More bought than TornW3B listed (it was behind already): gone, never below zero.
    assert.deepEqual(withOwnBuys(rows(NOW - 11 * MIN), XANAX, { bought: [buy('c:0', '3', 9, NOW - MIN)] }).map((r) => r.sellerId), ['1', '2']);
});

test('3.20.6, the friend again: TornW3B looked at the bazaar after his buy and saw no change - its number is still the old one', () => {
    // 2026-10-03: 177 Jaguar Plushies bought for one trade; two minutes later the next plan took only 89
    // off TornW3B's numbers and sent him to three bazaars that no longer had the listing. TornW3B had
    // "checked" those bazaars since (last_checked moved) without finding anything changed
    // (content_updated hours old): a check that did not see the buy.
    const H = 60 * MIN;
    const row = (checked, changed) => [{ sellerId: '2', sellerName: 'Bo', price: 13000, qty: 100, dataAt: checked, changedAt: changed }];
    const bought = [buy('b:0', '2', 100, NOW - 3 * MIN, 13000)];
    // Checked two minutes after the buy, the bazaar last seen to change 3 hours ago: the buy is not in that number.
    assert.deepEqual(withOwnBuys(row(NOW - MIN, NOW - 3 * H), XANAX, { bought }), [], 'the listing he emptied is not suggested again');
    assert.equal(withOwnBuys(row(NOW - MIN, NOW - 3 * H), XANAX, { bought: [buy('b:0', '2', 40, NOW - 3 * MIN, 13000)] })[0].qty, 60);
    // TornW3B found the bazaar changed after the buy: its number has it (60 left, or restocked to 500).
    const seen = [{ sellerId: '2', sellerName: 'Bo', price: 13000, qty: 60, dataAt: NOW - MIN, changedAt: NOW - MIN }];
    assert.equal(withOwnBuys(seen, XANAX, { bought: [buy('b:0', '2', 40, NOW - 3 * MIN, 13000)] }), seen);
    // A change it saw BEFORE the buy says nothing about the buy.
    assert.equal(withOwnBuys(row(NOW - MIN, NOW - 4 * MIN), XANAX, { bought: [buy('b:0', '2', 40, NOW - 3 * MIN, 13000)] })[0].qty, 60);
    // A row that does not say when the bazaar last changed: the check's time alone, as before.
    assert.equal(withOwnBuys(row(NOW - MIN, null), XANAX, { bought: [buy('b:0', '2', 40, NOW - 3 * MIN, 13000)] })[0].qty, 100);
    // What the page showed, and a listing the page showed is not there: the same rule.
    const stock = noteStock(null, '2', XANAX, 60, 13000, NOW - 3 * MIN);
    assert.equal(withOwnBuys(row(NOW - MIN, NOW - 3 * H), XANAX, { stock })[0].qty, 60);
    assert.equal(withOwnBuys(row(NOW - MIN, NOW - MIN), XANAX, { stock })[0].qty, 100);
    const gone = markGone(null, '2', XANAX, NOW - 3 * MIN);
    assert.deepEqual(withoutGone(row(NOW - MIN, NOW - 3 * H), XANAX, gone), [], 'still not there: TornW3B saw no change since you looked');
    assert.equal(withoutGone(row(NOW - MIN, NOW - MIN), XANAX, gone).length, 1, 'listed again: TornW3B saw the bazaar change after you looked');
    // The rule itself.
    assert.equal(checkedSince({ dataAt: NOW, changedAt: NOW }, NOW - 2 * MIN), true);
    assert.equal(checkedSince({ dataAt: NOW, changedAt: NOW - 3 * H }, NOW - 2 * MIN), false);
    assert.equal(checkedSince({ dataAt: NOW - 2 * MIN + SEEN_MARGIN_MS, changedAt: NOW - 2 * MIN + SEEN_MARGIN_MS }, NOW - 2 * MIN), false, 'within the margin');
    assert.equal(checkedSince({ dataAt: null, changedAt: NOW }, NOW - 2 * MIN), false);
});

test('what the page showed after your buy is the number - and no buy counts twice', () => {
    // Bo's card read 60 after he bought 40 (the overlay), a minute ago.
    const stock = noteStock(null, '2', XANAX, 60, 872500, NOW - MIN);
    assert.equal(withOwnBuys(rows(), XANAX, { stock })[1].qty, 60);
    // The same 40 in his Torn log (bought just before the page showed 60): not taken off again.
    const logged = [buy('b:0', '2', 40, NOW - MIN - 2000)];
    assert.equal(withOwnBuys(rows(), XANAX, { stock, bought: logged })[1].qty, 60);
    // Torn's clock a few seconds ahead of his: still the same buy.
    assert.equal(withOwnBuys(rows(), XANAX, { stock, bought: [buy('b:0', '2', 40, NOW - MIN + 5000)] })[1].qty, 60);
    // A buy clearly after that (the overlay off, from his phone): off what the page showed.
    const later = [...logged, buy('d:0', '2', 10, NOW - MIN + SEEN_MARGIN_MS + 1)];
    assert.equal(withOwnBuys(rows(NOW - 5 * MIN), XANAX, { stock, bought: later })[1].qty, 50);
    // TornW3B checked well after the page did, and says fewer still (others bought): its number.
    const fresh = [{ sellerId: '2', price: 872500, qty: 31, dataAt: NOW - MIN + SEEN_MARGIN_MS + 1 }];
    assert.equal(withOwnBuys(fresh, XANAX, { stock, bought: logged }), fresh);
    // ...or more (they stocked up): its number too, the page's is the older one.
    const restocked = [{ sellerId: '2', price: 872500, qty: 500, dataAt: NOW - MIN + SEEN_MARGIN_MS + 1 }];
    assert.equal(withOwnBuys(restocked, XANAX, { stock })[0].qty, 500);
    // The page never makes a listing bigger than TornW3B says.
    assert.equal(withOwnBuys(rows(), XANAX, { stock: noteStock(null, '3', XANAX, 400, 873000, NOW - MIN) })[2].qty, 5);
});

test('a gone mark and a buy on the same listing: gone once, nothing brought back', () => {
    const gone = markGone(null, '1', XANAX, NOW - MIN);
    const bought = [buy('a:0', '1', 80, NOW - MIN)];
    const left = withOwnBuys(withoutGone(rows(), XANAX, gone), XANAX, { bought });
    assert.deepEqual(left.map((r) => r.sellerId), ['2', '3']);
    assert.ok(left.every((r) => r.qty > 0));
});

test('a seller with two rows of the item: the one at the price you paid, else their cheapest', () => {
    const two = [
        { sellerId: '1', price: 100, qty: 10, dataAt: NOW - 2 * MIN },
        { sellerId: '1', price: 120, qty: 10, dataAt: NOW - 2 * MIN },
    ];
    assert.deepEqual(withOwnBuys(two, XANAX, { bought: [buy('a:0', '1', 4, NOW - MIN, 120)] }).map((r) => r.qty), [10, 6]);
    assert.deepEqual(withOwnBuys(two, XANAX, { bought: [buy('a:0', '1', 4, NOW - MIN, 999)] }).map((r) => r.qty), [6, 10]);
});

test('nothing to take off: the same list back, untouched', () => {
    const r = rows();
    assert.equal(withOwnBuys(r, XANAX, {}), r);
    assert.equal(withOwnBuys(r, XANAX, { stock: {}, bought: [] }), r);
    assert.equal(withOwnBuys(r, XANAX, { bought: [buy('z:0', '9', 5, NOW)] }), r, 'a seller TornW3B does not list');
    assert.equal(withOwnBuys(null, XANAX, { bought: [buy('a:0', '1', 1, NOW)] }), null);
    assert.deepEqual(withOwnBuys([], XANAX, { bought: [buy('a:0', '1', 1, NOW)] }), []);
});

test('the stores: half an hour, one per log line, junk left out', () => {
    // After 30 minutes a row not checked since is stale - never planned on - so nothing is left to take off.
    const s = noteStock(null, '2', XANAX, 60, 872500, NOW);
    assert.deepEqual(liveStock(s, NOW + OWN_KEEP_MS - 1), { [goneKey('2', XANAX)]: { qty: 60, price: 872500, at: NOW } });
    assert.deepEqual(liveStock(s, NOW + OWN_KEEP_MS), {});
    // Seen again: the newer number.
    assert.equal(noteStock(s, '2', XANAX, 20, 872500, NOW + MIN)[goneKey('2', XANAX)].qty, 20);
    // No stock is not a stock (that is a gone mark), no seller is nothing.
    assert.deepEqual(noteStock(null, '2', XANAX, 0, 1, NOW), {});
    assert.deepEqual(noteStock(null, '', XANAX, 5, 1, NOW), {});
    assert.deepEqual(liveStock([1, 2], NOW), {});
    assert.deepEqual(liveStock({ a: null, b: { qty: 'x', at: NOW } }, NOW), {});
    let many = null;
    for (let i = 0; i < STOCK_MAX + 20; i += 1) many = noteStock(many, String(i), '1', 5, 1, NOW + i);
    assert.equal(Object.keys(many).length, STOCK_MAX);

    // The log read and the Ledger both bring the same line: once.
    const a = buy('a:0', '1', 80, NOW - MIN, 869000);
    const b = addBought([a], [a, buy('b:0', '2', 40, NOW - 2 * MIN)], NOW);
    assert.deepEqual(b.map((x) => x.id), ['b:0', 'a:0'], 'oldest first');
    assert.deepEqual(addBought(b, [], NOW + OWN_KEEP_MS - MIN - 1).map((x) => x.id), ['a:0']);
    assert.deepEqual(addBought(b, [], NOW + OWN_KEEP_MS), []);
    assert.deepEqual(liveBought([null, { id: 'x' }, { id: 'y', sellerId: '1', itemId: '2', qty: 0, t: NOW }], NOW), []);
    assert.deepEqual(liveBought('junk', NOW), []);
    const lots = [];
    for (let i = 0; i < BOUGHT_MAX + 20; i += 1) lots.push(buy('n' + i + ':0', '1', 1, NOW - i));
    assert.equal(liveBought(lots, NOW).length, BOUGHT_MAX);
});

test('a step you took part of: "short" only when fewer are left than you still need', () => {
    const row = (qty) => [{ sellerId: '2', price: 872500, qty, dataAt: 5, stale: false }];
    const step = { sellerId: '2', qty: 80, price: 872500, bought: false };
    // He took 40 of the 80; the listing (100, less his 40) has 60: enough for the other 40.
    assert.equal(stepState({ ...step, boughtQty: 40 }, row(60)).state, 'ok');
    assert.equal(stepState({ ...step, boughtQty: 40 }, row(39)).state, 'short');
    // Nothing taken yet: as before.
    assert.equal(stepState(step, row(60)).state, 'short');
    assert.equal(stepState(step, row(80)).state, 'ok');
});

/* ------------------------------------------------- leftover cards go by themselves */

const AT = NOW - 14 * 60 * MIN;
const accepted = () => {
    let t = {
        key: 'id:500',
        trader: { id: '500', name: 'Picex' },
        itemId: '203',
        at: AT,
        items: [
            { line: 'flip:203', itemId: '203', name: 'Shrooms', units: 71, bid: 2141, kind: 'flip', sent: false, steps: [{ sellerId: '1', qty: 71, price: 1937, bought: false }] },
            { line: 'flip:9', itemId: '9', name: 'Compass', units: 3, bid: 16604, kind: 'flip', sent: false, steps: [{ sellerId: '2', qty: 3, price: 16372, bought: false }] },
        ],
    };
    t = recordBuy(t, 'flip:203', 0, 71, AT + MIN);
    t = recordBuy(t, 'flip:9', 0, 3, AT + 2 * MIN);
    return t;
};
const TRADED = AT + 20 * MIN;
// The Ledger's rows for it: the two buys, then the trade that took both.
const ledger = () => [
    { t: AT + MIN, itemId: '203', qty: 71, side: 'buy', venue: 'bazaar' },
    { t: AT + 2 * MIN, itemId: '9', qty: 3, side: 'buy', venue: 'bazaar' },
    { t: TRADED, itemId: '203', qty: 71, side: 'sell', venue: 'trade' },
    { t: TRADED, itemId: '9', qty: 3, side: 'sell', venue: 'trade' },
];

test('Cancel trade on a trade that went through hours ago: the cards go at the next Ledger read', () => {
    // His Checkout stayed with Torn Bids closed, so twelve hours on he pressed Cancel trade:
    // everything bought became a card - long past the 3 hours a cancel is put right in.
    const cards = cancelledLeftovers(accepted(), AT + 12 * 60 * MIN);
    assert.deepEqual(cards.map((l) => [l.itemId, l.qty, l.since]), [['203', 71, AT + 2 * MIN], ['9', 3, AT + 2 * MIN]], 'counted from his last buy for the trade');
    // The Ledger shows the trade taking them after that: he holds none. No Sold ✓ to press.
    assert.deepEqual(leftoversAfterSales(cards, ledger()), []);
    // Before 3.16.4 only sales five minutes AFTER the card counted - these never did.
    const before = cards.map(({ since, ...l }) => l);
    assert.equal(leftoversAfterSales(before, ledger()).length, 2);
    // Cancelled because the trader went away, nothing traded: the cards stay until he sells.
    const held = ledger().slice(0, 2);
    assert.deepEqual(leftoversAfterSales(cards, held), cards);
    assert.deepEqual(leftoversAfterSales(cards, [...held, { t: AT + 13 * 60 * MIN, itemId: '203', qty: 70, side: 'sell' }]).map((l) => [l.itemId, l.qty]), [['203', 1], ['9', 3]]);
    // No buy says when (ticked by hand): nothing said, the rule before stands.
    const ticked = accepted();
    ticked.items = ticked.items.map((i) => ({ ...i, steps: i.steps.map((st) => ({ ...st, boughtAt: null })) }));
    assert.equal('since' in cancelledLeftovers(ticked, AT + 30 * MIN)[0], false);
});

test('what they did not take, then passed on to another trader before the card was even made', () => {
    // Picex took 60 Shrooms; the other 11 went to a second trader a minute later; then the trade was seen finished.
    const rowsNow = [
        { t: AT + MIN, itemId: '203', qty: 71, side: 'buy' },
        { t: TRADED, itemId: '203', qty: 60, side: 'sell' },
        { t: TRADED + MIN, itemId: '203', qty: 11, side: 'give' },
    ];
    const cards = tradedLeftovers(accepted(), new Map([['203', 60], ['9', 3]]), TRADED + 2 * MIN, TRADED);
    assert.deepEqual(cards.map((l) => [l.itemId, l.qty, l.since]), [['203', 11, TRADED]]);
    assert.deepEqual(leftoversAfterSales(cards, rowsNow), []);
    // Still holding them: the card stays - the trade it was left over from never counts against it.
    assert.deepEqual(leftoversAfterSales(cards, rowsNow.slice(0, 2)), cards);
    const some = leftoversAfterSales(cards, [...rowsNow.slice(0, 2), { t: TRADED + 10 * MIN, itemId: '203', qty: 4, side: 'sell' }]);
    assert.deepEqual(some.map((l) => l.qty), [7]);
    // Read again: nothing counts twice.
    assert.deepEqual(leftoversAfterSales(some, [...rowsNow.slice(0, 2), { t: TRADED + 10 * MIN, itemId: '203', qty: 4, side: 'sell' }]), some);
});

test('his own units of the item went into the same trade: the card for what is left stays (review, 3.16.4)', () => {
    // 50 of his own Shrooms and the 71 bought were planned; the trader took 110: 11 bought ones are left.
    const t = accepted();
    t.items.push({ line: 'yours:203', itemId: '203', name: 'Shrooms', units: 50, kind: 'yours', steps: [] });
    const cards = tradedLeftovers(t, new Map([['203', 110], ['9', 3]]), TRADED + MIN, TRADED);
    assert.deepEqual(cards.map((l) => [l.itemId, l.qty]), [['203', 11]]);
    // The Ledger shows 71 in and 110 out since "accepted" - more out than in - and he still holds the 11.
    const rowsNow = [{ t: AT + MIN, itemId: '203', qty: 71, side: 'buy' }, { t: TRADED, itemId: '203', qty: 110, side: 'sell' }];
    assert.deepEqual(leftoversAfterSales(cards, rowsNow), cards);
    // What he held before, sold on his bazaar between the buys and the trade, is not the leftover going either.
    const sold = [rowsNow[0], { t: AT + 5 * MIN, itemId: '203', qty: 20, side: 'sell' }, rowsNow[1]];
    assert.deepEqual(leftoversAfterSales(cards, sold), cards);
});

test('bought again since: those are sold first, the leftover is still his', () => {
    const cards = tradedLeftovers(accepted(), new Map([['203', 60], ['9', 3]]), TRADED + MIN, TRADED);
    const flip = [{ t: TRADED + 20 * MIN, itemId: '203', qty: 50, side: 'buy' }, { t: TRADED + 30 * MIN, itemId: '203', qty: 50, side: 'sell' }];
    assert.equal(leftoversAfterSales(cards, flip)[0].qty, 11);
    assert.equal(leftoversAfterSales(cards, [...flip, { t: TRADED + 40 * MIN, itemId: '203', qty: 9, side: 'sell' }])[0].qty, 2);
});

test('a card kept before 3.16.4, or by Traded - done pressed by hand: as before', () => {
    const old = [{ itemId: '203', name: 'Shrooms', qty: 11, each: 1937, at: AT }];
    assert.deepEqual(leftoversAfterSales(old, [{ t: AT + MIN, itemId: '203', qty: 11, side: 'sell' }]), old, 'within five minutes of the card: the trade it came from, not a sale of it');
    assert.deepEqual(leftoversAfterSales(old, [{ t: AT + LEFTOVER_SALE_MARGIN_MS + 1, itemId: '203', qty: 11, side: 'sell' }]), []);
    assert.equal(leftoverFrom(old[0]), AT + LEFTOVER_SALE_MARGIN_MS);
    assert.equal(leftoverFrom({ at: AT, since: AT - 5 }), AT - 5);
});

test('two trades leave the same item: one row, counted from the later start', () => {
    const a = { itemId: '203', name: 'Shrooms', qty: 5, each: 1900, at: AT, since: AT - 5 * MIN };
    const b = { itemId: '203', name: 'Shrooms', qty: 6, each: 2000, at: AT + 30 * MIN, since: AT + 20 * MIN };
    const both = addLeftovers([a], [b]);
    assert.deepEqual([both[0].qty, both[0].since], [11, AT + 20 * MIN]);
    // The second trade's own buys and what it took (before its finish) never count against the row.
    const rowsNow = [{ t: AT + 10 * MIN, itemId: '203', qty: 40, side: 'buy' }, { t: AT + 20 * MIN, itemId: '203', qty: 34, side: 'sell' }];
    assert.deepEqual(leftoversAfterSales(both, rowsNow), both);
    // An old card and a new one: from the later of "five minutes after the old card" and the new one's start.
    const old = { itemId: '203', qty: 5, each: 1, at: AT };
    assert.equal(addLeftovers([old], [b])[0].since, AT + 20 * MIN);
    assert.equal(addLeftovers([{ ...old, at: AT + 60 * MIN }], [b])[0].since, AT + 60 * MIN + LEFTOVER_SALE_MARGIN_MS);
    // Two old ones: nothing said, as before.
    assert.equal('since' in addLeftovers([old], [{ ...old, at: AT + 1 }])[0], false);
});

/*
 * The friend's zip of 2026-10-05 23:04 (3.23.0). He cancelled a trade with
 * Grease_Monkey in Torn Bids, then sold the same bundle to Khawun by hand
 * (Torn receipt 7540751, 15:00:42 UTC: 2,352 Monkey Plushie, 513 Tribulus
 * Omanense). The Ledger had the sale; To sell kept Monkey Plushie 796 and
 * Tribulus 437, with `seenTo` at that sale and `spare` 0, also after Refresh.
 *
 * A row carried `spare` - what he bought again since it began counting - and
 * kept it when its start moved forward: an older row for the item counted
 * the new trade's buys as bought again, Cancel trade then put those same
 * units INTO the row (addLeftovers), and they stayed "spare" as well. A sale
 * was taken from that first, so it took nothing off the row and was marked
 * as seen. What was bought again is now worked out from the Ledger's rows
 * since the row's own start, each time.
 */
const ZIP_SINCE = 1791210045000; // 14:20:45 UTC, his last buy for the Grease_Monkey trade
const ZIP_CANCEL = 1791211869891; // 14:51:09
const ZIP_SALE = 1791212442000; // 15:00:42, receipt 7540751
const zipRows = () => [
    { t: 1791210034000, itemId: '269', qty: 52, side: 'buy', venue: 'bazaar' },
    { t: 1791210040000, itemId: '269', qty: 26, side: 'buy', venue: 'bazaar' },
    { t: ZIP_SINCE, itemId: '269', qty: 36, side: 'buy', venue: 'bazaar' },
    { t: ZIP_SALE, itemId: '269', qty: 2352, side: 'sell', venue: 'trade' },
    { t: ZIP_SALE, itemId: '385', qty: 513, side: 'sell', venue: 'trade' },
];

test('sold by hand after Cancel trade: the rows go, whatever "bought again" they carried (the zip of 2026-10-05)', () => {
    // The two rows as his leftovers.json has them, with the only carried count that leaves them as it does.
    const rows = [
        { itemId: '269', name: 'Monkey Plushie', qty: 796, each: 32090, from: 'Grease_Monkey', at: ZIP_CANCEL, why: 'cancel', since: ZIP_SINCE, spare: 2352, seenTo: ZIP_SINCE },
        { itemId: '385', name: 'Tribulus Omanense', qty: 437, each: 59993, from: 'Grease_Monkey', at: ZIP_CANCEL, why: 'cancel', since: ZIP_SINCE, spare: 513, seenTo: 1791210027000 },
    ];
    // Nothing was bought after the rows' start, so all of the sale is theirs: he holds none.
    assert.deepEqual(leftoversAfterSales(rows, zipRows()), []);
    // Not sold yet: the rows stay, the same objects (nothing to save).
    const held = leftoversAfterSales(rows, zipRows().slice(0, 3));
    assert.equal(held[0], rows[0]);
    assert.equal(held[1], rows[1]);
});

test('a new trade\'s buys, counted as bought again by an older row, then put into it by Cancel trade', () => {
    // An earlier cancelled trade left 722 Monkey Plushies (40 + 223 + 459, his log).
    const old = [{ itemId: '269', name: 'Monkey Plushie', qty: 722, each: 32246, from: 'Zer0CooL', at: 1791209628000, why: 'cancel', since: 1791208460000 }];
    // The Ledger reads the next trade's three buys: bought again, as far as the old row can tell.
    const seen = leftoversAfterSales(old, zipRows().slice(0, 3));
    assert.deepEqual([seen[0].qty, seen[0].spare, seen[0].seenTo], [722, 114, ZIP_SINCE]);
    // Cancel trade: those 114 join the row, which now counts from the last of those buys.
    const both = addLeftovers(seen, [{ itemId: '269', name: 'Monkey Plushie', qty: 114, each: 32047, from: 'Grease_Monkey', at: ZIP_CANCEL, why: 'cancel', since: ZIP_SINCE }]);
    assert.deepEqual([both[0].qty, both[0].since], [836, ZIP_SINCE]);
    // 150 sold on his bazaar: all 150 come off - the 114 are in the row, not beside it.
    const sale = { t: ZIP_SINCE + 10 * MIN, itemId: '269', qty: 150, side: 'sell', venue: 'bazaar' };
    const after = leftoversAfterSales(both, [...zipRows().slice(0, 3), sale]);
    assert.deepEqual([after[0].qty, after[0].spare, after[0].seenTo], [686, 0, sale.t]);
    // Read again: the sale counts once.
    assert.deepEqual(leftoversAfterSales(after, [...zipRows().slice(0, 3), sale]), after);
});

test('bought again, read in two goes: the same as read in one', () => {
    const cards = tradedLeftovers(accepted(), new Map([['203', 60], ['9', 3]]), TRADED + MIN, TRADED);
    const buy = { t: TRADED + 20 * MIN, itemId: '203', qty: 50, side: 'buy' };
    const sells = [{ t: TRADED + 30 * MIN, itemId: '203', qty: 30, side: 'sell' }, { t: TRADED + 40 * MIN, itemId: '203', qty: 29, side: 'sell' }];
    const first = leftoversAfterSales(cards, [buy, sells[0]]);
    assert.deepEqual([first[0].qty, first[0].spare], [11, 20]);
    // 29 more go: 20 of them bought again, 9 the leftover's.
    const second = leftoversAfterSales(first, [buy, ...sells]);
    assert.deepEqual([second[0].qty, second[0].spare], [2, 0]);
    assert.deepEqual(leftoversAfterSales(cards, [buy, ...sells]).map((l) => [l.qty, l.spare]), [[2, 0]]);
    // The row's start moves past the buy (a trade took some of it, core/to-sell.js afterYoursSent): what he held
    // before the start is not told apart from the row, bought again or not - the count kept from before is dropped.
    const moved = { ...first[0], since: TRADED + 35 * MIN };
    assert.deepEqual(leftoversAfterSales([moved], [buy, ...sells]), []);
});
