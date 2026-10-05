import test from 'node:test';
import assert from 'node:assert/strict';

import * as fill from '../src/core/fill.js';
import {
    fillPrice,
    fillQuantity,
    fillVerdict,
    realListings,
    cleanFillSettings,
    ordinalLowest,
    FILL_DEFAULTS,
    FILL_FRESH_MS,
    FILL_REUSE_MS,
    FILL_WARM_MS,
    priceTone,
    nextWarmRead,
} from '../src/core/fill.js';

const NOW = 1_800_000_000_000;
const fresh = (price, extra = {}) => ({ price, qty: 5, sellerId: '100', dataAt: NOW - 60_000, ...extra });

test('the default is the friend\'s: the lowest bazaar listing minus $1', () => {
    const r = fillPrice([fresh(840000), fresh(839399), fresh(839500)], FILL_DEFAULTS.bazaar, { now: NOW });
    assert.equal(r.price, 839398);
    assert.equal(r.base.price, 839399);
    assert.equal(r.used, 1);
});

test('listing index picks the 2nd or 3rd lowest; fewer listings uses the highest there is', () => {
    const rows = [fresh(100), fresh(120), fresh(150)];
    assert.equal(fillPrice(rows, { index: 2, amount: 1, unit: '$' }, { now: NOW }).price, 119);
    assert.equal(fillPrice(rows, { index: 3, amount: 1, unit: '$' }, { now: NOW }).price, 149);
    const r = fillPrice(rows, { index: 5, amount: 1, unit: '$' }, { now: NOW });
    assert.equal(r.used, 3);
    assert.equal(r.index, 5);
    assert.equal(r.price, 149);
});

test('the margin in percent rounds down to whole dollars', () => {
    assert.equal(fillPrice([fresh(1000)], { index: 1, amount: 2, unit: '%' }, { now: NOW }).price, 980);
    assert.equal(fillPrice([fresh(999)], { index: 1, amount: 1.5, unit: '%' }, { now: NOW }).price, 984);
    assert.equal(fillPrice([fresh(500)], { index: 1, amount: 0, unit: '$' }, { now: NOW }).price, 500);
});

test('your own, $1, sponsored, stale and troll listings are never the one undercut', () => {
    const rows = [
        fresh(700, { sellerId: '42' }),               // yours
        fresh(1),                                      // padlocked $1
        fresh(800, { sponsored: true }),
        fresh(810, { dataAt: NOW - FILL_FRESH_MS - 1 }), // not seen for 30 min
        fresh(200),                                    // under 25% of the average
        fresh(900),
    ];
    const r = fillPrice(rows, FILL_DEFAULTS.bazaar, { selfId: 42, avg: 1000, now: NOW });
    assert.equal(r.base.price, 900);
    assert.equal(r.price, 899);
    assert.deepEqual(r.skipped, { mine: 1, dollar: 1, sponsored: 1, stale: 1, troll: 1 });
});

test('Item Market listings are live: no freshness check, and a listing marked mine is skipped', () => {
    const rows = [{ price: 500, mine: true }, { price: 520 }];
    const r = fillPrice(rows, FILL_DEFAULTS.market, { now: NOW, checkFresh: false });
    assert.equal(r.price, 519);
});

test('never below the NPC price; the average floor only when switched on', () => {
    const r = fillPrice([fresh(600)], { index: 1, amount: 200, unit: '$' }, { npc: 550, now: NOW });
    assert.equal(r.price, 550);
    assert.equal(r.floor, 'npc');
    const a = fillPrice([fresh(900)], { index: 1, amount: 1, unit: '$', floorAvg: true }, { avg: 1000, now: NOW });
    assert.equal(a.price, 1000);
    assert.equal(a.floor, 'avg');
    const off = fillPrice([fresh(900)], { index: 1, amount: 1, unit: '$', floorAvg: false }, { avg: 1000, now: NOW });
    assert.equal(off.price, 899);
    assert.equal(off.floor, null);
});

test('nothing to go by: no price, and says why', () => {
    const r = fillPrice([fresh(1), fresh(50, { sellerId: '7' })], FILL_DEFAULTS.bazaar, { selfId: '7', now: NOW });
    assert.equal(r.price, null);
    assert.match(r.why, /No listing/);
    assert.equal(fillPrice([], FILL_DEFAULTS.bazaar).price, null);
});

