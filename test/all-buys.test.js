/*
 * 3.23.0, item 1 (the friend's zip, 2026-10-05; agreed with the owner the
 * same day): every buy the trader pays for joins the trade.
 *
 * FAFFO accepted Bottle of Champagne (181) at $3,100. One bought at $2,899 at
 * a bazaar other than the planned one was written down as "An extra buy kept
 * for To sell", not as a buy of the trade: on a bazaar page a buy was the
 * trade's only when its item was planned AT THAT bazaar, else by the lists
 * this browser had, while the read of your Torn log went by the trade's line
 * at any bazaar.
 *
 * One rule now, for the bazaar page, Next and the log read: the price the
 * trader accepted for the item in this trade, wherever it was to be bought;
 * else their list. And a buy is never in To sell and in the trade both.
 *
 * Namespace imports on purpose: a helper that is missing fails its own test,
 * not the whole file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as acc from '../src/core/accepted.js';

const NOW = 1_790_000_000_000;
const MIN = 60 * 1000;

const chosen = (id, name, flips, held = []) => ({ key: 'id:' + id, buyer: { id: String(id), name }, flips, held });
const flip = (itemId, name, bid, steps) => ({ itemId, name, bid, steps });
const step = (sellerId, qty, price) => ({ sellerId, sellerName: 'Seller ' + sellerId, qty, price });

/** FAFFO's trade: 50 Champagne planned at bazaar 500, 20 Xanax at bazaar 600. */
const faffo = (at = NOW - 10 * MIN) => acc.acceptTrade(chosen(9, 'FAFFO', [
    flip('181', 'Bottle of Champagne', 3100, [step('500', 50, 2950)]),
    flip('206', 'Xanax', 850000, [step('600', 20, 840000)]),
]), '181', at);

test('the Champagne case: a planned item bought at another bazaar joins the trade, at the price its trader accepted', () => {
    assert.equal(typeof acc.placeBuy, 'function');
    const t = faffo();
    // The lists this browser has say nothing of Champagne for FAFFO: the old rule left it out of the trade.
    const noList = () => 0;
    const r = acc.placeBuy([t], { sellerId: '777', itemId: '181', name: 'Bottle of Champagne', qty: 1, price: 2899 }, noList, NOW);
    assert.equal(r.where, 'trade');
    assert.equal(r.key, 'id:9');
    assert.equal(r.bid, 3100);
    assert.equal(r.by, 'accepted');
    assert.deepEqual([r.filled, r.extra], [0, 1]);
    assert.deepEqual(r.trade.extra.map((x) => [x.itemId, x.qty, x.price, x.bid, x.sellerId]), [['181', 1, 2899, 3100, '777']]);
    // So it is in Checkout, and Fill sends it.
    const b = acc.boughtSince(r.trade);
    assert.deepEqual(b.rows.map((x) => [x.name, x.qty, x.planned, x.profit]), [['Bottle of Champagne', 1, false, 201]]);
    assert.deepEqual(acc.sendList(r.trade).send, [{ itemId: '181', name: 'Bottle of Champagne', qty: 1 }]);
});

test('what a trade pays for an item: the price it accepted - for a flip or one of your own lines - else the trader\'s list, else nothing', () => {
    assert.equal(typeof acc.tradeBidOf, 'function');
    const t = acc.acceptTrade(chosen(9, 'FAFFO', [flip('181', 'Bottle of Champagne', 3100, [step('500', 50, 2950)])], [{ itemId: '384', name: 'Camel Plushie', units: 5, bid: 73500, each: 70000 }]), '181', NOW);
    assert.equal(acc.tradeBidOf(t, '181', () => 0), 3100);
    // The accepted price stands, whatever the list says now.
    assert.equal(acc.tradeBidOf(t, 181, () => 2500), 3100);
    // A To sell item of yours in the trade: they accepted a price for it too.
    assert.equal(acc.tradeBidOf(t, '384', () => 0), 73500);
    // Not in the trade: their list.
    assert.equal(acc.tradeBidOf(t, '206', (id) => (id === '206' ? 850000 : 0)), 850000);
    assert.equal(acc.tradeBidOf(t, '999', () => 0), 0);
    assert.equal(acc.tradeBidOf(t, '999'), 0);
    assert.equal(acc.tradeBidOf(null, '181', () => 5), 5);
    // A list that answers nonsense pays nothing.
    assert.equal(acc.tradeBidOf(t, '999', () => 'lots'), 0);
    assert.equal(acc.tradeBidOf(t, '999', () => -5), 0);
});

