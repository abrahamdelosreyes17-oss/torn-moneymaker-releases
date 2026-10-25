import test from 'node:test';
import assert from 'node:assert/strict';
import { itemMarketRows, withItemMarket, nextItemMarket, itemMarketRoom, isMarketSeller, ITEM_MARKET_FRESH_MS, ITEM_MARKET_PRESS_PER_MIN, ITEM_MARKET_SPARE_PER_MIN } from '../src/core/item-market.js';
import { bazaarSellers, flipPlan, FLIP_FRESH_MS } from '../src/core/flips.js';

const NOW = 1_000_000_000;

test('listings of the Item Market become sellers rows with no seller, one a price', () => {
    const rows = itemMarketRows({ at: NOW - 1000, listings: [{ price: 800, qty: 3 }, { price: 800, qty: 2 }, { price: 820, qty: 1 }] }, { now: NOW, freshMs: FLIP_FRESH_MS });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => [r.sellerId, r.sellerName, r.price, r.qty]), [['market', 'Item Market', 800, 5], ['market', 'Item Market', 820, 1]]);
    assert.equal(isMarketSeller(rows[0].sellerId), true);
    assert.equal(isMarketSeller('123'), false);
});

test('an old read gives nothing; a read turns stale after its own short time, not the bazaar rows long one', () => {
    assert.deepEqual(itemMarketRows({ at: NOW - FLIP_FRESH_MS - 1, listings: [{ price: 800, qty: 1 }] }, { now: NOW, freshMs: FLIP_FRESH_MS }), []);
    assert.deepEqual(itemMarketRows(null, { now: NOW, freshMs: FLIP_FRESH_MS }), []);
    const rows = itemMarketRows({ at: NOW, listings: [{ price: 800, qty: 1 }] }, { now: NOW, freshMs: FLIP_FRESH_MS });
    const staleAt = (t) => bazaarSellers(rows, { now: t })[0].stale;
    assert.equal(staleAt(NOW + ITEM_MARKET_FRESH_MS - 1000), false);
    assert.equal(staleAt(NOW + ITEM_MARKET_FRESH_MS + 1000), true);
});

test('Beer at 800 on the Item Market is the cheapest seller against a bazaar at 940: a trader paying 943 makes 143 each', () => {
    const bazaar = [{ sellerId: '11', sellerName: 'Ann', price: 940, qty: 40, dataAt: NOW }];
    const market = itemMarketRows({ at: NOW, listings: [{ price: 800, qty: 25 }] }, { now: NOW, freshMs: FLIP_FRESH_MS });
    const sellers = bazaarSellers(withItemMarket(bazaar, market), { now: NOW });
    assert.equal(sellers[0].sellerId, 'market');
    assert.equal(sellers[0].price, 800);
    assert.equal(943 - sellers[0].price, 143);
    assert.equal(sellers[1].sellerId, '11');
    // ...and the plan buys there: the flip exists, its first step is the Item Market.
    const plan = flipPlan(sellers, 943, { cash: 1e9, maxUnits: 20 });
    assert.ok(plan);
    assert.equal(plan.steps[0].sellerId, 'market');
    assert.equal(plan.steps[0].price, 800);
    assert.equal(plan.profit, 20 * 143);
    // The bazaar alone (940 for 943) is under the least profit: no flip.
    assert.equal(flipPlan(bazaarSellers(bazaar, { now: NOW }), 943, { cash: 1e9, maxUnits: 20 }), null);
});

test('at one price a bazaar comes before the market (its seller can be checked)', () => {
    const bazaar = [{ sellerId: '11', sellerName: 'Ann', price: 800, qty: 40, dataAt: NOW }];
    const market = itemMarketRows({ at: NOW, listings: [{ price: 800, qty: 25 }] }, { now: NOW, freshMs: FLIP_FRESH_MS });
    assert.equal(bazaarSellers(withItemMarket(bazaar, market), { now: NOW })[0].sellerId, '11');
    assert.equal(withItemMarket(bazaar, []), bazaar);
});

test('the order of reads: the pressed items, the item in view, then the candidates; a read in hand is not asked again', () => {
    const recs = { a: { at: NOW - 10 }, b: null, v: { at: NOW - 200_000 }, c1: null, c2: { at: NOW - 1000 } };
    const recOf = (id) => recs[id] || null;
    assert.deepEqual(nextItemMarket({ pressed: ['a', 'b'], view: 'v', candidates: ['c1'], recOf, now: NOW }), { id: 'b', urgent: true });
    recs.b = { at: NOW };
    assert.deepEqual(nextItemMarket({ pressed: ['a', 'b'], view: 'v', candidates: ['c1'], recOf, now: NOW }), { id: 'v', urgent: true });
    recs.v = { at: NOW };
    assert.deepEqual(nextItemMarket({ pressed: ['a', 'b'], view: 'v', candidates: ['c2', 'c1'], recOf, now: NOW }), { id: 'c1', urgent: false });
    recs.c1 = { at: NOW, loading: true };
    assert.equal(nextItemMarket({ pressed: [], view: null, candidates: ['c1', 'c2'], recOf, now: NOW }), null);
    recs.c1 = { error: true, triedAt: NOW - 1000 };
    assert.equal(nextItemMarket({ candidates: ['c1'], recOf, now: NOW }), null);
    recs.c1 = { error: true, triedAt: NOW - 61_000 };
    assert.equal(nextItemMarket({ candidates: ['c1'], recOf, now: NOW }).id, 'c1');
});

test('reads a minute: the pressed trader and the item in view get more than the rest', () => {
    const sent = Array.from({ length: ITEM_MARKET_SPARE_PER_MIN }, (_, i) => NOW - i * 1000);
    assert.equal(itemMarketRoom(sent, { now: NOW, urgent: false }), false);
    assert.equal(itemMarketRoom(sent, { now: NOW, urgent: true }), true);
    assert.equal(itemMarketRoom(Array.from({ length: ITEM_MARKET_PRESS_PER_MIN }, () => NOW), { now: NOW, urgent: true }), false);
    assert.equal(itemMarketRoom(sent, { now: NOW + 61_000, urgent: false }), true);
});