test('an undercut that would reach $1 or less is refused, not typed', () => {
    const r = fillPrice([fresh(3)], { index: 1, amount: 10, unit: '$' }, { now: NOW });
    assert.equal(r.price, null);
    assert.match(r.why, /\$1 or less/);
    assert.equal(fillPrice([fresh(5000)], { index: 1, amount: 100, unit: '%' }, { now: NOW }).price, null);
});

test('percent undercuts land on the right dollar (no float error)', () => {
    // 6% under $2,150 is $2,021 exactly; float maths gave $2,020.
    assert.equal(fillPrice([fresh(2150)], { index: 1, amount: 6, unit: '%' }, { now: NOW }).price, 2021);
    for (let base = 100; base <= 20000; base += 50) {
        const want = Math.floor((base * 94) / 100);
        assert.equal(fillPrice([fresh(base)], { index: 1, amount: 6, unit: '%' }, { now: NOW }).price, want, 'base ' + base);
    }
});

test('quantity: all, or all but one; nothing to list leaves the box alone', () => {
    assert.equal(fillQuantity(12, 'all'), 12);
    assert.equal(fillQuantity(12, 'allbut1'), 11);
    assert.equal(fillQuantity(1, 'allbut1'), null);
    assert.equal(fillQuantity(0, 'all'), null);
    assert.equal(fillQuantity(undefined, 'all'), null);
});

test('settings are cleaned: bad values fall back, the unit is $ or %', () => {
    assert.deepEqual(cleanFillSettings(null), FILL_DEFAULTS.bazaar);
    assert.deepEqual(cleanFillSettings({ index: 0, amount: -3, unit: 'x', qty: 'nope', floorAvg: 'yes' }), FILL_DEFAULTS.bazaar);
    assert.deepEqual(cleanFillSettings({ index: '2', amount: '1.5', unit: '%', qty: 'allbut1', floorAvg: true }), { index: 2, amount: 1.5, unit: '%', qty: 'allbut1', floorAvg: true });
});

test('the verdict: green at or over the average, amber under', () => {
    assert.deepEqual(fillVerdict(1000, 1000), { level: 'good', text: 'at the average' });
    assert.deepEqual(fillVerdict(1050, 1000), { level: 'good', text: '5% over the average' });
    assert.deepEqual(fillVerdict(980, 1000), { level: 'warn', text: '2% under the average' });
    assert.deepEqual(fillVerdict(1000, null), { level: null, text: '' });
});

test('ordinals read like a person would say them', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalLowest), ['lowest', '2nd lowest', '3rd lowest', '4th lowest', '11th lowest', '12th lowest', '13th lowest', '21st lowest', '22nd lowest']);
});

test('realListings sorts cheapest first', () => {
    const { rows } = realListings([fresh(30), fresh(10), fresh(20)], { now: NOW });
    assert.deepEqual(rows.map((r) => r.price), [10, 20, 30]);
});

test('a price on the add page: red under what you paid, amber over the lowest bazaar, green otherwise', () => {
    assert.equal(priceTone(90, { paid: 100, lowest: 120 }), 'under');
    assert.equal(priceTone(130, { paid: 100, lowest: 120 }), 'over');
    assert.equal(priceTone(119, { paid: 100, lowest: 120 }), 'ok');
    // At the lowest bazaar price, or at what you paid: neither a loss nor over.
    assert.equal(priceTone(120, { paid: 100, lowest: 120 }), 'ok');
    assert.equal(priceTone(100, { paid: 100, lowest: 120 }), 'ok');
    // Under what you paid AND over the lowest bazaar: the loss is said.
    assert.equal(priceTone(70, { paid: 100, lowest: 50 }), 'under');
});

test('a price with only one thing to hold it against, or none', () => {
    assert.equal(priceTone(130, { lowest: 120 }), 'over');
    assert.equal(priceTone(110, { lowest: 120 }), 'ok');
    assert.equal(priceTone(90, { paid: 100 }), 'under');
    assert.equal(priceTone(110, { paid: 100 }), 'ok');
    assert.equal(priceTone(110, {}), null);
    assert.equal(priceTone(0, { paid: 100, lowest: 120 }), null);
    assert.equal(priceTone('', { paid: 100, lowest: 120 }), null);
});

