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
import { fetchItemMarket } from '../src/api/torn.js';
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
import {
    recordSightings,
    pruneLedger,
    ledgerRows,
    makeLedgerCacheEntry,
    readLedgerCacheEntry,
} from '../src/core/ledger.js';
import { bazaarOwnerId, bazaarTarget } from '../src/sources/route.js';
import {
    LiveFeed,
    FEED_STORE_KEY,
    FEED_LEADER_KEY,
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
// Priced as Item Market resales (5% tax) unless a test says otherwise.
const SETTINGS = { compareNpc: true, compareMarket: true, cashOnHand: null, resaleInBazaar: false };

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

test('exitsFor honours the NPC / market switches', () => {
    const hammer = index.byId.get('1');
    assert.deepEqual(exitsFor(hammer, SETTINGS), { NPC: 100, ITEM_MARKET: 120 });
    assert.deepEqual(exitsFor(hammer, { ...SETTINGS, compareMarket: false }), { NPC: 100 });
    assert.deepEqual(exitsFor(hammer, { ...SETTINGS, npcShopsOnly: true }, null), { ITEM_MARKET: 120 });
    assert.deepEqual(exitsFor(index.byId.get('2'), SETTINGS), {});
    assert.deepEqual(exitsFor(hammer, { ...SETTINGS, resaleInBazaar: true }), { NPC: 100, BAZAAR_RESALE: 120 });
});

test('a Xanax 1% under market value is a margin in your bazaar, a loss on the Item Market', () => {
    // From a live bazaar: $838,745, shown as 1% under market value.
    const idx = buildItemIndex({ 206: { name: 'Xanax', sell_price: 600, market_value: 850000 } });
    const summary = [{ itemId: '206', lowestPrice: 838745 }];

    const taxed = selectCandidates(summary, idx, { ...SETTINGS, resaleInBazaar: false });
    assert.equal(taxed.length, 0, '850,000 x 0.95 = 807,500 < 838,745');

    const untaxed = selectCandidates(summary, idx, { ...SETTINGS, resaleInBazaar: true });
    assert.equal(untaxed.length, 1);
    assert.equal(untaxed[0].profitPerUnit, 11255);
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

    const feed = emptyFeed();
    setBazaarSnapshot(feed, '1', [row], 1000);
    expireFeed(feed, 1000 + BAZAAR_MAX_DATA_AGE_MS + 1);
    assert.equal(feed.bazaar.get('1').rows.length, 1, 'kept until the snapshot cap');

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

/* =================================================================== ledger */

function pageRow(id, name, price, profit, extra = {}) {
    return {
        itemId: id,
        name,
        qtyAtPrice: true,
        profit: {
            venue: 'NPC',
            listingPrice: price,
            exitPrice: price + profit,
            profitPerUnit: profit,
            roi: profit / price,
            qty: 1,
            affordableQty: 1,
            totalProfit: profit,
            realizableProfit: profit,
            cashRequired: price,
        },
        ...extra,
    };
}

test('re-reading an unchanged page does not make its prices younger', () => {
    const ledger = new Map();
    const loaded = 1_000_000;

    // The poll re-reads the same page 20 minutes later; the row still says
    // when the page first showed it.
    recordSightings(ledger, [pageRow('1', 'Hammer', 50, 50, { seenAt: loaded })], loaded + 20 * 60000);
    assert.equal(ledger.get('1').seenAt, loaded);

    pruneLedger(ledger, loaded + 20 * 60000);
    assert.equal(ledger.size, 0, 'and so it expires');
});

test('a bazaar sighting remembers whose bazaar it was', () => {
    const ledger = new Map();
    recordSightings(ledger, [pageRow('1', 'Hammer', 50, 50, { source: 'bazaar', sellerId: '42' })], 5);

    const [row] = ledgerRows(ledger);
    assert.equal(row.source, 'bazaar');
    assert.equal(row.sellerId, '42');
});

test('an entry with no valid time is dropped, not kept forever', () => {
    const ledger = new Map([['1', { itemId: '1', seenAt: undefined, realizableProfit: 1 }]]);
    pruneLedger(ledger, 1000);
    assert.equal(ledger.size, 0);

    const stored = makeLedgerCacheEntry(new Map([['1', { itemId: '1', seenAt: 'x' }]]), 0);
    assert.equal(readLedgerCacheEntry(stored, 0).size, 0);
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
