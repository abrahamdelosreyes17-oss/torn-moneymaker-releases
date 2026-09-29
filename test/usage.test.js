import test from 'node:test';
import assert from 'node:assert/strict';

import { usageAdd, usageMerge, usageSeries, usageLabel, USAGE_MINUTES_KEPT } from '../src/core/usage.js';

const NOW = Date.UTC(2026, 8, 29, 12, 30, 20);

test('usage: requests counted per minute by tag, added to what other tabs stored', () => {
    const mine = {};
    usageAdd(mine, 't.status', NOW);
    usageAdd(mine, 't.status', NOW);
    usageAdd(mine, 't.fill', NOW - 60000);
    usageAdd(mine, 'mystery', NOW);
    const other = usageMerge(null, usageAdd({}, 't.status', NOW), NOW);
    const all = usageMerge(other, mine, NOW);
    const m = Math.floor(NOW / 60000);
    assert.deepEqual(all.m[m], { 't.status': 3, 't.other': 1 });
    assert.deepEqual(all.m[m - 1], { 't.fill': 1 });
    assert.equal(usageLabel('w.nope'), 'w.other');
});

test('usage: a day of minutes, then hours for a week; the chart splits one service by tag', () => {
    let s = usageMerge(null, usageAdd({}, 'w.flips', NOW - (USAGE_MINUTES_KEPT + 5) * 60000), NOW);
    assert.equal(Object.keys(s.m).length, 0, 'folded into its hour');
    assert.equal(Object.keys(s.h).length, 1);
    s = usageMerge(s, usageAdd(usageAdd(usageAdd({}, 'w.flips', NOW), 'w.lists', NOW), 't.feed', NOW), NOW);
    const hour = usageSeries(s, { service: 'w', range: '1h', now: NOW });
    assert.equal(hour.bars.length, 60);
    assert.equal(hour.total, 2, 'TornW3B only, this hour');
    assert.deepEqual(hour.bars[59].counts, { 'w.flips': 1, 'w.lists': 1 });
    const week = usageSeries(s, { service: 'w', range: '7d', now: NOW });
    assert.equal(week.total, 3, 'the folded hour counts in the week');
    assert.equal(week.labels[0].id, 'w.flips');
    assert.equal(week.labels[0].total, 2);
    assert.equal(usageSeries(s, { service: 't', range: '24h', now: NOW }).labels[0].name, 'Item Market feed (overlay)');
    // A week later, all gone.
    assert.equal(Object.keys(usageMerge(s, {}, NOW + 8 * 86400000).h).length, 0);
});

import { usageExportFiles } from '../src/ui/usage-view.js';
import { makeZip, crc32 } from '../src/core/zip.js';

test('Export API usage: one zip - the record, CSVs, state and a readme; no key, id or name (3.15)', () => {
    const record = usageMerge(null, usageAdd(usageAdd({}, 't.status', NOW), 'w.flips', NOW), NOW);
    const files = usageExportFiles(record, { state: { script: '3.15.0', keys: { torn: true } }, now: NOW });
    assert.deepEqual(files.map((f) => f.name), ['README.txt', 'api-usage.json', 'by-minute.csv', 'by-hour.csv', 'state.json']);
    const csv = files.find((f) => f.name === 'by-minute.csv').text.trim().split(/\n/);
    assert.equal(csv[0], 'time,service,what for,tag,requests');
    assert.deepEqual(csv.slice(1).map((r) => r.split(',').slice(1).join(',')).sort(), ['Torn API,Trader statuses,t.status,1', 'TornW3B,Possible flips,w.flips,1']);
    assert.equal(JSON.parse(files[1].text).record.m[Math.floor(NOW / 60000)]['t.status'], 1);
    assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
    const zip = makeZip(files, new Date(NOW));
    const dv = new DataView(zip.buffer);
    assert.equal(dv.getUint32(0, true), 0x04034b50, 'a zip');
    assert.equal(dv.getUint16(zip.length - 22 + 10, true), 5, 'five files');
});
