import test from 'node:test';
import assert from 'node:assert/strict';

import {
    W3bClient,
    W3bError,
    W3B_COOLDOWN_MS,
    fetchW3bSummary,
    fetchW3bListings,
} from '../src/api/w3b.js';
import { TornApiClient, KEY_DEAD_CODES } from '../src/api/client.js';
import { fetchItemMarket, fetchItems, npcSaleFromValue, parseUserPresence } from '../src/api/torn.js';
import { agoText, presenceText } from '../src/sources/dom/owner.js';
import { buildItemIndex } from '../src/core/items.js';
import {
    emptyFeed,
    exitsFor,
    selectCandidates,
    normalizeW3bListings,
    normalizeItemMarketRows,
    setBazaarSnapshot,
    setItemMarketSnapshot,
    expireFeed,
    bazaarDue,
    itemMarketDue,
    reconcileWithPage,
    pageRowContradicted,
    bazaarUrl,
    feedOpportunities,
    makeFeedCacheEntry,
    readFeedCacheEntry,
    BAZAAR_MAX_DATA_AGE_MS,
    BAZAAR_SNAPSHOT_TTL_MS,
    ITEM_MARKET_SNAPSHOT_TTL_MS,
    BAZAAR_REFRESH_MS,
} from '../src/core/feed.js';
import { decideLeader, LEADER_STALE_MS } from '../src/core/leader.js';
import { bazaarOwnerId, bazaarTarget } from '../src/sources/route.js';
import {
    LiveFeed,
    FEED_STORE_KEY,
    FEED_LEADER_KEY,
    FEED_REFRESH_KEY,
} from '../src/feed/controller.js';

const KEY = 'abcdef1234567890';

function json(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: async () => body };
}

function notJson(status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            throw new SyntaxError('Unexpected token <');
        },
    };
}

function recorder(handler) {
    const calls = [];
    const impl = async (url) => {
        calls.push(url);
        return handler(url, calls.length);
    };
    impl.calls = calls;
    return impl;
}

/*
 * A tiny catalogue. Hammer: NPC pays $100, market $120.
 * Xanax: NPC pays $1,000? no - real sell prices are low; this is a fixture.
 */
const RAW_ITEMS = {
    1: { name: 'Hammer', sell_price: 100, market_value: 120 },
    206: { name: 'Xanax', sell_price: 600, market_value: 830000 },
    2: { name: 'Junk', sell_price: 0, market_value: 0 },
};

const index = buildItemIndex(RAW_ITEMS);
// NPC plus Item Market resale (5% tax) unless a test says otherwise.
const SETTINGS = { sellToNpc: true, resaleMarket: true, resaleBazaar: false, cashOnHand: null };

/* ================================================================ W3B client */

test('TornW3B client only ever contacts weav3r.dev, and never sends a key', async () => {
    const fetchImpl = recorder(async () => json({ items: [] }));
    const client = new W3bClient({ fetchImpl });

    await client.get('marketplace');
    await client.get('marketplace/206?key=' + KEY + '&maxPrice=5');

    for (const raw of fetchImpl.calls) {
        const url = new URL(raw);
        assert.equal(url.hostname, 'weav3r.dev');
        assert.equal(url.searchParams.get('key'), null);
        assert.ok(!raw.includes(KEY), 'no key anywhere in ' + raw);
        assert.deepEqual([...url.searchParams.keys()], ['comment']);
    }
});

test('TornW3B client refuses an absolute URL to another host', async () => {
    const fetchImpl = recorder(async () => json({}));
    const client = new W3bClient({ fetchImpl });

    await assert.rejects(() => client.get('https://evil.example/steal'), W3bError);
    assert.equal(fetchImpl.calls.length, 0);

    // A protocol-relative path is stripped to a relative one: still weav3r.dev.
    await client.get('//evil.example/x');
    assert.equal(new URL(fetchImpl.calls[0]).hostname, 'weav3r.dev');
});

test('a 429 from TornW3B pauses every further request for the cooldown', async () => {
    let t = 1_000_000;
    const fetchImpl = recorder(async () => json({}, { ok: false, status: 429 }));
    const client = new W3bClient({ fetchImpl, now: () => t });

    await assert.rejects(() => client.get('marketplace'), (e) => e.blocked === true);
    await assert.rejects(() => client.get('marketplace'), (e) => e.blocked === true);
    assert.equal(fetchImpl.calls.length, 1, 'second call never left the client');

    t += W3B_COOLDOWN_MS + 1;
    await assert.rejects(() => client.get('marketplace'));
    assert.equal(fetchImpl.calls.length, 2);
});

