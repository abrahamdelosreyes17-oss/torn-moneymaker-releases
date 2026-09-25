import test from 'node:test';
import assert from 'node:assert/strict';

import {
    emptyTraderDb,
    readTraderDb,
    mergeTraderDbs,
    addTraders,
    parseW3bPriceList,
    recordW3bList,
    liveW3bPrices,
    nextW3bTrader,
    traderDbStats,
    buyersForItem,
    indexW3bByItem,
    onlineOnly,
    itemRows,
    traderLinksIn,
    traderNamesInText,
    W3B_LIST_MAX_AGE_MS,
    W3B_HELD_REFRESH_MS,
    W3B_OTHER_REFRESH_MS,
    W3B_MISSING_RECHECK_MS,
    W3B_ERROR_RETRY_MS,
    markW3bDue,
    pruneTraderDb,
    traderIdsByName,
} from '../src/core/traders.js';
import { W3bClient, fetchW3bPriceList, w3bPriceListUrl } from '../src/api/w3b.js';
import { scaleRange } from '../src/ui/graph.js';
import { parseTeActiveTraderList } from '../src/api/te.js';

const NOW = 1_900_000_000_000;

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A database where trader 11 (Bob) and 77 have TornW3B lists read just now. */
function dbWithLists(now = NOW) {
    const db = emptyTraderDb();
    addTraders(db, [{ id: 11, name: 'Bob' }, { id: 77, name: 'Zed' }, { id: 12, name: 'Alice' }], now);
    recordW3bList(db, 11, { prices: { 206: 852000 } }, now);
    recordW3bList(db, 77, { prices: { 206: 849500, 180: 61 } }, now);
    recordW3bList(db, 12, { prices: {} }, now);
    return db;
}

/* ============================================================ price lists */

test('a TornW3B price list keeps buying prices of real items only', () => {
    const prices = parseW3bPriceList([
        { itemId: 206, name: 'Xanax', buyPrice: 840000 },
        { itemId: 1, name: 'Hammer', buyPrice: 0 },
        { itemId: -1, name: 'Flower Set', buyPrice: 303717 },
        { itemId: 'x', buyPrice: 5 },
        null,
    ]);
    assert.deepEqual(prices, { 206: 840000 });
    assert.deepEqual(parseW3bPriceList({ error: 'Pricelist not found for this user' }), {});
});

test('fetchW3bPriceList: no key, weav3r.dev only, and "no list" (404 or []) is empty, not an error', async () => {
    const seen = [];
    const client = new W3bClient({
        fetchImpl: async (url) => {
            seen.push(url);
            if (url.includes('/pricelist/2?')) return response(404, { error: 'Pricelist not found for this user' });
            if (url.includes('/pricelist/4?')) return response(200, []);
            return response(200, [{ itemId: 206, buyPrice: 1 }]);
        },
    });
    assert.deepEqual(await fetchW3bPriceList(client, 2), []);
    assert.deepEqual(await fetchW3bPriceList(client, 4), []);
    assert.equal((await fetchW3bPriceList(client, '3727302')).length, 1);
    for (const url of seen) {
        const u = new URL(url);
        assert.equal(u.hostname, 'weav3r.dev');
        assert.deepEqual([...u.searchParams.keys()], ['comment']);
    }
    assert.equal(w3bPriceListUrl(3727302), 'https://weav3r.dev/pricelist/3727302');
});

test('a trader\'s TornW3B prices are shown for 6 hours after reading, then dropped', () => {
    const db = dbWithLists();
    assert.deepEqual(liveW3bPrices(db.traders[11], NOW + 1000), { 206: 852000 });
    assert.equal(liveW3bPrices(db.traders[11], NOW + W3B_LIST_MAX_AGE_MS + 1), null);
    // No list at all: nothing to show.
    assert.equal(liveW3bPrices(db.traders[12], NOW), null);
});

/* ============================================================== one row */

test('one row per trader: on both sites, the higher price and both sources; highest first', () => {
    const db = dbWithLists();
    const buyers = buyersForItem('206', {
        teBest: [{ name: 'Bob', id: '11', price: 850000, score: 214 }],
        teFull: [
            { name: 'Bob', price: 850000 },
            { name: 'Carol', price: 845000 },
            { name: 'Alice', price: 830000 },
        ],
        idsByName: new Map([['bob', '11'], ['carol', '44'], ['alice', '12']]),
        db,
        w3bByItem: indexW3bByItem(db, NOW),
    });
    assert.deepEqual(
        buyers.map((b) => [b.name, b.id, b.price, b.te, b.w3b]),
        [
            ['Bob', '11', 852000, 850000, 852000],
            ['Zed', '77', 849500, null, 849500],
            ['Carol', '44', 845000, 845000, null],
            ['Alice', '12', 830000, 830000, null],
        ],
    );
});

