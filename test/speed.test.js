/*
 * 3.17.0: the speed log. The friend's laptop lags and he will not measure it
 * for us, so the script keeps its own counts - and they ride in the zips he
 * already sends, with his trades.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { speedNew, speedAdd, speedStore, speedForeign, speedStartup, speedMachine, speedHasData, speedMerge, speedExpand, speedTotals, speedText, speedFiles, speedKey, SPEED_HOURS_KEPT, SPEED_DAYS_KEPT, SPEED_TOP, SPEED_STARTS, SPEED_NAMES } from '../src/core/speed.js';
import { tradesFiles } from '../src/core/trades-export.js';
import { usageExportFiles } from '../src/ui/usage-view.js';
import { reportFiles } from '../src/ui/report-view.js';
import { makeZip } from '../src/core/zip.js';
import { gmGet, gmSet, gmSize, gmSetProbe } from '../src/platform/gm.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Math.floor(1_790_000_000_000 / HOUR) * HOUR + 5 * 60000;

test('work is counted by kind and hour: how often, how long in all, the longest', () => {
    const p = speedNew();
    assert.equal(speedHasData(p), false);
    speedAdd(p, 'w', 'scan bazaar · timer', 12, 'bazaar', NOW);
    speedAdd(p, 'w', 'scan bazaar · timer', 30, 'bazaar', NOW + 1000);
    speedAdd(p, 'w', 'panel redraw', 4, 'bazaar', NOW);
    assert.equal(speedHasData(p), true);
    const r = speedMerge(null, p, NOW + 5000);
    const hour = String(Math.floor(NOW / HOUR));
    assert.deepEqual(speedExpand(r).h[hour].w['scan bazaar · timer'], [2, 42, 30]);
    assert.deepEqual(speedExpand(r).h[hour].w['panel redraw'], [1, 4, 4]);
    // Stored, each label is written once and the buckets hold its number.
    assert.deepEqual(r.n, ['scan bazaar · timer', 'panel redraw']);
    assert.deepEqual(r.h[hour].w, { 0: [2, 42, 30], 1: [1, 4, 4] });
    // A second tab's counts for the same hour are added, the longest kept.
    const q = speedNew();
    speedAdd(q, 'w', 'scan bazaar · timer', 80, 'bazaar', NOW + 2000);
    const both = speedMerge(r, q, NOW + 6000);
    assert.deepEqual(speedExpand(both).h[hour].w['scan bazaar · timer'], [3, 122, 80]);
    // The record it was added to is not changed (it is another tab's stored copy).
    assert.deepEqual(speedExpand(r).h[hour].w['scan bazaar · timer'], [2, 42, 30]);
    // Junk is not a time.
    speedAdd(p, 'w', 'x', NaN, '', NOW);
    speedAdd(p, 'w', 'x', -1, '', NOW);
    assert.equal(p.h[hour].w.x, undefined);
});

test('freezes and slow clicks say where; the slowest single events are kept, 50 at most', () => {
    const p = speedNew();
    speedAdd(p, 'f', 'freeze', 180, 'bazaar', NOW);
    speedAdd(p, 'i', 'click', 240, 'Torn Bids', NOW);
    speedAdd(p, 'w', 'Torn Bids redraw (working out + page)', 95, 'Torn Bids', NOW);
    speedAdd(p, 'w', 'panel redraw', 8, 'bazaar', NOW);
    const r = speedMerge(null, p, NOW);
    const hour = String(Math.floor(NOW / HOUR));
    assert.deepEqual(Object.keys(speedExpand(r).h[hour].f), ['bazaar · freeze']);
    assert.deepEqual(Object.keys(speedExpand(r).h[hour].i), ['Torn Bids · click']);
    assert.deepEqual(r.top.map((t) => [t[0], t[1], t[2]]), [[240, 'slow click', 'Torn Bids'], [180, 'freeze', 'bazaar'], [95, 'Torn Bids redraw (working out + page)', 'Torn Bids']], 'under 50 ms is not one of the slow ones');
    const many = speedNew();
    for (let i = 0; i < SPEED_TOP + 30; i += 1) speedAdd(many, 'w', 'k', 50 + i, 'x', NOW);
    assert.equal(many.top.length, SPEED_TOP);
    assert.equal(many.top[0][0], 50 + SPEED_TOP + 29);
    assert.equal(speedMerge(r, many, NOW).top.length, SPEED_TOP);
});

test('stored values: reads and writes apart, the size of the text, and no tab id in a name', () => {
    const p = speedNew();
    speedStore(p, 'traderDb', false, 3.2, 812345, NOW);
    speedStore(p, 'traderDb', false, 1.1, 812345, NOW);
    speedStore(p, 'traderDb', true, 9, 812400, NOW);
    speedStore(p, 'apiWindow.mfq1x2-ab12cd34', true, 0.2, 120, NOW);
    speedStore(p, 'apiWindow.tabs', false, 0.1, 40, NOW);
    const merged = speedMerge(null, p, NOW);
    const s = speedTotals(merged).s;
    assert.deepEqual(s.traderDb, [2, 4.3, 3.2, 1, 9, 9, 812400]);
    // Kept by the day, not the hour: the hour's bucket holds none of it.
    assert.equal(Object.values(merged.h).some((b) => b.s), false);
    assert.equal(Object.values(merged.d).length, 1);
    assert.deepEqual(Object.keys(s).sort(), ['apiWindow.tab', 'apiWindow.tabs', 'traderDb']);
    assert.equal(speedKey('w3bWindow.mfq1x2-ab12cd34'), 'w3bWindow.tab');
    assert.equal(speedKey('sellAccepted'), 'sellAccepted');
});

test('changes in the rows we watch that we did not make: how often, how many, the busiest minute', () => {
    const p = speedNew();
    for (let i = 0; i < 5; i += 1) speedForeign(p, 3, NOW + i * 1000);
    speedForeign(p, 10, NOW + 70000);
    const x = speedTotals(speedMerge(null, p, NOW + 80000)).x;
    assert.deepEqual(x, [6, 25, 5]);
});

test('kept by the hour for a day, by the day for a week, then let go', () => {
    const p = speedNew();
    speedAdd(p, 'w', 'k', 10, '', NOW);
    let r = speedMerge(null, p, NOW);
    assert.equal(Object.keys(r.h).length, 1);
    // A day on: folded into its day.
    r = speedMerge(r, speedNew(), NOW + SPEED_HOURS_KEPT * HOUR);
    assert.equal(Object.keys(r.h).length, 0);
    assert.deepEqual(Object.values(speedExpand(r).d)[0].w.k, [1, 10, 10]);
    assert.deepEqual(speedTotals(r).w.k, [1, 10, 10], 'the week\'s totals count it once');
    // Past a week: gone.
    r = speedMerge(r, speedNew(), NOW + (SPEED_DAYS_KEPT + 1) * DAY);
    assert.deepEqual(r.d, {});
    // The slowest events and the start-ups go with their week too.
    const q = speedNew();
    speedAdd(q, 'f', 'freeze', 300, 'bazaar', NOW);
    speedStartup(q, 'bazaar', { script: 812.4, panel: 900, items: 1500 }, NOW);
    for (let i = 0; i < SPEED_STARTS + 5; i += 1) speedStartup(q, 'Torn Bids', { script: 100 + i }, NOW);
    assert.equal(q.start.length, SPEED_STARTS);
    const kept = speedMerge(null, q, NOW);
    assert.equal(kept.top.length, 1);
    assert.deepEqual(kept.start[0].slice(1), ['Torn Bids', 105, null, null]);
    const later = speedMerge(kept, speedNew(), NOW + (SPEED_DAYS_KEPT + 1) * DAY);
    assert.deepEqual([later.top, later.start], [[], []]);
});

test('a stored record that is junk is started again, never an error', () => {
    for (const junk of [null, 5, 'x', [], { h: 5, d: 'x', top: {}, start: 1 }]) {
        const r = speedMerge(junk, speedNew(), NOW);
        assert.deepEqual([r.h, r.d, r.top, r.start], [{}, {}, [], []]);
    }
    assert.doesNotThrow(() => speedText({ h: { 5: { w: { k: 'x' } } } }, { now: NOW }));
    // A bucket under a key that is no hour, a slowest event with no hour: left out, and the text is still made
    // (a zip must come out whatever is stored - review, 3.17.0).
    const bad = { h: { nonsense: { w: { 0: [1, 5, 5] } }, [Math.floor(NOW / HOUR)]: 'x' }, d: { alsoBad: {} }, n: ['k'], top: [[90, 'k', 'x', 'when?']], start: [['never', 'x', 1, 2, 3]] };
    assert.doesNotThrow(() => speedText(bad, { now: NOW }));
    assert.doesNotThrow(() => speedFiles(bad, { now: NOW }));
    const cleaned = speedMerge(bad, speedNew(), NOW);
    assert.deepEqual([cleaned.h, cleaned.d, cleaned.top, cleaned.start], [{}, {}, [], []]);
});

test('labels no bucket holds any more are let go, and the numbers still mean the same labels', () => {
    // Day 1: two kinds. A week on, only one of them and a new one are still on record.
    const a = speedNew();
    speedAdd(a, 'w', 'old kind', 5, '', NOW);
    speedAdd(a, 'w', 'kept kind', 7, '', NOW);
    let r = speedMerge(null, a, NOW);
    assert.deepEqual(r.n, ['old kind', 'kept kind']);
    const later = NOW + (SPEED_DAYS_KEPT + 1) * DAY;
    const b = speedNew();
    speedAdd(b, 'w', 'kept kind', 9, '', later);
    speedAdd(b, 'w', 'new kind', 11, '', later);
    r = speedMerge(r, b, later);
    assert.deepEqual(r.n, ['kept kind', 'new kind'], 'the old one is gone with its week');
    const t = speedTotals(r).w;
    assert.deepEqual([t['kept kind'], t['new kind'], t['old kind']], [[1, 9, 9], [1, 11, 11], undefined]);
    // And again: nothing shifts under a third tab's counts.
    const c = speedNew();
    speedAdd(c, 'w', 'new kind', 1, '', later + 1000);
    assert.deepEqual(speedTotals(speedMerge(r, c, later + 2000)).w['new kind'], [2, 12, 11]);
});

test('the text: worst first, and nothing that names a player, an item or a price', () => {
    const p = speedNew();
    speedAdd(p, 'w', 'panel redraw', 4, 'bazaar', NOW);
    speedAdd(p, 'w', 'Torn Bids redraw (working out + page)', 120, 'Torn Bids', NOW);
    speedAdd(p, 'f', 'freeze', 180, 'bazaar (hidden tab)', NOW);
    speedStore(p, 'traderDb', false, 3.2, 812345, NOW);
    speedForeign(p, 14, NOW);
    speedStartup(p, 'bazaar', { script: 812, panel: 900, items: 1500 }, NOW);
    speedMachine(p, { 'processor threads': 12 });
    const r = speedMerge(null, p, NOW);
    const text = speedText(r, { sizes: [['feed', 2048], ['traderDb', 812345]], version: '3.17.0', now: NOW });
    const at = (s) => text.indexOf(s);
    // Rows of the table (each starts its line): the one that took the most time is first.
    assert.ok(at('\n  Torn Bids redraw') > 0 && at('\n  Torn Bids redraw') < at('\n  panel redraw'), 'the most time first');
    assert.ok(at('traderDb') > 0 && text.lastIndexOf('traderDb') < text.lastIndexOf('feed'), 'the biggest stored value first');
    assert.match(text, /processor threads: 12/);
    assert.match(text, /bazaar \(hidden tab\) · freeze/);
    assert.match(text, /told 1 times, 14 changes in all/);
    assert.match(text, /No name, id, item, price or key is in this file\./);
    const files = speedFiles(r, { sizes: [['feed', 2048]], version: '3.17.0', now: NOW });
    assert.deepEqual(files.map((f) => f.name), ['speed.txt', 'speed.json']);
    const json = JSON.parse(files[1].text);
    assert.equal(json.kind, 'torn-trading-speed');
    assert.deepEqual(json.sizes, { feed: 2048 });
    assert.deepEqual(json.record.machine, { 'processor threads': 12 });
});

test('it stays small - the browser hands it to the script on every page', () => {
    // 25 kinds of work and 45 stored values, in four kinds of page.
    const week = (hoursADay) => {
        let r = null;
        for (let h = 0; h < 7 * 24; h += 1) {
            if (h % 24 >= hoursADay) continue;
            const p = speedNew();
            const at = NOW + h * HOUR;
            for (let k = 0; k < 25; k += 1) speedAdd(p, 'w', 'scan bazaar · rows changed number ' + k, 5.37 + k, 'bazaar', at);
            for (let k = 0; k < 45; k += 1) speedStore(p, 'storedValueName' + k, k % 2 === 0, 1.53, 1000 * k, at);
            for (const w of ['bazaar', 'trade', 'Torn Bids', 'other Torn page (hidden tab)']) speedAdd(p, 'f', 'freeze', 120, w, at);
            speedForeign(p, 5, at);
            r = speedMerge(r, p, at);
        }
        return r;
    };
    const usual = week(6);
    assert.ok(Object.keys(usual.h).length <= SPEED_HOURS_KEPT);
    assert.ok(Object.keys(usual.d).length <= SPEED_DAYS_KEPT);
    const kb = (r) => JSON.stringify(r).length / 1024;
    assert.ok(kb(usual) < 24, 'six hours a day: ' + kb(usual).toFixed(1) + ' KB');
    assert.ok(kb(week(24)) < 40, 'never closed: ' + kb(week(24)).toFixed(1) + ' KB');
    // Nothing is lost by writing the labels once: the week's totals are all there.
    const t = speedTotals(usual);
    assert.equal(Object.keys(t.w).length, 25);
    assert.equal(Object.keys(t.s).length, 45);
    assert.equal(t.w['scan bazaar · rows changed number 3'][0], 7 * 6);
    // More labels than it can hold are counted together, never dropped.
    const p = speedNew();
    for (let k = 0; k < SPEED_NAMES + 20; k += 1) speedAdd(p, 'w', 'kind ' + k, 1, '', NOW);
    const full = speedMerge(null, p, NOW);
    assert.equal(full.n.length, SPEED_NAMES + 1);
    assert.equal(speedTotals(full).w.other[0], 20);
});

test('the storage probe: every read and write is told to it, and nothing changes what is read', () => {
    const seen = [];
    gmSet('probeTest', { a: 1 });
    gmSetProbe((key, write, ms, size) => seen.push([key, write, ms >= 0, size]));
    try {
        assert.deepEqual(gmGet('probeTest', null), { a: 1 });
        assert.equal(gmGet('probeMissing', 'fallback'), 'fallback');
        gmSet('probeTest', { a: 2 });
        assert.deepEqual(gmGet('probeTest', null), { a: 2 });
    } finally {
        gmSetProbe(null);
    }
    assert.deepEqual(seen, [['probeTest', false, true, 7], ['probeMissing', false, true, 0], ['probeTest', true, true, 7], ['probeTest', false, true, 7]]);
    assert.equal(gmSize('probeTest'), 7);
    assert.equal(gmSize('probeMissing'), 0);
    // Off again: nothing is told.
    gmGet('probeTest', null);
    assert.equal(seen.length, 4);
});

/* ------------------------------------------------------------- his trades */

