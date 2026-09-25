import test from 'node:test';
import assert from 'node:assert/strict';

import {
    parseInventoryPage,
    mergeInventory,
    nextInventoryOffset,
    makeInventoryCacheEntry,
    readInventoryCacheEntry,
    inventoryRefreshDue,
    INVENTORY_TTL_MS,
    INVENTORY_RETRY_MS,
} from '../src/core/inventory.js';
import { fetchInventory, TORN_ERROR_ACCESS_LEVEL, TORN_INVENTORY_CATEGORIES } from '../src/api/torn.js';
import { TornApiClient } from '../src/api/client.js';
import {
    TeClient,
    TeQueue,
    TeError,
    parseTeBestListings,
    parseTeListings,
    parseTeActiveTraders,
    fetchTeListings,
    tePriceListUrl,
    TE_MIN_GAP_MS,
} from '../src/api/te.js';
import {
    makeTeCacheEntry,
    readTeCacheEntry,
    readTeItemLists,
    writeTeItemList,
    TE_MAX_AGE_MS,
} from '../src/core/selling.js';
import { tradersPageUrl, isTradersPageUrl, isOldTradersPageUrl, detectPage } from '../src/sources/route.js';

const KEY = 'abcdef1234567890';

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/* ============================================================== inventory */

const INVENTORY_PAGE = {
    inventory: {
        items: [
            { id: 206, amount: 12, equipped: false, name: 'Xanax', faction_owned: false, uid: null },
            { id: 206, amount: 3, equipped: false, name: 'Xanax', faction_owned: false, uid: 99 },
            { id: 1, amount: 1, equipped: true, name: 'Hammer', faction_owned: false, uid: 5 },
            { id: 180, amount: 40, equipped: false, name: 'Bottle of Beer', faction_owned: true, uid: null },
            { id: 180, amount: 2, equipped: false, name: 'Bottle of Beer', faction_owned: false, uid: null },
            { id: 'x', amount: 1, name: 'bad' },
            { id: 4, amount: 0, name: 'none' },
        ],
        timestamp: 1790000000,
    },
    _metadata: { links: { next: 'https://api.torn.com/v2/user/inventory?limit=250&offset=250', prev: null }, total: 300 },
};

test('inventory: stacks merge by item, equipped and faction-owned copies are left out', () => {
    const rows = parseInventoryPage(INVENTORY_PAGE);
    assert.equal(rows.length, 5, 'bad rows dropped');

    const merged = mergeInventory(rows);
    assert.deepEqual(merged, [
        { id: '180', name: 'Bottle of Beer', qty: 2 },
        { id: '206', name: 'Xanax', qty: 15 },
    ]);

    assert.equal(nextInventoryOffset(INVENTORY_PAGE), 250);
    assert.equal(nextInventoryOffset({ _metadata: { links: { next: null } } }), null);
    assert.throws(() => parseInventoryPage({}), /no inventory/);
});

test('inventory: the cache expires, and survives a JSON round trip', () => {
    const now = 5_000_000;
    const entry = JSON.parse(JSON.stringify(makeInventoryCacheEntry([{ id: '1', name: 'H', qty: 2 }], now)));
    assert.deepEqual(readInventoryCacheEntry(entry, now + 1000).items, [{ id: '1', name: 'H', qty: 2 }]);
    assert.equal(readInventoryCacheEntry(entry, now + INVENTORY_TTL_MS + 1), null);
    assert.equal(readInventoryCacheEntry(null, now), null);
});

