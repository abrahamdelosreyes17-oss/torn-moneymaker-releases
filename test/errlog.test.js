import test from 'node:test';
import assert from 'node:assert/strict';

import { addLogEntries, logText, logAsText, LOG_KEEP_MS } from '../src/core/errlog.js';
import { reportFiles } from '../src/ui/report-view.js';
import { makeZip } from '../src/core/zip.js';

const NOW = Date.UTC(2026, 8, 29, 14, 0, 0);

test('problem log: a week of lines from every tab, repeats counted, never a key (3.15)', () => {
    let log = addLogEntries(null, [
        { at: NOW - 1000, kind: 'action', where: 'Torn Bids', what: 'Picked item 206 (Xanax)' },
        { at: NOW - 900, kind: 'error', where: 'Torn Bids', what: 'TornExchange failed: An item\'s full list', detail: 'no answer in 30 s' },
        { at: NOW - 800, kind: 'error', where: 'Torn Bids', what: 'TornExchange failed: An item\'s full list', detail: 'no answer in 30 s' },
    ], NOW);
    assert.equal(log.length, 2);
    assert.equal(log[1].times, 2, 'the same failure twice within a minute: one line, x2');
    log = addLogEntries(log, [{ at: NOW - LOG_KEEP_MS - 1, kind: 'note', where: 'x', what: 'old' }], NOW);
    assert.equal(log.length, 2, 'older than a week: dropped');
    assert.equal(logText('https://api.torn.com/user?key=abcdEFGH12345678&x=1'), 'https://api.torn.com/user?key=****&x=1');
    assert.equal(logText('key ABCDEFGH12345678 here'), 'key **** here');
    assert.match(logAsText(log), /ERROR \[Torn Bids\] TornExchange failed: An item's full list - no answer in 30 s \(x2/);
});

test('Report a problem: one zip - your words, screenshots, the log, API use, state (3.15)', () => {
    const shot = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const files = reportFiles({
        happened: 'Buyers went empty',
        expected: 'Traders for Xanax',
        shots: [{ name: 'my shot.png', data: shot }],
        log: [{ at: NOW, kind: 'error', where: 'Torn Bids', what: 'TornW3B failed' }],
        usage: { record: {}, state: { script: '3.15.0' } },
        env: { userAgent: 'Chrome' },
        now: NOW,
    });
    const names = files.map((f) => f.name);
    assert.deepEqual(names.slice(0, 5), ['report.txt', 'problem-log.txt', 'problem-log.json', 'state.json', 'screenshots/1-my_shot.png']);
    assert.ok(names.includes('api-usage/by-minute.csv'));
    const report = files[0].text;
    assert.match(report, /WHAT HAPPENED\nBuyers went empty/);
    assert.match(report, /1 errors and 0 other lines/);
    assert.equal(files[4].data, shot, 'the screenshot as it is');
    const zip = makeZip(files, new Date(NOW));
    assert.equal(new DataView(zip.buffer).getUint16(zip.length - 22 + 10, true), files.length);
});