const rows = () => [
    { id: 'b1:0', t: NOW - 3 * HOUR, itemId: '335', qty: 50, each: 17500, side: 'buy', venue: 'bazaar', who: '2', whoName: null, fee: 0 },
    { id: 'trade:77:out:0', t: NOW - 2 * HOUR, itemId: '335', qty: 30, each: 18000, side: 'sell', venue: 'trade', who: '11', whoName: 'Bob', fee: 0 },
    { id: 'trade:77:out:1', t: NOW - 2 * HOUR, itemId: '1', qty: 3, each: 0, side: 'give', venue: 'trade', who: '11', whoName: 'Bob', fee: 0 },
    { id: 'm1:0', t: NOW - HOUR, itemId: '206', qty: 1, each: 840000, side: 'sell', venue: 'market', who: '99', whoName: null, fee: 0 },
];

test('his trades: a receipt per trade with what it cost and made - and they do name the trader', () => {
    const files = tradesFiles({
        rows: rows(),
        priceRecords: [{ traderId: '11', name: 'Bob', at: NOW - 3 * HOUR, prices: { 335: 18000 } }],
        leftovers: [{ itemId: '335', name: 'Stick of Dynamite', qty: 20, each: 17500, from: 'Bob', at: NOW - HOUR }],
        nameOf: (id) => ({ 335: 'Stick of Dynamite', 1: 'Hammer' })[id] || null,
        now: NOW,
    });
    assert.deepEqual(files.map((f) => f.name), ['README.txt', 'receipts.json', 'receipts.csv', 'accepted-prices.json', 'leftovers.json']);
    const receipts = JSON.parse(files[1].text).receipts;
    assert.equal(receipts.length, 1, 'only trades: the Item Market sale is not one');
    assert.deepEqual([receipts[0].who, receipts[0].whoName, receipts[0].received, receipts[0].cost, receipts[0].profit], ['11', 'Bob', 540000, 525000, 15000]);
    assert.deepEqual(receipts[0].gave.map((g) => [g.name, g.qty, g.given]), [['Stick of Dynamite', 30, false], ['Hammer', 3, true]]);
    const csv = files[2].text.trim().split('\n');
    assert.equal(csv.length, 3);
    assert.match(csv[1], /,77,Bob,11,sold,Stick of Dynamite,335,30,18000,540000,525000,15000$/);
    assert.match(csv[2], /,given,Hammer,1,3,0,0,,$/);
    assert.match(files[0].text, /THESE FILES NAME THE OTHER TRADERS/);
    assert.match(files[0].text, /No API key is in these files\./);
    assert.equal(JSON.parse(files[3].text)[0].name, 'Bob');
    assert.equal(JSON.parse(files[4].text)[0].qty, 20);
    // Nothing read yet: files all the same, saying so.
    const none = tradesFiles({ now: NOW });
    assert.match(none[0].text, /No finished trade has been read yet/);
    assert.deepEqual(JSON.parse(none[1].text).receipts, []);
});