test('a full-list name not among active traders is left out once the active list is known', () => {
    const buyers = buyersForItem('1', {
        teBest: [{ name: 'Alice', id: '12', price: 115 }],
        teFull: [{ name: 'Alice', price: 115 }, { name: 'Ghost', price: 500 }],
        idsByName: new Map([['alice', '12']]),
    });
    assert.deepEqual(buyers.map((b) => b.name), ['Alice']);
    // Active list not loaded yet: nobody can be ruled out.
    const unknown = buyersForItem('1', { teFull: [{ name: 'Ghost', price: 500 }] });
    assert.deepEqual(unknown.map((b) => [b.name, b.id]), [['Ghost', null]]);
});

test('an item nobody buys has no rows; Online only keeps order and drops the rest', () => {
    assert.deepEqual(buyersForItem('999', { db: dbWithLists(), w3bByItem: new Map() }), []);
    const buyers = [{ id: '1', price: 3 }, { id: '2', price: 2 }, { id: null, price: 1 }, { id: '4', price: 0.5 }];
    const level = { 1: 'offline', 2: 'online', 4: 'online' };
    assert.deepEqual(onlineOnly(buyers, (id) => level[id]).map((b) => b.id), ['2', '4']);
});

/* =============================================================== sections */

test('item rows: the filter narrows by name; best price first; no trader last', () => {
    const buyersOf = (id) =>
        ({ 206: [{ id: '11', name: 'Bob', price: 852000 }], 1: [{ id: '12', name: 'Alice', price: 115 }] })[id] || [];
    const names = { 206: 'Xanax', 1: 'Hammer', 180: 'Bottle of Beer' };
    const nameOf = (id) => names[id];

    const rows = itemRows(['180', '1', '206'], { buyersOf, nameOf });
    assert.deepEqual(rows.map((r) => [r.name, r.best && r.best.price]), [
        ['Xanax', 852000],
        ['Hammer', 115],
        ['Bottle of Beer', null],
    ]);

    const xanax = itemRows(['180', '1', '206'], { buyersOf, nameOf, query: '  XAN ' });
    assert.deepEqual(xanax.map((r) => r.name), ['Xanax']);
    assert.equal(xanax[0].buyers[0].name, 'Bob');
});

/* ===================================================== which list is next */

test('next TornW3B list: never read first, then stale lists of traders buying what you hold, then the rest', () => {
    const db = dbWithLists();
    addTraders(db, [{ id: 99, name: 'New' }], NOW);
    const held = new Set(['180']);

    assert.equal(nextW3bTrader(db, held, NOW), '99');
    recordW3bList(db, 99, { prices: { 1: 5 } }, NOW);

    // Everything fresh: nothing due.
    assert.equal(nextW3bTrader(db, held, NOW + 1000), null);

    // Held-item buyers (77 buys 180) are due sooner than the rest.
    assert.equal(nextW3bTrader(db, held, NOW + W3B_HELD_REFRESH_MS + 1), '77');
    const later = NOW + W3B_OTHER_REFRESH_MS + 1;
    recordW3bList(db, 77, { prices: { 180: 61 } }, later);
    assert.ok(['11', '99'].includes(nextW3bTrader(db, held, later + 1)));

    // No list: asked again after a day, not before.
    const noList = emptyTraderDb();
    recordW3bList(noList, 12, { prices: {} }, NOW);
    assert.equal(nextW3bTrader(noList, held, NOW + W3B_MISSING_RECHECK_MS - 1), null);
    assert.equal(nextW3bTrader(noList, held, NOW + W3B_MISSING_RECHECK_MS + 1), '12');

    // A failed read waits before the next try, and keeps the old list.
    const failed = dbWithLists();
    recordW3bList(failed, 11, { error: true }, NOW + W3B_HELD_REFRESH_MS + 1);
    assert.notEqual(nextW3bTrader(failed, new Set(['206']), NOW + W3B_HELD_REFRESH_MS + 2), '11');
    assert.deepEqual(liveW3bPrices(failed.traders[11], NOW + 2000), { 206: 852000 });
    assert.equal(nextW3bTrader(failed, new Set(['206']), NOW + W3B_HELD_REFRESH_MS + W3B_ERROR_RETRY_MS + 2), '11');
});

