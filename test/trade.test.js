/*
 * One trade with one trader (core/trade.js): the friend's "many items looks
 * legit", N3 with the Sell to picker (2026-09-27).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planTrade, keepAfter } from '../src/core/trade.js';

const s = (price, qty, stale = false, who = 'S' + price) => ({ sellerId: who, sellerName: who, price, qty, stale });

// A trader who buys three things; two bazaars sell under their price.
const FLIPS = [
    { itemId: '206', bid: 1162056, sellers: [s(1150000, 1), s(1150000, 2, false, 'Blakeii'), s(1248748, 1)] }, // the picked item
    { itemId: '384', bid: 73500, sellers: [s(70000, 26), s(71800, 1018)] },
    { itemId: '186', bid: 520, sellers: [s(450, 1), s(482, 200)] },
];

test('the picked item first, then the most profit per $; ONE Cash for everything', () => {
    const t = planTrade({ first: '206', flips: FLIPS, cash: 5_000_000, maxPerItem: 100 });
    assert.equal(t.flips[0].itemId, '206', 'the item you picked leads');
    assert.equal(t.flips[0].units, 3);
    assert.equal(t.cost <= 5_000_000, true, 'never more than your Cash, all items together');
    // Sheep (15% on $450) is bought before the Camel (5%) once the picked item is in.
    const sheep = t.flips.find((r) => r.itemId === '186');
    const camel = t.flips.find((r) => r.itemId === '384');
    assert.equal(sheep.units, 100, 'Most per flip, per item');
    assert.ok(camel.units > 0 && camel.units < 26 + 1018);
    assert.equal(t.items, 3);
    assert.equal(t.profit, t.flips.reduce((a, r) => a + r.profit, 0));
    assert.equal(t.pays, t.flips.reduce((a, r) => a + r.units * r.bid, 0));
});

test('untick an item: it is left out and its cash goes to the others; a typed number caps it', () => {
    const base = planTrade({ first: '206', flips: FLIPS, cash: 5_000_000 });
    const off = planTrade({ first: '206', flips: FLIPS, cash: 5_000_000, edits: { 186: { off: true } } });
    assert.deepEqual(off.off.map((r) => r.itemId), ['186']);
    assert.equal(off.flips.some((r) => r.itemId === '186'), false);
    const camel = (t) => t.flips.find((r) => r.itemId === '384').units;
    assert.ok(camel(off) > camel(base), 'the freed cash buys more Camels');
    const two = planTrade({ first: '206', flips: FLIPS, cash: 5_000_000, edits: { 206: { qty: 2 } } });
    assert.equal(two.flips[0].units, 2);
});

test('stale listings and ones under the least profit per item are never planned', () => {
    const t = planTrade({ flips: [{ itemId: '1', bid: 100000, sellers: [s(99999, 5), s(90000, 5, true), s(95000, 2)] }] });
    assert.deepEqual(t.flips[0].steps.map((x) => x.price), [95000], '$1 under: not a trade; stale: never');
});

test('what you hold goes in, minus what you keep; the keep list is remembered as a number or all', () => {
    const held = [{ itemId: '738', bid: 17100, held: 10 }, { itemId: '206', bid: 1162056, held: 12 }];
    const t = planTrade({ flips: [], held, keep: { 738: 3, 206: 'all' } });
    assert.deepEqual(t.held.map((r) => [r.itemId, r.units, r.kept]), [['738', 7, 3], ['206', 0, 'all']]);
    assert.equal(t.pays, 7 * 17100);
    assert.equal(t.items, 1);

    assert.deepEqual(keepAfter({}, '738', 10, 7), { 738: 3 }, 'give 7 of 10: keep 3');
    assert.deepEqual(keepAfter({ 738: 3 }, '738', 10, 10), {}, 'give all: nothing kept');
    assert.deepEqual(keepAfter({}, '738', 10, 0), { 738: 'all' });
    assert.deepEqual(keepAfter({}, '738', 10, null), { 738: 'all' }, 'unticked');
});

test('the trader is never asked for more than their networth share - for the whole trade', () => {
    const held = [{ itemId: '738', bid: 17100, held: 10 }];
    // They can pay $1.2m in all: the picked item's first unit, then the rest is capped.
    const t = planTrade({ first: '206', flips: FLIPS, held, payCap: 1_200_000 });
    assert.ok(t.pays <= 1_200_000, 'paid ' + t.pays);
    assert.equal(t.flips[0].units, 1);
    assert.equal(t.payCapped, true);
    const free = planTrade({ first: '206', flips: FLIPS, held });
    assert.equal(free.payCapped, false);
});

test('3.25.0, every flip with one trader (the owner: "1 trader that just buys everything"): all of it in one trade - inside your cash, their pay and the 10,000', () => {
    // As the app plans: every item's kind is known. These are slow sellers, the worst case for the usual plan.
    const kindOf = () => 'slow';
    // Twelve items the trader buys, each sold under their price by two bazaars.
    const flips = Array.from({ length: 12 }, (_, i) => ({ itemId: String(100 + i), bid: 1000 + i, sellers: [s(900, 40, false, 'A' + i), s(950, 40, false, 'B' + i)] }));
    const usual = planTrade({ first: '100', flips, maxPerItem: 100, kindOf });
    assert.ok(usual.flips.length < 12, 'the usual plan is a main flip and a few extras: ' + usual.flips.length);
    const every = planTrade({ first: '100', flips, maxPerItem: 100, kindOf, everything: true });
    assert.equal(every.flips.length, 12, 'every item they buy that a bazaar sells for less');
    assert.deepEqual(every.flips.map((r) => r.units), Array(12).fill(80), 'each from every bazaar under their price, up to Most per flip');
    assert.equal(every.flips[0].itemId, '100', 'the item on the desk leads');
    assert.equal(every.flips.every((r) => r.kind === 'slow'), true, 'a line keeps its kind');
    assert.equal(every.items, 12);
    assert.equal(every.stops, 24);
    // Most per flip still holds, per item.
    assert.deepEqual(planTrade({ flips, maxPerItem: 50, kindOf, everything: true }).flips.map((r) => r.units), Array(12).fill(50));
    // Your cash: never more, all items together.
    const poor = planTrade({ flips, maxPerItem: 100, cash: 90_000, kindOf, everything: true });
    assert.ok(poor.cost <= 90_000 && poor.cost > 80_000, 'cash ' + poor.cost);
    // With cash for one bazaar's worth, it goes to the item on the desk - not to the best return (item 111 here).
    const tight = planTrade({ first: '100', flips, maxPerItem: 100, cash: 36_000, kindOf, everything: true });
    assert.deepEqual(tight.flips.map((r) => [r.itemId, r.units]), [['100', 40]]);
    // What the trader can pay: never asked for more.
    const capped = planTrade({ flips, maxPerItem: 100, payCap: 200_000, kindOf, everything: true });
    assert.ok(capped.pays <= 200_000 && capped.payCapped, 'pays ' + capped.pays);
    // The 10,000 items one trade takes.
    const big = Array.from({ length: 12 }, (_, i) => ({ itemId: String(100 + i), bid: 1000, sellers: [s(900, 5000, false, 'A' + i)] }));
    const full = planTrade({ flips: big, maxPerItem: 10_000, kindOf, everything: true });
    assert.equal(full.units, 10_000);
    assert.equal(full.unitsCapped, true);
    // Never their own bazaar; never a listing under the least profit; an item you unticked stays out.
    const own = planTrade({ flips, maxPerItem: 100, traderId: 'A3', kindOf, everything: true });
    assert.deepEqual(own.flips.find((r) => r.itemId === '103').steps.map((st) => st.sellerId), ['B3']);
    const thin = planTrade({ flips, maxPerItem: 100, minPct: 8, kindOf, everything: true });
    assert.equal(thin.flips.every((r) => r.steps.every((st) => st.price === 900)), true, 'the $950 listings make under 8%');
    const off = planTrade({ flips, maxPerItem: 100, edits: { 105: { off: true } }, kindOf, everything: true });
    assert.equal(off.flips.some((r) => r.itemId === '105'), false);
    assert.deepEqual(off.off.map((r) => r.itemId), ['105']);
});