test('a Cloudflare challenge page (non-JSON) is treated as blocked', async () => {
    const client = new W3bClient({ fetchImpl: async () => notJson() });
    await assert.rejects(() => client.get('marketplace'), (e) => e.blocked === true);
    assert.equal(client.stats().coolingDown, true);
});

test('the TornW3B summary is read into one row per item', async () => {
    const client = new W3bClient({
        fetchImpl: async () =>
            json({
                total_count: 2,
                items: [
                    { item_id: 206, item_name: 'Xanax', market_price: 852268, bazaar_average: 846000, lowest_price: 829999, total_bazaars: 412 },
                    { item_id: 1, item_name: 'Hammer', market_price: 120, bazaar_average: null, lowest_price: null, total_bazaars: 0 },
                ],
            }),
    });

    const rows = await fetchW3bSummary(client);
    assert.deepEqual(rows[0], {
        itemId: '206',
        name: 'Xanax',
        lowestPrice: 829999,
        marketPrice: 852268,
        bazaarAverage: 846000,
        totalBazaars: 412,
    });
    assert.equal(rows[1].lowestPrice, null);
});

test('listings are re-asked once when TornW3B says there are some but sends none', async () => {
    const fetchImpl = recorder(async (_url, n) =>
        n === 1
            ? json({ total_listings: 3, listings: [] })
            : json({ total_listings: 1, listings: [{ player_id: 5, price: 50, quantity: 1 }] }),
    );
    const client = new W3bClient({ fetchImpl });

    const { listings } = await fetchW3bListings(client, 1);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(listings.length, 1);
});

/* ============================================================ Torn client */

test('v2 paths are sent without the v1 trailing slash', async () => {
    const fetchImpl = recorder(async () => json({ itemmarket: { listings: [] } }));
    const client = new TornApiClient({ getKey: () => KEY, fetchImpl, maxRetries: 0 });

    await client.get('v2/market/206/itemmarket', { limit: 20 });
    await client.get('torn', { selections: 'items' });

    assert.equal(new URL(fetchImpl.calls[0]).pathname, '/v2/market/206/itemmarket');
    assert.equal(new URL(fetchImpl.calls[1]).pathname, '/torn/');
});

test('a top-level {code, error} v2 error is still an error', async () => {
    const client = new TornApiClient({
        getKey: () => KEY,
        fetchImpl: async () => json({ code: 2, error: 'Incorrect key' }),
        maxRetries: 0,
    });

    await assert.rejects(
        () => client.get('v2/market/1/itemmarket'),
        (e) => e.code === 2 && KEY_DEAD_CODES.has(e.code),
    );
});

test('every tab draws on one shared request window', async () => {
    let shared = [];
    const mk = () =>
        new TornApiClient({
            getKey: () => KEY,
            fetchImpl: async () => json({}),
            maxRetries: 0,
            maxPerMinute: 3,
            dedupTtlMs: 0,
            loadWindow: () => shared,
            saveWindow: (w) => {
                shared = [...w];
            },
        });

    const tabA = mk();
    const tabB = mk();

    await tabA.get('torn', { a: 1 });
    await tabA.get('torn', { a: 2 });
    await tabB.get('torn', { b: 1 });

    assert.equal(tabB.stats().remaining, 0, 'tab B sees tab A\'s requests');
    assert.equal(tabA.stats().remaining, 0);
});

test('fetchItemMarket reads the v2 shape and when Torn will next refresh it', async () => {
    const client = {
        get: async (path, params) => {
            assert.equal(path, 'v2/market/206/itemmarket');
            assert.equal(params.limit, 20);
            return {
                itemmarket: {
                    item: { id: 206, name: 'Xanax', average_price: 851096 },
                    listings: [
                        { price: 873000, amount: 5 },
                        { price: 873000, amount: 2 },
                        { price: 0, amount: 1 },
                    ],
                    cache_timestamp: 1787334782,
                    cache_delay: 30,
                },
                _metadata: { total: 193 },
            };
        },
    };

    const m = await fetchItemMarket(client, 206);
    assert.equal(m.listings.length, 2);
    assert.equal(m.averagePrice, 851096);
    assert.equal(m.cacheTimestamp, 1787334782000);
    assert.equal(m.nextAt, 1787334782000 + 30000);
    assert.equal(m.total, 193);

    assert.deepEqual(normalizeItemMarketRows(m.listings), [{ price: 873000, qty: 7 }]);
});

/* ================================================================ feed core */