test('fetchInventory pages with limit/offset, only against api.torn.com, and names access level 16', async () => {
    const urls = [];
    const client = new TornApiClient({
        getKey: () => KEY,
        maxRetries: 0,
        fetchImpl: async (url) => {
            urls.push(url);
            const u = new URL(url);
            assert.equal(u.hostname, 'api.torn.com');
            const offset = Number(u.searchParams.get('offset'));
            if (offset === 0) return response(200, INVENTORY_PAGE);
            return response(200, {
                inventory: { items: [{ id: 7, amount: 5, equipped: false, name: 'Seven', faction_owned: false, uid: null }], timestamp: 1 },
                _metadata: { links: { next: null } },
            });
        },
    });

    const rows = await fetchInventory(client);
    assert.equal(urls.length, 2);
    assert.equal(new URL(urls[0]).pathname, '/v2/user/inventory');
    assert.equal(new URL(urls[0]).searchParams.has('cat'), false, 'asked without a category first');
    assert.equal(new URL(urls[0]).searchParams.get('limit'), '250');
    assert.equal(new URL(urls[1]).searchParams.get('offset'), '250');
    assert.equal(rows.length, 6);
    assert.equal(mergeInventory(rows).length, 3);

    const denied = new TornApiClient({
        getKey: () => KEY,
        maxRetries: 0,
        fetchImpl: async () => response(200, { error: { code: 16, error: 'Access level of this key is not high enough' } }),
    });
    await assert.rejects(() => fetchInventory(denied), (e) => e.code === TORN_ERROR_ACCESS_LEVEL && /Limited/.test(e.message));
});

test('fetchInventory: "Incorrect category" without cat falls back to one paged read per category', async () => {
    assert.equal(TORN_INVENTORY_CATEGORIES.length, 25, 'TornInventoryItemType from the OpenAPI spec');
    assert.ok(TORN_INVENTORY_CATEGORIES.includes('Drug') && TORN_INVENTORY_CATEGORIES.includes('Energy Drink'));

    const urls = [];
    const client = new TornApiClient({
        getKey: () => KEY,
        maxRetries: 0,
        fetchImpl: async (url) => {
            urls.push(url);
            const u = new URL(url);
            const cat = u.searchParams.get('cat');
            const offset = Number(u.searchParams.get('offset') || 0);
            if (!cat) return response(200, { error: { code: 21, error: 'Incorrect category' } });
            if (cat === 'Artifact') return response(200, { error: { code: 21, error: 'Incorrect category' } });
            if (cat === 'Drug') {
                return offset === 0
                    ? response(200, { inventory: { items: [{ id: 206, amount: 12, name: 'Xanax' }] }, _metadata: { links: { next: 'https://api.torn.com/v2/user/inventory?cat=Drug&limit=250&offset=250' } } })
                    : response(200, { inventory: { items: [{ id: 206, amount: 3, name: 'Xanax' }] }, _metadata: { links: { next: null } } });
            }
            if (cat === 'Tool') return response(200, { inventory: { items: [{ id: 1, amount: 4, name: 'Hammer' }] }, _metadata: { links: { next: null } } });
            return response(200, { inventory: { items: [] }, _metadata: { links: { next: null } } });
        },
    });

    const rows = await fetchInventory(client);
    assert.equal(urls.length, 1 + TORN_INVENTORY_CATEGORIES.length + 1, 'one try without, then every category, Drug paged');
    const cats = urls.slice(1).map((u) => new URL(u).searchParams.get('cat'));
    assert.deepEqual([...new Set(cats)], TORN_INVENTORY_CATEGORIES);
    assert.deepEqual(mergeInventory(rows), [
        { id: '1', name: 'Hammer', qty: 4 },
        { id: '206', name: 'Xanax', qty: 15 },
    ]);

    // Any other error is not a reason to loop the categories.
    let calls = 0;
    const down = new TornApiClient({
        getKey: () => KEY,
        maxRetries: 0,
        fetchImpl: async () => (calls++, response(200, { error: { code: 9, error: 'API disabled' } })),
    });
    await assert.rejects(() => fetchInventory(down), /API disabled/);
    assert.equal(calls, 1);
});

test('inventory refresh: old is due, a failure waits its retry time, a rejected key waits for a new key', () => {
    const now = 1_900_000_000_000;
    const old = now - 16 * 60 * 1000;
    const ttl = 15 * 60 * 1000;
    assert.equal(inventoryRefreshDue({ inventoryAt: old, now, refreshMs: ttl }), true);
    assert.equal(inventoryRefreshDue({ inventoryAt: now - 1000, now, refreshMs: ttl }), false);
    assert.equal(inventoryRefreshDue({ inventoryAt: null, now, refreshMs: ttl }), true, 'never loaded: due');
    assert.equal(inventoryRefreshDue({ inventoryAt: old, retryAt: now + INVENTORY_RETRY_MS - 15000, now, refreshMs: ttl }), false, 'not every 15s after a failure');
    assert.equal(inventoryRefreshDue({ inventoryAt: old, retryAt: now - 1, now, refreshMs: ttl }), true);
    assert.equal(inventoryRefreshDue({ inventoryAt: old, keyDead: true, now, refreshMs: ttl }), false);
    assert.ok(INVENTORY_RETRY_MS >= 5 * 60 * 1000);
});

