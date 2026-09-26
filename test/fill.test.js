import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fillPrice,
    fillQuantity,
    fillVerdict,
    realListings,
    cleanFillSettings,
    ordinalLowest,
    FILL_DEFAULTS,
    FILL_FRESH_MS,
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