test('stats count traders, unread lists and the newest read', () => {
    const db = dbWithLists();
    addTraders(db, [{ id: 5 }], NOW);
    assert.deepEqual(traderDbStats(db, NOW), { total: 4, withW3b: 2, unchecked: 1, newestW3bAt: NOW });
});

/* ================================================= the database, shared */

test('two copies merge: nobody\'s traders are lost, and the newer list wins', () => {
    const mine = dbWithLists(NOW);
    const theirs = JSON.parse(JSON.stringify(dbWithLists(NOW)));
    addTraders(theirs, [{ id: 555, name: 'FromW3bPage', source: 'w3b' }], NOW);
    recordW3bList(theirs, 11, { prices: { 206: 860000 } }, NOW + 5000);
    recordW3bList(mine, 77, { prices: { 206: 1 } }, NOW + 9000);

    assert.equal(mergeTraderDbs(mine, theirs), true);
    assert.equal(mine.traders[555].name, 'FromW3bPage');
    assert.equal(mine.traders[11].w3b.prices[206], 860000);
    assert.equal(mine.traders[77].w3b.prices[206], 1);
    assert.equal(mergeTraderDbs(mine, theirs), false);

    // Another version, or nothing stored: an empty database.
    assert.deepEqual(readTraderDb({ version: 0, traders: { 1: {} } }), emptyTraderDb());
    assert.deepEqual(readTraderDb(null), emptyTraderDb());
});

test('adding traders: ids cleaned, a real name replaces a placeholder, nothing added twice', () => {
    const db = emptyTraderDb();
    assert.equal(addTraders(db, [{ id: '[77]' }, { id: '' }, { id: 0 }], NOW), true);
    assert.deepEqual(Object.keys(db.traders), ['77']);
    assert.equal(db.traders[77].name, 'Trader 77');
    assert.equal(addTraders(db, [{ id: 77, name: 'Zed' }], NOW), true);
    assert.equal(db.traders[77].name, 'Zed');
    assert.equal(addTraders(db, [{ id: 77, name: 'Zed' }], NOW), false);
});

/* ============================================== traders found on TornW3B */

test('TornW3B pages: every /pricelist/ link is a trader; names come from the link or "Name [id]" text', () => {
    const a = (href, text) => ({ getAttribute: () => href, textContent: text });
    const found = traderLinksIn([
        a('/pricelist/2982905', 'Clouds'),
        a('/pricelist/4239607', 'List'),
        a('https://weav3r.dev/pricelist/1195734?x=1', 'Friends'),
        a('/pricelist/2982905', 'List'),
        a('/item/206', 'Xanax'),
    ]);
    assert.deepEqual(found.map((f) => [f.id, f.name]), [
        ['2982905', 'Clouds'],
        ['4239607', ''],
        ['1195734', 'Friends'],
    ]);
    const names = traderNamesInText('1\nSimSOp [4239607]\n$840,001\n2\nFriends [1195734]');
    assert.equal(names.get('4239607'), 'SimSOp');
    assert.equal(names.get('1195734'), 'Friends');
});

test('TornExchange active traders keep their names as written, for our database', () => {
    const list = parseTeActiveTraderList({
        data: { verbose: { 1: { name: 'SimSOp', torn_id: 4239607 }, 2: { name: '', torn_id: 5 }, 3: { name: 'NoId' } } },
    });
    assert.deepEqual(list, [{ id: '4239607', name: 'SimSOp', source: 'te' }]);
});

/* ====================================== found in review, kept fixed */

test('a failed first read is tried again in minutes, not a day, and still counts as unread', () => {
    const db = emptyTraderDb();
    addTraders(db, [{ id: 5, name: 'Eve' }], NOW);
    recordW3bList(db, 5, { error: true }, NOW);
    assert.equal(nextW3bTrader(db, new Set(), NOW + 1000), null);
    assert.equal(nextW3bTrader(db, new Set(), NOW + W3B_ERROR_RETRY_MS + 1), '5');
    assert.equal(traderDbStats(db, NOW).unchecked, 1);
});

test('a failed read in one tab never wipes the list another tab read', () => {
    const good = dbWithLists(NOW);
    const failed = JSON.parse(JSON.stringify(good));
    delete failed.traders[11].w3b;
    recordW3bList(failed, 11, { error: true }, NOW + 60000);
    assert.equal(mergeTraderDbs(good, failed), false);
    assert.deepEqual(liveW3bPrices(good.traders[11], NOW + 60000), { 206: 852000 });
});

