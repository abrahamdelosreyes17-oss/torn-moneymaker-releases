import test from 'node:test';
import assert from 'node:assert/strict';

import { selectCandidates, itemMarketSweepList, reachableProfit } from '../src/core/feed.js';
import { hiddenCounts, rankOpportunities, summarize, affordableRow } from '../src/core/ranker.js';
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

const row = (price, exit, qty, cash, extra = {}) => ({
    name: 'x',
    qtyAtPrice: true,
    profit: bestVenue({ listingPrice: price, exits: { NPC: exit }, qty, cashOnHand: cash }),
    ...extra,
});

test('hiddenCounts: says what cash and Min took out', () => {
    const rows = [
        row(2e6, 2.1e6, 5, 1e6), // cannot afford one: hidden by cash
        row(100, 150, 10, 1e6), // $500 total: under a $1k Min
        row(100, 1200, 10, 1e6), // $11k: shown
        row(5e6, 6e6, 1, 1e6, { qtyAtPrice: false }), // unknown qty, above cash: hidden by cash
    ];
    assert.deepEqual(hiddenCounts(rows, { minTotalProfit: 1000, cashOnHand: 1e6 }), { cash: 2, min: 1 });
});

test('cash: rows you cannot buy one of are hidden, whatever Min and whether the quantity is known', () => {
    const cash = 1e6;
    const rows = [
        row(2e6, 2.1e6, 5, cash), // too dear
        row(400000, 500000, 5, cash), // 2 of 5 affordable
        row(5e6, 6e6, 1, cash, { qtyAtPrice: false }), // unknown qty, too dear
        row(900000, 950000, 1, cash, { qtyAtPrice: false }), // unknown qty, affordable
    ];

    const kept = rankOpportunities(rows, { minTotalProfit: 0, cashOnHand: cash });
    assert.equal(kept.length, 2);
    assert.equal(kept[0].profit.listingPrice, 400000);
    assert.equal(kept[0].profit.affordableQty, 2, 'priced for the part you can afford');
    assert.equal(kept[0].profit.realizableProfit, 200000);
    assert.equal(kept[1].profit.listingPrice, 900000);

    assert.equal(affordableRow(rows[0], cash), false);
    assert.equal(affordableRow(rows[2], cash), false);
    assert.equal(affordableRow(rows[3], cash), true);
    assert.equal(affordableRow(rows[0], null), true, 'no cash set: no cap');

    // Without cash, every profitable row stays.
    assert.equal(rankOpportunities(rows, { minTotalProfit: 0, cashOnHand: null }).length, 4);
});

test('header total: with cash set, best rows first until the cash runs out', () => {
    const cash = 1e6;
    const rows = rankOpportunities(
        [
            row(400000, 500000, 5, cash), // 2 affordable: +$200k for $800k
            row(100000, 150000, 10, cash), // 10 affordable: +$500k for $1m
            row(50000, 60000, 1, cash), // +$10k for $50k
        ],
        { minTotalProfit: 0, cashOnHand: cash },
    );
    assert.deepEqual(rows.map((r) => r.profit.listingPrice), [100000, 400000, 50000]);

    // Summing each row's own capped profit would claim $710k on $1.85m of spend.
    const s = summarize(rows, { cashOnHand: cash });
    assert.equal(s.count, 3);
    assert.equal(s.cashRequired, 1e6, 'never more than the cash');
    assert.equal(s.totalProfit, 500000, 'the best row uses all the cash');
    assert.equal(s.capped, true);

    const s2 = summarize(rows.slice(1), { cashOnHand: cash });
    // $800k on 2 of the $400k row, then $200k buys 4 of the $50k row (only 1 exists).
    assert.equal(s2.totalProfit, 200000 + 10000);
    assert.equal(s2.cashRequired, 850000);
    assert.equal(s2.capped, false);

    const s3 = summarize(rows, {});
    assert.equal(s3.totalProfit, 710000, 'no cash: every row counts');
    assert.equal(s3.capped, false);
});

test('money input: digits, commas, $, and shorthand read as people mean them; junk is rejected', () => {
    assert.equal(parseMoneyInput('1234567'), 1234567);
    assert.equal(parseMoneyInput('$1,234,567'), 1234567);
    assert.equal(parseMoneyInput('1m'), 1e6);
    assert.equal(parseMoneyInput('1.5M'), 1.5e6);
    assert.equal(parseMoneyInput('$1,000,000'), 1e6);
    assert.equal(parseMoneyInput('500k'), 5e5);
    assert.equal(parseMoneyInput('2b'), 2e9);
    assert.equal(parseMoneyInput('1kk'), 1e6);
    assert.equal(parseMoneyInput('1 million'), 1e6);
    assert.equal(parseMoneyInput('lots'), null);
    assert.equal(parseMoneyInput('12x'), null);
    assert.equal(parseMoneyInput(''), null);
});

/*
 * The owner's report (3.10.1): NPC deals showing - Travel Visa $120,000 ->
 * $122,500, Magnum $15,500 -> $16,000 - and all gone the moment Cash was set
 * to $2m. Discovery ranked by profit x how many the cash buys, as if every
 * listing had unlimited stock: a $10 item making $1 scored 200,000, beating
 * the Visa's 40,000, so 25 cheap items took every slot and the feed then
 * dropped the real deals.
 */
test('discovery: setting Cash never pushes out deals you can afford', () => {
    const byId = new Map();
    const summary = [];
    byId.set('visa', { id: 'visa', name: 'Travel Visa', sellPrice: 122500, marketValue: 130000 });
    summary.push({ itemId: 'visa', lowestPrice: 120000 });
    byId.set('magnum', { id: 'magnum', name: 'Magnum', sellPrice: 16000, marketValue: 17000 });
    summary.push({ itemId: 'magnum', lowestPrice: 15500 });
    for (let i = 1; i <= 40; i++) {
        byId.set('j' + i, { id: 'j' + i, name: 'Junk' + i, sellPrice: 12, marketValue: 12 });
        summary.push({ itemId: 'j' + i, lowestPrice: 10 + (i % 2) });
    }
    const index = { byId };
    const settings = { sellToNpc: true, minTotalProfit: 1 };
    const ids = (cash) => selectCandidates(summary, index, { ...settings, cashOnHand: cash }).map((c) => c.itemId);

    assert.deepEqual(ids(null).slice(0, 2), ['visa', 'magnum'], 'no cash: best profit per item first');
    assert.deepEqual(ids(2e6).slice(0, 2), ['visa', 'magnum'], '$2m: the same deals, still first');
    // Cash still drops what it cannot buy one of.
    assert.ok(!ids(100000).includes('visa') && ids(100000)[0] === 'magnum', '$100k: the Visa goes, the Magnum stays');
});
