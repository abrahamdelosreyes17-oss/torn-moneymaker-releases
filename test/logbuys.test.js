/*
 * 3.16: buys confirmed from your Torn log (log 1225), after the friend's first
 * live run: 534 Red Fox Plushies and 362 Peony bought, none recorded, every
 * Next answered "Did not buy" by a quick second press.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyLogBuys, bazaarBuyRows, addLogBuys, splitLogBuys, sellElsewhere, boughtSince, checkoutList, recordBuy, cancelledLeftovers, leftoversOf, nextStep, sendUnits, LOG_BUY_SLACK_MS } from '../src/core/accepted.js';
import { rowsFromLog } from '../src/core/ledger.js';

const trade = () => ({
    key: 'id:77',
    trader: { id: '77', name: 'Foxy' },
    itemId: '268',
    at: 1_000_000,
    items: [
        { line: 'flip:268', itemId: '268', name: 'Red Fox Plushie', units: 534, bid: 31000, kind: 'flip', sent: false, steps: [
            { sellerId: '1', sellerName: 'Ann', qty: 200, price: 30000, bought: false },
            { sellerId: '2', sellerName: 'Bo', qty: 334, price: 30500, bought: false },
        ] },
    ],
});

const logEntry = (id, t, seller, itemId, qty, each) => ({ id, timestamp: t / 1000, details: { id: 1225 }, data: { seller, items: [{ id: itemId, qty }], cost_each: each, cost_total: each * qty } });
const buys = (...entries) => bazaarBuyRows(entries.flatMap(rowsFromLog));

test('log 1225 rows become bazaar buys: seller, item, how many, each', () => {
    const b = buys(logEntry('a', 1_100_000, 1, 268, 200, 30000));
    assert.deepEqual(b, [{ id: 'a:0', t: 1_100_000, itemId: '268', qty: 200, each: 30000, sellerId: '1' }]);
    // Sells and Item Market rows are not bazaar buys.
    assert.deepEqual(bazaarBuyRows([{ id: 'x', side: 'sell', venue: 'bazaar', qty: 1, itemId: '1', who: '2' }, { id: 'y', side: 'buy', venue: 'market', qty: 1, itemId: '1', who: '2' }]), []);
});

test('the friend\'s run: every Next said "Did not buy", the log says he bought it all - the log wins', () => {
    let t = recordBuy(trade(), 'flip:268', 0, 0, 1_050_000);
    t = recordBuy(t, 'flip:268', 1, 0, 1_060_000);
    assert.equal(nextStep(t), null, 'both steps "skipped" by the misclick');
    const b = buys(logEntry('a', 1_100_000, 1, 268, 200, 30000), logEntry('b', 1_200_000, 2, 268, 334, 30500));
    const got = applyLogBuys(t, b, { readTo: 1_300_000 });
    assert.deepEqual(got.items[0].steps.map((st) => [st.boughtQty, st.bought, st.skipped, st.logged]), [[200, true, false, true], [334, true, false, true]]);
    assert.equal(sendUnits(got.items[0]), 534);
    const bs = boughtSince(got);
    assert.equal(bs.rows.length, 1);
    assert.equal(bs.rows[0].qty, 534);
    assert.equal(bs.totals.cost, 200 * 30000 + 334 * 30500);
    const cart = checkoutList(got);
    assert.deepEqual(cart.lines.map((l) => l.state), ['done', 'done']);
    assert.equal(cart.finished, 2);
    // Cancelled now: all 534 are leftovers to sell elsewhere (before 3.16: none).
    assert.deepEqual(cancelledLeftovers(got, 5).map((l) => [l.itemId, l.qty]), [['268', 534]]);
});

test('applied twice, nothing changes (every page applies it on read)', () => {
    const b = buys(logEntry('a', 1_100_000, 1, 268, 150, 29000), logEntry('c', 1_150_000, 9, 1, 3, 500));
    const o = { readTo: 1_300_000, bidOf: () => 700, nameOf: () => 'Hammer' };
    const once = applyLogBuys(trade(), b, o);
    assert.deepEqual(applyLogBuys(once, b, o), once);
});

test('fewer than planned: bought what the log says, at what was paid; the plan price is kept', () => {
    const got = applyLogBuys(trade(), buys(logEntry('a', 1_100_000, 1, 268, 150, 29000)), { readTo: 1_300_000 });
    const st = got.items[0].steps[0];
    assert.deepEqual([st.boughtQty, st.bought, st.price, st.planned], [150, false, 29000, 30000]);
    assert.equal(checkoutList(got).lines[0].state, 'part');
    assert.equal(got.items[0].steps[1].bought, false, 'the other seller: still to buy');
    assert.equal(nextStep(got).index, 1);
});

test('more than planned, the item elsewhere, and other items: unplanned buys, with what the trader pays', () => {
    const b = buys(
        logEntry('a', 1_100_000, 1, 268, 250, 30000), // 50 more than planned from Ann
        logEntry('b', 1_110_000, 5, 268, 10, 30200), // from a seller not in the plan
        logEntry('c', 1_120_000, 6, 263, 362, 54400), // Peony, not in the plan
    );
    const got = applyLogBuys(trade(), b, { readTo: 1_300_000, bidOf: (id) => (id === '263' ? 56000 : 0), nameOf: (id) => (id === '263' ? 'Peony' : null) });
    assert.deepEqual(got.extra.map((x) => [x.name, x.qty, x.bid, x.sellerId, x.fromLog]), [
        ['Red Fox Plushie', 50, 31000, '1', true],
        ['Red Fox Plushie', 10, 31000, '5', true],
        ['Peony', 362, 56000, '6', true],
    ]);
    assert.equal(got.extra[0].seller, 'Ann', 'a seller the plan knows is named');
    assert.deepEqual(boughtSince(got).rows.map((r) => [r.name, r.qty, r.planned]), [
        ['Red Fox Plushie', 200, true],
        ['Red Fox Plushie', 50, false],
        ['Red Fox Plushie', 10, false],
        ['Peony', 362, false],
    ]);
});

test('a buy before "accepted" is not this trade\'s; within a minute (clocks) it is', () => {
    const t = trade();
    const early = buys(logEntry('a', t.at - LOG_BUY_SLACK_MS - 1000, 1, 268, 200, 30000));
    assert.equal(applyLogBuys(t, early, { readTo: 0 }), t, 'nothing to apply, no read time: the same trade');
    const close = buys(logEntry('a', t.at - 30000, 1, 268, 200, 30000));
    assert.equal(applyLogBuys(t, close, {}).items[0].steps[0].bought, true);
});

test('unplanned buys the page counted: dropped once the log has read past them, kept after', () => {
    const t = { ...trade(), extra: [
        { itemId: '1', name: 'Hammer', qty: 2, price: 50, bid: 70, at: 1_100_000 },
        { itemId: '2', name: 'Dahlia', qty: 1, price: 900, bid: 950, at: 1_400_000 },
    ] };
    const got = applyLogBuys(t, [], { readTo: 1_300_000 });
    assert.deepEqual(got.extra.map((x) => x.name), ['Dahlia'], 'Hammer: the log read to 1,300,000 has no such buy');
    assert.equal(got.logTo, 1_300_000);
});

test('a step counted on the page after the log\'s read is left as counted (the log has not reached it)', () => {
    const t = recordBuy(trade(), 'flip:268', 0, 200, 1_350_000);
    assert.equal(applyLogBuys(t, [], { readTo: 1_300_000 }).items[0].steps[0].boughtQty, 200);
});

test('"Bought 200" at Ann\'s, but the log - read past it - has no buy from Ann: not bought (never 400 counted)', () => {
    const t = recordBuy(trade(), 'flip:268', 0, 200, 1_250_000);
    const b = buys(logEntry('x', 1_240_000, 5, 268, 200, 30100)); // bought from seller 5 instead
    const got = applyLogBuys(t, b, { readTo: 1_300_000 });
    assert.deepEqual([got.items[0].steps[0].boughtQty, got.items[0].steps[0].skipped, got.items[0].steps[0].notInLog], [0, true, true]);
    assert.deepEqual(got.extra.map((x) => [x.sellerId, x.qty]), [['5', 200]]);
    assert.equal(boughtSince(got).rows.reduce((a, r) => a + r.qty, 0), 200);
    assert.deepEqual(applyLogBuys(got, b, { readTo: 1_300_000 }), got, 'and it stays that way');
    // A tick by hand in Torn Bids has no time: never undone by the log.
    const ticked = { ...trade(), items: [{ ...trade().items[0], steps: [{ ...trade().items[0].steps[0], bought: true }, trade().items[0].steps[1]] }] };
    assert.equal(applyLogBuys(ticked, [], { readTo: 1_300_000 }).items[0].steps[0].bought, true);
});

test('an older trade the stored log no longer reaches back to is left exactly as saved', () => {
    const t = { ...trade(), extra: [{ itemId: '1', name: 'Hammer', qty: 2, price: 50, bid: 70, at: 1_100_000, fromLog: true }, { itemId: '2', name: 'Dahlia', qty: 1, price: 900, bid: 950, at: 1_050_000 }] };
    assert.equal(applyLogBuys(t, [], { readFrom: 5_000_000, readTo: 9_000_000 }), t);
});

import { addExtraBuy } from '../src/core/accepted.js';

test('a buy counted on the page never merges into a row from the log (the next read would take it away)', () => {
    const got = applyLogBuys(trade(), buys(logEntry('c', 1_120_000, 6, 1, 3, 500)), { readTo: 1_130_000, bidOf: () => 700, nameOf: () => 'Hammer' });
    const more = addExtraBuy(got, { itemId: '1', name: 'Hammer', qty: 2, price: 500, bid: 700, sellerId: '6' }, 1_200_000);
    assert.deepEqual(more.extra.map((x) => [x.qty, Boolean(x.fromLog)]), [[3, true], [2, false]]);
    const again = applyLogBuys(more, buys(logEntry('c', 1_120_000, 6, 1, 3, 500)), { readTo: 1_130_000, bidOf: () => 700, nameOf: () => 'Hammer' });
    assert.equal(again.extra.reduce((a, x) => a + x.qty, 0), 5, 'the page\'s 2 (after the read) are kept');
});

test('two accepted trades: a buy counts once - planned seller first, else the newest trade before it', () => {
    const a = trade();
    const b = { ...trade(), key: 'id:88', trader: { id: '88', name: 'Late' }, at: 1_150_000, items: [{ line: 'flip:1', itemId: '1', name: 'Hammer', units: 3, bid: 70, kind: 'flip', steps: [{ sellerId: '9', qty: 3, price: 50, bought: false }] }] };
    const list = buys(logEntry('p', 1_200_000, 1, 268, 200, 30000), logEntry('q', 1_210_000, 9, 1, 3, 50), logEntry('r', 1_220_000, 4, 263, 1, 1), logEntry('s', 1_050_000, 4, 263, 1, 1));
    const split = splitLogBuys([a, b], list);
    assert.deepEqual(split.get('id:77').map((x) => x.id), ['p:0', 's:0'], 'Plushie from Ann: planned in A; the Peony at 1,050,000: only A was accepted then');
    assert.deepEqual(split.get('id:88').map((x) => x.id), ['q:0', 'r:0']);
});

test('stored log buys: one per line, only since the oldest trade', () => {
    const one = buys(logEntry('a', 1_100_000, 1, 268, 2, 1));
    const both = addLogBuys(one, [...one, ...buys(logEntry('b', 900_000, 1, 268, 2, 1))], 1_000_000);
    assert.deepEqual(both.map((x) => x.id), ['a:0']);
});

test('the trade page: what is in the trade is shared out - one count never ticks two rows', () => {
    const got = applyLogBuys(trade(), buys(logEntry('a', 1_100_000, 1, 268, 250, 30000)), { readTo: 1_300_000 });
    const inside = new Map([['red fox plushie', 200]]);
    const bs = boughtSince(got, { inside });
    assert.deepEqual(bs.rows.map((r) => [r.planned, r.send, r.inTrade]), [[true, 200, 200], [false, 50, 0]]);
    assert.deepEqual(bs.missing, [{ name: 'Red Fox Plushie', qty: 50 }]);
    const cart = checkoutList(got, { inside });
    assert.deepEqual(cart.lines.map((l) => [l.state, l.inTrade]), [['done', 200], ['todo', undefined]]);
});

test('sell what you are holding: each bought item with its best OTHER buyer', () => {
    const got = applyLogBuys(trade(), buys(logEntry('a', 1_100_000, 1, 268, 200, 30000), logEntry('c', 1_120_000, 6, 263, 362, 54400)), { readTo: 1_300_000, nameOf: () => 'Peony' });
    const buyers = { 268: [{ id: '77', name: 'Foxy', price: 31000 }, { id: '5', name: 'Next', price: 30800 }], 263: [] };
    const s = sellElsewhere(got, (id) => buyers[id]);
    // 3.16.4: the Peony was not for this trade (Foxy does not buy it) - it is no leftover of it.
    assert.deepEqual(s.map((l) => [l.name, l.qty, l.best && l.best.name, l.gain]), [['Red Fox Plushie', 200, 'Next', 200 * 800]]);
    // One Foxy pays for is.
    const paid = applyLogBuys(trade(), buys(logEntry('c', 1_120_000, 6, 263, 362, 54400)), { readTo: 1_300_000, nameOf: () => 'Peony', bidOf: () => 55000 });
    assert.deepEqual(sellElsewhere(paid, () => []).map((l) => [l.name, l.qty, l.best]), [['Peony', 362, null]]);
});

test('3.16.4: a buy this trader does not pay for was not for the trade - never a leftover of it', () => {
    // The friend's Torn Bids, 2026-10-02: two dozen "Left over" cards. Every bazaar buy in his log
    // while a trade was accepted had been attached to it, and became a card when it closed.
    const t = { ...trade(), extra: [{ itemId: '263', name: 'Peony', qty: 362, price: 54400, bid: 0, at: 5, fromLog: true }, { itemId: '1', name: 'Hammer', qty: 2, price: 50, bid: 70, at: 5 }] };
    assert.deepEqual(leftoversOf(t, 9), [], 'Traded - done: what they pay for went into the trade');
    assert.deepEqual(cancelledLeftovers(t, 9).map((l) => [l.name, l.qty, l.each]), [['Hammer', 2, 50]], 'Cancel trade: only what was bought for them');
});
