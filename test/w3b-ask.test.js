/*
 * 3.23.0, items 6 and 7: two things TornW3B's own API takes that we never
 * sent - `tradedWithinHours` on an item's buyers, `maxPrice` on its listings.
 * The first is sent (item 6). The second was measured on the bench and did
 * not help, so it is not (item 7): the test here holds it out of the query.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as w3b from '../src/api/w3b.js';
import * as traders from '../src/core/traders.js';

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const clientSeeing = (seen, answer) => new w3b.W3bClient({
    fetchImpl: async (url) => {
        seen.push(url);
        return response(200, answer(new URL(url)));
    },
});
const keys = (url) => [...new URL(url).searchParams.keys()];

test('the TornW3B client: besides the comment, only one whole number can ever be in a query - never a key, and not maxPrice', () => {
    const c = new w3b.W3bClient({ fetchImpl: async () => response(200, {}) });
    const u = c.buildUrl('marketplace/206/traders', { tradedWithinHours: 48 });
    assert.deepEqual([...u.searchParams.keys()], ['comment', 'tradedWithinHours']);
    assert.equal(u.searchParams.get('tradedWithinHours'), '48');
    // Anything else is dropped: other names, and values that are not a whole number within the range.
    const junk = [
        { key: 'ABCDEF1234567890' }, { apiKey: 'ABCDEF1234567890' }, { comment: 'x' }, { minQty: 5 }, { sort: 'fast' },
        { tradedWithinHours: 'ABCDEF1234567890' }, { tradedWithinHours: '48' }, { tradedWithinHours: 48.5 }, { tradedWithinHours: 0 }, { tradedWithinHours: 169 },
        { maxPrice: 850000 }, { maxPrice: '850000&key=ABCDEF1234567890' }, { tradedWithinHours: NaN }, { tradedWithinHours: Infinity }, { tradedWithinHours: -5 },
    ];
    for (const q of junk) {
        const url = c.buildUrl('marketplace/206', q);
        assert.deepEqual([...url.searchParams.keys()], ['comment'], JSON.stringify(q));
        assert.equal(url.searchParams.get('comment'), 'TornTradingV2');
    }
    // A query written into the path is still thrown away, and the host is still the only one.
    assert.deepEqual([...c.buildUrl('marketplace/206?key=ABCDEF1234567890&maxPrice=5').searchParams.keys()], ['comment']);
    assert.throws(() => c.buildUrl('https://evil.example/x', { maxPrice: 5 }), /Refusing/);
});

test('an item\'s buyers: asked for those who traded lately only when told to, and the answer says which it was', async () => {
    const seen = [];
    const c = clientSeeing(seen, () => ({ total_count: 412, traders: [{ player_id: 11, player_name: 'Bob', price: 850000, last_trade: NOW / 1000 - 3600, pricelist_updated: NOW / 1000 - 7200 }] }));
    const all = await w3b.fetchW3bItemTraders(c, 206);
    assert.deepEqual(keys(seen[0]), ['comment']);
    assert.equal(all.withinHours, null);
    const recent = await w3b.fetchW3bItemTraders(c, 206, { withinHours: 48 });
    assert.equal(new URL(seen[1]).searchParams.get('tradedWithinHours'), '48');
    assert.equal(new URL(seen[1]).pathname, '/api/marketplace/206/traders');
    assert.deepEqual([recent.withinHours, recent.total, recent.traders[0].id, recent.traders[0].lastTrade], [48, 412, '11', NOW - HOUR]);
});

test('when to ask for those who traded lately: Fresh prices only on, and more buyers than one answer holds - every other read', () => {
    const t = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), price: 1000 - i }));
    const full = { at: NOW, total: 412, traders: t(100), withinHours: null };
    // Two days, as Fresh prices only.
    assert.equal(traders.FRESH_TRADED_HOURS, 48);
    assert.equal(traders.buyersAsk(full, { fresh: true }), 48);
    // The switch off: as before.
    assert.equal(traders.buyersAsk(full, { fresh: false }), null);
    // Never read: everyone first.
    assert.equal(traders.buyersAsk(null, { fresh: true }), null);
    assert.equal(traders.buyersAsk({ at: 0, total: 0, traders: [] }, { fresh: true }), null);
    // Every buyer fitted in the answer: nothing more to ask for.
    assert.equal(traders.buyersAsk({ at: NOW, total: 60, traders: t(60), withinHours: null }, { fresh: true }), null);
    // The last read was the lately one: everyone again (the list dates of the others stay read).
    assert.equal(traders.buyersAsk({ ...full, withinHours: 48 }, { fresh: true }), null);
});

test('the two answers are one list: nobody the full read named is lost, the lately read adds who it cut off', () => {
    const full = [{ id: '1', name: 'Top', price: 900, lastTrade: NOW - 400 * HOUR, listAt: NOW - 500 * HOUR }, { id: '2', name: 'Bob', price: 850, lastTrade: NOW - 5 * HOUR, listAt: NOW - 30 * HOUR }];
    const recent = [{ id: '2', name: 'Bob', price: 855, lastTrade: NOW - HOUR, listAt: NOW - 2 * HOUR }, { id: '3', name: 'New', price: 700, lastTrade: NOW - 2 * HOUR, listAt: NOW - 3 * HOUR }];
    const merged = traders.mergeItemBuyers(full, recent);
    assert.deepEqual(merged.map((x) => [x.id, x.price]), [['1', 900], ['2', 855], ['3', 700]], 'highest first; the newer read of the same trader counts');
    assert.equal(merged[1].listAt, NOW - 2 * HOUR);
    assert.deepEqual(traders.mergeItemBuyers(null, recent).map((x) => x.id), ['2', '3']);
    assert.deepEqual(traders.mergeItemBuyers(full, null).map((x) => x.id), ['1', '2']);
    // Did TornW3B do as asked? Those in a lately answer whose last trade is known and older say no.
    assert.equal(traders.notTradedLately(recent, 48, NOW), 0);
    assert.equal(traders.notTradedLately(full, 48, NOW), 1);
    assert.equal(traders.notTradedLately([{ id: '9', lastTrade: null }], 48, NOW), 0, 'not known: not counted');
});

test('an item\'s listings: every one is asked for - a price cap is not sent, whatever is passed', async () => {
    const seen = [];
    const rows = [{ player_id: 1, price: 800, quantity: 2 }, { player_id: 2, price: 900, quantity: 1 }];
    const c = clientSeeing(seen, () => ({ total_listings: 2, listings: rows }));
    const got = await w3b.fetchW3bListings(c, 206, { maxPrice: 850 });
    assert.deepEqual(keys(seen[0]), ['comment']);
    assert.equal(got.listings.length, 2);
});

/*
 * Item 5: our own count of requests, nobody else's. The friend's TornW3B use
 * peaked at 89 a minute against our own 80: the tabs see each other's
 * requests late. What pushed it is for his next zip to say - so a tab that
 * finds the shared minute over the limit says so, with the numbers.
 */