test('Refresh asks for a list again first, without hiding its prices meanwhile', () => {
    const db = dbWithLists(NOW);
    markW3bDue(db, 77);
    assert.deepEqual(liveW3bPrices(db.traders[77], NOW + 1000), { 206: 849500, 180: 61 });
    assert.equal(nextW3bTrader(db, new Set(), NOW + 1000), '77');
    recordW3bList(db, 77, { prices: { 206: 1 } }, NOW + 2000);
    assert.equal(nextW3bTrader(db, new Set(), NOW + 3000), null);
});

test('a trader known by name on TornExchange and by id on TornW3B is one row', () => {
    const db = dbWithLists(NOW);
    // The active-trader list has not loaded: the full list has names only.
    const buyers = buyersForItem('206', {
        teFull: [{ name: 'Bob', price: 850000 }],
        db,
        w3bByItem: indexW3bByItem(db, NOW),
    });
    const bobs = buyers.filter((b) => b.name === 'Bob');
    assert.equal(bobs.length, 1);
    assert.deepEqual([bobs[0].id, bobs[0].te, bobs[0].w3b, bobs[0].price], ['11', 850000, 852000, 852000]);
    // And a name our database knows gives the TornExchange row its id.
    const ids = traderIdsByName(db);
    const alice = buyersForItem('1', { teFull: [{ name: 'alice', price: 115 }], dbIdsByName: ids });
    assert.equal(alice[0].id, '12');
});

test('a TornW3B page never renames a trader TornExchange or Torn named; only a real name is taken', () => {
    const db = emptyTraderDb();
    addTraders(db, [{ id: 11, name: 'Bob', source: 'te' }], NOW);
    assert.equal(addTraders(db, [{ id: 11, name: 'Bobby', source: 'w3b' }], NOW), false);
    assert.equal(db.traders[11].name, 'Bob');
    const a = (href, text) => ({ getAttribute: () => href, textContent: text });
    const found = traderLinksIn([a('/pricelist/1', '1 Clouds +516'), a('/pricelist/2', 'Open list'), a('/pricelist/3', 'Clouds')]);
    assert.deepEqual(found.map((f) => f.name), ['', '', 'Clouds']);
});

test('old price lists are dropped from storage; the trader stays and is read again', () => {
    const db = dbWithLists(NOW);
    const later = NOW + W3B_LIST_MAX_AGE_MS + 1;
    pruneTraderDb(db, later);
    assert.equal(db.traders[11].w3b.prices, null);
    assert.equal(db.traders[11].w3b.found, true);
    assert.ok(['11', '77'].includes(nextW3bTrader(db, new Set(['206']), later)));
});

test('graph scale: one troll listing never sets the scale, with or without an average', () => {
    assert.deepEqual(scaleRange([100, 110, 9999999], []), { min: 100, max: 330 });
    const withAvg = scaleRange([830000, 840000, 9999999], [830000]);
    assert.ok(withAvg.max <= 2490000 && withAvg.min >= 276000, JSON.stringify(withAvg));
    assert.deepEqual(scaleRange([], [55]), { min: 55, max: 55 });
    assert.deepEqual(scaleRange([], []), { min: null, max: null });
});

/* ============================== 3.9.2: no single source can empty the page */

import { parseTeBestListing, fetchTeBestListing, TeClient } from '../src/api/te.js';
import { SEED_TRADERS } from '../src/core/seed-traders.js';
import { belowMinRows } from '../src/core/ranker.js';

test('the built-in TornW3B traders: real ids, no repeats, and they never rename a trader', () => {
    const ids = SEED_TRADERS.map(([id]) => String(id));
    assert.ok(ids.length >= 100);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(SEED_TRADERS.every(([id, name]) => Number.isInteger(id) && id > 0 && /^[A-Za-z0-9_-]{1,20}$/.test(name)));
    const db = emptyTraderDb();
    addTraders(db, [{ id: 3727302, name: 'RealName', source: 'te' }], NOW);
    addTraders(db, SEED_TRADERS.map(([id, name]) => ({ id, name, source: 'seed' })), NOW);
    assert.equal(db.traders[3727302].name, 'RealName');
    // With no TornExchange at all, every one of them is queued for its list.
    assert.equal(traderDbStats(db, NOW).unchecked, db.traders ? Object.keys(db.traders).length : 0);
    assert.ok(nextW3bTrader(db, new Set(), NOW));
});

