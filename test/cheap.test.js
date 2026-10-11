/*
 * 3.26.0 - TornW3B's light list (core/cheap.js): the ten cheapest prices and
 * counts of an item, no seller, on a limit of its own. The owner, 2026-10-11:
 * TornW3B is asked only what we cannot know - so the light list confirms a
 * sellers list read before, or calls for a new one, and never changes a row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseW3bCheapest, cheapKeys, cheapLowest, cheapSame, W3B_LIGHT_ROWS } from '../src/core/cheap.js';
import { W3bClient, fetchW3bCheapest, W3B_LIGHT_PER_DAY, W3B_LISTING_PER_MINUTE } from '../src/api/w3b.js';

const row = (price, qty, sellerId = '1') => ({ sellerId, price, qty });
const light = (...pairs) => parseW3bCheapest({ listings: pairs.map(([price, quantity]) => ({ price, quantity })) });

test('the light list is read whatever it names its fields, one row a price, and $1 listings are left out', () => {
    assert.deepEqual(parseW3bCheapest({ listings: [{ price: 60, quantity: 5 }, { price: 50, quantity: 4 }, { price: 60, quantity: 1 }, { price: 1, quantity: 99 }] }), { rows: [{ price: 50, qty: 4 }, { price: 60, qty: 6 }], whole: true });
    assert.deepEqual(parseW3bCheapest([{ cost: 50, amount: 4 }]).rows, [{ price: 50, qty: 4 }]);
    assert.deepEqual(parseW3bCheapest({ prices: [[50, 4], [70, '2']] }).rows, [{ price: 50, qty: 4 }, { price: 70, qty: 2 }]);
    // Nobody sells it.
    assert.deepEqual(parseW3bCheapest({ listings: [] }), { rows: [], whole: true });
    // Ten came: there may be more behind them.
    const ten = { listings: Array.from({ length: W3B_LIGHT_ROWS }, (_, i) => ({ price: 100 + i, quantity: 1 })) };
    assert.equal(parseW3bCheapest(ten).whole, false);
    assert.equal(cheapLowest(parseW3bCheapest(ten)), 100);
    assert.equal(cheapLowest(parseW3bCheapest({ listings: [] })), null);
    assert.equal(cheapLowest(null), null);
});

test('an answer in a shape this version does not read is not guessed at: null, and only its field names go to the log', () => {
    for (const odd of [null, 'text', 5, {}, { ok: true, cheapest: 'see the website' }, { listings: [{ price: 50 }] }, { listings: [{ price: 'a lot', quantity: 2 }] }, { listings: [{ price: 50, quantity: 0 }] }, { listings: [5, 6] }, { listings: [[50, 4, 9]] }]) {
        assert.equal(parseW3bCheapest(odd), null, JSON.stringify(odd));
    }
    assert.equal(cheapKeys({ ok: true, cheapest: 'see the website' }), '{ok, cheapest}');
    assert.equal(cheapKeys({ total: 2, rows: [{ p: 50, n: 4, seller: 'Bob' }] }), '{total, rows}, rows of {p, n, seller}');
    assert.equal(cheapKeys([{ p: 50 }]), 'a list of {p}');
    assert.equal(cheapKeys('text'), 'string');
    // Never what the fields hold.
    assert.doesNotMatch(cheapKeys({ total: 2, rows: [{ p: 50, n: 4, seller: 'Bob' }] }), /Bob|50/);
});

test('the same as the sellers list said: every price under the cut, with the count of every listing at it', () => {
    const rows = [row(50, 4, '7'), row(60, 2, '8'), row(60, 3, '9'), row(75, 1, '7')];
    assert.deepEqual(cheapSame(rows, light([50, 4], [60, 5], [75, 1])), { same: true, why: 'same', prices: 3 });
    // Nobody sold it, and nobody does.
    assert.equal(cheapSame([], light()).same, true);
    // Ten came, the last at 109: only the prices under it are compared (the last may be there in part).
    const many = Array.from({ length: 30 }, (_, i) => row(100 + i, 2, String(i)));
    const first = light(...many.slice(0, W3B_LIGHT_ROWS).map((r) => [r.price, r.qty]));
    assert.deepEqual(cheapSame(many, first), { same: true, why: 'same', prices: W3B_LIGHT_ROWS - 1 });
    // A sellers list of which only the cheapest rows were kept: compared under its own last price too.
    assert.deepEqual(cheapSame(many.slice(0, 4), first, { cut: true }), { same: true, why: 'same', prices: 3 });
    assert.equal(cheapSame(many.slice(0, 4), first).same, false);
});

test('not the same: a price no seller we know has, more at a price, fewer, sold - each calls for the sellers list', () => {
    const rows = [row(50, 4, '7'), row(60, 2, '8'), row(75, 1, '7')];
    assert.equal(cheapSame(rows, light([45, 1], [50, 4], [60, 2], [75, 1])).why, 'new-price');
    assert.equal(cheapSame(rows, light([50, 9], [60, 2], [75, 1])).why, 'more');
    assert.equal(cheapSame(rows, light([50, 1], [60, 2], [75, 1])).why, 'less');
    assert.equal(cheapSame(rows, light([60, 2], [75, 1])).why, 'less');
    assert.equal(cheapSame(rows, light()).why, 'less');
    assert.equal(cheapSame([], light([50, 1])).why, 'new-price');
    for (const l of [light([45, 1], [50, 4]), light([50, 9]), light([60, 2])]) assert.equal(cheapSame(rows, l).same, false);
    // Ten listings at one price: nothing lies under the cut, so nothing was learned - the sellers are read.
    const flat = light(...Array.from({ length: W3B_LIGHT_ROWS }, () => [50, 1]));
    assert.deepEqual(cheapSame([row(50, 40)], parseW3bCheapest({ listings: Array.from({ length: W3B_LIGHT_ROWS }, () => ({ price: 50, quantity: 1 })) })), { same: false, why: 'nothing', prices: 0 });
    assert.equal(flat.rows.length, 1);
});

test('the light list is asked with filler=1, counts on its own day, and takes nothing from the sellers lists\' minute', async () => {
    const asked = [];
    const client = new W3bClient({
        fetchImpl: async (url) => {
            asked.push(url);
            return { ok: true, status: 200, async json() { return { listings: [{ price: 50, quantity: 4 }] }; }, headers: { get: () => null } };
        },
        minIntervalMs: 0,
        sleep: async () => {},
    });
    const data = await fetchW3bCheapest(client, 206);
    assert.deepEqual(parseW3bCheapest(data).rows, [{ price: 50, qty: 4 }]);
    const u = new URL(asked[0]);
    assert.equal(u.pathname.endsWith('/marketplace/206'), true);
    assert.equal(u.searchParams.get('filler'), '1');
    const st = client.stats();
    assert.equal(st.lightToday, 1);
    assert.equal(st.listingMinuteLeft, W3B_LISTING_PER_MINUTE);
    assert.ok(W3B_LIGHT_PER_DAY <= 10000);
});