/* ========================================================== TornExchange */

const BEST = {
    status: 'success',
    data: {
        206: {
            item: 'Xanax',
            traders: [
                { trader: 'Bob', trader_id: 11, price: 820000, vote_score: 214 },
                { trader: 'Alice', trader_id: '12', price: 830000, vote_score: 40 },
                { trader: 'Stale', trader_id: 13, price: 990000, vote_score: 3 },
            ],
        },
        1: { item: 'Hammer', traders: [{ trader: 'Bob', trader_id: 11, price: 110, vote_score: 214 }] },
        bad: { item: 'x', traders: [] },
        2: { item: 'Junk', traders: [{ trader: 'NoId', price: 5 }, { trader: 'Zero', trader_id: 9, price: 0 }] },
    },
};

const LISTINGS = {
    status: 'success',
    data: {
        item: 'Xanax',
        meta: { total_listings: 4, total_pages: 1, current_page: 1 },
        listings: [
            { trader: 'Stale', price: 990000, item: 'Xanax' },
            { trader: 'Carol', price: 800000, item: 'Xanax' },
            { trader: 'Alice', price: 830000, item: 'Xanax' },
            { trader: 'Bob', price: 820000, item: 'Xanax' },
            { trader: '', price: 1 },
        ],
    },
};

test('TornExchange: the top buyers parse highest first; bad rows are dropped', () => {
    const map = parseTeBestListings(BEST);
    assert.deepEqual([...map.keys()].sort(), ['1', '206']);
    assert.deepEqual(map.get('206').map((t) => t.name), ['Stale', 'Alice', 'Bob']);
    assert.throws(() => parseTeBestListings({ status: 'success' }), /no trader prices/);
});

test('TornExchange: an item\'s full buyer list carries names only, highest first', async () => {
    const parsed = parseTeListings(LISTINGS);
    assert.deepEqual(parsed.traders.map((t) => t.name), ['Stale', 'Alice', 'Bob', 'Carol']);
    assert.equal(parsed.total, 4);

    const urls = [];
    let t = 1_000_000;
    const te = new TeClient({ getKey: () => 'TEKEY1', now: () => t, fetchImpl: async (url) => (urls.push(url), response(200, LISTINGS)) });
    const { traders, complete } = await fetchTeListings(te, 206);
    assert.equal(traders.length, 4);
    assert.equal(complete, true);
    const u = new URL(urls[0]);
    assert.equal(u.hostname, 'www.tornexchange.com');
    assert.equal(u.pathname, '/api/listings');
    assert.equal(u.searchParams.get('item_id'), '206');
    assert.equal(u.searchParams.get('order'), 'desc');
    assert.equal(u.searchParams.get('key'), 'TEKEY1');

    // Never two calls inside the gap: at most 6 a minute.
    assert.ok(TE_MIN_GAP_MS >= 10000);
    await assert.rejects(te.get('listings', { item_id: 1 }), /Too soon/);
    assert.equal(te.nextAllowedAt(), t + TE_MIN_GAP_MS);
    assert.equal(urls.length, 1);
    assert.throws(() => parseTeListings({ status: 'success', data: {} }), /no buyer list/);
});

test('TornExchange: active traders give a name -> id map', () => {
    const map = parseTeActiveTraders({ status: 'success', data: { ids: [11, 44], verbose: { 11: { name: 'Bob', torn_id: 11, last_trade: 1 }, 44: { name: 'Carol', torn_id: 44, last_trade: null } } } });
    assert.equal(map.get('carol'), '44');
    assert.equal(map.get('bob'), '11');
    assert.equal(parseTeActiveTraders({}).size, 0);
});

