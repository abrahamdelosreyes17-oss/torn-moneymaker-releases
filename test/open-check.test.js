import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseW3bPage, openNow, nextOpenCheck, OPEN_CHECK_MS, OPEN_RECHECK_MS } from '../src/core/open-check.js';

// Two real pages, read 2026-10-16 with `RSC: 1`: the owner's closed list, and an open list of 108 items.
const CLOSED = readFileSync(new URL('./pages/w3b-closed-2691860.rsc', import.meta.url), 'utf8');
const OPEN = readFileSync(new URL('./pages/w3b-open-3626229.rsc', import.meta.url), 'utf8');

test('a closed list is closed, with no prices', () => {
    const r = parseW3bPage(CLOSED, 2691860);
    assert.equal(r.state, 'closed');
    assert.equal(r.prices, null);
});

test('an open list is open, with every price it names and when it changed', () => {
    const r = parseW3bPage(OPEN, '3626229');
    assert.equal(r.state, 'open');
    assert.equal(r.items, 108);
    assert.equal(Object.keys(r.prices).length, 108);
    assert.equal(r.prices['35'], 831);
    assert.equal(r.updatedAt, Date.parse('2026-10-16T06:26:40.000Z'));
    // Sets (negative ids) are not items.
    assert.ok(!Object.keys(r.prices).some((k) => Number(k) < 0));
});

test('another trader\'s page is unclear, never theirs', () => {
    assert.equal(parseW3bPage(OPEN, 2691860).state, 'unclear');
    assert.equal(parseW3bPage(CLOSED, 3626229).state, 'unclear');
});

test('a page cut off, empty or changed in shape is unclear', () => {
    assert.equal(parseW3bPage(OPEN.slice(0, Math.floor(OPEN.length / 2)), 3626229).state, 'unclear');
    assert.equal(parseW3bPage('', 3626229).state, 'unclear');
    assert.equal(parseW3bPage('<html>Just a moment...</html>', 3626229).state, 'unclear');
    assert.equal(parseW3bPage(OPEN.replace('"isActive":true', '"isActive":false'), 3626229).state, 'unclear');
    assert.equal(parseW3bPage(OPEN.replaceAll('items priced', 'things priced'), 3626229).state, 'unclear');
    // Says both: not believed either way.
    assert.equal(parseW3bPage(OPEN + '"subtitle":"This pricelist is currently closed."', 3626229).state, 'unclear');
    // A count written with a thousands comma is read as the number (1,234 items).
    assert.equal(parseW3bPage(OPEN.replace('"subtitle":"108 items priced', '"subtitle":"1,08 items priced'), 3626229).state, 'open');
    // One price row fewer than it says it has.
    assert.equal(parseW3bPage(OPEN.replace('"buyPrice":831', '"buyPrice":0'), 3626229).state, 'unclear');
});

test('an open check stands three minutes; closed, unclear, failed and old ones never', () => {
    const now = 10_000_000;
    assert.deepEqual(openNow({ at: now - 60_000, state: 'open' }, { now }), { ok: true, why: 'open', at: now - 60_000 });
    assert.equal(openNow({ at: now - OPEN_CHECK_MS - 1, state: 'open' }, { now }).why, 'stale');
    assert.equal(openNow({ at: now - 1000, state: 'closed' }, { now }).why, 'closed');
    assert.equal(openNow({ at: now - 1000, state: 'unclear' }, { now }).ok, false);
    assert.equal(openNow({ at: now - 1000, state: 'failed' }, { now }).why, 'failed');
    assert.equal(openNow(null, { now }).why, 'unread');
    // From the future (a clock moved): not believed.
    assert.equal(openNow({ at: now + 120_000, state: 'open' }, { now }).ok, false);
});

test('the next list to check: due ones in the order wanted, within the minute', () => {
    const now = 10_000_000;
    const checks = new Map([['1', { at: now - 10_000 }], ['2', { at: now - OPEN_RECHECK_MS }]]);
    assert.equal(nextOpenCheck(['1', '2', '3'], checks, { now }), '2');
    assert.equal(nextOpenCheck(['1', '3'], checks, { now }), '3');
    assert.equal(nextOpenCheck(['3'], checks, { now, reading: new Set(['3']) }), null);
    assert.equal(nextOpenCheck(['3'], checks, { now, sent: Array(10).fill(now - 1000) }), null);
    assert.equal(nextOpenCheck(['3'], checks, { now, sent: Array(10).fill(now - 61_000) }), '3');
    assert.equal(nextOpenCheck(['name-only', '1'], checks, { now }), null);
});
