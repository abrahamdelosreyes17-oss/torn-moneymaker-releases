/*
 * 3.28.1: the speed log says what the time was spent ON. The friend's zip of
 * 2026-10-11 held a redraw going from 256 ms to 4,096 ms in five hours and
 * nothing that said why: no sizes, no word of what was kept between redraws.
 * And the one line that would have explained it - "Kept buyers differed" -
 * named an item and nothing else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { speedNew, speedAdd, speedGauge, speedMerge, speedExpand, speedTotals, speedText, speedFiles, SPEED_BIDS, SPEED_HOURS_KEPT } from '../src/core/speed.js';
import { makeKeeper, keptDiffWords } from '../src/core/kept.js';
import { makeBuyersKeeper } from '../src/core/kept-buyers.js';

const HOUR = 3600000;
const NOW = Math.floor(1_790_000_000_000 / HOUR) * HOUR + 5 * 60000;
const hourOf = (t) => String(Math.floor(t / HOUR));

test('a size is counted by the hour: how often it was noted, the sum, the most', () => {
    const p = speedNew();
    speedGauge(p, SPEED_BIDS.items, 900, NOW);
    speedGauge(p, SPEED_BIDS.items, 1100, NOW + 1000);
    speedGauge(p, SPEED_BIDS.shown, 0, NOW);
    // Not a size: left out, never an error.
    speedGauge(p, SPEED_BIDS.items, NaN, NOW);
    speedGauge(p, SPEED_BIDS.items, -4, NOW);
    speedGauge(p, SPEED_BIDS.items, null, NOW);
    const r = speedMerge(null, p, NOW + 5000);
    const open = speedExpand(r).h[hourOf(NOW)];
    assert.deepEqual(open.g[SPEED_BIDS.items], [2, 2000, 1100]);
    assert.deepEqual(open.g[SPEED_BIDS.shown], [1, 0, 0], 'nothing shown is a count too');
    // A second tab's counts are added to the first's; the stored record writes each label once.
    const p2 = speedNew();
    speedGauge(p2, SPEED_BIDS.items, 1300, NOW + 2000);
    const both = speedMerge(r, p2, NOW + 6000);
    assert.deepEqual(speedExpand(both).h[hourOf(NOW)].g[SPEED_BIDS.items], [3, 3300, 1300]);
    assert.equal(both.n.filter((n) => n === SPEED_BIDS.items).length, 1);
    assert.deepEqual(speedTotals(both).g[SPEED_BIDS.items], [3, 3300, 1300]);
});

test('sizes are folded into their day with the times, and a record made before them still reads', () => {
    const p = speedNew();
    speedGauge(p, SPEED_BIDS.items, 500, NOW);
    speedAdd(p, 'w', SPEED_BIDS.redraw, 80, 'Torn Bids', NOW);
    let r = speedMerge(null, p, NOW);
    r = speedMerge(r, speedNew(), NOW + (SPEED_HOURS_KEPT + 1) * HOUR);
    assert.deepEqual(r.h, {});
    assert.deepEqual(Object.values(speedExpand(r).d)[0].g[SPEED_BIDS.items], [1, 500, 500]);
    assert.deepEqual(speedTotals(r).g[SPEED_BIDS.items], [1, 500, 500]);
    // What 3.28.0 stored: no sizes anywhere.
    const old = { v: 1, n: ['scan bazaar · timer'], h: { [hourOf(NOW)]: { w: { 0: [2, 42, 30] } } }, d: {}, top: [], start: [], machine: null };
    const p3 = speedNew();
    speedGauge(p3, SPEED_BIDS.items, 7, NOW);
    const merged = speedExpand(speedMerge(old, p3, NOW));
    assert.deepEqual(merged.h[hourOf(NOW)].w['scan bazaar · timer'], [2, 42, 30]);
    assert.deepEqual(merged.h[hourOf(NOW)].g[SPEED_BIDS.items], [1, 7, 7]);
    assert.deepEqual(speedExpand(old).h[hourOf(NOW)].g, {});
});

test('the text lays Torn Bids\' redraw out hour by hour: its time beside what went into it', () => {
    const G = SPEED_BIDS;
    const p = speedNew();
    // A calm hour: everything kept, 250 ms a redraw.
    const calm = NOW;
    // The hour after: the buyers' keeping switched off, the same market, 1,200 ms a redraw.
    const slow = NOW + HOUR;
    for (const [at, ms, on, kept, redone] of [[calm, 250, 1, 990, 10], [slow, 1200, 0, 0, 1000]]) {
        for (let i = 0; i < 4; i += 1) {
            speedAdd(p, 'w', G.redraw, ms, 'Torn Bids', at + i);
            speedAdd(p, 'w', G.stage3, ms * 0.6, 'Torn Bids', at + i);
            speedAdd(p, 'w', G.stage4, ms * 0.3, 'Torn Bids', at + i);
            speedAdd(p, 'w', G.inBuyers, ms * 0.5, 'Torn Bids', at + i);
            speedAdd(p, 'w', G.inShown, ms * 0.2, 'Torn Bids', at + i);
            speedAdd(p, 'w', G.pieces, 30, 'Torn Bids', at + i);
            speedGauge(p, i < 3 ? G.byData : G.byPress, 1, at + i);
            speedGauge(p, G.items, 1000, at + i);
            speedGauge(p, G.buyerRows, 60000, at + i);
            speedGauge(p, G.priceLists, 2900, at + i);
            speedGauge(p, G.lists, 400, at + i);
            speedGauge(p, G.shown, 200, at + i);
            speedGauge(p, G.fresh, 3, at + i);
            speedGauge(p, G.buyersKept, kept, at + i);
            speedGauge(p, G.buyersRedone, redone, at + i);
            speedGauge(p, G.buyersOn, on, at + i);
            speedGauge(p, G.age, 10 + i, at + i);
            speedGauge(p, G.heap, 180.5, at + i);
        }
        speedAdd(p, 'w', G.yard, 1.1, 'Torn Bids', at);
    }
    const text = speedText(speedMerge(null, p, slow + 1000), { now: slow + 1000 });
    assert.match(text, /^SIZES AND COUNTS \(not times\)/m);
    assert.match(text, /^TORN BIDS, HOUR BY HOUR \(UTC\)/m);
    const lines = text.split('\n');
    const stampOf = (t) => new Date(t).toISOString().slice(0, 13).replace('T', ' ') + 'h';
    const rowsOf = (t) => lines.filter((l) => l.trim().startsWith(stampOf(t)));
    // Four tables and the old "by hour" one: each hour is a row in all five.
    assert.equal(rowsOf(calm).length, 5);
    const [calmTime, calmBeside, calmSizes, calmKept] = rowsOf(calm);
    const [slowTime, , slowSizes, slowKept] = rowsOf(slow);
    assert.match(calmTime, /\b4\s+250\b/);
    assert.match(slowTime, /\b4\s+1,200\b/);
    // 3.29.0: what follows "who buys an item" has a column of its own (it was outside every count)...
    assert.match(calmTime, /\b125\s+50\.0\b/, 'in: buyers, then in: shown');
    // ...and so has the work beside the redraw, and who asked for the redraws: 3 by data, 1 by a press.
    assert.match(calmBeside, /h\s+120\s+4\s+-\s+0\s+3\s+1\s+0\s+0\s+0$/);
    // The same market in both hours...
    assert.match(calmSizes, /\b1,000\s+60,000\s+2,900\s+400\b/);
    assert.match(slowSizes, /\b1,000\s+60,000\s+2,900\s+400\b/);
    assert.match(calmSizes, /\b200\b.*\b12\b/, 'flips shown, and the new flips of the hour added up');
    // ...and what changed between them is on the page: the keeping.
    assert.match(calmKept, /99%\s+on\b/);
    assert.match(slowKept, /0%\s+OFF\b/);
    assert.match(calmKept, /\b13\s+181\b/, 'the page\'s age at its most, the memory');
    // A table with no Torn Bids hour says so instead of printing headings over nothing.
    const none = speedText(speedMerge(null, speedNew(), NOW), { now: NOW });
    assert.match(none, /TORN BIDS, HOUR BY HOUR[^\n]*\n[^\n]*\n {2}\(nothing recorded\)/);
    // No name, id, item or price can be in it: every label is one of this file's own words.
    for (const name of Object.values(G)) assert.doesNotMatch(name, /\d{3,}/);
    // And the json carries the sizes, hour by hour, for whoever reads the zip with a program.
    const json = JSON.parse(speedFiles(speedMerge(null, p, slow + 1000), { now: slow + 1000 }).find((f) => f.name === 'speed.json').text);
    assert.deepEqual(json.record.h[hourOf(slow)].g[G.buyersOn], [4, 0, 0]);
});

test('where a kept result and a fresh one part is said: kept -> fresh, the first few places', () => {
    assert.equal(keptDiffWords([{ id: '5', price: 100 }], [{ id: '5', price: 100 }]), '');
    assert.equal(keptDiffWords([{ id: '5', price: 120 }], [{ id: '5', price: 100 }]), '[0].price: 100 -> 120');
    assert.equal(keptDiffWords([{ id: '5', trust: { level: 'Trusted' } }], [{ id: '5', trust: { level: 'Known' } }]), '[0].trust.level: "Known" -> "Trusted"');
    assert.equal(keptDiffWords([{ id: '5' }, { id: '6' }], [{ id: '5' }]), 'the result: 1 rows -> 2; [1]: nothing -> {"id":"6"}');
    assert.equal(keptDiffWords({ units: 3 }, null), 'the result: null -> {"units":3}');
    assert.equal(keptDiffWords([{ id: '5', te: 4 }], [{ id: '5' }]), '[0].te: nothing -> 4');
    // Never a wall of text: the first few places, and a long value cut.
    const many = keptDiffWords(Array.from({ length: 30 }, (_, i) => ({ p: i })), Array.from({ length: 30 }, () => ({ p: -1 })));
    assert.equal(many.split('; ').length, 4);
    assert.ok(keptDiffWords({ a: 'x'.repeat(500) }, { a: 'y' }).length < 120);
});

test('a keeper that switches off says where, and from then on its work is counted as worked out again', () => {
    const said = [];
    const k = makeKeeper({ onDiffer: (key, where) => said.push([key, where]), checkAll: true });
    let n = 0;
    const lies = () => ({ n: (n += 1) });
    k.begin();
    k.get('a', [1], lies);
    k.begin();
    k.get('a', [1], lies);
    assert.deepEqual(said, [['a', 'n: 1 -> 2']]);
    assert.equal(k.on(), false);
    const before = k.stats.redone;
    k.get('a', [1], lies);
    k.get('b', [1], lies);
    assert.equal(k.stats.redone - before, 2, 'off: every ask is work');

    // The buyers' keeper the same: what it is told differs, and it counts while off.
    const told = [];
    let price = 100;
    const b = makeBuyersKeeper({ compute: () => [{ id: '7', name: 'T', price: (price += 1) }], onDiffer: (id, where) => told.push([id, where]) });
    b.begin({});
    b.buyers('206', {});
    // One kept item a redraw is checked: within a few redraws the changed answer is caught.
    for (let i = 0; i < 6 && b.on(); i += 1) {
        b.begin({});
        b.buyers('206', {});
    }
    assert.equal(b.on(), false);
    assert.equal(told.length, 1);
    assert.equal(told[0][0], '206');
    assert.match(told[0][1], /^\[0\]\.price: \d+ -> \d+$/);
    const was = b.stats.redone;
    b.buyers('206', {});
    assert.equal(b.stats.redone - was, 1);
});