test('exitsFor: Sell to NPC is the default; resale exits only when chosen', () => {
    const hammer = index.byId.get('1');
    assert.deepEqual(exitsFor(hammer, {}), { NPC: 100 }, 'defaults: NPC only');
    assert.deepEqual(exitsFor(hammer, SETTINGS), { NPC: 100, ITEM_MARKET: 120 });
    assert.deepEqual(exitsFor(hammer, { resaleBazaar: true }), { NPC: 100, BAZAAR_RESALE: 120 });
    assert.deepEqual(exitsFor(hammer, { sellToNpc: false, resaleMarket: true }), { ITEM_MARKET: 120 });
    assert.deepEqual(exitsFor(index.byId.get('2'), SETTINGS), {});
});

test('an item with no NPC sell price ("Sell: N/A") never gets an NPC price', () => {
    const idx = buildItemIndex({
        900: { name: 'Companion Script : Ubay', sell_price: null, market_value: 10088888 },
        18: { name: 'Beretta M9', sell_price: 3800, market_value: 3542 },
    });

    assert.deepEqual(exitsFor(idx.byId.get('900'), {}), {});
    assert.deepEqual(exitsFor(idx.byId.get('18'), {}), { NPC: 3800 });

    // A Beretta listed at $3,600 is an NPC flip even though it is ABOVE its
    // average value ($3,542): the NPC pays $3,800.
    const c = selectCandidates(
        [{ itemId: '900', lowestPrice: 10319999 }, { itemId: '18', lowestPrice: 3600 }],
        idx,
        {},
    );
    assert.deepEqual(c.map((x) => x.itemId), ['18']);
    assert.equal(c[0].profitPerUnit, 200);
});

test('candidates come from one summary call, best edge first', () => {
    const summary = [
        { itemId: '1', lowestPrice: 60 }, // +$54 vs market (120*.95=114)
        { itemId: '206', lowestPrice: 900000 }, // above every exit
        { itemId: '999', lowestPrice: 1 }, // not in the catalogue
        { itemId: '2', lowestPrice: 1 }, // no exit at all
    ];

    const c = selectCandidates(summary, index, SETTINGS);
    assert.deepEqual(c.map((x) => x.itemId), ['1']);
    assert.equal(c[0].profitPerUnit, 54);
});

test('TornW3B listings: no seller means no row, and we sort by price ourselves', () => {
    const rows = normalizeW3bListings([
        { player_id: 9, player_name: 'Sponsor', price: 90, quantity: 1, last_checked: 1_790_000_300, sponsored: 1 },
        { player_id: null, price: 10, quantity: 5, last_checked: 1_790_000_300 },
        { player_id: 7, player_name: 'Cheap', price: 50, quantity: 3, last_checked: 1_790_000_000, content_updated: 1_789_999_000 },
        { player_id: 8, price: 60, quantity: 0 },
    ]);

    assert.deepEqual(rows.map((r) => r.sellerId), ['7', '9']);
    assert.equal(rows[0].dataAt, 1_790_000_000_000, 'unix seconds -> ms');
    assert.equal(rows[0].changedAt, 1_789_999_000_000);
});

test('a listing with no timestamp is "age unknown", not "ancient"', () => {
    const [row] = normalizeW3bListings([{ player_id: 7, price: 50, quantity: 1 }]);
    assert.equal(row.dataAt, null);

    // Kept for as long as the snapshot that returned it is current...
    const feed = emptyFeed();
    setBazaarSnapshot(feed, '1', [row], 1000);
    expireFeed(feed, 1000 + BAZAAR_SNAPSHOT_TTL_MS - 1);
    assert.equal(feed.bazaar.get('1').rows.length, 1);

    // ...and removed with it.
    expireFeed(feed, 1000 + BAZAAR_SNAPSHOT_TTL_MS + 1);
    assert.equal(feed.bazaar.size, 0);
});

test('a new snapshot REPLACES the old one - a sold listing cannot survive a refresh', () => {
    const feed = emptyFeed();
    const t = 1_000_000;

    setBazaarSnapshot(feed, '1', [
        { sellerId: '7', price: 50, qty: 1, dataAt: t },
        { sellerId: '8', price: 55, qty: 1, dataAt: t },
    ], t);

    // Seller 7 sold out. The next fetch no longer includes them.
    setBazaarSnapshot(feed, '1', [{ sellerId: '8', price: 55, qty: 1, dataAt: t + 60000 }], t + 60000);

    assert.deepEqual(feed.bazaar.get('1').rows.map((r) => r.sellerId), ['8']);
});

test('bazaar rows expire on the SOURCE\'s age, not on when we fetched', () => {
    const feed = emptyFeed();
    const t = 10_000_000;

    setBazaarSnapshot(feed, '1', [
        { sellerId: '7', price: 50, qty: 1, dataAt: t - BAZAAR_MAX_DATA_AGE_MS - 1 },
        { sellerId: '8', price: 55, qty: 1, dataAt: t - 1000 },
    ], t);

    const removed = expireFeed(feed, t);
    assert.equal(removed, 1);
    assert.deepEqual(feed.bazaar.get('1').rows.map((r) => r.sellerId), ['8']);
});

