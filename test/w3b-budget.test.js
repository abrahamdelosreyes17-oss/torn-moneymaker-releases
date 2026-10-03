/*
 * TornW3B allows 100 calls a minute per IP, for everything on it. These pin
 * down what 3.12.5 changed: the feed no longer re-reads the same item every
 * tick, every tab shares one TornW3B window and one 429 wait, and saving
 * Torn API calls leaves bazaars watched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { W3bClient, overlayPerMinute, W3B_MAX_PER_MINUTE, W3B_SHARED_PER_MINUTE, W3B_BESIDE_BIDS_PER_MINUTE, W3B_BIDS_IN_USE_MS } from '../src/api/w3b.js';
import { LiveFeed, watching } from '../src/feed/controller.js';
import { buildItemIndex } from '../src/core/items.js';
import { bazaarDue, emptyFeed, setBazaarSnapshot } from '../src/core/feed.js';

const T0 = 1_700_000_000_000;
const json = (body) => ({ ok: true, status: 200, json: async () => body });

function memoryStore() {
    const data = new Map();
    return {
        load: (k) => (data.has(k) ? JSON.parse(data.get(k)) : null),
        save: (k, v) => data.set(k, JSON.stringify(v)),
    };
}

/** One minute of the leader's 3 s ticks against a TornW3B that lists `listings` for item 1. */
async function minuteOfFeed({ lowest, listings, settings = {}, items = 1 }) {
    let t = T0;
    const now = () => t;
    const raw = {};
    for (let i = 1; i <= items; i++) raw[i] = { name: 'Item ' + i, sell_price: 100, market_value: 120 };
    const w3bCalls = [];
    const tornCalls = [];
    const w3b = new W3bClient({
        now,
        maxPerMinute: 10000,
        fetchImpl: async (url) => {
            const path = new URL(url).pathname;
            w3bCalls.push(path);
            if (path === '/api/marketplace') {
                return json({ items: Object.keys(raw).map((id) => ({ item_id: +id, item_name: 'x', lowest_price: lowest, market_price: 120 })) });
            }
            return json({ total_listings: listings.length, listings });
        },
    });
    const store = memoryStore();
    const feed = new LiveFeed({
        tabId: 'A',
        w3b,
        torn: { get: async (p) => (tornCalls.push(p), { itemmarket: { listings: [] } }) },
        getIndex: () => buildItemIndex(raw),
        getSettings: () => ({ sellToNpc: true, resaleMarket: false, resaleBazaar: false, cashOnHand: null, liveFeed: true, useW3b: true, ...settings }),
        hasUsableKey: () => true,
        isVisible: () => true,
        load: store.load,
        save: store.save,
        now,
    });
    for (let i = 0; i < 21; i++) {
        await feed.tick();
        t += 3000;
    }
    return { w3bCalls, tornCalls, listingReads: w3bCalls.filter((p) => p !== '/api/marketplace').length };
}

const seen = Math.floor(T0 / 1000);
const BOB = { player_id: 7, player_name: 'Bob', price: 50, quantity: 2, last_checked: seen };

test('a $1 Dollar Sale in the summary does not make the feed re-read the item every tick', async () => {
    // Before 3.12.5: 20 reads a minute for this one item (the rows leave the
    // $1 listing out, so they never matched the summary's $1).
    const dollar = await minuteOfFeed({ lowest: 1, listings: [{ player_id: 8, price: 1, quantity: 1, last_checked: seen }, BOB] });
    assert.ok(dollar.listingReads <= 2, 'read ' + dollar.listingReads + ' times in a minute');

    // A cheapest listing with no seller id is left out of the rows too.
    const anon = await minuteOfFeed({ lowest: 10, listings: [{ player_id: null, price: 10, quantity: 9, last_checked: seen }, BOB] });
    assert.ok(anon.listingReads <= 2, 'read ' + anon.listingReads + ' times in a minute');

    const normal = await minuteOfFeed({ lowest: 50, listings: [BOB] });
    assert.equal(dollar.listingReads, normal.listingReads, 'the same as an ordinary item');
});

