/*
 * 3.26.0: the root cause of the TornW3B refusals (the zips of 2026-09-30 ... 10-11: every 429 was on the
 * sellers of an item, GET /marketplace/{itemId} - ten a minute and a thousand a day by address since
 * 2026-10-06, 25 a minute with the key registered there). The sellers list has a minute and a day of its own
 * here, a refusal of it stops only it for as long as TornW3B says (Retry-After), and the registered key goes
 * in a header of that one request and nowhere else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    W3bClient, w3bRoute, isW3bListingPath, w3bRetryAfterMs,
    W3B_LISTING_PER_MINUTE, W3B_LISTING_PER_DAY, W3B_LISTING_KEYED_PER_MINUTE, W3B_LIGHT_PER_DAY, W3B_KEY_HEADER, W3B_COOLDOWN_MS,
    W3B_RETRY_AFTER_MIN_MS, W3B_RETRY_AFTER_MAX_MS,
} from '../src/api/w3b.js';
import { gmHeader } from '../src/platform/gm.js';

const T0 = 1_700_000_000_000;
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const KEY = 'abcdEFGH1234ijkl';

function world({ answer = () => ({ status: 200 }), key = null, other = null, ...options } = {}) {
    const w = { t: T0, calls: [], routes: null, listing: [], refusedKey: 0, notes: [] };
    w.client = new W3bClient({
        now: () => w.t,
        sleep: async (ms) => { w.t += ms; },
        maxPerMinute: 1000,
        sharedPerMinute: 1000,
        loadListing: () => w.listing.filter((at) => w.t - at < MINUTE),
        addListing: (at) => w.listing.push(at),
        loadRoutes: () => w.routes,
        saveRoutes: (r) => { w.routes = JSON.parse(JSON.stringify(r)); },
        otherListing: other ? () => other(w) : null,
        onRoute: (x) => w.notes.push(x),
        listingKey: key ? () => key(w) : null,
        onKeyRefused: () => { w.refusedKey += 1; },
        fetchImpl: async (url, opts) => {
            w.calls.push({ url, opts: opts || null, at: w.t });
            const a = answer(w, url, opts) || {};
            const status = a.status || 200;
            return { ok: status >= 200 && status < 300, status, json: async () => a.body || { listings: [] }, header: (name) => (a.headers || {})[String(name).toLowerCase()] ?? null };
        },
        ...options,
    });
    return w;
}
const fails = async (p) => p.then(() => null, (e) => e);

test('which limit a request draws on: only the sellers of an item, and its light list', () => {
    assert.equal(w3bRoute('marketplace/206'), 'listing');
    assert.equal(w3bRoute('/marketplace/206/'), 'listing');
    assert.equal(w3bRoute('marketplace/206', { filler: 1 }), 'light');
    assert.equal(w3bRoute('marketplace'), 'rest');
    assert.equal(w3bRoute('marketplace/206/traders'), 'rest');
    assert.equal(w3bRoute('pricelist/11'), 'rest');
    assert.equal(isW3bListingPath('marketplace/206/traders'), false);
    // Two under TornW3B's ten a minute, a hundred under its thousand a day.
    assert.deepEqual([W3B_LISTING_PER_MINUTE, W3B_LISTING_PER_DAY, W3B_LIGHT_PER_DAY], [8, 900, 9000]);
});

test('a Retry-After is seconds or an HTTP date, never under a second, never over a day', () => {
    assert.equal(w3bRetryAfterMs('30'), 30000);
    assert.equal(w3bRetryAfterMs('0'), W3B_RETRY_AFTER_MIN_MS);
    assert.equal(w3bRetryAfterMs('999999'), W3B_RETRY_AFTER_MAX_MS);
    assert.equal(w3bRetryAfterMs(new Date(T0 + 90000).toUTCString(), T0), 90000);
    for (const junk of [null, undefined, '', 'soon', '12 apples']) assert.equal(w3bRetryAfterMs(junk), null);
    // The userscript host gives the answer's headers as one text.
    assert.equal(gmHeader('content-type: application/json\r\nRetry-After: 42\r\n', 'retry-after'), '42');
    assert.equal(gmHeader('content-type: application/json', 'retry-after'), null);
    assert.equal(gmHeader(null, 'retry-after'), null);
});

test('the ninth sellers list of a minute is not sent; price lists and buyers go on; the minute after, it is', async () => {
    const w = world();
    for (let i = 0; i < W3B_LISTING_PER_MINUTE; i++) await w.client.get('marketplace/' + (100 + i));
    assert.equal(w.calls.length, 8);
    const e = await fails(w.client.get('marketplace/999'));
    assert.equal(w.calls.length, 8, 'not sent');
    assert.deepEqual([e.paused, e.route, e.reason, e.blocked], [true, 'listing', 'listing-minute', false]);
    assert.equal(e.retryAt, w.calls[0].at + MINUTE);
    // The other kinds are not held by it.
    await w.client.get('pricelist/11');
    await w.client.get('marketplace/206/traders');
    await w.client.get('marketplace');
    await w.client.get('marketplace/206', { query: { filler: 1 } });
    assert.equal(w.calls.length, 12);
    assert.deepEqual(w.client.stats().listingMinuteLeft, 0);
    w.t = e.retryAt + 1;
    await w.client.get('marketplace/999');
    assert.equal(w.calls.length, 13);
});

test('every tab and Torn Archive on this PC draw on the same minute and day: TornW3B counts by address', async () => {
    const w = world({ other: () => ({ minute: 5, day: 100 }) });
    for (let i = 0; i < 3; i++) await w.client.get('marketplace/' + (100 + i));
    const e = await fails(w.client.get('marketplace/999'));
    assert.equal(e.reason, 'listing-minute');
    assert.equal(w.calls.length, 3);
    assert.deepEqual([w.client.stats().listingLastMinute, w.client.stats().listingToday], [8, 103]);
    // Another tab's sellers lists are in the shared minute.
    const w2 = world();
    w2.listing.push(...Array.from({ length: 8 }, (_, i) => T0 - 1000 - i));
    assert.equal((await fails(w2.client.get('marketplace/1'))).reason, 'listing-minute');
    assert.equal(w2.calls.length, 0);
});

test('nine hundred sellers lists in a day, then none until the oldest hour has left the day', async () => {
    const w = world();
    const hour = Math.floor(T0 / HOUR);
    w.routes = { listingDay: { [hour - 23]: 400, [hour - 1]: 499 }, lightDay: {}, listingUntil: 0, lightUntil: 0 };
    await w.client.get('marketplace/1');
    assert.equal(w.client.stats().listingDayLeft, 0);
    const e = await fails(w.client.get('marketplace/2'));
    assert.deepEqual([e.paused, e.reason], [true, 'listing-day']);
    assert.equal(w.calls.length, 1);
    // The light list has its own day.
    await w.client.get('marketplace/2', { query: { filler: 1 } });
    assert.equal(w.calls.length, 2);
    assert.match(w.calls[1].url, /filler=1/);
    // When the hour with the 400 is over a day old, there is room again.
    w.t = e.retryAt + 1;
    await w.client.get('marketplace/2');
    assert.equal(w.calls.length, 3);
});

test('a refused sellers list stops only sellers lists, for as long as TornW3B says', async () => {
    const w = world({ answer: (x, url) => (/marketplace\/\d+\?/.test(url) && x.calls.length === 1 ? { status: 429, headers: { 'retry-after': '90' } } : { status: 200 }) });
    const e = await fails(w.client.get('marketplace/206'));
    assert.deepEqual([e.http, e.route, e.blocked, e.paused], [429, 'listing', false, false]);
    assert.equal(e.retryAt, T0 + 90000);
    assert.deepEqual(w.notes.map((n) => [n.route, n.said]), [['listing', 90000]]);
    // Nothing else is stopped, and nothing is slowed.
    assert.equal(w.client.stats().coolingDown, false);
    await w.client.get('pricelist/11');
    await w.client.get('marketplace/206', { query: { filler: 1 } });
    assert.equal(w.calls.length, 3);
    // Sellers lists wait the ninety seconds - every tab's (the wait is stored).
    const wait = await fails(w.client.get('marketplace/1'));
    assert.deepEqual([wait.paused, wait.reason, wait.retryAt], [true, 'listing-wait', T0 + 90000]);
    assert.equal(w.routes.listingUntil, T0 + 90000);
    w.t = T0 + 90001;
    await w.client.get('marketplace/1');
    assert.equal(w.calls.length, 4);
});

test('a refusal with no Retry-After waits the usual minute; a refused price list still stops everything', async () => {
    const w = world({ answer: (x) => (x.calls.length === 1 ? { status: 429 } : { status: 200 }) });
    assert.equal((await fails(w.client.get('marketplace/206'))).retryAt, T0 + W3B_COOLDOWN_MS);
    const all = world({ answer: () => ({ status: 429, headers: { 'retry-after': '20' } }) });
    const e = await fails(all.client.get('pricelist/11'));
    assert.deepEqual([e.blocked, e.route, e.retryAt], [true, null, T0 + 20000]);
    assert.equal(all.client.stats().coolingDown, true);
    assert.equal((await fails(all.client.get('marketplace/1'))).reason, 'cooldown');
});

test('the key registered on TornW3B: in a header of a sellers list only, never in the address, and 22 a minute with it', async () => {
    const w = world({ key: () => KEY });
    await w.client.get('marketplace/206');
    await w.client.get('pricelist/11');
    await w.client.get('marketplace/206/traders');
    await w.client.get('marketplace/206', { query: { filler: 1 } });
    await w.client.get('marketplace');
    assert.deepEqual(w.calls.map((c) => c.opts), [{ headers: { [W3B_KEY_HEADER]: KEY } }, null, null, null, null]);
    for (const c of w.calls) assert.ok(!c.url.includes(KEY) && !/apiKey|[?&]key=/i.test(c.url), c.url);
    assert.equal(W3B_KEY_HEADER, 'X-API-Key');

    assert.equal(W3B_LISTING_KEYED_PER_MINUTE, 22);
    for (let i = 1; i < 22; i++) await w.client.get('marketplace/' + (300 + i));
    assert.equal((await fails(w.client.get('marketplace/999'))).reason, 'listing-minute');
    assert.equal(w.calls.filter((c) => c.opts).length, 22);
    // The day is the same nine hundred.
    assert.equal(w.client.stats().listingDayLeft, W3B_LISTING_PER_DAY - 22);
});

test('a key TornW3B does not know is said once and never sent again; something not shaped like a Torn key never leaves', async () => {
    let key = KEY;
    const w = world({ key: () => key, answer: (x, url, opts) => (opts ? { status: 401 } : { status: 200 }) });
    w.client.onKeyRefused = () => { w.refusedKey += 1; key = ''; };
    const e = await fails(w.client.get('marketplace/206'));
    assert.deepEqual([e.http, e.badKey, e.blocked, e.paused], [401, true, false, false]);
    assert.equal(w.refusedKey, 1);
    await w.client.get('marketplace/206');
    assert.equal(w.calls[1].opts, null);
    // Without the key the minute is eight again.
    assert.equal(w.client.listingPerMinute, W3B_LISTING_PER_MINUTE);

    for (const bad of ['short', KEY + 'x', 'abcd EFGH1234ijk', 'abcdEFGH1234ijk\n', { toString: () => KEY + '!' }, null]) {
        const b = world({ key: () => bad });
        await b.client.get('marketplace/206');
        assert.equal(b.calls[0].opts, null, String(bad));
    }
    // A key that throws on reading is no key.
    const t = world({ key: () => { throw new Error('storage'); } });
    await t.client.get('marketplace/206');
    assert.equal(t.calls[0].opts, null);
});

test('each kind with a day of its own says what it used in this clock hour (3.26.1: the day is paced by it)', async () => {
    // T0 is 800 s into its hour.
    const w = world();
    for (let i = 0; i < 3; i++) await w.client.get('marketplace/' + (100 + i));
    for (let i = 0; i < 5; i++) await w.client.get('marketplace/' + (100 + i), { query: { filler: 1 } });
    let st = w.client.stats();
    assert.deepEqual([st.listingHourUsed, st.lightHourUsed, st.lightToday, st.lightDayLeft], [3, 5, 5, W3B_LIGHT_PER_DAY - 5]);
    // The next hour: the day still holds them, the hour does not.
    w.t = T0 + HOUR;
    await w.client.get('marketplace/200', { query: { filler: 1 } });
    st = w.client.stats();
    assert.deepEqual([st.listingHourUsed, st.listingToday, st.lightHourUsed, st.lightToday], [0, 3, 1, 6]);
});