test('which trade a buy is for: the one that planned it at this bazaar, else the newest that accepted a price for the item, else the newest whose trader lists it', () => {
    assert.equal(typeof acc.tradeForBuy, 'function');
    const a = faffo(NOW - 30 * MIN);
    const b = acc.acceptTrade(chosen(11, 'Bob', [flip('181', 'Bottle of Champagne', 3050, [step('700', 10, 2900)])]), '181', NOW - 5 * MIN);
    const c = acc.acceptTrade(chosen(12, 'Alice', [flip('1', 'Hammer', 115, [step('800', 4, 50)])]), '1', NOW - MIN);
    const list = (t, id) => (t.key === 'id:12' && id === '335' ? 18000 : t.key === 'id:9' && id === '335' ? 17900 : 0);
    // Planned at this bazaar: that trade, though another accepted the item later.
    assert.equal(acc.tradeForBuy([a, b, c], { sellerId: '500', itemId: '181' }, list).key, 'id:9');
    // At a bazaar nobody planned: the newest trade that accepted a price for it.
    assert.equal(acc.tradeForBuy([a, b, c], { sellerId: '4242', itemId: '181' }, list).key, 'id:11');
    // In no trade: the newest whose trader's list pays for it.
    assert.equal(acc.tradeForBuy([a, b, c], { sellerId: '4242', itemId: '335' }, list).key, 'id:12');
    assert.equal(acc.tradeForBuy([a, b], { sellerId: '4242', itemId: '335' }, list).key, 'id:9');
    // Nobody pays for it: no trade (it is yours - To sell).
    assert.equal(acc.tradeForBuy([a, b, c], { sellerId: '4242', itemId: '999' }, list), null);
    assert.equal(acc.tradeForBuy([], { sellerId: '1', itemId: '181' }, list), null);
    assert.equal(acc.tradeForBuy(null, { sellerId: '1', itemId: '181' }), null);
});

test('a buy on a bazaar page goes to one place: the buying run, the trade, or To sell', () => {
    const t = faffo();
    const noList = () => 0;
    // The step here is still to buy: the buying run counts it at Next (never twice).
    const run = acc.placeBuy([t], { sellerId: '500', itemId: '181', name: 'Bottle of Champagne', qty: 5, price: 2950 }, noList, NOW);
    assert.equal(run.where, 'run');
    assert.equal(run.trade, null);
    // Nobody pays for it: yours, To sell.
    const mine = acc.placeBuy([t], { sellerId: '500', itemId: '999', name: 'Thing', qty: 2, price: 10 }, noList, NOW);
    assert.deepEqual([mine.where, mine.trade, mine.bid], ['tosell', null, 0]);
    // No trade accepted at all: To sell.
    assert.equal(acc.placeBuy([], { sellerId: '500', itemId: '181', qty: 1, price: 2899 }, noList, NOW).where, 'tosell');
    // Not in the plan, on the trader's list: the trade, at the list's price.
    const listed = acc.placeBuy([t], { sellerId: '500', itemId: '384', name: 'Camel Plushie', qty: 3, price: 70000 }, (tr, id) => (id === '384' ? 73500 : 0), NOW);
    assert.deepEqual([listed.where, listed.bid, listed.by, listed.extra], ['trade', 73500, 'list', 3]);
    // A buy that is nothing is nowhere.
    assert.equal(acc.placeBuy([t], { sellerId: '500', itemId: '181', qty: 0, price: 2950 }, noList, NOW).where, 'none');
    assert.equal(acc.placeBuy([t], null, noList, NOW).where, 'none');
});