test('the summary price moving still re-reads the item at once', () => {
    const feed = emptyFeed();
    setBazaarSnapshot(feed, '1', [{ sellerId: '7', price: 50, qty: 1 }], T0, 1);
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 1 }, T0 + 3000), false, 'same summary price: not again');
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 45 }, T0 + 3000), true, 'summary moved: read again');
    assert.equal(bazaarDue(feed, { itemId: '1', lowestPrice: 1 }, T0 + 61000), true, 'a minute old: read again');
    // A snapshot stored before 3.12.5 (no summary price) falls back to its rows.
    feed.bazaar.set('2', { fetchedAt: T0, rows: [{ price: 50 }] });
    assert.equal(bazaarDue(feed, { itemId: '2', lowestPrice: 50 }, T0 + 3000), false);
});

/* ---------------------------------------------------------- one window */

function sharedClients(n, { sharedPerMinute = 5, onFetch = () => json({ items: [] }) } = {}) {
    let t = T0;
    const store = memoryStore();
    const calls = [];
    const slept = [];
    const clients = [];
    for (let i = 0; i < n; i++) {
        clients.push(new W3bClient({
            now: () => t,
            maxPerMinute: 60,
            sharedPerMinute,
            loadShared: () => store.load('w3bWindow'),
            saveShared: (s) => store.save('w3bWindow', s),
            // Sleeping moves the clock instead of waiting.
            sleep: async (ms) => {
                slept.push(ms);
                t += ms;
            },
            fetchImpl: async (url) => {
                calls.push({ tab: i, at: t, url });
                return onFetch(url);
            },
        }));
    }
    return { clients, calls, slept, store, clock: { get t() { return t; }, set t(v) { t = v; } } };
}

test('every tab draws on ONE TornW3B window: the 6th call in a minute waits, whichever tab makes it', async () => {
    const { clients, calls, slept } = sharedClients(3, { sharedPerMinute: 5 });
    for (let i = 0; i < 6; i++) await clients[i % 3].get('marketplace');
    assert.equal(calls.length, 6);
    assert.ok(calls.slice(0, 5).every((c) => c.at === T0), 'five go at once');
    assert.ok(calls[5].at >= T0 + 60000, 'the sixth waits for the first to leave the minute');
    assert.equal(slept.length, 1);
    // Each tab on its own had room (60 a minute): only the shared window held it.
});

test('a 429 seen by one tab stops every tab for a minute', async () => {
    let first = true;
    const { clients, calls, clock } = sharedClients(2, {
        sharedPerMinute: 80,
        onFetch: () => {
            if (first) {
                first = false;
                return { ok: false, status: 429, json: async () => ({}) };
            }
            return json({ items: [] });
        },
    });
    await assert.rejects(clients[0].get('marketplace'), (e) => e.http === 429);
    await assert.rejects(clients[1].get('marketplace'), (e) => e.blocked && !e.http, 'the other tab does not even ask');
    assert.equal(calls.length, 1);
    clock.t += 61000;
    await clients[1].get('marketplace');
    assert.equal(calls.length, 2, 'asked again once the wait is over');
});

/* ------------------------------------------------------- saving calls */

test('saving API calls (Item Market off) still watches bazaars, at 0 Torn API calls', async () => {
    const r = await minuteOfFeed({ lowest: 50, listings: [BOB], settings: { liveFeed: false, useW3b: true } });
    assert.equal(r.tornCalls.length, 0, 'no Torn API call');
    assert.ok(r.listingReads >= 1, 'bazaars still read from TornW3B');
    assert.ok(r.w3bCalls.includes('/api/marketplace'));

    const both = await minuteOfFeed({ lowest: 50, listings: [BOB], settings: { liveFeed: true, useW3b: true } });
    assert.ok(both.tornCalls.length >= 1, 'with the Item Market on, it is watched too');

    const off = await minuteOfFeed({ lowest: 50, listings: [BOB], settings: { liveFeed: false, useW3b: false } });
    assert.equal(off.w3bCalls.length + off.tornCalls.length, 0, 'both off: nothing at all');
});