test('listings read ahead: never read first, in the order given; then the oldest past its age', () => {
    const state = { a: { at: NOW - 30_000 }, b: null, c: null };
    assert.equal(nextWarmRead(['a', 'b', 'c'], (id) => state[id], { now: NOW }), 'b');
    state.b = { at: NOW - 10_000 };
    state.c = { at: NOW - 20_000 };
    // Every one read, none older than FILL_WARM_MS: nothing to read.
    assert.equal(nextWarmRead(['a', 'b', 'c'], (id) => state[id], { now: NOW }), null);
    state.a.at = NOW - FILL_WARM_MS - 5_000;
    state.c.at = NOW - FILL_WARM_MS - 1_000;
    assert.equal(nextWarmRead(['c', 'a', 'b'], (id) => state[id], { now: NOW }), 'a');
});

test('listings read ahead: one being read is passed over, one that failed waits', () => {
    const state = { a: { promise: {} }, b: { errorAt: NOW - 5_000 }, c: { at: NOW - FILL_WARM_MS - 1 } };
    assert.equal(nextWarmRead(['a', 'b', 'c'], (id) => state[id], { now: NOW }), 'c');
    state.b.errorAt = NOW - FILL_REUSE_MS - 1;
    assert.equal(nextWarmRead(['a', 'b', 'c'], (id) => state[id], { now: NOW }), 'b');
    assert.equal(nextWarmRead([], () => null, { now: NOW }), null);
});

/*
 * 3.23.0, item 8: a typed bazaar price far under market value - a slipped
 * digit (15,000 typed as 1,500) - pulses red in its box. By a share of the
 * value, never a sum; no pop-up, and nothing of Torn's is blocked.
 */
test('a price far under market value: a quarter or more under it pulses red; a normal undercut does not', () => {
    assert.equal(fill.FAR_UNDER_SHARE, 0.25);
    // A slipped digit.
    assert.equal(fill.priceTone(1500, { market: 15000 }), 'cheap');
    assert.deepEqual(fill.farUnder(1500, { market: 15000 }), { ref: 15000, of: 'market', pct: 90 });
    // A fifth under: an undercut, not a slip.
    assert.equal(fill.priceTone(12000, { market: 15000 }), 'ok');
    assert.equal(fill.farUnder(12000, { market: 15000 }), null);
    // The line itself: a quarter under is still a price; a dollar less is not.
    assert.equal(fill.priceTone(11250, { market: 15000 }), 'ok');
    assert.equal(fill.priceTone(11249, { market: 15000 }), 'cheap');
    // No market value known: nothing to hold it against, as before.
    assert.equal(fill.priceTone(1500, {}), null);
    assert.equal(fill.priceTone(1500, { market: 0 }), null);
    assert.equal(fill.farUnder(0, { market: 15000 }), null);
});

test('far under: held against the lower of the market value and the lowest bazaar, so undercutting cheap bazaars is not a warning', () => {
    // Every bazaar sells it at less than half its market value: a dollar under the cheapest is a normal price.
    assert.equal(fill.priceTone(6999, { market: 15000, lowest: 7000 }), 'ok');
    assert.equal(fill.farUnder(6999, { market: 15000, lowest: 7000 }), null);
    // A slip against that too.
    assert.equal(fill.priceTone(700, { market: 15000, lowest: 7000 }), 'cheap');
    assert.deepEqual(fill.farUnder(700, { market: 15000, lowest: 7000 }), { ref: 7000, of: 'bazaar', pct: 90 });
    // The lowest bazaar over the market value: the market value is the line.
    assert.deepEqual(fill.farUnder(1000, { market: 15000, lowest: 16000 }), { ref: 15000, of: 'market', pct: 93 });
    // Under what you paid is said first (it is the loss); over the lowest bazaar is unchanged.
    assert.equal(fill.priceTone(90, { paid: 100, market: 15000 }), 'under');
    assert.equal(fill.priceTone(16000, { market: 15000, lowest: 15500 }), 'over');
    // In words, for the box's hover.
    assert.equal(fill.farUnderWords({ ref: 15000, of: 'market', pct: 90 }), 'Far under its market value, $15,000: 90% less. Check the price');
    assert.equal(fill.farUnderWords({ ref: 7000, of: 'bazaar', pct: 90 }), 'Far under the lowest bazaar price, $7,000: 90% less. Check the price');
});
