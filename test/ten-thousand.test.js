/*
 * 3.23.0, items 2 and 3 (the friend's zip, 2026-10-05; the owner the same
 * day).
 *
 * 2. "the 10k limit is per trade": a count of units - planned, unplanned and
 *    your To sell lines together. The plan, Add all and Fill all stop at it;
 *    Checkout counts as you buy and says when the trade is full. What goes
 *    over waits in To sell under that trader, for a second trade with them
 *    ("yes can go to sell").
 * 3. "when I click show all items on the flip plan it doesn't really follow
 *    the cash for flip limit": the left-out list is walked best first against
 *    the cash left, what the trader can pay and the 10,000; what does not fit
 *    is hidden, with how many ("yes do that").
 *
 * Namespace imports on purpose: a helper that is missing fails its own test,
 * not the whole file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as acc from '../src/core/accepted.js';
import * as trade from '../src/core/trade.js';
import * as held from '../src/core/held.js';
import * as toSell from '../src/core/to-sell.js';

const NOW = 1_790_000_000_000;
const MIN = 60 * 1000;
const s = (price, qty, who = 'S' + price) => ({ sellerId: who, sellerName: who, price, qty, stale: false });
const chosen = (id, name, flips, heldRows = []) => ({ key: 'id:' + id, buyer: { id: String(id), name }, flips, held: heldRows });
const fast = () => 'fast';

/** FAFFO accepted 6,000 Champagne and 3,000 Peony; both bought as planned. */
function boughtTrade() {
    let t = acc.acceptTrade(chosen(9, 'FAFFO', [
        { itemId: '181', name: 'Bottle of Champagne', bid: 3100, steps: [{ sellerId: '500', sellerName: 'A', qty: 6000, price: 2950 }] },
        { itemId: '271', name: 'Peony', bid: 5200, steps: [{ sellerId: '600', sellerName: 'B', qty: 3000, price: 5000 }] },
    ]), '181', NOW - 30 * MIN);
    t = acc.recordBuy(t, 'flip:181', 0, 6000, NOW - 20 * MIN);
    t = acc.recordBuy(t, 'flip:271', 0, 3000, NOW - 19 * MIN);
    return t;
}

test('10,000 items per trade: the count is every unit of the trade - planned, unplanned and your own lines together', () => {
    assert.equal(acc.TRADE_MAX_UNITS, 10000);
    assert.equal(typeof acc.tradeCount, 'function');
    const t = boughtTrade();
    assert.deepEqual(pick(acc.tradeCount(t)), { max: 10000, units: 9000, room: 1000, full: false, over: 0, toBuy: 0 });
    // An unplanned buy counts.
    const more = acc.addExtraBuy(t, { itemId: '384', name: 'Camel Plushie', qty: 600, price: 70000, bid: 73500, sellerId: '700' }, NOW - 10 * MIN);
    assert.deepEqual(pick(acc.tradeCount(more)), { max: 10000, units: 9600, room: 400, full: false, over: 0, toBuy: 0 });
    // One the trader does not pay for is not in the trade, and not in its count.
    const unpaid = acc.addExtraBuy(more, { itemId: '999', name: 'Thing', qty: 5000, price: 5, bid: 0, sellerId: '700' }, NOW - 9 * MIN);
    assert.equal(acc.tradeCount(unpaid).units, 9600);
    // What is still to buy is said apart: it is not in the trade yet.
    const half = acc.acceptTrade(chosen(9, 'FAFFO', [{ itemId: '181', name: 'Bottle of Champagne', bid: 3100, steps: [{ sellerId: '500', sellerName: 'A', qty: 6000, price: 2950 }, { sellerId: '501', sellerName: 'C', qty: 700, price: 2960 }] }]), '181', NOW);
    assert.deepEqual(pick(acc.tradeCount(acc.recordBuy(half, 'flip:181', 0, 6000, NOW))), { max: 10000, units: 6000, room: 4000, full: false, over: 0, toBuy: 700 });
    // Before anything is bought: nothing in it.
    assert.deepEqual(pick(acc.tradeCount(half)), { max: 10000, units: 0, room: 10000, full: false, over: 0, toBuy: 6700 });
    assert.deepEqual(pick(acc.tradeCount(null)), { max: 10000, units: 0, room: 10000, full: false, over: 0, toBuy: 0 });
});