test('watching: either switch on is enough', () => {
    assert.equal(watching({ liveFeed: false, useW3b: true }), true);
    assert.equal(watching({ liveFeed: true, useW3b: false }), true);
    assert.equal(watching({ liveFeed: false, useW3b: false }), false);
});

test('Torn Bids first (3.20.5): while it is in use, the overlay takes only what the 60 of Torn Bids leave of the 80', () => {
    assert.equal(W3B_BESIDE_BIDS_PER_MINUTE, W3B_SHARED_PER_MINUTE - W3B_MAX_PER_MINUTE);
    // Torn Bids never opened, or not seen for 5 minutes: the overlay's own 60, as before.
    assert.equal(overlayPerMinute(0, T0), W3B_MAX_PER_MINUTE);
    assert.equal(overlayPerMinute(null, T0), W3B_MAX_PER_MINUTE);
    assert.equal(overlayPerMinute(T0 - W3B_BIDS_IN_USE_MS, T0), W3B_MAX_PER_MINUTE);
    // In view now, or a moment ago (a buying run goes back and forth): it steps back.
    assert.equal(overlayPerMinute(T0, T0), W3B_BESIDE_BIDS_PER_MINUTE);
    assert.equal(overlayPerMinute(T0 - W3B_BIDS_IN_USE_MS + 1, T0), W3B_BESIDE_BIDS_PER_MINUTE);
    // A time from the future (the clock was changed) is not believed for ever.
    assert.equal(overlayPerMinute(T0 + 30000, T0), W3B_BESIDE_BIDS_PER_MINUTE);
    assert.equal(overlayPerMinute(T0 + 3600000, T0), W3B_MAX_PER_MINUTE);
    assert.equal(overlayPerMinute('rubbish', T0), W3B_MAX_PER_MINUTE);
});

test('a client with a ceiling that moves: the overlay waits at 20 a minute while Torn Bids is in use, Torn Bids does not', async () => {
    let t = T0;
    let bidsSeen = 0;
    const calls = [];
    const slept = [];
    const make = (extra) => new W3bClient({
        now: () => t,
        sleep: async (ms) => {
            slept.push(ms);
            t += ms;
        },
        fetchImpl: async () => {
            calls.push(t);
            return json({ items: [] });
        },
        ...extra,
    });
    const overlay = make({ perMinute: () => overlayPerMinute(bidsSeen, t) });
    // Torn Bids not in use: 60 go at once, as before.
    for (let i = 0; i < 25; i++) await overlay.get('marketplace');
    assert.equal(slept.length, 0);
    assert.equal(overlay.stats().remaining, 35);
    // Torn Bids comes into view: over its share already, the next read waits until it is under 20 again.
    bidsSeen = t;
    assert.equal(overlay.limit(), W3B_BESIDE_BIDS_PER_MINUTE);
    assert.equal(overlay.stats().remaining, 0);
    await overlay.get('marketplace');
    assert.equal(slept.length, 1);
    assert.ok(calls[25] >= T0 + 60000, 'it waited for its own reads to leave the minute');
    // A ceiling that is rubbish, or throws: the client's own. Never more than its own, never under one.
    assert.equal(make({ perMinute: () => NaN }).limit(), W3B_MAX_PER_MINUTE);
    assert.equal(make({ perMinute: () => { throw new Error('x'); } }).limit(), W3B_MAX_PER_MINUTE);
    assert.equal(make({ perMinute: () => 500 }).limit(), W3B_MAX_PER_MINUTE);
    assert.equal(make({ perMinute: () => 0 }).limit(), 1);
    assert.equal(make({}).limit(), W3B_MAX_PER_MINUTE);
});