test('Item Market snapshots die when not refreshed', () => {
    const feed = emptyFeed();
    setItemMarketSnapshot(feed, '1', { rows: [{ price: 50, qty: 1 }], fetchedAt: 0, dataAt: 0, nextAt: 30000 });

    expireFeed(feed, ITEM_MARKET_SNAPSHOT_TTL_MS - 1);
    assert.equal(feed.itemmarket.size, 1);
    expireFeed(feed, ITEM_MARKET_SNAPSHOT_TTL_MS + 1);
    assert.equal(feed.itemmarket.size, 0);
});

test('refetch timing respects both sources\' caches', () => {
    const feed = emptyFeed();
    const t = 1_000_000;

    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 50 }, t), true);

    setBazaarSnapshot(feed, '1', [{ sellerId: '7', price: 50, qty: 1, dataAt: t }], t);
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 50 }, t + 1000), false);
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 45 }, t + 1000), true, 'price moved');
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 50 }, t + BAZAAR_REFRESH_MS), true);

    setItemMarketSnapshot(feed, '1', { rows: [], fetchedAt: t, nextAt: t + 30000 });
    assert.equal(itemMarketDue(feed, '1', t + 29999), false);
    assert.equal(itemMarketDue(feed, '1', t + 30000), true);
});

test('the page you are viewing overrules the feed when it shows a higher price', () => {
    const feed = emptyFeed();
    const t = 1_000_000;

    setBazaarSnapshot(feed, '1', [
        { sellerId: '7', price: 50, qty: 1, dataAt: t },
        { sellerId: '8', price: 40, qty: 1, dataAt: t },
    ], t);
    setItemMarketSnapshot(feed, '1', { rows: [{ price: 45, qty: 2 }, { price: 70, qty: 1 }], fetchedAt: t });

    // On seller 7's bazaar, Hammer is now $80: their $50 listing is gone.
    let removed = reconcileWithPage(feed, {
        pageType: 'bazaar',
        sellerId: '7',
        listings: [{ itemId: '1', listingPrice: 80 }],
    });
    assert.equal(removed, 1);
    assert.deepEqual(feed.bazaar.get('1').rows.map((r) => r.sellerId), ['8'], 'other sellers untouched');

    // The Item Market page's cheapest Hammer is $60: the $45 row sold.
    removed = reconcileWithPage(feed, {
        pageType: 'itemmarket',
        sellerId: null,
        listings: [{ itemId: '1', listingPrice: 60 }],
    });
    assert.equal(removed, 1);
    assert.deepEqual(feed.itemmarket.get('1').rows.map((r) => r.price), [70]);
});

test('absence from a bazaar page proves nothing - it renders lazily', () => {
    const feed = emptyFeed();
    setBazaarSnapshot(feed, '1', [{ sellerId: '7', price: 50, qty: 1, dataAt: 1 }], 1);

    const removed = reconcileWithPage(feed, { pageType: 'bazaar', sellerId: '7', listings: [] });
    assert.equal(removed, 0);
});

test('feed rows are priced like page rows and link to the right place', () => {
    const feed = emptyFeed();
    const t = 1_000_000;

    setBazaarSnapshot(feed, '1', [{ sellerId: '7', sellerName: 'Bob', price: 50, qty: 3, dataAt: t - 2000 }], t);
    setItemMarketSnapshot(feed, '1', { rows: [{ price: 200, qty: 1 }], fetchedAt: t, dataAt: t - 5000 });

    const rows = feedOpportunities(feed, index, SETTINGS, {
        now: t,
        itemMarketUrl: (id) => 'im:' + id,
    });

    assert.equal(rows.length, 1, 'the $200 Item Market row is above every exit');
    const [r] = rows;
    assert.equal(r.source, 'bazaar');
    assert.equal(r.profit.venue, 'ITEM_MARKET');
    assert.equal(r.profit.profitPerUnit, 64); // 120*.95 - 50
    assert.equal(r.profit.totalProfit, 192);
    assert.equal(r.ageMs, 2000);
    assert.equal(r.url, bazaarUrl('7', '1', 50));
    assert.equal(new URL(r.url).searchParams.get('userId'), '7');
});

