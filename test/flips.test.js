import test from 'node:test';
import assert from 'node:assert/strict';

import {
    bazaarSellers,
    flipPlan,
    whereToSell,
    flipCandidates,
    flipBuyer,
    payableUnits,
    flipBuyers,
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

    // No cash and a high Most per flip: every listing under the bid, none at or over it.
    const all = flipPlan(sellers, 73500, { cash: null, maxUnits: 5000 });
    assert.equal(all.units, 26 + 1018);
    assert.equal(all.steps.length, 2);
});

test('flip plan: never more than Most per flip (100 by default), and says how many were under the bid', () => {
    // The owner's 2,188-item plan: no trader takes thousands.
    const sellers = bazaarSellers([row(1, 35019, 5), row(2, 35020, 20), row(3, 35062, 2163)], { now: NOW });
    const plan = flipPlan(sellers, 40000, { cash: null });
    assert.equal(plan.units, 100);
    assert.equal(plan.available, 2188);
    // 3.14: all 100 from the one bazaar that has them - three bazaars would
    // make $1,055 more (0.2%), not worth two more stops ("1 bazaar best").
    assert.deepEqual(plan.steps.map((s) => [s.sellerId, s.qty]), [['3', 100]]);
    assert.equal(flipPlan(sellers, 40000, { cash: null, maxUnits: 10 }).units, 10);
});