test('the shared minute found over our own limit is reported - with how many, the limit, and this tab\'s share', async () => {
    let t = 1000000;
    const overs = [];
    let others = Array.from({ length: 85 }, (_, i) => t - 30000 + i);
    const sent = [];
    const c = new w3b.W3bClient({
        now: () => t,
        fetchImpl: async (url) => {
            sent.push(url);
            return response(200, {});
        },
        loadShared: () => ({ recent: others, cooldownUntil: 0 }),
        addShared: () => {},
        sleep: async () => {
            // A minute on: the others' requests have left the window.
            t += 61000;
            others = [];
        },
        onOver: (x) => overs.push(x),
    });
    await c.get('marketplace');
    assert.equal(sent.length, 1, 'it waited, then asked');
    assert.deepEqual(overs, [{ count: 85, limit: 80, own: 0 }]);
    // At the limit, or under it: nothing to report.
    const quiet = [];
    others = Array.from({ length: 80 }, (_, i) => t - 30000 + i);
    const c2 = new w3b.W3bClient({ now: () => t, fetchImpl: async () => response(200, {}), loadShared: () => ({ recent: others, cooldownUntil: 0 }), addShared: () => {}, sleep: async () => { t += 61000; others = []; }, onOver: (x) => quiet.push(x) });
    await c2.get('marketplace');
    assert.deepEqual(quiet, []);
    // A report that throws never stops a request.
    others = Array.from({ length: 90 }, (_, i) => t - 30000 + i);
    const c3 = new w3b.W3bClient({ now: () => t, fetchImpl: async () => response(200, { ok: 1 }), loadShared: () => ({ recent: others, cooldownUntil: 0 }), addShared: () => {}, sleep: async () => { t += 61000; others = []; }, onOver: () => { throw new Error('x'); } });
    assert.deepEqual(await c3.get('marketplace'), { ok: 1 });
});