test('the feed survives storage and drops what expired meanwhile', () => {
    const feed = emptyFeed();
    const t = 1_000_000;
    setBazaarSnapshot(feed, '1', [{ sellerId: '7', price: 50, qty: 1, dataAt: t }], t);

    const stored = JSON.parse(JSON.stringify(makeFeedCacheEntry(feed, t)));
    assert.equal(readFeedCacheEntry(stored, t + 1000).bazaar.size, 1);
    assert.equal(readFeedCacheEntry(stored, t + BAZAAR_SNAPSHOT_TTL_MS + 1).bazaar.size, 0);
    assert.equal(readFeedCacheEntry({ version: 'old' }, t).bazaar.size, 0);
});

/* ================================================================== routing */

test('bazaar owner and link target come from the URL', () => {
    const url = bazaarUrl('123', '206', 829999);
    assert.equal(bazaarOwnerId(url), '123');
    assert.deepEqual(bazaarTarget(url), { itemId: '206', price: 829999 });

    assert.equal(bazaarOwnerId('https://www.torn.com/bazaar.php#/'), null);
    assert.equal(bazaarTarget('https://www.torn.com/bazaar.php?userId=1#/'), null);
    assert.equal(bazaarOwnerId('https://www.torn.com/page.php?sid=ItemMarket&userId=5'), null);
});

/* =================================================================== leader */

test('only one visible tab leads, and a hidden leader steps down', () => {
    const now = 100_000;

    let d = decideLeader(null, 'A', { now, visible: true });
    assert.deepEqual([d.lead, d.confirmed], [true, false], 'claims, not yet confirmed');

    const record = d.write;
    d = decideLeader(record, 'B', { now: now + 1000, visible: true });
    assert.equal(d.lead, false, 'B defers to a fresh leader');

    d = decideLeader(record, 'A', { now: now + 5000, visible: true });
    assert.deepEqual([d.lead, d.confirmed], [true, true]);

    d = decideLeader(record, 'A', { now: now + 6000, visible: false });
    assert.equal(d.lead, false);
    assert.deepEqual(d.write, { id: null, ts: 0 }, 'hidden leader releases');

    d = decideLeader({ id: 'A', ts: now }, 'B', { now: now + LEADER_STALE_MS + 1, visible: true });
    assert.equal(d.lead, true, 'a dead leader is replaced');

    d = decideLeader(null, 'C', { now, visible: false });
    assert.equal(d.lead, false, 'a hidden tab never claims');
});

/* =============================================================== controller */

function memoryStore() {
    const data = new Map();
    return {
        data,
        load: (k) => (data.has(k) ? JSON.parse(data.get(k)) : null),
        save: (k, v) => data.set(k, JSON.stringify(v)),
    };
}

function makeFeed({ store, tabId = 'A', visible = true, settings = {}, w3bFetch, tornGet, now }) {
    const w3b = new W3bClient({ fetchImpl: w3bFetch, now });
    return new LiveFeed({
        tabId,
        w3b,
        torn: { get: tornGet || (async () => ({ itemmarket: { listings: [] } })) },
        getIndex: () => index,
        getSettings: () => ({ ...SETTINGS, liveFeed: true, useW3b: true, ...settings }),
        hasUsableKey: () => true,
        isVisible: () => visible,
        load: store.load,
        save: store.save,
        now,
    });
}

function w3bServer() {
    return recorder(async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/marketplace') {
            return json({ items: [{ item_id: 1, item_name: 'Hammer', lowest_price: 50, market_price: 120 }] });
        }
        return json({
            total_listings: 1,
            listings: [{ player_id: 7, player_name: 'Bob', price: 50, quantity: 2, last_checked: 1_000 }],
        });
    });
}

test('the leader polls; a second visible tab does not', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const now = () => t;

    const fetchA = w3bServer();
    const fetchB = w3bServer();
    const tornCalls = [];

    const a = makeFeed({ store, tabId: 'A', w3bFetch: fetchA, now, tornGet: async (p) => (tornCalls.push(p), { itemmarket: { listings: [] } }) });
    const b = makeFeed({ store, tabId: 'B', w3bFetch: fetchB, now });

    await a.tick(); // A claims
    await b.tick(); // B sees a fresh leader
    assert.equal(fetchA.calls.length + fetchB.calls.length, 0, 'nobody polls on a mere claim');

    t += 5000;
    await a.tick(); // A confirmed -> polls
    await b.tick();

    assert.ok(fetchA.calls.length >= 2, 'A fetched the summary and a candidate');
    assert.equal(fetchB.calls.length, 0);
    assert.ok(tornCalls.length >= 1);
    assert.ok(tornCalls.length <= 2, 'Torn budget per cycle respected');

    const stored = readFeedCacheEntry(store.load(FEED_STORE_KEY), t);
    assert.deepEqual(stored.bazaar.get('1').rows.map((r) => r.sellerId), ['7']);
});

