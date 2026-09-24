import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TeClient,
    parseTeBestListings,
    fetchTeBestListings,
    tePriceListUrl,
    TE_MIN_GAP_MS,
} from '../src/api/te.js';
import {
    pickTrader,
    maxTraderPrice,
    groupByTrader,
    makeTeCacheEntry,
    readTeCacheEntry,
    TE_MAX_AGE_MS,
} from '../src/core/traders.js';
import { exitsFor, selectCandidates, itemMarketSweepList } from '../src/core/feed.js';
import { bestVenue } from '../src/core/profit.js';

// Shape of /api/all_best_listings, from main/api.py in torn-exchange/web.
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

function response(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('TornExchange: parses the top buyers, highest first, dropping bad rows', () => {
    const map = parseTeBestListings(BEST);
    assert.deepEqual([...map.keys()].sort(), ['1', '206']);
    assert.deepEqual(map.get('206').map((t) => t.name), ['Stale', 'Alice', 'Bob']);
    assert.deepEqual(map.get('206')[2], { name: 'Bob', id: '11', price: 820000, score: 214 });
    assert.throws(() => parseTeBestListings({ status: 'success' }), /no trader prices/);
});

test('TornExchange client: its own key, its own host, and never the key in an error', async () => {
    const urls = [];
    let t = 1_000_000;
    const te = new TeClient({
        getKey: () => 'TEKEY1234567890A',
        now: () => t,
        fetchImpl: async (url) => {
            urls.push(url);
            return response(200, BEST);
        },
    });

    const map = await fetchTeBestListings(te);
    assert.equal(map.size, 2);
    assert.equal(urls[0], 'https://www.tornexchange.com/api/all_best_listings?key=TEKEY1234567890A');

    assert.throws(() => te.buildUrl('https://evil.example/x', 'k'), /Refusing/);

    // A second call inside the gap is refused without touching the network.
    await assert.rejects(te.get('all_best_listings'), /Too soon/);
    assert.equal(urls.length, 1);

    t += TE_MIN_GAP_MS;
    const failing = new TeClient({
        getKey: () => 'TEKEY1234567890A',
        now: () => t,
        fetchImpl: async () => {
            throw new Error('boom https://www.tornexchange.com/api/x?key=TEKEY1234567890A');
        },
    });
    await assert.rejects(failing.get('all_best_listings'), (e) => !String(e.message).includes('TEKEY'));
});

test('TornExchange client: a 429 waits out retry_after; a 401 is a bad key; no key sends nothing', async () => {
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

    let sent = false;
    const none = new TeClient({ getKey: () => '', fetchImpl: async () => { sent = true; } });
    await assert.rejects(none.get('all_best_listings'), (e) => e.badKey === true);
    assert.equal(sent, false);

    assert.equal(tePriceListUrl('11'), 'https://www.tornexchange.com/prices/11/');
});

test('pickTrader: online first, then price; a price far above value is suspect and sinks', () => {
    const traders = parseTeBestListings(BEST).get('206');
    const levels = { 11: 'Online', 12: 'Offline', 13: 'Online' };
    const presenceOf = (id) => (levels[id] ? { online: levels[id] } : null);

    const pick = pickTrader(traders, { presenceOf, marketValue: 830000 });
    assert.equal(pick.trader.name, 'Bob', 'online and sane beats offline and higher');
    assert.equal(pick.level, 'online');
    assert.equal(pick.suspect, false);
    assert.equal(Math.round(pick.pctOfValue * 100), 99);
    assert.deepEqual(pick.better && [pick.better.trader.name, pick.better.level], ['Alice', 'offline']);

    // Nobody's status known yet: the highest sane price.
    const unknown = pickTrader(traders, { marketValue: 830000 });
    assert.equal(unknown.trader.name, 'Alice');
    assert.equal(unknown.better, null);

    // Only a suspect price: still shown, but flagged.
    const onlyStale = pickTrader([traders[0]], { marketValue: 830000 });
    assert.equal(onlyStale.suspect, true);

    assert.equal(pickTrader([], {}), null);
    assert.equal(maxTraderPrice(traders, 830000), 830000, 'the stale 990k is ignored');
});

test('the Trader exit: only with the chip on, and it prices like any other exit', () => {
    const item = { id: '206', sellPrice: 600, marketValue: 830000 };
    assert.deepEqual(exitsFor(item, {}, 820000), { NPC: 600 });
    assert.deepEqual(exitsFor(item, { sellToTrader: true }, 820000), { NPC: 600, TRADER: 820000 });
    assert.deepEqual(exitsFor(item, { sellToTrader: true }, 0), { NPC: 600 });

    const p = bestVenue({ listingPrice: 800000, exits: exitsFor(item, { sellToTrader: true }, 820000), qty: 2 });
    assert.equal(p.venue, 'TRADER');
    assert.equal(p.realizableProfit, 40000, 'no tax on a trade');

    // The feed picks items a trader would buy for more than their cheapest bazaar.
    const index = { byId: new Map([['206', { ...item, name: 'Xanax' }]]) };
    const summary = [{ itemId: '206', lowestPrice: 800000 }];
    assert.equal(selectCandidates(summary, index, {}).length, 0);
    assert.equal(selectCandidates(summary, index, { sellToTrader: true }, 25, () => 820000).length, 1);

    // ...and sweeps the Item Market for them, even with no NPC price.
    const noNpc = { byId: new Map([['206', { ...item, sellPrice: null }]]) };
    assert.deepEqual(itemMarketSweepList(noNpc, {}), []);
    assert.deepEqual(itemMarketSweepList(noNpc, { sellToTrader: true }, () => 820000), ['206']);
});

test('groupByTrader: one group per trader, online first, then biggest total', () => {
    const bob = { name: 'Bob', id: '11', price: 1, score: 5 };
    const al = { name: 'Al', id: '12', price: 1, score: 5 };
    const row = (who, level, profit, venue = 'TRADER') => ({
        profit: { venue, realizableProfit: profit, cashRequired: 10 },
        traderPick: { trader: who, level },
    });

    const groups = groupByTrader([
        row(al, 'offline', 900),
        row(bob, 'online', 100),
        row(bob, 'online', 300),
        row(bob, 'online', 50, 'NPC'),
    ]);

    assert.deepEqual(groups.map((g) => g.trader.name), ['Bob', 'Al']);
    assert.equal(groups[0].rows.length, 2);
    assert.equal(groups[0].totalProfit, 400);
    assert.deepEqual(groups[0].rows.map((r) => r.profit.realizableProfit), [300, 100]);
});

test('trader price cache: round trip, and too old is dropped', () => {
    const now = 1_900_000_000_000;
    const map = parseTeBestListings(BEST);
    const entry = JSON.parse(JSON.stringify(makeTeCacheEntry(map, now)));
    const back = readTeCacheEntry(entry, now + 1000);
    assert.deepEqual(back.map.get('206'), map.get('206'));
    assert.equal(readTeCacheEntry(entry, now + TE_MAX_AGE_MS + 1), null);
    assert.equal(readTeCacheEntry({ version: 0 }, now), null);
});