test('flip buyer: a bid over 3x the Item Market Average is not real; no average or own-stat items: no flip', () => {
    const buyers = [
        { name: 'Troll', price: 92_000_000_000 },
        { name: 'Real', price: 74_000 },
    ];
    assert.equal(flipBuyer(buyers, { avg: 71_675, type: 'Plushie' }).name, 'Real');
    assert.equal(flipBuyer(buyers, { avg: null, type: 'Plushie' }), null);
    assert.equal(flipBuyer(buyers, { avg: 71_675, type: 'Defensive' }), null);
    assert.equal(flipBuyer(buyers, { avg: 71_675, type: 'Primary' }), null);
    assert.equal(flipBuyer([{ name: 'T', price: 300_000 }], { avg: 100_000, type: 'Flower' }).name, 'T');
    assert.equal(flipBuyer([{ name: 'T', price: 300_001 }], { avg: 100_000, type: 'Flower' }), null);
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

test('could they pay: a flip never asks a trader for more than your share of their networth', () => {
    // $1m networth, 10%: $100,000 at an $18,000 bid is 5 items.
    assert.equal(payableUnits(18000, 1000000, 10), 5);
    assert.equal(payableUnits(18000, null, 10), Infinity);
    assert.equal(payableUnits(18000, 1000000, 0), Infinity);
    assert.equal(payableUnits(200000, 1000000, 10), 0);
    const buyers = [{ id: '1', name: 'Poor', price: 200000 }, { id: '2', name: 'Rich', price: 190000 }];
    const nw = { 1: 1000000, 2: 1e10 };
    const unitsOf = (b) => payableUnits(b.price, nw[b.id], 10);
    // The best bidder cannot pay for even one: the next one is the buyer.
    const b = flipBuyer(buyers, { avg: 150000, type: 'Drug', unitsOf });
    assert.equal(b.name, 'Rich');
    assert.equal(b.maxUnits, Math.floor(1e9 / 190000));
    // Unknown networth: the buyer stands, with no cap yet.
    assert.equal(flipBuyer(buyers, { avg: 150000, unitsOf: () => Infinity }).maxUnits, undefined);
});

test('flip buyers: every believable one that can pay for one, best bid first, each with its cap', () => {
    const buyers = [{ id: '1', price: 1000 }, { id: '2', price: 990 }, { id: '3', price: 99999 }];
    const nw = { 1: 10000, 2: 1e9 };
    const list = flipBuyers(buyers, { avg: 1000, type: 'Drug', unitsOf: (b) => payableUnits(b.price, nw[b.id], 10) });
    // 3 is not believable (over 3x the average); 1 can pay for 1, 2 for many.
    assert.deepEqual(list.map((b) => [b.id, b.maxUnits]), [['1', 1], ['2', Math.floor(1e8 / 990)]]);
    // At $900 a unit with 100 on sale: 1 makes $100, 2 makes 100 x $90 - the plan should sell to 2.
    const sellers = [{ sellerId: '9', price: 900, qty: 100, stale: false }];
    const plans = list.map((b) => ({ b, p: flipPlan(sellers, b.price, { maxUnits: Math.min(100, b.maxUnits || Infinity) }) }));
    const best = plans.reduce((a, x) => (x.p.profit > a.p.profit ? x : a));
    assert.equal(best.b.id, '2');
    assert.equal(best.p.profit, 9000);
});

/* ------------------------------------------------ $1 is for NPC shops only */

import { bestVenue, enoughProfit, MIN_PROFIT_PCT } from '../src/core/profit.js';

test('a flip to a trader needs a real margin: $1 under a $140,000 bid is not a flip', () => {
    const fresh = (price, qty = 5) => ({ sellerId: 'S' + price, sellerName: 'Seller', price, qty, stale: false });
    // $1 and $1,000 under: less than 1% of the price, left out.
    assert.equal(flipPlan([fresh(139999), fresh(139000)], 140000), null);
    // $2,000 under (1.4%): a flip.
    const plan = flipPlan([fresh(139999), fresh(138000)], 140000);
    assert.equal(plan.units, 5);
    assert.equal(plan.profit, 5 * 2000);
    // Settings can ask for more, or for nothing at all.
    assert.equal(flipPlan([fresh(138000)], 140000, { minPct: 2 }), null);
    assert.equal(flipPlan([fresh(139999)], 140000, { minPct: 0 }).units, 5);
    // Candidates follow the same rule.
    const summary = new Map([['1', { lowestPrice: 139999 }], ['2', { lowestPrice: 138000 }]]);
    assert.deepEqual(flipCandidates(summary, () => 140000).map((c) => c.itemId), ['2']);
});

test('NPC deals still count from $1; resale deals need the least profit per item', () => {
    assert.equal(MIN_PROFIT_PCT, 1);
    assert.equal(enoughProfit(1, 10000, 'NPC'), true);
    assert.equal(enoughProfit(1, 10000, 'BAZAAR_RESALE'), false);
    assert.equal(enoughProfit(100, 10000, 'BAZAAR_RESALE'), true);
    // A $1 NPC margin survives; a $5 resale margin on a $10,000 item does not, so NPC wins.
    const best = bestVenue({ listingPrice: 10000, exits: { NPC: 10001, BAZAAR_RESALE: 10005 } });
    assert.equal(best.venue, 'NPC');
    assert.equal(bestVenue({ listingPrice: 10000, exits: { BAZAAR_RESALE: 10005 } }), null);
    assert.equal(bestVenue({ listingPrice: 10000, exits: { BAZAAR_RESALE: 10005 }, minPct: 0 }).venue, 'BAZAAR_RESALE');
    // Cheap items: never less than $1 either way.
    assert.equal(enoughProfit(0.5, 10, 'TRADER'), false);
    assert.equal(enoughProfit(1, 10, 'TRADER'), true);
});

/* ------------------------------------ Where to sell: a big stack is not "all at the cheapest" */

import { whereToSell as sellWhere, depthNearCheapest } from '../src/core/flips.js';

test('150,000 Hammers are not all worth the cheapest ask: listing counts only the first N listed near it', () => {
    // The review's screenshot: 150,000 Hammers, the trader pays $110, bazaars from $130.
    const rows = [{ price: 130, qty: 4 }, { price: 131, qty: 9 }, { price: 200, qty: 50 }];
    const depth = depthNearCheapest(rows);
    assert.equal(depth, 13, 'within 1% of $130: the 4 and the 9');
    const w = sellWhere({ held: 150000, bid: 110, bazaarLowest: 130, bazaarDepth: depth });
    const bz = w.options.find((o) => o.venue === 'bazaar');
    assert.equal(bz.units, 13);
    assert.equal(bz.total, 13 * 129 + (150000 - 13) * 110, 'the rest go to the trader');
    assert.equal(w.best, 'bazaar');
    assert.equal(w.gain, 13 * (129 - 110), 'the gain is for the 13, not $2.85m');
    // Before: the gain was (129 - 110) × 150,000.
    const old = sellWhere({ held: 150000, bid: 110, bazaarLowest: 130 });
    assert.equal(old.gain, 150000 * 19, 'depth unknown: counted for everything, as before');
    // A small stack inside the depth is unchanged.
    const small = sellWhere({ held: 5, bid: 110, bazaarLowest: 130, bazaarDepth: depth });
    assert.equal(small.options.find((o) => o.venue === 'bazaar').units, 5);
    assert.equal(depthNearCheapest([]), null);
});

/* ---------------- one-of-a-kind items are never flipped by the hundred */

import { isStatType, flipBuyers as buyersForFlip } from '../src/core/flips.js';

test('weapons, armour and cars are never flipped, whichever way Torn names the type; temporaries are', () => {
    // The owner: "no one is buying 100 weapons/armor", "same with cars".
    for (const [type, sub] of [['Melee', null], ['Primary', null], ['Secondary', null], ['Defensive', null], ['Weapon', 'Primary'], ['Weapon', null], ['Armor', null], ['Car', null]]) {
        assert.equal(isStatType(type, sub), true, type + '/' + sub);
        assert.deepEqual(buyersForFlip([{ name: 'X', price: 100 }], { avg: 90, type, subType: sub }), [], type + ' has no flip buyers');
    }
    // Grenades and the like stack, and traders buy them in bulk.
    assert.equal(isStatType('Temporary', null), false);
    assert.equal(isStatType('Weapon', 'Temporary'), false);
    assert.equal(buyersForFlip([{ name: 'X', price: 100 }], { avg: 90, type: 'Weapon', subType: 'Temporary' }).length, 1);
    assert.equal(isStatType('Drug', null), false);
});

import { listBid, believableBid } from '../src/core/flips.js';

test('troll bids never lead the item list: it sorts by the best believable bid', () => {
    // A Parcel-style troll: $99b against an item worth $300.
    const buyers = [{ name: 'Norker', price: 99_000_000_000 }, { name: 'Real', price: 320 }];
    assert.equal(listBid(buyers, 300), 320, 'the real bid counts');
    assert.equal(listBid(buyers.slice(0, 1), 300), 0, 'only a troll: nothing to sort by');
    assert.equal(listBid(buyers, null), 0, 'no market price: a bid cannot be told real, so it does not lead');
    assert.equal(believableBid(900, 300), true, 'exactly 3x: still real');
    assert.equal(believableBid(901, 300), false);
    // Sorted as the list sorts: the real item first.
    const rows = [
        { name: 'Parcel', bid: listBid([{ price: 99_000_000_000 }], null) },
        { name: 'Xanax', bid: listBid([{ price: 850_000 }], 830_000) },
    ].sort((a, b) => b.bid - a.bid);
    assert.equal(rows[0].name, 'Xanax');
});

import { nearMisses } from '../src/core/flips.js';

test('near-misses: a bazaar a little over the best bid is read too (the summary lags), closest first (3.15)', () => {
    const summary = new Map([['1', { lowestPrice: 71800 }], ['2', { lowestPrice: 200 }], ['3', { lowestPrice: 101 }], ['4', { lowestPrice: 90 }]]);
    const bids = { 1: 70000, 2: 100, 3: 100, 4: 100 };
    // 1: 2.6% over; 2: 100% over (no); 3: 1% over; 4: already a flip (not a near-miss).
    assert.deepEqual(nearMisses(summary, (id) => bids[id]), ['3', '1']);
    assert.deepEqual(nearMisses(summary, (id) => bids[id], { exclude: new Set(['3']) }), ['1']);
});
