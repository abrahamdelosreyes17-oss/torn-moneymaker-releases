import test from 'node:test';
import assert from 'node:assert/strict';

import {
    bazaarSellers,
    flipPlan,
    whereToSell,
    flipCandidates,
    traderTagLabel,
    FLIP_FRESH_MS,
    LIST_EDGE,
} from '../src/core/flips.js';

const NOW = 1_800_000_000_000;
const row = (sellerId, price, qty, agoMs = 60_000, sellerName = 'S' + sellerId) => ({ sellerId: String(sellerId), sellerName, price, qty, dataAt: NOW - agoMs });

test('bazaar sellers: cheapest first, your own listing left out, old ones marked stale', () => {
    const rows = [row(2, 72000, 56), row(1, 70000, 26), row(9, 69000, 5), row(3, 71800, 1018, FLIP_FRESH_MS + 1)];
    const out = bazaarSellers(rows, { selfId: '9', now: NOW });
    assert.deepEqual(out.map((r) => r.sellerId), ['1', '3', '2']);
    assert.deepEqual(out.map((r) => r.stale), [false, true, false]);
    // No id known: nothing is left out.
    assert.equal(bazaarSellers(rows, { now: NOW }).length, 4);
});

test('flip plan: cheapest first, only under the bid, the cash caps it, a part-bought listing ends it', () => {
    // The camel plushie case: 26 at $70,000, then 1,018 at $71,800, the trader pays $73,500.
    const sellers = bazaarSellers([row(1, 70000, 26), row(2, 71800, 1018), row(3, 73500, 50)], { now: NOW });
    const plan = flipPlan(sellers, 73500, { cash: 5_000_000 });
    assert.equal(plan.steps.length, 2);
    assert.deepEqual(plan.steps.map((s) => [s.sellerId, s.qty]), [['1', 26], ['2', 44]]);
    assert.equal(plan.units, 70);
    assert.equal(plan.cost, 26 * 70000 + 44 * 71800);
    assert.equal(plan.profit, 26 * 3500 + 44 * 1700);
    assert.ok(plan.cost <= 5_000_000);
    assert.equal(plan.each, 3500);

    // No cash set: every listing under the bid, and none at or over it.
    const all = flipPlan(sellers, 73500, { cash: null });
    assert.equal(all.units, 26 + 1018);
    assert.equal(all.steps.length, 2);
});

test('flip plan: nothing under the bid is no plan; one you cannot afford says what it needs', () => {
    const sellers = bazaarSellers([row(1, 15_960_000, 2)], { now: NOW });
    assert.equal(flipPlan(sellers, 15_000_000, { cash: 5_000_000 }), null);
    const plan = flipPlan(sellers, 16_124_868, { cash: 5_000_000 });
    assert.equal(plan.units, 0);
    assert.equal(plan.needs, 15_960_000);
    assert.equal(flipPlan(sellers, 0), null);
});

test('flip plan: a stale listing is never planned on, even when it is the cheapest', () => {
    const sellers = bazaarSellers([row(1, 100, 10, FLIP_FRESH_MS * 2), row(2, 150, 3)], { now: NOW });
    const plan = flipPlan(sellers, 200, { cash: null });
    assert.deepEqual(plan.steps.map((s) => s.sellerId), ['2']);
    assert.equal(plan.profit, 3 * 50);
    // Only stale listings under the bid: no plan at all.
    assert.equal(flipPlan(bazaarSellers([row(1, 100, 10, FLIP_FRESH_MS * 2)], { now: NOW }), 200), null);
});

test('where to sell: the trader wins unless waiting pays at least 1% more', () => {
    // Balaclava: trader $12,600,000; your bazaar $12,974,999 (+3%).
    const a = whereToSell({ held: 2, bid: 12_600_000, bazaarLowest: 12_975_000, marketLowest: 13_400_000 });
    assert.equal(a.best, 'bazaar');
    assert.equal(a.gain, 2 * (12_974_999 - 12_600_000));
    // The Item Market is after its 5% fee.
    assert.equal(a.options[2].each, Math.floor(13_399_999 * 0.95));

    // Xanax: your bazaar would be under the trader - sell to the trader.
    const b = whereToSell({ held: 12, bid: 840_000, bazaarLowest: 839_399, marketLowest: 842_000 });
    assert.equal(b.best, 'trader');
    assert.equal(b.gain, 0);

    // Just under the edge: still the trader.
    const bid = 1_000_000;
    const c = whereToSell({ held: 1, bid, bazaarLowest: Math.floor(bid * (1 + LIST_EDGE)), marketLowest: null });
    assert.equal(c.best, 'trader');
    const d = whereToSell({ held: 1, bid, bazaarLowest: bid * (1 + LIST_EDGE) + 1, marketLowest: null });
    assert.equal(d.best, 'bazaar');
});

test('where to sell: no trader means the better of the two listings; nothing known means no answer', () => {
    const a = whereToSell({ held: 3, bid: null, bazaarLowest: 500, marketLowest: 600 });
    assert.equal(a.best, 'market');
    assert.equal(a.gain, 0);
    assert.equal(a.options[0].each, null);
    assert.equal(whereToSell({ held: 1 }).best, null);
});

test('flip candidates: only where a trader pays more than the cheapest; unaffordable left out; best first', () => {
    const summary = new Map([
        ['384', { lowestPrice: 70000 }],
        ['186', { lowestPrice: 450 }],
        ['818', { lowestPrice: 15_960_000 }],
        ['206', { lowestPrice: 839_399 }],
        ['1', { lowestPrice: null }],
    ]);
    const bids = { 384: 73500, 186: 520, 818: 16_124_868, 206: 839_000, 1: 100 };
    const out = flipCandidates(summary, (id) => bids[id] || null, { cash: 5_000_000 });
    assert.deepEqual(out.map((c) => c.itemId), ['384', '186']);
    assert.equal(out[0].each, 3500);
    // With no cash limit the expensive one is a candidate too.
    assert.ok(flipCandidates(summary, (id) => bids[id] || null, { cash: null }).some((c) => c.itemId === '818'));
});

test('trader tag: only a Trusted buyer paying more than the listing; two lines, nothing cut', () => {
    const faffo = { name: 'FAFFO', price: 73500, trust: { level: 'Trusted' } };
    assert.equal(traderTagLabel(faffo, 70000), 'FAFFO pays $73,500\n+$3,500 each');
    assert.equal(traderTagLabel(faffo, 73500), null);
    assert.equal(traderTagLabel({ ...faffo, trust: { level: 'Known' } }, 70000), null);
    assert.equal(traderTagLabel({ ...faffo, trust: null }, 70000), null);
    assert.equal(traderTagLabel(null, 70000), null);
});
