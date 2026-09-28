/*
 * The main flip and its cover (3.14, the owner, 2026-09-28): "the MAIN flip
 * is the big earner... extra items are only cover"; "1 item 1 bazaar best,
 * 1 item 3 bazaars sure, 5 bazaars max for the main flip"; "I'll flip lets
 * say 5 extra items, not max, but soft cap".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { flipPlan, pickBazaars, MAIN_STOPS } from '../src/core/flips.js';
import { planTrade, EXTRA_ITEMS } from '../src/core/trade.js';

const s = (price, qty, who = 'S' + price) => ({ sellerId: who, sellerName: who, price, qty, stale: false });
const sellersOf = (steps) => new Set(steps.map((st) => st.sellerId));

test('a flip takes at most 5 bazaars: Bag of Bon Bons no longer needs 38', () => {
    // 38 bazaars of two or three each (the owner's Bag of Bon Bons, 2026-09-28).
    const bonbons = Array.from({ length: 38 }, (_, i) => s(80 + i, 2 + (i % 2), 'B' + i));
    const p = flipPlan(bonbons, 200, { maxUnits: 100 });
    assert.ok(sellersOf(p.steps).size <= MAIN_STOPS, sellersOf(p.steps).size + ' bazaars');
    assert.equal(p.stops, sellersOf(p.steps).size);
    assert.ok(p.units > 0 && p.units < 100);
});

test('a flip picks the bazaars that pay the most: one seller with 30 beats five with 2 each', () => {
    const rows = [s(100, 2, 'a'), s(101, 2, 'b'), s(102, 2, 'c'), s(103, 2, 'd'), s(104, 2, 'e'), s(110, 30, 'Big')];
    const p = flipPlan(rows, 200, { maxUnits: 100 });
    assert.ok(sellersOf(p.steps).has('Big'), 'the seller with 30 is in');
    assert.equal(p.units, 30 + 4 * 2, 'Big and the four best small ones');
    assert.equal(p.stops, 5);
    // Fewer is better: 30 from one bazaar when that is all Most per flip takes.
    const one = flipPlan(rows, 200, { maxUnits: 30 });
    assert.deepEqual([...sellersOf(one.steps)], ['Big']);
    assert.equal(one.stops, 1);
});

test('a big flip from a few bazaars is unchanged: Stealth Virus', () => {
    const virus = [s(809351, 30, 'A'), s(812000, 12, 'B'), s(820000, 6, 'C')];
    const p = flipPlan(virus, 1157499, { maxUnits: 100 });
    assert.equal(p.units, 48);
    assert.equal(p.stops, 3);
    assert.equal(p.profit, 30 * (1157499 - 809351) + 12 * (1157499 - 812000) + 6 * (1157499 - 820000));
});

test('bazaars you visit anyway cost no new stop', () => {
    const rows = [s(100, 5, 'x'), s(100, 5, 'y'), s(100, 5, 'Route')];
    const p = pickBazaars(rows, 200, { maxUnits: 5, maxStops: 3, maxNew: 0, free: new Set(['Route']) });
    assert.deepEqual([...sellersOf(p.steps)], ['Route']);
    assert.equal(p.newStops, 0);
});

// Mil-Soul (2026-09-28): the desk showed Small First Aid Kit +$2,308 as the
// main item and Gentleman Cache +$55,349 as an extra.
const MILSOUL = [
    { itemId: 'kit', bid: 330, sellers: [s(250, 29, 'k1')] },
    { itemId: 'cache', bid: 60000, sellers: [s(55000, 11, 'c1')] },
];
const fast = () => 'fast';

test('the item that makes the most with the trader is the main flip, not the one on the desk', () => {
    const t = planTrade({ first: 'kit', flips: MILSOUL, kindOf: fast });
    assert.equal(t.main, 'cache');
    assert.equal(t.flips[0].itemId, 'cache', 'first on the card');
    assert.equal(t.flips[0].role, 'main');
    assert.equal(t.flips.find((r) => r.itemId === 'kit').role, 'extra', 'the desk item is cover');
    // When the desk item makes the most, it is the main flip as before.
    const alone = planTrade({ first: 'kit', flips: [MILSOUL[0]], kindOf: fast });
    assert.equal(alone.main, 'kit');
});

test('the main flip in a trade takes at most 5 bazaars too', () => {
    const flips = [{ itemId: 'B', bid: 200, sellers: Array.from({ length: 38 }, (_, i) => s(80 + i, 3, 'B' + i)) }];
    const t = planTrade({ first: 'B', flips, kindOf: fast });
    assert.ok(t.mainStops <= MAIN_STOPS, t.mainStops + ' bazaars');
});

test('about 5 extras, even when the route sells ten more; the rest are listed to add', () => {
    // One bazaar on the route sells ten other things the trader buys.
    const flips = [{ itemId: 'M', bid: 10000, sellers: [s(5000, 10, 'Hub')] }];
    for (let i = 0; i < 10; i += 1) flips.push({ itemId: 'x' + i, bid: 100 + i, sellers: [s(50, 10, 'Hub')] });
    const t = planTrade({ first: 'M', flips, kindOf: fast });
    assert.equal(t.flips.length, 1 + EXTRA_ITEMS, 'the main flip and five extras');
    assert.equal(t.left.length, 10 - EXTRA_ITEMS);
    assert.equal(t.more, 10 - EXTRA_ITEMS);
    // Adding one: a number typed for it puts it in.
    const add = t.left[0];
    const more = planTrade({ first: 'M', flips, kindOf: fast, edits: { [add.itemId]: { qty: add.units } } });
    assert.ok(more.flips.some((r) => r.itemId === add.itemId));
});

test('an item you typed a number for takes at most 5 bazaars, not twenty', () => {
    const flips = [
        { itemId: 'M', bid: 10000, sellers: [s(5000, 10, 'Hub')] },
        { itemId: 'T', bid: 300, sellers: Array.from({ length: 20 }, (_, i) => s(100 + i, 2, 'T' + i)) },
    ];
    const t = planTrade({ first: 'M', flips, kindOf: fast, edits: { T: { qty: 40 } } });
    const typed = t.flips.find((r) => r.itemId === 'T');
    assert.ok(sellersOf(typed.steps).size <= MAIN_STOPS, sellersOf(typed.steps).size + ' bazaars');
});

/* Review findings (2026-09-28), each a case the first build got wrong. */