test('a hidden tab does nothing and hands over leadership', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const fetchImpl = w3bServer();

    store.save(FEED_LEADER_KEY, { id: 'A', ts: t });
    const a = makeFeed({ store, tabId: 'A', visible: false, w3bFetch: fetchImpl, now: () => t });

    await a.tick();
    assert.equal(fetchImpl.calls.length, 0);
    assert.deepEqual(store.load(FEED_LEADER_KEY), { id: null, ts: 0 });
});

test('with TornW3B not opted in, it is never contacted', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const fetchImpl = w3bServer();
    const a = makeFeed({ store, w3bFetch: fetchImpl, settings: { useW3b: false }, now: () => t });

    await a.tick();
    t += 5000;
    await a.tick();

    assert.equal(fetchImpl.calls.length, 0);
});

test('an item that drops out of the summary loses its bazaar rows at once', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    let cheap = true;

    const fetchImpl = recorder(async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/marketplace') {
            return json({ items: [{ item_id: 1, lowest_price: cheap ? 50 : 500 }] });
        }
        return json({ total_listings: 1, listings: [{ player_id: 7, price: 50, quantity: 1, last_checked: t / 1000 }] });
    });

    const a = makeFeed({ store, w3bFetch: fetchImpl, now: () => t });
    await a.tick();
    t += 5000;
    await a.tick();
    assert.equal(readFeedCacheEntry(store.load(FEED_STORE_KEY), t).bazaar.size, 1);

    cheap = false;
    t += 61000;
    await a.tick();
    assert.equal(readFeedCacheEntry(store.load(FEED_STORE_KEY), t).bazaar.size, 0);
});

test('the Item Market sweep covers every item, even with candidates queued', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const asked = [];

    const feed = makeFeed({
        store,
        now: () => t,
        settings: { useW3b: false },
        tornGet: async (path) => {
            asked.push(path.split('/')[2]);
            return { itemmarket: { listings: [], cache_timestamp: Math.floor(t / 1000), cache_delay: 30 } };
        },
    });
    feed.sweep = ['a', 'b', 'c', 'd', 'e'];

    await feed.tick(); // claim
    for (let i = 0; i < 12; i++) {
        t += 31000; // everything's 30s cache has expired
        feed.tornSpent = [];
        // A priority item is queued every cycle: it must not starve the sweep.
        feed.requestRecheck(['hot']);
        await feed.tick();
    }

    for (const id of ['a', 'b', 'c', 'd', 'e', 'hot']) {
        assert.ok(asked.includes(id), 'swept ' + id);
    }
});

// Captured from the live API, 2026-09-24 (trimmed to `value`).
const LIVE_VALUES = {
    15: { name: 'Beretta M9', value: { vendor: { country: 'Torn', name: "Big Al's Gun Shop" }, shops: [{ country: 'Torn', shop: "Big Al's Gun Shop", buy_price: 2000, sell_price: 1300 }], buy_price: 2000, sell_price: 1300, market_price: 1066 } },
    181: { name: 'Bottle of Champagne', value: { vendor: { country: 'Torn', name: "Bits 'n' Bobs" }, shops: [{ country: 'Torn', shop: "Bits 'n' Bobs", buy_price: 4500, sell_price: 3100 }], buy_price: 4500, sell_price: 3100, market_price: 2932 } },
    456: { name: 'Companion Script : Ubay', value: { vendor: null, shops: [], buy_price: null, sell_price: 12000000, market_price: 0 } },
    335: { name: 'Stick of Dynamite', value: { vendor: { country: 'China', name: 'General Store' }, shops: [{ country: 'China', shop: 'General Store', buy_price: 50000, sell_price: 37500 }], buy_price: 50000, sell_price: null, market_price: 9172 } },
    326: { name: 'Printing Paper', value: { vendor: { country: 'China', name: 'General Store' }, shops: [{ country: 'China', shop: 'General Store', buy_price: 75000, sell_price: 56250 }], buy_price: 75000, sell_price: null, market_price: 48977 } },
    440: { name: 'Pillow', value: { vendor: { country: 'Torn', name: "Big Al's Gun Shop" }, shops: [{ country: 'UAE', shop: 'Arms Dealer', buy_price: null, sell_price: 75 }, { country: 'Torn', shop: "Big Al's Gun Shop", buy_price: null, sell_price: 150 }], buy_price: null, sell_price: 150, market_price: 880 } },
    159: { name: 'Bolt Cutters', value: { vendor: { country: 'Mexico', name: 'General Store' }, shops: [{ country: 'Mexico', shop: 'General Store', buy_price: 25, sell_price: 15 }], buy_price: 25, sell_price: 15, market_price: 446 } },
    4: { name: 'Knuckle Dusters', value: { vendor: { country: 'Torn', name: "Big Al's Gun Shop" }, shops: [{ country: 'South Africa', shop: 'Arms Dealer', buy_price: 750, sell_price: 500 }, { country: 'Torn', shop: "Big Al's Gun Shop", buy_price: null, sell_price: 500 }], buy_price: 750, sell_price: 500, market_price: 263 } },
    1290: { name: 'Toner', value: { vendor: { country: 'Torn', name: 'Print Shop' }, shops: [{ country: 'Torn', shop: 'Print Shop', buy_price: 800, sell_price: null }], buy_price: 800, sell_price: null, market_price: 357 } },
};