test('a step already passed is filled first; what is over it is an unplanned buy of the same trade', () => {
    // Next was pressed at bazaar 500 with 10 of the 50 bought.
    const t = acc.recordBuy(faffo(), 'flip:181', 0, 10, NOW - 5 * MIN);
    const r = acc.placeBuy([t], { sellerId: '500', itemId: '181', name: 'Bottle of Champagne', qty: 60, price: 2950 }, () => 0, NOW);
    assert.equal(r.where, 'trade');
    assert.deepEqual([r.filled, r.extra, r.bid], [40, 20, 3100]);
    assert.equal(r.trade.items[0].steps[0].boughtQty, 50);
    assert.deepEqual(r.trade.extra.map((x) => [x.itemId, x.qty, x.sellerId]), [['181', 20, '500']]);
    // 70 Champagne in all: never counted twice, never lost.
    assert.equal(acc.sendList(r.trade).send.find((x) => x.itemId === '181').qty, 70);
});

test('your Torn log goes by the same rule: one of your own lines says what they pay, and a buy goes to the trade that pays for it', () => {
    const a = acc.acceptTrade(chosen(9, 'FAFFO', [flip('181', 'Bottle of Champagne', 3100, [step('500', 50, 2950)])], [{ itemId: '384', name: 'Camel Plushie', units: 5, bid: 73500, each: 70000 }]), '181', NOW - 30 * MIN);
    const b = acc.acceptTrade(chosen(11, 'Bob', [flip('1', 'Hammer', 110, [step('700', 4, 50)])]), '1', NOW - 20 * MIN);
    const buys = [
        { id: 'l1', t: NOW - 10 * MIN, itemId: '384', qty: 7, each: 70500, sellerId: '4242' },
        { id: 'l2', t: NOW - 9 * MIN, itemId: '181', qty: 2, each: 2899, sellerId: '777' },
        { id: 'l3', t: NOW - 8 * MIN, itemId: '999', qty: 1, each: 5, sellerId: '777' },
    ];
    // The newest trade used to take everything not planned at that seller: Bob's, who buys neither.
    const split = acc.splitLogBuys([a, b], buys, () => 0);
    assert.deepEqual(split.get('id:9').map((x) => x.id), ['l1', 'l2']);
    // What no trade pays for stays with the newest (left off its list, as before).
    assert.deepEqual(split.get('id:11').map((x) => x.id), ['l3']);
    const applied = acc.applyLogBuys(a, split.get('id:9'), { readTo: NOW, bidOf: () => 0 });
    assert.deepEqual(applied.extra.map((x) => [x.itemId, x.qty, x.bid]), [['384', 7, 73500], ['181', 2, 3100]]);
});

