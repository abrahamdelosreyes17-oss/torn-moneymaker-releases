import test from 'node:test';
import assert from 'node:assert/strict';

import { LiveFeed, LIVE_ROW_URGENT_MS } from '../src/feed/controller.js';
import { W3bClient } from '../src/api/w3b.js';
import { buildItemIndex } from '../src/core/items.js';
import {
    readFeedCacheEntry,
    feedOpportunities,
    itemMarketSweepList,
    itemMarketLiveIds,
    emptyFeed,
    setItemMarketSnapshot,
    finiteCmp,
    selectCandidates,
} from '../src/core/feed.js';

/*
 * The Item Market regression, as a permanent test.
 *
 * Ten simulated minutes of the feed over 1,000 items: 300 with an NPC price
 * (sell $90, values $100-$700), the rest value-only. Twenty NPC items are
 * listed on the Item Market at $60 - a deal - and forty items are cheap in
 * bazaars, so TornW3B candidates compete for the same Torn budget.
 *
 * Measured before the fix: 3.6.0 found 3/20 (NPC only), 3.7.0 found 0/20
 * with the Market chip on. The causes: the sweep re-checked EVERY item it
 * had ever fetched (a snapshot with listings counted as "live"), so after a
 * dozen items the budget went to re-checks and the cursor stood still; the
 * sweep list was ordered by a NaN comparator and, with the Market chip, held
 * every item in id order; and candidates took the slots first.
 */
function simulate(settings, { minutes = 10 } = {}) {
    const raw = {};
    for (let i = 1; i <= 1000; i++) {
        raw[i] = { name: 'I' + i, type: 'Other', sell_price: i <= 300 ? 90 : 0, market_value: 100 * (1 + (i % 7)) };
    }
    const index = buildItemIndex(raw);
    for (const it of index.byId.values()) {
        const n = Number(it.id);
        it.sellPrice = n <= 300 ? 90 : null;
        it.marketValue = 100 * (1 + (n % 7));
    }

    const imDeal = new Set(Array.from({ length: 20 }, (_, k) => String(250 + k)));
    let t = 1_000_000;
    const asked = [];
    const torn = {
        get: async (path) => {
            const id = path.split('/')[2];
            asked.push(id);
            const listings = imDeal.has(id) ? [{ price: 60, amount: 3 }] : [{ price: 99999, amount: 1 }];
            return {
                itemmarket: { item: { id: +id, average_price: 100 }, listings, cache_timestamp: Math.floor(t / 1000), cache_delay: 30 },
                _metadata: { total: 1 },
            };
        },
    };
    const w3bFetch = async (url) => {
        const path = new URL(url).pathname;
        const body =
            path === '/api/marketplace'
                ? { items: Array.from({ length: 40 }, (_, k) => ({ item_id: k + 1, item_name: 'I' + (k + 1), lowest_price: 70 })) }
                : { total_listings: 1, listings: [{ player_id: 9, player_name: 'S', price: 70, quantity: 2, last_checked: Math.floor(t / 1000) }] };
        return { ok: true, status: 200, json: async () => body };
    };

    const store = new Map();
    const full = { liveFeed: true, useW3b: true, ...settings };
    const feed = new LiveFeed({
        tabId: 'A',
        w3b: new W3bClient({ fetchImpl: w3bFetch, now: () => t }),
        torn,
        getIndex: () => index,
        getSettings: () => full,
        hasUsableKey: () => true,
        isVisible: () => true,
        load: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
        save: (k, v) => store.set(k, JSON.stringify(v)),
        now: () => t,
    });

    return (async () => {
        for (let i = 0; i < minutes * 20; i++) {
            await feed.tick();
            t += 3000;
        }
        const fe = readFeedCacheEntry(JSON.parse(store.get('feed')), t);
        const rows = feedOpportunities(fe, index, full, { now: t });
        const found = new Set(rows.filter((r) => r.source === 'itemmarket').map((r) => r.itemId));
        return { found: found.size, calls: asked.length, bazaarDriven: asked.filter((id) => +id <= 40).length };
    })();
}

for (const [label, settings] of [
    ['NPC only', { sellToNpc: true }],
    ['NPC + Market', { sellToNpc: true, resaleMarket: true }],
    ['NPC + Market + $1m cash', { sellToNpc: true, resaleMarket: true, cashOnHand: 1000000 }],
]) {
    test('discovery simulation, ' + label + ': most of the 20 Item Market deals are found in 10 minutes', async () => {
        const r = await simulate(settings);
        assert.ok(r.calls <= 300, 'inside the 30/min budget: ' + r.calls);
        assert.ok(r.found >= 12, 'found ' + r.found + ' of 20 (calls ' + r.calls + ', bazaar-driven ' + r.bazaarDriven + ')');
        assert.ok(r.bazaarDriven < r.calls / 3, 'TornW3B candidates do not take the budget: ' + r.bazaarDriven);
    });
}