test('TornExchange without a key: best_listing is sent with no key, and "no listings" is null', async () => {
    const seen = [];
    const client = new TeClient({
        getKey: () => '',
        fetchImpl: async (url) => {
            seen.push(url);
            if (url.includes('item_id=999')) return response(400, { status: 'error', message: 'No listings found for the specified item' });
            return response(200, { status: 'success', data: { item: 'Xanax', trader: 'MaxLEXO', trader_id: '3922958', vote: 1, price: 839004 } });
        },
    });
    assert.deepEqual(await fetchTeBestListing(client, 206), { name: 'MaxLEXO', id: '3922958', price: 839004, score: 1 });
    assert.ok(!seen[0].includes('key='), 'no key in ' + seen[0]);
    assert.equal(new URL(seen[0]).hostname, 'www.tornexchange.com');
    client.lastRequestAt = 0;
    assert.equal(await fetchTeBestListing(client, 999), null);
    assert.equal(parseTeBestListing({ data: { trader: 'X', trader_id: '', price: 5 } }), null);
});

test('a rejected key says what TornExchange said, and what to do', async () => {
    const client = new TeClient({
        getKey: () => 'LIMITED123456789',
        fetchImpl: async () => response(401, { status: 'error', message: 'Invalid API key' }),
    });
    await assert.rejects(client.get('all_best_listings'), (e) => e.badKey && /"Invalid API key"/.test(e.message) && /log in with this key/.test(e.message));
});

test('below Min but profitable: marked in the second colour, never in the list; Cash still applies', () => {
    const row = (id, perUnit, qty, price) => ({
        itemId: id,
        profit: {
            profitPerUnit: perUnit,
            realizableProfit: perUnit * Math.min(qty, Math.floor(1000 / price)),
            cashRequired: price * qty,
            listingPrice: price,
            affordableQty: Math.min(qty, Math.floor(1000 / price)),
            roi: 1,
        },
        qtyAtPrice: qty,
        npcVerified: true,
    });
    const big = row('1', 50, 5, 100); // +250
    const small = row('2', 40, 1, 100); // +40
    const loss = row('3', -10, 1, 100);
    const pricey = row('4', 40, 1, 5000); // +40, but you cannot afford one
    const opts = { minTotalProfit: 100, cashOnHand: 1000 };
    assert.deepEqual(belowMinRows([big, small, loss, pricey], opts).map((r) => r.itemId), ['2']);
});

/* ======================================= 3.9.4: trust and best trader */

import { trustOf, votesByTrader, bestTradersFor, ratingsInText } from '../src/core/traders.js';

test('trust: the better of TornExchange votes and TornW3B rating; nothing known is no badge', () => {
    assert.equal(trustOf(null, null), null);
    assert.equal(trustOf(214, null).level, 'Trusted');
    assert.equal(trustOf(5, { up: 523, down: 7 }).level, 'Trusted', 'known on one site is enough');
    assert.equal(trustOf(25, null).level, 'Known');
    assert.equal(trustOf(3, null).level, 'New');
    assert.equal(trustOf(-4, null).level, 'Caution');
    assert.deepEqual(trustOf(null, { up: 30, down: 2 }), { level: 'Known', score: 28, votes: null, up: 30, down: 2 });
});

test('trust reaches every row: votes from any item, ratings from our database', () => {
    const db = dbWithLists();
    addTraders(db, [{ id: 77, name: 'Zed', rating: { up: 200, down: 3 } }], NOW);
    const votes = votesByTrader([[{ id: '11', score: 40 }], [{ id: '11', score: 99 }]]);
    assert.equal(votes.get('11'), 40, 'first answer wins');
    const buyers = buyersForItem('206', { db, w3bByItem: indexW3bByItem(db, NOW), votesById: votes });
    assert.equal(buyers.find((b) => b.id === '11').trust.level, 'Known');
    assert.equal(buyers.find((b) => b.id === '77').trust.level, 'Trusted');
});

test('best trader for you: most best-prices first, then most items bought', () => {
    const bob = { id: '11', name: 'Bob' };
    const zed = { id: '77', name: 'Zed' };
    const rows = [
        { itemId: '1', buyers: [bob, zed] },
        { itemId: '2', buyers: [bob] },
        { itemId: '3', buyers: [zed, bob] },
        { itemId: '4', buyers: [] },
    ];
    const best = bestTradersFor(rows);
    assert.deepEqual(best.map((e) => [e.trader.name, e.bestOn, e.buys]), [['Bob', ['1', '2'], 3], ['Zed', ['3'], 2]]);
});

test('TornW3B ratings are read off its leaderboards', () => {
    const r = ratingsInText('Highest Rated Traders\n1\nClouds\n523↑ · 7↓\n+516\n2\n7ZP\n468↑ · 9↓');
    assert.deepEqual(r.get('Clouds'), { up: 523, down: 7 });
    assert.deepEqual(r.get('7ZP'), { up: 468, down: 9 });
});