test('a trader who can pay for nothing gets nothing (a zero cap is not "no limit")', () => {
    const flips = [{ itemId: 'A', bid: 200, sellers: [s(100, 50, 'x')] }];
    for (const payCap of [0, 150]) {
        const t = planTrade({ flips, payCap, kindOf: fast });
        assert.equal(t.pays, 0, 'payCap ' + payCap);
        assert.equal(t.payCapped, true);
    }
    // The main flip spends the whole cap: no extra goes over it.
    const two = [{ itemId: 'M', bid: 1000, sellers: [s(500, 10, 'm')] }, { itemId: 'E', bid: 200, sellers: [s(100, 5, 'm')] }];
    const t = planTrade({ flips: two, payCap: 10000, kindOf: fast });
    assert.ok(t.pays <= 10000, 'paid ' + t.pays);
});

test('extras never spend cash the main flip already spent', () => {
    const flips = [{ itemId: 'M', bid: 1000, sellers: [s(500, 10, 'm')] }, { itemId: 'E', bid: 200, sellers: [s(100, 50, 'm')] }];
    const t = planTrade({ flips, cash: 5000, kindOf: fast });
    assert.ok(t.cost <= 5000, 'cost ' + t.cost);
});

test('a big seller behind sixty single units is still found', () => {
    const rows = Array.from({ length: 60 }, (_, i) => s(100 + i, 1, 'one' + i));
    rows.push(s(170, 100, 'Big'));
    const p = flipPlan(rows, 1000, { maxUnits: 100 });
    assert.ok(sellersOf(p.steps).has('Big'));
    assert.ok(p.profit > 80000, 'profit ' + p.profit);
});

test('five smaller bazaars that beat one big one are found', () => {
    const rows = ['B', 'C', 'D', 'E', 'F'].map((w) => s(100, 20, w));
    rows.push(s(150, 100, 'A'));
    const p = flipPlan(rows, 200, { maxUnits: 100 });
    assert.equal(p.profit, 100 * 100, 'B-F: 100 at $100');
    assert.equal(sellersOf(p.steps).has('A'), false);
});

test('the item on the desk stays in its trade, even as slow cover', () => {
    const t = planTrade({ first: 'kit', flips: MILSOUL, kindOf: (id) => (id === 'kit' ? 'slow' : 'fast') });
    assert.equal(t.main, 'cache');
    assert.ok(t.flips.some((r) => r.itemId === 'kit'), 'the desk item is in');
    assert.equal(t.flips.find((r) => r.itemId === 'kit').units, 3, 'a slow one: 3');
});