test('TornExchange client: its own key, its own host, a 429 waits, a 401 is a bad key', async () => {
    let t = 5_000_000;
    let calls = 0;
    const limited = new TeClient({
        getKey: () => 'k',
        now: () => t,
        fetchImpl: async () => {
            calls++;
            return response(429, { status: 'error', rate_limited: true, retry_after: 120 });
        },
    });
    await assert.rejects(limited.get('all_best_listings'), (e) => e.http === 429 && e.retryAfterMs === 120000);
    t += 60000;
    await assert.rejects(limited.get('all_best_listings'), (e) => e.http === 429);
    assert.equal(calls, 1, 'no request while TornExchange says wait');

    const denied = new TeClient({ getKey: () => 'k', fetchImpl: async () => response(401, { status: 'error', message: 'Invalid API key' }) });
    await assert.rejects(denied.get('all_best_listings'), (e) => e.badKey === true);

    const te = new TeClient({ getKey: () => 'k' });
    assert.throws(() => te.buildUrl('https://evil.example/x', 'k'), /Refusing/);
    assert.equal(tePriceListUrl('11'), 'https://www.tornexchange.com/prices/11/');
    assert.equal(tePriceListUrl('Carol'), 'https://www.tornexchange.com/prices/Carol/');
});

test('TornExchange pace and penalty are shared: a second tab (or a reload) cannot send inside the gap or the wait', async () => {
    const store = {};
    const shared = { loadState: () => store.te, saveState: (s) => (store.te = { ...(store.te || {}), ...s }) };
    let t = 5_000_000;
    let fetches = 0;
    let status = 200;
    const fetchImpl = async () => {
        fetches++;
        return status === 429
            ? response(429, { status: 'error', rate_limited: true, retry_after: 120 })
            : response(200, LISTINGS);
    };
    const tabA = new TeClient({ getKey: () => 'k', now: () => t, fetchImpl, ...shared });
    const tabB = new TeClient({ getKey: () => 'k', now: () => t, fetchImpl, ...shared });

    await tabA.get('listings', { item_id: 1 });
    assert.equal(store.te.lastRequestAt, t, 'the pace is written to storage');
    t += 1000;
    await assert.rejects(tabB.get('listings', { item_id: 2 }), (e) => e.tooSoon === true);
    assert.equal(fetches, 1, 'the other tab did not send');
    assert.equal(tabB.nextAllowedAt(), t - 1000 + TE_MIN_GAP_MS);

    t += TE_MIN_GAP_MS;
    status = 429;
    await assert.rejects(tabA.get('listings', { item_id: 1 }), (e) => e.http === 429);
    assert.equal(store.te.blockedUntil, t + 120000, 'the wait is written to storage');
    t += 60000;
    await assert.rejects(tabB.get('listings', { item_id: 3 }), (e) => e.http === 429 && e.retryAfterMs === 60000);
    assert.equal(fetches, 2, 'no request during the penalty from any tab');
    // A fresh client (a reload) reads the same wait.
    const reloaded = new TeClient({ getKey: () => 'k', now: () => t, fetchImpl, ...shared });
    assert.equal(reloaded.nextAllowedAt(), t + 60000);
});

/** A queue whose timers advance a fake clock instead of waiting. */
function fakeQueue(client, clock, extra = {}) {
    return new TeQueue({
        client,
        now: () => clock.t,
        setTimer: (fn, ms) => {
            clock.t += ms;
            Promise.resolve().then(fn);
        },
        ...extra,
    });
}

test('a buyer list of three pages is read one page per slot, then put together', async () => {
    const clock = { t: 7_000_000 };
    const calls = [];
    const te = new TeClient({
        getKey: () => 'k',
        now: () => clock.t,
        fetchImpl: async (url) => {
            const page = Number(new URL(url).searchParams.get('page'));
            calls.push({ page, at: clock.t });
            return response(200, {
                status: 'success',
                data: {
                    item: 'Xanax',
                    meta: { total_listings: 6, total_pages: 3, current_page: page },
                    listings: [{ trader: 'P' + page + 'a', price: 1000 - page * 10 }, { trader: 'P' + page + 'b', price: 1000 - page * 10 - 1 }],
                },
            });
        },
    });
    const queue = fakeQueue(te, clock);
    const { traders, total, complete } = await fetchTeListings(te, 206, { schedule: (fn) => queue.enqueue(fn) });
    assert.deepEqual(calls.map((c) => c.page), [1, 2, 3]);
    assert.ok(calls[1].at - calls[0].at >= TE_MIN_GAP_MS && calls[2].at - calls[1].at >= TE_MIN_GAP_MS, 'one page per slot');
    assert.equal(traders.length, 6);
    assert.deepEqual(traders.map((x) => x.name), ['P1a', 'P1b', 'P2a', 'P2b', 'P3a', 'P3b']);
    assert.equal(total, 6);
    assert.equal(complete, true);

    // Without the queue, page 2 follows page 1 inside the gap and is refused.
    calls.length = 0;
    await assert.rejects(fetchTeListings(te, 206), /Too soon/);
});