const npc = (id) => npcSaleFromValue(LIVE_VALUES[id].value);

test('an NPC price needs sell_price AND a shop in Torn - each field lies alone', () => {
    assert.deepEqual(npc(15), { price: 1300, shop: "Big Al's Gun Shop" });
    assert.deepEqual(npc(181), { price: 3100, shop: "Bits 'n' Bobs" });
    assert.deepEqual(npc(4), { price: 500, shop: "Big Al's Gun Shop" });

    // sell_price says $12m; the game says N/A; no shop at all.
    assert.deepEqual(npc(456), { price: null, shop: null });
    // A foreign shop lists 75% of its buy price; sell_price is null; game says N/A.
    assert.deepEqual(npc(335), { price: null, shop: null });
    assert.deepEqual(npc(326), { price: null, shop: null });
    // Only sold abroad - you cannot sell abroad.
    assert.deepEqual(npc(159), { price: null, shop: null });
    // A Torn shop that only sells it, never buys it back.
    assert.deepEqual(npc(1290), { price: null, shop: null });
    // Two shops: the Torn one, not the foreign one.
    assert.deepEqual(npc(440), { price: 150, shop: "Big Al's Gun Shop" });

    // A payload from before `shops` existed: only a vendor in Torn counts.
    assert.deepEqual(npcSaleFromValue({ vendor: { country: 'Torn', name: 'X' }, sell_price: 50 }), { price: 50, shop: 'X' });
    assert.deepEqual(npcSaleFromValue({ vendor: { country: 'China', name: 'X' }, sell_price: 50 }), { price: null, shop: null });
    assert.deepEqual(npcSaleFromValue({ vendor: null, sell_price: 50 }), { price: null, shop: null });
});

test('the item list comes from v2 and never prices a shop-less item for an NPC', async () => {
    const asked = [];
    const client = {
        get: async (path) => {
            asked.push(path);
            return {
                items: Object.entries(LIVE_VALUES).map(([id, i]) => ({ id: +id, name: i.name, type: 'Other', value: i.value })),
                _metadata: { links: { next: null } },
            };
        },
    };

    const idx = buildItemIndex(await fetchItems(client));
    assert.deepEqual(asked, ['v2/torn/items']);

    assert.equal(idx.byId.get('15').sellPrice, 1300);
    assert.equal(idx.byId.get('15').npcShopName, "Big Al's Gun Shop");
    assert.equal(idx.byId.get('181').sellPrice, 3100);
    assert.equal(idx.byId.get('456').sellPrice, 0);

    // The exact row from the screenshot: $11,000,000 on the Item Market.
    const c = selectCandidates([{ itemId: '456', lowestPrice: 11000000 }], idx, {});
    assert.equal(c.length, 0, 'no NPC flip on a Sell: N/A item');
});

test('if v2 fails for a non-key reason, v1 is used instead', async () => {
    const client = {
        get: async (path) => {
            if (path === 'v2/torn/items') throw Object.assign(new Error('shape'), { code: 23 });
            return { items: { 18: { name: 'Beretta M9', sell_price: 3800, market_value: 3542 } } };
        },
    };
    const raw = await fetchItems(client);
    assert.equal(raw['18'].sell_price, 3800);
});

test('a dead key is not retried against v1', async () => {
    let calls = 0;
    const client = {
        get: async () => {
            calls += 1;
            throw Object.assign(new Error('Incorrect key'), { code: 2 });
        },
    };
    await assert.rejects(() => fetchItems(client));
    assert.equal(calls, 1);
});