test('both zips carry speed/ and trades/, and say truthfully what is in them', () => {
    const p = speedNew();
    speedAdd(p, 'w', 'panel redraw', 4, 'bazaar', NOW);
    const extra = [
        ...speedFiles(speedMerge(null, p, NOW), { now: NOW }).map((f) => ({ ...f, name: 'speed/' + f.name })),
        ...tradesFiles({ rows: rows(), now: NOW }).map((f) => ({ ...f, name: 'trades/' + f.name })),
    ];
    // Export API usage.
    const usage = usageExportFiles({}, { state: { script: '3.17.0' }, now: NOW, extra });
    const names = usage.map((f) => f.name);
    assert.deepEqual(names.slice(0, 5), ['README.txt', 'api-usage.json', 'by-minute.csv', 'by-hour.csv', 'state.json']);
    for (const n of ['speed/speed.txt', 'speed/speed.json', 'trades/README.txt', 'trades/receipts.json', 'trades/receipts.csv', 'trades/accepted-prices.json', 'trades/leftovers.json']) assert.ok(names.includes(n), n);
    assert.match(usage[0].text, /^speed\/ {10}how long the script's own work took/m);
    assert.match(usage[0].text, /No API key is in these files\. trades\/ names the traders you traded with/);
    assert.doesNotMatch(usage[0].text, /No API key, player id or name is in these files/);
    // Report a problem.
    const report = reportFiles({ happened: 'It lags', log: [], usage: { record: {}, state: { script: '3.17.0' } }, extra, now: NOW });
    const rnames = report.map((f) => f.name);
    assert.ok(rnames.includes('speed/speed.txt') && rnames.includes('trades/receipts.json') && rnames.includes('api-usage/by-minute.csv'));
    assert.equal(rnames.filter((n) => n.startsWith('api-usage/speed') || n.startsWith('api-usage/trades')).length, 0, 'once, at the top of the zip');
    assert.match(report[0].text, /^ {2}speed\/ - how long the script's own work took/m);
    assert.match(report[0].text, /^ {2}trades\/ - your finished trades/m);
    assert.match(report[0].text, /trades\/ names the traders you traded with/);
    // The api-usage folder inside that zip does not claim "no name" for the zip it sits in (review, 3.17.0).
    const inner = report.find((f) => f.name === 'api-usage/README.txt').text;
    assert.match(inner, /No API key, player id or name is in this folder's files\. The trades\/ folder beside it names the traders you traded with\./);
    assert.doesNotMatch(inner, /^speed\//m, 'it lists only what is in its own folder');
    for (const f of report) if (/README\.txt$|report\.txt$/.test(f.name) && !f.name.startsWith('trades/')) assert.doesNotMatch(f.text, /No API key, player id or name is in these files\./, f.name);
    // The zip itself is made of them all.
    const zip = makeZip(report, new Date(NOW));
    assert.equal(new DataView(zip.buffer).getUint16(zip.length - 22 + 10, true), report.length);
    // Without them (an old caller): the zips say what they always said.
    assert.match(usageExportFiles({}, { now: NOW })[0].text, /No API key, player id or name is in these files\./);
    assert.match(reportFiles({ now: NOW })[0].text, /No API key, player id or name is in these files\./);
    // The speed log itself holds no trader's name, even in a zip that has the trades.
    const speedTxt = usage.find((f) => f.name === 'speed/speed.txt').text;
    assert.doesNotMatch(speedTxt, /Bob/);
});