test('the queue: a too-soon refusal goes back to the front; another error fails that call only', async () => {
    const clock = { t: 8_000_000 };
    const te = new TeClient({ getKey: () => 'k', now: () => clock.t, fetchImpl: async () => response(200, LISTINGS) });
    const settled = [];
    const queue = fakeQueue(te, clock, { onSettled: (e) => settled.push(e ? e.message : null) });

    let tries = 0;
    const first = queue.enqueue(async () => {
        tries++;
        if (tries === 1) throw new TeError('Too soon to ask TornExchange again.', { retryAfterMs: 5000, tooSoon: true });
        return 'ok';
    });
    const second = queue.enqueue(async () => {
        throw new TeError('TornExchange HTTP 500.', { http: 500 });
    });
    const third = queue.enqueue(async () => te.get('listings', { item_id: 1 }));

    assert.equal(await first, 'ok');
    assert.equal(tries, 2);
    await assert.rejects(second, /500/);
    assert.equal((await third).status, 'success');
    assert.deepEqual(settled, [null, 'TornExchange HTTP 500.', null]);
    assert.equal(queue.length, 0);
});

/* ================================================================= caches */

test('trader price caches: round trips, ages out; per-item lists capped', () => {
    const now = 1_900_000_000_000;
    const map = parseTeBestListings(BEST);
    const entry = JSON.parse(JSON.stringify(makeTeCacheEntry(map, now)));
    assert.deepEqual(readTeCacheEntry(entry, now + 1000).map.get('206'), map.get('206'));
    assert.equal(readTeCacheEntry(entry, now + TE_MAX_AGE_MS + 1), null);

    let lists = writeTeItemList(null, '206', [{ name: 'Carol', price: 800000 }], now);
    lists = writeTeItemList(lists, '1', [{ name: 'Bob', price: 110 }], now + 1);
    const back = readTeItemLists(JSON.parse(JSON.stringify(lists)), now + 2);
    assert.deepEqual(back.get('206').traders, [{ name: 'Carol', price: 800000 }]);
    assert.equal(readTeItemLists(lists, now + 31 * 60 * 1000).size, 0);

    let many = null;
    for (let i = 0; i < 205; i++) many = writeTeItemList(many, String(i), [], now + i);
    assert.equal(Object.keys(many).length, 200);
    assert.equal(many['0'], undefined, 'oldest dropped');
});

test('traders page URL: our own page, not Torn; the old Torn address forwards to it', () => {
    assert.equal(new URL(tradersPageUrl()).hostname, 'abrahamdelosreyes17-oss.github.io');
    assert.equal(isTradersPageUrl(tradersPageUrl()), true);
    assert.equal(isTradersPageUrl(tradersPageUrl() + '?x=1#top'), true);
    assert.equal(isTradersPageUrl('https://www.torn.com/index.php'), false);
    assert.equal(detectPage(tradersPageUrl()), null);
    // 3.9.2 and before: Torn's home page with ?ttv2=traders is not drawn over any more.
    assert.equal(isTradersPageUrl('https://www.torn.com/index.php?ttv2=traders'), false);
    assert.equal(isOldTradersPageUrl('https://www.torn.com/index.php?ttv2=traders'), true);
    assert.equal(isOldTradersPageUrl(tradersPageUrl()), false);
    // The test harness keeps booting it with the marker on its own page.
    assert.equal(isTradersPageUrl('http://localhost:8765/test/harness-live.html?ttv2=traders'), true);
});
