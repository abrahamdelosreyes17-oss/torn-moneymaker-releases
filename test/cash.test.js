import test from 'node:test';
import assert from 'node:assert/strict';

import { selectCandidates, itemMarketSweepList, reachableProfit } from '../src/core/feed.js';
import { hiddenCounts } from '../src/core/ranker.js';
import { bestVenue } from '../src/core/profit.js';
import { parseMoneyInput } from '../src/core/parse.js';

/*
 * The reported bug: Market chip on, $1m cash, and nothing showed - though
 * cheap under-value items existed. Discovery ranked by profit PER ITEM, so it
 * only ever fetched the $200m items, and the cash cap then hid all of them.
 */
function market() {
    const byId = new Map();
    const summary = [];
    for (let i = 1; i <= 30; i++) {
        byId.set('p' + i, { id: 'p' + i, name: 'Pricey' + i, sellPrice: null, marketValue: 200e6 });
        summary.push({ itemId: 'p' + i, lowestPrice: 150e6 });
    }
    for (let i = 1; i <= 10; i++) {
        byId.set('c' + i, { id: 'c' + i, name: 'Cheap' + i, sellPrice: null, marketValue: 100000 });
        summary.push({ itemId: 'c' + i, lowestPrice: 80000 - i });
    }
    return { index: { byId }, summary };
}

test('discovery: with cash set, items you cannot afford are never fetched', () => {
    const { index, summary } = market();
    const settings = { sellToNpc: true, resaleMarket: true, cashOnHand: 1e6, minTotalProfit: 1 };

    const before = selectCandidates(summary, index, { ...settings, cashOnHand: null });
    assert.ok(before.slice(0, 5).every((c) => c.itemId.startsWith('p')), 'no cash: pricey first (unchanged)');

    const withCash = selectCandidates(summary, index, settings);
    assert.equal(withCash.length, 10, 'only the affordable items');
    assert.ok(withCash.every((c) => c.itemId.startsWith('c')));
    // $1m buys 12 at ~$80k, each resold at $95k after tax.
    assert.equal(withCash[0].reach, reachableProfit(withCash[0].profitPerUnit, withCash[0].lowestPrice, settings));
});

test('discovery: an item that cannot reach Min with your cash is skipped', () => {
    const { index, summary } = market();
    const base = { sellToNpc: true, resaleMarket: true, cashOnHand: 1e6 };
    assert.equal(selectCandidates(summary, index, { ...base, minTotalProfit: 100000 }).length, 10);
    // $1m cash can make ~$180k here at most: a $1m Min fetches nothing.
    assert.equal(selectCandidates(summary, index, { ...base, minTotalProfit: 1e6 }).length, 0);
});

test('Item Market sweep: the Market chip adds items, and cash drops unaffordable ones', () => {
    const { index } = market();
    assert.equal(itemMarketSweepList(index, { sellToNpc: true }).length, 0, 'NPC only: none of these have an NPC price');
    assert.equal(itemMarketSweepList(index, { resaleMarket: true }).length, 40);
    const cashed = itemMarketSweepList(index, { resaleMarket: true, cashOnHand: 1e6 });
    assert.equal(cashed.length, 10);
    assert.ok(cashed.every((id) => id.startsWith('c')));
});

test('hiddenCounts: says what cash and Min took out', () => {
    const row = (price, exit, qty, cash) => ({
        qtyAtPrice: true,
        profit: bestVenue({ listingPrice: price, exits: { NPC: exit }, qty, cashOnHand: cash }),
    });
    const rows = [
        row(2e6, 2.1e6, 5, 1e6), // cannot afford one: hidden by cash
        row(100, 150, 10, 1e6), // $500 total: under a $1k Min
        row(100, 1200, 10, 1e6), // $11k: shown
    ];
    assert.deepEqual(hiddenCounts(rows, { minTotalProfit: 1000 }), { cash: 1, min: 1 });
});

test('money input: shorthand reads as people mean it', () => {
    assert.equal(parseMoneyInput('1m'), 1e6);
    assert.equal(parseMoneyInput('1.5M'), 1.5e6);
    assert.equal(parseMoneyInput('$1,000,000'), 1e6);
    assert.equal(parseMoneyInput('500k'), 5e5);
    assert.equal(parseMoneyInput('2b'), 2e9);
    assert.equal(parseMoneyInput('1kk'), 1e6);
    assert.equal(parseMoneyInput('1 million'), 1e6);
    assert.equal(parseMoneyInput('lots'), null);
});