test('sweep order: NPC items first, closest to value first; never a NaN comparison', () => {
    const byId = new Map([
        ['a', { id: 'a', sellPrice: 90, marketValue: 100 }],
        ['b', { id: 'b', sellPrice: 90, marketValue: 700 }],
        ['c', { id: 'c', sellPrice: null, marketValue: 500 }],
        ['d', { id: 'd', sellPrice: 90, marketValue: 200 }],
        ['e', { id: 'e', sellPrice: 0, marketValue: 0 }],
    ]);
    const index = { byId };

    assert.deepEqual(itemMarketSweepList(index, { sellToNpc: true }), ['a', 'd', 'b']);
    // With the Market chip: NPC items still first, then the resale-only item.
    assert.deepEqual(itemMarketSweepList(index, { sellToNpc: true, resaleMarket: true }), ['a', 'd', 'b', 'c']);
    // The order does not change without cash (the 3.7 NaN bug put ids in file order).
    assert.deepEqual(itemMarketSweepList(index, { sellToNpc: true, resaleMarket: true, cashOnHand: null }), ['a', 'd', 'b', 'c']);
    // Cash: an item you cannot afford one of at half its value is skipped.
    assert.deepEqual(itemMarketSweepList(index, { sellToNpc: true, resaleMarket: true, cashOnHand: 120 }), ['a', 'd']);

    assert.equal(finiteCmp(Infinity, Infinity), 0);
    assert.equal(finiteCmp(Infinity, 5), 1);
    assert.equal(finiteCmp(3, 5), -1);
    const c = selectCandidates([{ itemId: 'a', lowestPrice: 50 }, { itemId: 'd', lowestPrice: 50 }], index, { sellToNpc: true });
    assert.deepEqual(c.map((x) => x.itemId), ['a', 'd']);
});

test('a snapshot with listings is "live" only when one of them beats an exit', () => {
    const feed = emptyFeed();
    setItemMarketSnapshot(feed, '1', { rows: [{ price: 60, qty: 1 }], fetchedAt: 0 });
    setItemMarketSnapshot(feed, '2', { rows: [{ price: 99999, qty: 1 }], fetchedAt: 0 });
    setItemMarketSnapshot(feed, '3', { rows: [], fetchedAt: 0 });

    const deals = itemMarketLiveIds(feed, (id, price) => price < 90);
    assert.deepEqual(deals, ['1']);
    assert.deepEqual(itemMarketLiveIds(feed), ['1', '2'], 'the old rule, for comparison');
});

test('the planner gives discovery a slot every cycle and re-checks live rows before they expire', () => {
    const index = { byId: new Map([['hot', { id: 'hot', sellPrice: 100, marketValue: 120 }]]) };
    const feed = new LiveFeed({
        tabId: 'A', w3b: null, torn: null,
        getIndex: () => index,
        getSettings: () => ({ sellToNpc: true }),
        hasUsableKey: () => true, isVisible: () => true,
        load: () => null, save: () => {},
        now: () => 0,
    });
    feed.sweep = ['a', 'b', 'c'];
    feed.candidates = [{ itemId: 'cand', lowestPrice: 1 }];

    const f = emptyFeed();
    // A live deal fetched long ago, and a non-deal fetched long ago.
    setItemMarketSnapshot(f, 'hot', { rows: [{ price: 50, qty: 1 }], fetchedAt: 0, dataAt: 0, nextAt: 30000 });

    let now = LIVE_ROW_URGENT_MS + 1000;
    let order = feed.planItemMarket(f, [], now, 2);
    assert.deepEqual(order, ['hot', 'a'], 'urgent live row first, then one sweep item');

    now += 1000;
    setItemMarketSnapshot(f, 'hot', { rows: [{ price: 50, qty: 1 }], fetchedAt: now, dataAt: now, nextAt: now + 30000 });
    order = feed.planItemMarket(f, [], now + 31000, 2);
    assert.deepEqual(order, ['b', 'cand'], 'young live row waits; sweep and a candidate go');

    order = feed.planItemMarket(f, [], now + 34000, 2);
    assert.deepEqual(order, ['c', 'a'], 'the candidate is not asked again for two minutes; the sweep fills');

    order = feed.planItemMarket(f, ['hot'], now + 40000, 2);
    assert.equal(order[0], 'hot', 'an explicit re-check request goes first');
});