const pick = (c) => ({ max: c.max, units: c.units, room: c.room, full: c.full, over: c.over, toBuy: c.toBuy });

test('a full trade: Fill all stops at 10,000, in the order you bought, and what is over is named', () => {
    let t = boughtTrade();
    t = acc.addExtraBuy(t, { itemId: '384', name: 'Camel Plushie', qty: 600, price: 70000, bid: 73500, sellerId: '700' }, NOW - 10 * MIN);
    t = acc.addExtraBuy(t, { itemId: '258', name: 'Jaguar Plushie', qty: 720, price: 11000, bid: 11500, sellerId: '701' }, NOW - 5 * MIN);
    const c = acc.tradeCount(t);
    assert.deepEqual(pick(c), { max: 10000, units: 10000, room: 0, full: true, over: 320, toBuy: 0 });
    assert.deepEqual(c.overRows, [{ itemId: '258', name: 'Jaguar Plushie', qty: 320, each: 11000 }]);
    // What Fill types: 10,000 in all, never one more.
    const list = acc.sendList(t);
    assert.deepEqual(list.send.map((x) => [x.name, x.qty]), [['Bottle of Champagne', 6000], ['Peony', 3000], ['Camel Plushie', 600], ['Jaguar Plushie', 400]]);
    assert.equal(list.send.reduce((a, x) => a + x.qty, 0), 10000);
    assert.deepEqual(list.over, [{ itemId: '258', name: 'Jaguar Plushie', qty: 320 }]);
    // The money expected is for what goes in.
    assert.equal(list.pays, 6000 * 3100 + 3000 * 5200 + 600 * 73500 + 400 * 11500);
    // Checkout's rows say the same, so its checklist never asks for the 320.
    const b = acc.boughtSince(t, { inside: new Map([['bottle of champagne', 6000], ['peony', 3000], ['camel plushie', 600], ['jaguar plushie', 400]]) });
    assert.deepEqual(b.rows.map((r) => [r.name, r.send, r.over || 0]), [['Bottle of Champagne', 6000, 0], ['Peony', 3000, 0], ['Camel Plushie', 600, 0], ['Jaguar Plushie', 400, 320]]);
    assert.deepEqual(b.missing, []);
    assert.equal(b.done, true);
    assert.deepEqual(pick(b.count), pick(c));
    // A smaller limit, for a test: the same walk.
    assert.deepEqual(acc.sendList(t, 6100).send.map((x) => [x.name, x.qty]), [['Bottle of Champagne', 6000], ['Peony', 100]]);
});

test('your own To sell lines count too, after what you bought: one that does not fit stays in To sell', () => {
    let t = acc.acceptTrade(chosen(9, 'FAFFO', [
        { itemId: '181', name: 'Bottle of Champagne', bid: 3100, steps: [{ sellerId: '500', sellerName: 'A', qty: 6000, price: 2950 }] },
    ], [{ itemId: '271', name: 'Peony', units: 3000, bid: 5200, each: 5000 }]), '181', NOW - 30 * MIN);
    // As accepted, nothing bought yet: the plan's own numbers.
    assert.deepEqual(acc.sendList(t).send.map((x) => [x.name, x.qty]), [['Bottle of Champagne', 6000], ['Peony', 3000]]);
    t = acc.recordBuy(t, 'flip:181', 0, 6000, NOW - 20 * MIN);
    assert.equal(acc.tradeCount(t).units, 9000);
    // 2,500 more bought, not planned: the trade is full, and 1,500 of your Peonies wait.
    t = acc.addExtraBuy(t, { itemId: '384', name: 'Camel Plushie', qty: 2500, price: 70000, bid: 73500, sellerId: '700' }, NOW - 10 * MIN);
    const c = acc.tradeCount(t);
    assert.deepEqual(pick(c), { max: 10000, units: 10000, room: 0, full: true, over: 1500, toBuy: 0 });
    assert.deepEqual(c.yoursOver, { 271: 1500 });
    assert.deepEqual(acc.sendList(t).send.map((x) => [x.name, x.qty]), [['Peony', 1500], ['Bottle of Champagne', 6000], ['Camel Plushie', 2500]]);
    // The trade goes through: only the 1,500 they took come off your To sell list.
    const mine = [{ itemId: '271', name: 'Peony', qty: 3000, each: 5000, from: null, at: NOW - 60 * MIN, why: 'extra' }];
    assert.deepEqual(toSell.afterYoursSent(mine, t, NOW).map((l) => [l.itemId, l.qty]), [['271', 1500]]);
});

