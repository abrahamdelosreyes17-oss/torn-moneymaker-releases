// A flip bought on the Item Market (sellerId 'market', core/item-market.js) end to end through the trade it becomes:
// the plan, the accepted trade, the order of its steps, the log that ticks it, a buy found by seller, what is left over -
// and nothing of it counted as a bazaar or a seller to ask the shared server about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemMarketRows, withItemMarket } from '../src/core/item-market.js';
import { bazaarSellers, FLIP_FRESH_MS, pickBazaars } from '../src/core/flips.js';
import { acceptTrade, nextStep, stepDone, stepRank, applyLogBuys, placeBuy, tradeForBuy, pendingStepAt, leftoversOf } from '../src/core/accepted.js';
import { marketBuyRows, marketItems, marketNext, marketPageItem } from '../src/core/owner-tab.js';
import { itemMarketUrl } from '../src/sources/route.js';
import { confirmWants } from '../src/core/server-first.js';
import { sellerRowsKept } from '#engines/rules/seller-rule.js';
import { sharedBody } from '../src/core/shared.js';
import { sellersOfRows, seesOf } from '../src/core/who-sells.js';

const NOW = 1_000_000_000;
const bazaar = [{ sellerId: '11', sellerName: 'Ann', price: 940, qty: 10, dataAt: NOW }, { sellerId: '12', sellerName: 'Bob', price: 950, qty: 30, dataAt: NOW }];
const market = itemMarketRows({ at: NOW, listings: [{ price: 800, qty: 5 }] }, { now: NOW, freshMs: FLIP_FRESH_MS });
const sellers = bazaarSellers(withItemMarket(bazaar, market), { now: NOW });
const plan = pickBazaars(sellers, 1000, { cash: 1e9, maxUnits: 12, minPct: 0 });

const chosen = (flips) => ({ key: 'id:7', buyer: { id: 7, name: 'Trader' }, flips: flips.map((f) => ({ ...f, name: 'Beer', bid: 1000 })), held: [] });

test('the plan buys the market first (cheapest) and tops up at the bazaar; accepting it keeps every step with its seller', () => {
    assert.equal(plan.steps[0].sellerId, 'market');
    const t = acceptTrade(chosen([{ itemId: 180, steps: plan.steps }]), 180, NOW);
    assert.deepEqual(t.items[0].steps.map((s) => [s.sellerId, s.sellerName, s.qty]).slice(0, 2), [['market', 'Item Market', 5], ['11', 'Ann', 7]]);
    assert.deepEqual([...marketItems([t])], ['180']);
});

test('the bazaars are walked first and the Item Market last, with or without stops named', () => {
    const t = acceptTrade(chosen([{ itemId: 180, steps: plan.steps }]), 180, NOW);
    assert.equal(stepRank(t, 'market'), 2e9);
    assert.ok(stepRank(t, '11') < stepRank(t, 'market'));
    assert.equal(nextStep(t).step.sellerId, '11', 'the market step is first in the list but not first to visit');
    // Only the market left: it is the next step, and Next knows the page to open (no bazaar of seller "market").
    const only = acceptTrade(chosen([{ itemId: 180, steps: [plan.steps[0]] }]), 180, NOW);
    assert.equal(nextStep(only).step.sellerId, 'market');
    assert.equal(marketNext(only, null).itemId, '180');
    assert.match(itemMarketUrl(180, 'Beer'), /ItemMarket/i);
});

test('your log ticks the market step (venue market), the bazaar page ticks the other; what is over the plan is left over', () => {
    let t = acceptTrade(chosen([{ itemId: 180, steps: plan.steps }]), 180, NOW);
    const rows = [{ id: 'a', side: 'buy', venue: 'market', qty: 5, each: 801, t: NOW + 1000, itemId: 180 }];
    const buys = marketBuyRows(rows, marketItems([t]));
    assert.equal(buys[0].sellerId, 'market');
    t = applyLogBuys(t, buys, { readFrom: 0, readTo: 0 });
    const step = t.items[0].steps.find((s) => s.sellerId === 'market');
    assert.equal(stepDone(step), true);
    assert.equal(step.boughtQty, 5);
    assert.equal(nextStep(t).step.sellerId, '11');
    // A market buy of more than planned is the trade's extra, by its seller name, not a bazaar.
    const more = applyLogBuys(t, [...buys, { id: 'b', t: NOW + 2000, itemId: '180', qty: 3, each: 805, sellerId: 'market' }], { readFrom: 0, readTo: 0 });
    assert.ok(more.extra.some((x) => x.sellerId === 'market' && x.qty === 3 && x.seller === 'Item Market'));
});

test('a buy found by its seller: the market buy belongs to the trade that planned it, and a pending step is its run', () => {
    const t = acceptTrade(chosen([{ itemId: 180, steps: plan.steps }]), 180, NOW);
    assert.equal(pendingStepAt(t, 'market', 180), true);
    assert.equal(tradeForBuy([t], { sellerId: 'market', itemId: 180 }).key, 'id:7');
    const placed = placeBuy([t], { sellerId: 'market', itemId: 180, qty: 2, price: 800 }, () => 0, NOW);
    assert.equal(placed.where, 'run');
});

test('what is left of a market step after the trade is a leftover like any other', () => {
    let t = acceptTrade(chosen([{ itemId: 180, steps: [plan.steps[0]] }]), 180, NOW);
    t = applyLogBuys(t, [{ id: 'a', t: NOW + 1, itemId: '180', qty: 5, each: 800, sellerId: 'market' }], { readFrom: 0, readTo: 0 });
    const left = leftoversOf(t, NOW + 5000);
    assert.ok(Array.isArray(left));
});

test('the seller rule and the server confirm leave the market alone', () => {
    const kept = sellerRowsKept(sellers, () => null, { mostEnemies: 3, perFriend: 2 }).rows;
    assert.ok(kept.some((r) => r.sellerId === 'market'), 'a row with no seller to count is kept');
    const wants = confirmWants([{ itemId: '180', rows: sellers.map((r) => ({ ...r, shared: true })), bid: 1000 }], new Map(), NOW);
    assert.ok(!wants.includes('market'), 'no Torn bazaar is read for the market');
});

test('nothing of the market is told to the shared server as a seller', () => {
    const body = sharedBody({ wants: [{ sellers: ['market', 11], trades: ['market'], looking: ['market', 12] }], now: NOW });
    assert.deepEqual(body.sellers.sort(), [11, 12].sort());
    assert.deepEqual(body.trades, []);
    assert.deepEqual(sellersOfRows(sellers), ['11', '12']);
    assert.deepEqual(seesOf(180, sellersOfRows(sellers), NOW)[2], [11, 12]);
    assert.equal(marketPageItem(itemMarketUrl(180, 'Beer')), '180');
});