test('never in To sell and in the trade both: a buy your log puts in the trade comes off the To sell row the page made for it', () => {
    assert.equal(typeof acc.toSellLessTradeBuys, 'function');
    // The page kept 5 Camels for To sell (no list on this browser said FAFFO buys them)...
    const kept = acc.addLeftovers([], [{ itemId: '384', name: 'Camel Plushie', qty: 5, each: 70000, from: null, at: NOW - 5 * MIN, why: 'extra', buys: { 4242: 5 } }]);
    // ...and 3 more at another bazaar.
    const both = acc.addLeftovers(kept, [{ itemId: '384', name: 'Camel Plushie', qty: 3, each: 70000, from: null, at: NOW - 4 * MIN, why: 'extra', buys: { 5555: 3 } }]);
    assert.deepEqual(both.map((l) => [l.itemId, l.qty, l.buys]), [['384', 8, { 4242: 5, 5555: 3 }]]);
    // Then Torn Bids read your log, with FAFFO's list: the 5 from bazaar 4242 are the trade's.
    const t = { ...faffo(NOW - 30 * MIN), extra: [{ itemId: '384', name: 'Camel Plushie', qty: 5, price: 70000, bid: 73500, sellerId: '4242', at: NOW - 5 * MIN, fromLog: true }] };
    const after = acc.toSellLessTradeBuys(both, [t]);
    assert.deepEqual(after.map((l) => [l.itemId, l.qty, l.buys]), [['384', 3, { 5555: 3 }]]);
    // Done again, nothing more comes off.
    assert.deepEqual(acc.toSellLessTradeBuys(after, [t]), after);
    assert.equal(acc.toSellLessTradeBuys(after, [t]), after, 'the same list when nothing changes');
    // A buy the trade's trader does not pay for stays To sell; so does a row the page did not make.
    const unpaid = { ...t, extra: [{ ...t.extra[0], bid: 0 }] };
    assert.equal(acc.toSellLessTradeBuys(both, [unpaid]), both);
    const cancelled = [{ itemId: '384', name: 'Camel Plushie', qty: 5, each: 70000, from: 'Bob', at: NOW, why: 'cancel' }];
    assert.equal(acc.toSellLessTradeBuys(cancelled, [t]), cancelled);
    // The whole row taken: it goes.
    assert.deepEqual(acc.toSellLessTradeBuys(kept, [t]), []);
    // A buy from before they said yes is not this trade's.
    const old = acc.addLeftovers([], [{ itemId: '384', name: 'Camel Plushie', qty: 5, each: 70000, from: null, at: NOW - 60 * MIN, why: 'extra', buys: { 4242: 5 } }]);
    assert.equal(acc.toSellLessTradeBuys(old, [t]), old);
});

test('the same item listed twice at one bazaar: the card the buying run is not counting is a buy of the trade at once', () => {
    const t = faffo();
    const buy = { sellerId: '500', itemId: '181', name: 'Bottle of Champagne', qty: 4, price: 2990 };
    // The run counts the $2,950 card (Next); the $2,990 card beside it is nobody's to count - it was lost till the log was read.
    assert.equal(acc.placeBuy([t], buy, () => 0, NOW).where, 'run');
    const r = acc.placeBuy([t], buy, () => 0, NOW, false);
    assert.deepEqual([r.where, r.filled, r.extra, r.bid], ['trade', 0, 4, 3100]);
    // The step itself is untouched: Next still counts its own card.
    assert.equal(acc.pendingStepAt(r.trade, '500', '181'), true);
    assert.equal(acc.pendingStepAt(r.trade, '777', '181'), false);
});

test('the problem log says where each buy read from your Torn log lands, and why', () => {
    assert.equal(typeof acc.logBuyPlace, 'function');
    const t = faffo(NOW - 30 * MIN);
    const list = (tr, id) => (id === '384' ? 73500 : 0);
    const at = NOW - 5 * MIN;
    assert.deepEqual(acc.logBuyPlace([t], { t: at, itemId: '181', sellerId: '500', qty: 5 }, list), { where: 'step', key: 'id:9', bid: 3100, by: 'accepted' });
    assert.deepEqual(acc.logBuyPlace([t], { t: at, itemId: '181', sellerId: '777', qty: 1 }, list), { where: 'trade', key: 'id:9', bid: 3100, by: 'accepted' });
    assert.deepEqual(acc.logBuyPlace([t], { t: at, itemId: '384', sellerId: '777', qty: 1 }, list), { where: 'trade', key: 'id:9', bid: 73500, by: 'list' });
    assert.deepEqual(acc.logBuyPlace([t], { t: at, itemId: '999', sellerId: '777', qty: 1 }, list), { where: 'out', key: 'id:9', bid: 0, by: null });
    // Bought before they said yes: no trade's buy.
    assert.equal(acc.logBuyPlace([t], { t: NOW - 60 * MIN, itemId: '181', sellerId: '500', qty: 5 }, list).where, 'none');
    assert.equal(acc.logBuyPlace([], { t: at, itemId: '181', sellerId: '500', qty: 5 }, list).where, 'none');
});