test('what went over waits in To sell under that trader, for a second trade - never as "not taken"', () => {
    let t = boughtTrade();
    t = acc.addExtraBuy(t, { itemId: '258', name: 'Jaguar Plushie', qty: 1320, price: 11000, bid: 11500, sellerId: '701' }, NOW - 5 * MIN);
    // Torn says what you gave: the 10,000.
    const gave = new Map([['181', 6000], ['271', 3000], ['258', 1000]]);
    const left = acc.tradedLeftovers(t, gave, NOW, NOW - MIN);
    assert.deepEqual(left.map((l) => [l.itemId, l.qty, l.each, l.why, l.from, l.for]), [['258', 320, 11000, 'over', null, 'FAFFO']]);
    // Traded - done pressed by hand: the same 320.
    assert.equal(typeof acc.overLeftovers, 'function');
    assert.deepEqual(acc.overLeftovers(t, NOW).map((l) => [l.itemId, l.qty, l.why, l.from, l.for]), [['258', 320, 'over', null, 'FAFFO']]);
    assert.deepEqual(acc.overLeftovers(boughtTrade(), NOW), []);
    // They took fewer than you sent: that part is "not taken", as before (and never offered to them again).
    const fewer = acc.tradedLeftovers(t, new Map([['181', 6000], ['271', 3000], ['258', 900]]), NOW, NOW - MIN);
    assert.deepEqual(fewer.map((l) => [l.itemId, l.qty, l.why, l.from]), [['258', 420, 'left', 'FAFFO']]);
    // In To sell it is offered to that trader first, while they pay more than you paid.
    assert.equal(toSell.TO_SELL_WHY.over, 'Over 10,000');
    const buyersOf = () => [{ id: '44', name: 'Carol', price: 11600 }, { id: '9', name: 'FAFFO', price: 11500 }];
    const rows = toSell.toSellRows(left, { buyersOf });
    assert.deepEqual(rows.map((r) => [r.itemId, r.why, r.best.name, r.gain, r.ready]), [['258', 'over', 'FAFFO', 320 * 500, true]]);
    assert.deepEqual([...toSell.toSellHeld(left, { buyersOf }).keys()].sort(), ['id:44', 'id:9']);
    // They stopped paying more than you paid: whoever does.
    const cheap = () => [{ id: '44', name: 'Carol', price: 11600 }, { id: '9', name: 'FAFFO', price: 10900 }];
    assert.equal(toSell.toSellRows(left, { buyersOf: cheap })[0].best.name, 'Carol');
    // A "not taken" row is still never offered back to that trader.
    assert.equal(toSell.toSellRows(fewer, { buyersOf })[0].best.name, 'Carol');
});

test('the plan stops at 10,000 items: the main flip, your To sell lines and the extras together', () => {
    const flips = [
        { itemId: '181', bid: 3100, sellers: [s(2950, 9000, 'A')] },
        { itemId: '271', bid: 5200, sellers: [s(5000, 9000, 'B')] },
        { itemId: '258', bid: 11500, sellers: [s(11000, 9000, 'C')] },
    ];
    const t = trade.planTrade({ first: '181', flips, maxPerItem: 9000, kindOf: fast, extraItems: 10 });
    assert.equal(t.units, 10000);
    assert.equal(t.flips.reduce((a, r) => a + r.units, 0), 10000);
    assert.equal(t.unitsCapped, true);
    // The main flip is whole; the cover takes what room is left.
    assert.equal(t.flips[0].units, 9000);
    // Your To sell lines count: 4,000 of yours leave 6,000 for the bazaars.
    const mine = [{ itemId: '384', bid: 73500, held: 4000, each: 70000, all: true }];
    const withMine = trade.planTrade({ first: '181', flips, held: mine, maxPerItem: 9000, kindOf: fast, extraItems: 10 });
    assert.equal(withMine.units, 10000);
    assert.equal(withMine.flips.reduce((a, r) => a + r.units, 0) + withMine.held.reduce((a, r) => a + r.units, 0), 10000);
    // A number you type is held to it too.
    const typed = trade.planTrade({ first: '271', flips, maxPerItem: 9000, kindOf: fast, edits: { 271: { qty: 5000 } } });
    assert.equal(typed.units, 10000);
    assert.equal(typed.flips.find((r) => r.itemId === '271').units, 1000);
    // Without kinds (the other planner): the same line.
    const every = trade.planTrade({ first: '181', flips, maxPerItem: 9000 });
    assert.equal(every.units, 10000);
    assert.equal(every.flips.reduce((a, r) => a + r.units, 0), 10000);
    // A small trade is not touched.
    const small = trade.planTrade({ first: '181', flips: [{ itemId: '181', bid: 3100, sellers: [s(2950, 50, 'A')] }], kindOf: fast });
    assert.deepEqual([small.units, small.unitsCapped], [50, false]);
    // The limit can be given (a test's): nothing is planned past it.
    assert.equal(trade.planTrade({ first: '181', flips, maxPerItem: 9000, kindOf: fast, maxUnits: 120 }).units, 120);
});

