/*
 * 3.16.1: an accepted trade that went through closes itself, after the
 * friend's second live report: the Checkout "still stays even though my
 * trade with this trader is already done", so he pressed Cancel trade - and
 * the Shrooms and Compasses KOMBAJN1 had already taken became leftovers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { finishedTradeFor, tradedLeftovers, removeLeftovers, itemsGiven, tradePartnerId, tradeFinishedAt, cancelledLeftovers, addLeftovers, recordBuy, TRADE_DONE_SLACK_MS } from '../src/core/accepted.js';
import { TeClient, fetchTeActiveTraderList, TE_ACTIVE_TIMEOUT_MS } from '../src/api/te.js';

const AT = 1_790_000_000_000;

// The friend's screenshot: Shrooms x71 and Compass x3 bought for KOMBAJN1, one step skipped.
const trade = () => {
    let t = {
        key: 'id:500',
        trader: { id: '500', name: 'KOMBAJN1' },
        itemId: '203',
        at: AT,
        items: [
            { line: 'flip:203', itemId: '203', name: 'Shrooms', units: 71, bid: 2141, kind: 'flip', sent: false, steps: [{ sellerId: '1', sellerName: 'SavageGrace', qty: 71, price: 1937, bought: false }] },
            { line: 'flip:9', itemId: '9', name: 'Compass', units: 3, bid: 16604, kind: 'flip', sent: false, steps: [{ sellerId: '2', sellerName: 'Stcr', qty: 3, price: 16372, bought: false }] },
            { line: 'flip:370', itemId: '370', name: 'Drug Pack', units: 1, bid: 4200000, kind: 'flip', sent: false, steps: [{ sellerId: '3', qty: 1, price: 4150000, bought: false }] },
        ],
    };
    t = recordBuy(t, 'flip:203', 0, 71, AT + 60_000);
    t = recordBuy(t, 'flip:9', 0, 3, AT + 70_000);
    t = recordBuy(t, 'flip:370', 0, 0, AT + 80_000);
    return t;
};

const SELF = '42';
// Torn's /v2/user/{id}/trade: both sides' items and money.
const fullTrade = (id, completedS, partner, gave, money = 201823) => ({
    id,
    completed_at: completedS,
    user: { id: 42, name: 'Me' },
    trader: { id: partner, name: 'Them' },
    items: [
        ...Object.entries(gave).map(([itemId, amount]) => ({ user_id: 42, type: 'Item', details: { id: Number(itemId), amount } })),
        { user_id: partner, type: 'Money', details: { amount: money } },
    ],
});

test('a finished trade: when, with whom, what you gave', () => {
    const f = fullTrade(9001, AT / 1000 + 600, 500, { 203: 71, 9: 3 });
    assert.equal(tradeFinishedAt(f), AT + 600_000);
    assert.equal(tradePartnerId(f, SELF), '500');
    assert.deepEqual(Object.fromEntries(itemsGiven(f, SELF)), { 203: 71, 9: 3 });
    // Their side (money) is not what you gave; without your id nothing is.
    assert.equal(itemsGiven(f, null).size, 0);
    assert.equal(tradePartnerId({ id: 1 }, SELF), null, 'Torn did not say who: unknown, never guessed');
    assert.equal(tradeFinishedAt({}), 0);
});

test('the friend\'s trade: finished with KOMBAJN1 after they accepted - it closes, nothing left over', () => {
    const t = trade();
    const f = { id: '9001', t: AT + 20 * 60_000, partnerId: '500', gave: { 203: 71, 9: 3 } };
    assert.equal(finishedTradeFor(t, [f]), f);
    assert.deepEqual(tradedLeftovers(t, new Map([['203', 71], ['9', 3]])), [], 'he took everything bought; the skipped Drug Pack was never bought');
});

test('only a trade with that trader, after they accepted, with the plan\'s items in it', () => {
    const t = trade();
    const other = { id: '1', t: AT + 60_000, partnerId: '777', gave: { 203: 71 } };
    const before = { id: '2', t: AT - TRADE_DONE_SLACK_MS - 1, partnerId: '500', gave: { 203: 71 } };
    const unrelated = { id: '3', t: AT + 60_000, partnerId: '500', gave: { 1: 5 } };
    const moneyOnly = { id: '4', t: AT + 60_000, partnerId: '500', gave: {} };
    assert.equal(finishedTradeFor(t, [other, before, unrelated, moneyOnly]), null);
    // Clocks differ a little: just before "accepted" still counts.
    const early = { id: '5', t: AT - TRADE_DONE_SLACK_MS + 1, partnerId: '500', gave: { 9: 3 } };
    assert.equal(finishedTradeFor(t, [early]), early);
    // No trader id (a TornExchange name never matched): nothing to match.
    assert.equal(finishedTradeFor({ ...t, trader: { id: null, name: 'x' } }, [early]), null);
    // Several: the earliest.
    const later = { ...early, id: '6', t: AT + 3_600_000 };
    assert.equal(finishedTradeFor(t, [later, early]).id, '5');
});

test('a cancelled trade: only one that finished before you cancelled is it', () => {
    const t = trade();
    const cancelAt = AT + 30 * 60_000;
    const before = { id: '1', t: AT + 20 * 60_000, partnerId: '500', gave: { 203: 71 } };
    const after = { id: '2', t: cancelAt + TRADE_DONE_SLACK_MS + 1, partnerId: '500', gave: { 203: 71 } };
    assert.equal(finishedTradeFor(t, [after], cancelAt + TRADE_DONE_SLACK_MS), null, 'a later trade with them is another trade');
    assert.equal(finishedTradeFor(t, [after, before], cancelAt + TRADE_DONE_SLACK_MS), before);
});

test('what they did not take stays yours: bought minus given, at what it cost', () => {
    const t = trade();
    const left = tradedLeftovers(t, new Map([['203', 60]]), AT + 1);
    assert.deepEqual(left, [
        { itemId: '203', name: 'Shrooms', qty: 11, each: 1937, from: 'KOMBAJN1', at: AT + 1 },
        { itemId: '9', name: 'Compass', qty: 3, each: 16372, from: 'KOMBAJN1', at: AT + 1 },
    ]);
    // 3.16.4: told when the trade finished, each says so - from then on what leaves your stock counts against it.
    assert.deepEqual(tradedLeftovers(t, new Map([['203', 60]]), AT + 1, AT - 5000).map((l) => l.since), [AT - 5000, AT - 5000]);
    // Unplanned buys count as bought; your own planned items went in first.
    const withExtra = { ...t, extra: [{ itemId: '203', name: 'Shrooms', qty: 9, price: 1900, bid: 2141 }, { itemId: '1', name: 'Hammer', qty: 2, price: 50, bid: 70 }, { itemId: '4', name: 'Rock', qty: 5, price: 10, bid: 0, fromLog: true }], items: [...t.items, { line: 'yours:9', itemId: '9', name: 'Compass', units: 1, kind: 'yours', steps: [] }] };
    const l2 = tradedLeftovers(withExtra, new Map([['203', 80], ['9', 4]]), AT + 1);
    assert.deepEqual(l2.map((l) => [l.itemId, l.qty]), [['1', 2]], 'Shrooms 71+9 all went, Compass 3 of 4 given were bought, the Hammer was never given; the Rocks they do not buy were not for this trade (3.16.4)');
});

test('Cancel trade on a trade that had gone through is put right: its leftovers come off again', () => {
    const t = trade();
    const earlier = [{ itemId: '203', name: 'Shrooms', qty: 10, each: 2000, from: 'X', at: AT - 1 }];
    const cancelLeft = cancelledLeftovers(t, AT + 5);
    const stored = addLeftovers(earlier, cancelLeft);
    assert.deepEqual(stored.map((l) => [l.itemId, l.qty]), [['203', 81], ['9', 3]]);
    const fixed = addLeftovers(removeLeftovers(stored, cancelLeft), tradedLeftovers(t, new Map([['203', 71], ['9', 3]])));
    // What was a leftover before the cancel stays: as many, at about its cost (rows merge, so to the dollar or two).
    assert.equal(fixed.length, 1);
    assert.equal(fixed[0].itemId, '203');
    assert.equal(fixed[0].qty, 10);
    assert.ok(Math.abs(fixed[0].each - 2000) <= 5, 'each ' + fixed[0].each);
    // Removing more than is there: the row goes, never below zero.
    assert.deepEqual(removeLeftovers([{ itemId: '1', qty: 2, each: 5 }], [{ itemId: '1', qty: 9, each: 5 }]), []);
});

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('TornExchange: every active trader is waited for longer than other calls (18 of 20 timed out at 30 s)', async () => {
    const seen = [];
    const te = new TeClient({ getKey: () => 'k', fetchImpl: async (url, opts) => (seen.push(opts), response(200, { status: 'success', data: { verbose: { a: { name: 'Bob', torn_id: 11 } } } })) });
    const { list } = await fetchTeActiveTraderList(te);
    assert.deepEqual(list, [{ id: '11', name: 'Bob', source: 'te' }]);
    assert.deepEqual(seen[0], { timeoutMs: TE_ACTIVE_TIMEOUT_MS });
    assert.ok(TE_ACTIVE_TIMEOUT_MS > 30000);

    let t = 1_000_000;
    const slow = new TeClient({ getKey: () => 'k', now: () => (t += 60000), fetchImpl: async (url, opts) => {
        seen.push(opts);
        throw new Error('Torn API request timed out.');
    } });
    await assert.rejects(fetchTeActiveTraderList(slow), (e) => /timed out/.test(e.message) && e.reason === 'no answer in 90 s');
    // Other calls keep the usual wait.
    await assert.rejects(slow.get('all_best_listings'), (e) => e.reason === 'no answer in 30 s');
    assert.equal(seen[2], undefined);
});

import { leftoversAfterSales, LEFTOVER_SALE_MARGIN_MS } from '../src/core/accepted.js';

test('3.16.2: a leftover you sold goes by itself ("binenta ko na to ah") - from your Ledger\'s sales', () => {
    const at = AT;
    const left = [{ itemId: '203', name: 'Shrooms', qty: 11, each: 1937, from: 'KOMBAJN1', at }, { itemId: '9', name: 'Compass', qty: 3, each: 16372, from: 'KOMBAJN1', at }];
    const later = at + LEFTOVER_SALE_MARGIN_MS + 60_000;
    // Sold 11 Shrooms on his bazaar and 2 Compasses on the Item Market.
    const rows = [
        { t: later, itemId: '203', qty: 11, side: 'sell', venue: 'bazaar' },
        { t: later + 1, itemId: '9', qty: 2, side: 'sell', venue: 'market' },
    ];
    const once = leftoversAfterSales(left, rows);
    assert.deepEqual(once.map((l) => [l.itemId, l.qty]), [['9', 1]]);
    // Read again: nothing counts twice.
    assert.deepEqual(leftoversAfterSales(once, rows), once);
    // A later sale of the last one: gone.
    assert.deepEqual(leftoversAfterSales(once, [...rows, { t: later + 5, itemId: '9', qty: 1, side: 'give', venue: 'trade' }]), []);
});

test('3.16.2: the trade it was left over from, and units bought again since, never take a leftover off', () => {
    const at = AT;
    const left = [{ itemId: '203', name: 'Shrooms', qty: 11, each: 1937, at }];
    // The trade that left it over finished just before (or, by Torn's clock, just after) it was kept.
    assert.deepEqual(leftoversAfterSales(left, [{ t: at - 30_000, itemId: '203', qty: 60, side: 'sell' }, { t: at + 60_000, itemId: '203', qty: 60, side: 'sell' }]), left);
    // Bought 71 more for another flip and traded those 71: the 11 are still yours.
    const later = at + LEFTOVER_SALE_MARGIN_MS + 1;
    const flip = [{ t: later, itemId: '203', qty: 71, side: 'buy' }, { t: later + 10, itemId: '203', qty: 71, side: 'sell' }];
    assert.deepEqual(leftoversAfterSales(left, flip).map((l) => l.qty), [11]);
    // Sold 80 in all after buying 71: 9 of the 11 went.
    const more = leftoversAfterSales(left, [...flip, { t: later + 20, itemId: '203', qty: 9, side: 'sell' }]);
    assert.deepEqual(more.map((l) => l.qty), [2]);
    // Another item's sales are not this one's; no rows, nothing changes.
    assert.deepEqual(leftoversAfterSales(left, [{ t: later, itemId: '9', qty: 5, side: 'sell' }]), left);
    assert.deepEqual(leftoversAfterSales(left, []), left);
});