test('a page listing is removed once fresher data proves it sold', () => {
    const feed = emptyFeed();
    const loaded = 1_000_000;

    // Item Market: the page showed Beretta at $3,600 when it loaded.
    const imRow = { itemId: '18', source: 'itemmarket', seenAt: loaded, listingPrice: 3600 };

    setItemMarketSnapshot(feed, '18', { rows: [{ price: 3600, qty: 1 }], fetchedAt: loaded - 5000, dataAt: loaded - 5000 });
    assert.equal(pageRowContradicted(feed, imRow), false, 'older data proves nothing');

    setItemMarketSnapshot(feed, '18', { rows: [{ price: 3600, qty: 1 }], fetchedAt: loaded + 30000, dataAt: loaded + 30000 });
    assert.equal(pageRowContradicted(feed, imRow), false, 'still listed');

    setItemMarketSnapshot(feed, '18', { rows: [{ price: 3900, qty: 2 }], fetchedAt: loaded + 60000, dataAt: loaded + 60000 });
    assert.equal(pageRowContradicted(feed, imRow), true, 'cheapest is now $3,900: it sold');

    // Bazaar: seller 42 re-checked by TornW3B after the page loaded, now dearer.
    const bzRow = { itemId: '18', source: 'bazaar', sellerId: '42', seenAt: loaded, listingPrice: 3600 };
    setBazaarSnapshot(feed, '18', [{ sellerId: '99', price: 3500, qty: 1, dataAt: loaded + 1000 }], loaded + 1000);
    assert.equal(pageRowContradicted(feed, bzRow), false, 'seller not tracked: proves nothing');

    setBazaarSnapshot(feed, '18', [{ sellerId: '42', price: 4000, qty: 1, dataAt: loaded + 1000 }], loaded + 1000);
    assert.equal(pageRowContradicted(feed, bzRow), true);
});

test('Scan in any tab makes the leader rebuild everything at once', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const fetchImpl = w3bServer();
    const feed = makeFeed({ store, w3bFetch: fetchImpl, now: () => t });

    await feed.tick();
    t += 3000;
    await feed.tick();
    const firstPass = fetchImpl.calls.length;
    assert.ok(firstPass >= 2);

    // 10s later nothing is due yet...
    t += 10000;
    await feed.tick();
    assert.equal(fetchImpl.calls.length, firstPass);

    // ...until Scan (from another tab object sharing the store).
    const other = makeFeed({ store, tabId: 'B', w3bFetch: w3bServer(), now: () => t });
    other.requestRefresh();
    assert.equal(store.load(FEED_STORE_KEY), null, 'feed cleared at once');
    assert.ok(store.load(FEED_REFRESH_KEY) > 0);

    t += 3000;
    await feed.tick();
    assert.ok(fetchImpl.calls.length >= firstPass + 2, 'summary and listings fetched again');
});

test('items with a live Item Market row are re-checked on every refresh', async () => {
    const store = memoryStore();
    let t = 1_000_000;
    const asked = [];

    const feed = makeFeed({
        store,
        now: () => t,
        settings: { useW3b: false },
        tornGet: async (path) => {
            const id = path.split('/')[2];
            asked.push(id);
            return { itemmarket: { listings: id === '1' ? [{ price: 10, amount: 1 }] : [], cache_timestamp: Math.floor(t / 1000), cache_delay: 30 } };
        },
    });
    feed.sweep = ['1', 'x', 'y', 'z', 'w', 'v'];

    await feed.tick();
    for (let i = 0; i < 30; i++) {
        t += 3000;
        feed.tornSpent = [];
        await feed.tick();
    }

    // ~90s of ticks: item 1 (a live opportunity) re-checked every ~30s.
    const hits = asked.filter((id) => id === '1').length;
    assert.ok(hits >= 3, 'item 1 re-checked ' + hits + ' times');
});

test('bazaar owner presence: v2 and v1 shapes, and the words shown', () => {
    const now = 1_800_000_000_000;
    const la = { status: 'Idle', timestamp: now / 1000 - 12 * 60, relative: '12 minutes ago' };
    const v2 = parseUserPresence({ profile: { name: 'Dixie', last_action: la, status: { state: 'Okay', description: 'Okay' } } });
    const v1 = parseUserPresence({ name: 'Dixie', last_action: la, status: { state: 'Okay', description: 'Okay' } });
    assert.deepEqual(v1, v2);
    assert.equal(v2.online, 'Idle');
    assert.deepEqual(presenceText(v2, now), { level: 'idle', text: 'Idle · 12m ago' });

    const online = parseUserPresence({ profile: { name: 'X', last_action: { status: 'Online', timestamp: now / 1000 }, status: { state: 'Hospital', description: 'In hospital for 20 mins' } } });
    assert.deepEqual(presenceText(online, now), { level: 'online', text: 'Online · In hospital for 20 mins' });

    assert.equal(parseUserPresence({ error: { code: 6 } }), null);
    assert.equal(presenceText(null).level, 'unknown');
    assert.equal(agoText(now - 30_000, now), 'just now');
    assert.equal(agoText(now - 3 * 3600_000, now), '3h ago');
    assert.equal(agoText(now - 2 * 86400_000, now), '2d ago');
});