test('"Show them" follows Cash for flips: what is listed is what Add all can buy - best first - and the rest is counted, not shown', () => {
    // One extra per trade, so everything else is left out.
    const flips = [
        { itemId: '1', bid: 2000, sellers: [s(1000, 100, 'M')] }, // the main flip: $100,000 of cash
        { itemId: '2', bid: 1000, sellers: [s(500, 100, 'X2')] }, // the one extra: the next best
        { itemId: '3', bid: 900, sellers: [s(500, 100, 'X3')] }, // left out: +$40,000 for $50,000
        { itemId: '4', bid: 700, sellers: [s(500, 100, 'X4')] }, // left out: +$20,000 for $50,000
        { itemId: '5', bid: 650, sellers: [s(500, 100, 'X5')] }, // left out: +$15,000 for $50,000
    ];
    const p = { first: '1', flips, maxPerItem: 100, kindOf: fast, extraItems: 1 };
    // No cash limit: all three listed, as before.
    const free = trade.planTrade(p);
    assert.deepEqual(free.left.map((r) => r.itemId), ['3', '4', '5']);
    assert.deepEqual([free.more, free.leftHidden], [3, 0]);
    // $230,000: the main flip and the extra take $150,000; $80,000 buys item 3 whole and 60 of item 4.
    const tight = trade.planTrade({ ...p, cash: 230000 });
    assert.equal(tight.cost, 150000);
    assert.deepEqual(tight.left.map((r) => [r.itemId, r.units, r.cost]), [['3', 100, 50000], ['4', 60, 30000]]);
    assert.deepEqual([tight.more, tight.leftHidden], [2, 1]);
    assert.ok(tight.cost + tight.left.reduce((a, r) => a + r.cost, 0) <= 230000, 'the plan and everything Add all adds, inside your Cash');
    // The cash all spent: nothing to show, three hidden.
    const spent = trade.planTrade({ ...p, cash: 150000 });
    assert.deepEqual([spent.left.length, spent.more, spent.leftHidden], [0, 0, 3]);
    // What the trader can pay stops it the same way: $40,000 more buys 44 of item 3 at $900.
    const pay = trade.planTrade({ ...p, payCap: 100 * 2000 + 100 * 1000 + 40000 });
    assert.deepEqual(pay.left.map((r) => [r.itemId, r.units]), [['3', 44]]);
    assert.equal(pay.leftHidden, 2);
    // And the 10,000 items.
    const units = trade.planTrade({ ...p, maxUnits: 250 });
    assert.deepEqual(units.left.map((r) => [r.itemId, r.units]), [['3', 50]]);
    assert.equal(units.leftHidden, 2);
});

test('the left-out list for a trade that holds still: fitted to what that trade leaves of the cash, their pay and the 10,000', () => {
    assert.equal(typeof trade.fitLeftOut, 'function');
    const cands = [
        { itemId: '3', bid: 900, kind: 'fast', cap: 100, under: [s(500, 100, 'X3')] },
        { itemId: '4', bid: 700, kind: 'fast', cap: 100, under: [s(500, 100, 'X4')] },
        // Its bazaars not read yet: the cheapest price known stands in.
        { itemId: '5', bid: 650, kind: 'fast', cap: 100, under: [{ sellerId: null, sellerName: null, price: 500, qty: 1, stale: false }] },
    ];
    const all = trade.fitLeftOut(cands, { cash: Infinity, pay: Infinity, units: Infinity });
    assert.deepEqual(all.fit.map((r) => [r.itemId, r.units]), [['3', 100], ['4', 100], ['5', 100]]);
    assert.equal(all.hidden, 0);
    const some = trade.fitLeftOut(cands, { cash: 60000, pay: Infinity, units: Infinity });
    assert.deepEqual(some.fit.map((r) => [r.itemId, r.units, r.cost]), [['3', 100, 50000], ['4', 20, 10000]]);
    assert.equal(some.hidden, 1);
    assert.deepEqual(trade.fitLeftOut(cands, { cash: Infinity, pay: Infinity, units: 130 }).fit.map((r) => [r.itemId, r.units]), [['3', 100], ['4', 30]]);
    assert.deepEqual(trade.fitLeftOut(cands, { cash: 0, pay: Infinity, units: Infinity }), { fit: [], hidden: 3 });
    assert.deepEqual(trade.fitLeftOut([], { cash: 5, pay: 5, units: 5 }), { fit: [], hidden: 0 });
});

test('a line added to a trade that holds still takes no more than the room it is given', () => {
    const h = held.holdTrade({ key: 'id:9', buyer: { id: '9', name: 'FAFFO' }, main: '181', flips: [{ itemId: '181', name: 'Bottle of Champagne', bid: 3100, units: 9900, steps: [{ sellerId: 'A', sellerName: 'A', qty: 9900, price: 2950 }] }], off: [] }, '181', NOW);
    const repick = (id, n) => [{ sellerId: 'B', sellerName: 'B', qty: n, price: 5000 }];
    const info = { name: 'Peony', bid: 5200, kind: 'fast', units: 300, price: 5000 };
    // As before, with no room said.
    assert.equal(held.editHeld(h, '271', { qty: 300 }, repick, info).lines[1].units, 300);
    // 100 left of the 10,000: 100 go in.
    const fit = held.editHeld(h, '271', { qty: 300 }, repick, info, 100);
    assert.equal(fit.lines[1].units, 100);
    // No room: the trade is as it was.
    assert.equal(held.editHeld(h, '271', { qty: 300 }, repick, info, 0), h);
    // Unticking and ticking back are not held up by it.
    const off = held.editHeld(fit, '271', { off: true }, repick, info, 0);
    assert.deepEqual(off.lines.map((l) => l.itemId), ['181']);
});

test('the counter in words: nothing to say while there is room, room left from 9,000, full, and what goes to To sell', () => {
    const v = (units, over = 0) => acc.countView({ max: 10000, units, room: Math.max(0, 10000 - units), full: units >= 10000, near: units >= 9000 && units < 10000, over }, 'FAFFO');
    assert.deepEqual(v(6420), { state: 'ok', units: 6420, max: 10000, pct: 64.2, text: '6,420 of 10,000', say: '' });
    assert.equal(v(0).pct, 0);
    assert.deepEqual([v(9480).state, v(9480).say], ['near', 'Room for 520 more in this trade.']);
    assert.deepEqual([v(10000).state, v(10000).pct, v(10000).say], ['full', 100, 'This trade is full. Anything more you buy goes to To sell under FAFFO, for a second trade.']);
    assert.equal(v(10000, 320).say, 'This trade is full. 320 more go to To sell under FAFFO when it is done, for a second trade.');
    assert.equal(v(10000, 1).say, 'This trade is full. 1 more goes to To sell under FAFFO when it is done, for a second trade.');
    assert.equal(acc.countView(null, 'FAFFO'), null, 'no count: no counter');
    // Fill's line on the trade page says it too, and never offers what is over.
    const note = acc.fillNote({ accepted: ['FAFFO'], trader: 'FAFFO', partner: 'FAFFO', toSend: 3, marked: 3, over: 320 });
    assert.match(note.text, /the trade is full at 10,000 items: 320 more go to To sell under FAFFO, for a second trade/);
    assert.doesNotMatch(acc.fillNote({ accepted: ['FAFFO'], trader: 'FAFFO', partner: 'FAFFO', toSend: 3, marked: 3 }).text, /full/);
});
