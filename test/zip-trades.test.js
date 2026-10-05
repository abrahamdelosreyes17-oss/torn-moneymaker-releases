/*
 * 3.23.0, item 4: the next zip answers "why did this buy not go in the trade"
 * itself. The accepted trades ride in trades/ in full (lines, bazaars,
 * unplanned buys, units), the last few that ended too, and the lines "a
 * listing is no longer in this bazaar" fold into one per bazaar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as ex from '../src/core/trades-export.js';
import * as log from '../src/core/errlog.js';

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const MIN = 60000;
const DAY = 24 * 60 * MIN;

const trade = (over = {}) => ({
    key: 'id:5001',
    trader: { id: '5001', name: 'FAFFO' },
    itemId: '870',
    at: NOW - 30 * MIN,
    items: [
        { line: 'flip:870', itemId: '870', name: 'Bottle of Champagne', units: 6, bid: 3100, kind: 'flip', sent: false, steps: [
            { sellerId: '1', sellerName: 'Havean', qty: 4, price: 2899, bought: true, boughtQty: 4, boughtAt: NOW - 20 * MIN },
            { sellerId: '2', sellerName: 'Baecon', qty: 2, price: 2950, bought: false },
        ] },
        { line: 'yours:206', itemId: '206', name: 'Xanax', units: 3, bid: 850000, kind: 'yours', sent: false, steps: [] },
    ],
    extra: [{ itemId: '870', name: 'Bottle of Champagne', qty: 1175, price: 2899, bid: 3100, sellerId: '9', seller: 'Other', at: NOW - 10 * MIN }],
    ...over,
});

test('the zip: every accepted trade in full - its lines, the bazaars, the unplanned buys and its units', () => {
    const files = ex.tradesFiles({ accepted: [trade()], now: NOW });
    const f = files.find((x) => x.name === 'accepted-trades.json');
    assert.ok(f, 'accepted-trades.json is in trades/');
    const got = JSON.parse(f.text);
    assert.equal(got.open.length, 1);
    const t = got.open[0];
    assert.deepEqual([t.trader.name, t.trader.id, t.state, t.acceptedAt], ['FAFFO', '5001', 'open', new Date(NOW - 30 * MIN).toISOString()]);
    assert.deepEqual(t.lines.map((l) => [l.name, l.kind, l.units, l.bid, l.steps.length]), [['Bottle of Champagne', 'flip', 6, 3100, 2], ['Xanax', 'yours', 3, 850000, 0]]);
    assert.deepEqual(t.lines[0].steps[0], { sellerId: '1', seller: 'Havean', qty: 4, price: 2899, bought: 4, boughtAt: new Date(NOW - 20 * MIN).toISOString(), skipped: false });
    assert.deepEqual(t.lines[0].steps[1], { sellerId: '2', seller: 'Baecon', qty: 2, price: 2950, bought: 0, boughtAt: null, skipped: false });
    assert.deepEqual(t.unplanned, [{ itemId: '870', name: 'Bottle of Champagne', qty: 1175, price: 2899, bid: 3100, sellerId: '9', seller: 'Other', at: new Date(NOW - 10 * MIN).toISOString() }]);
    // Units: 4 bought as planned, 1,175 not planned, 3 of your own; 2 planned and not bought yet.
    assert.deepEqual([t.units, t.max, t.over, t.toBuy], [4 + 1175 + 3, 10000, 0, 2]);
    assert.match(files[0].text, /accepted-trades\.json/);
    // None accepted: the file is there, empty.
    const none = JSON.parse(ex.tradesFiles({ now: NOW }).find((x) => x.name === 'accepted-trades.json').text);
    assert.deepEqual([none.open, none.ended], [[], []]);
    // A trade that cannot be read does not lose the others.
    const mixed = JSON.parse(ex.tradesFiles({ accepted: [null, { key: 'x' }, trade()], now: NOW }).find((x) => x.name === 'accepted-trades.json').text);
    assert.equal(mixed.open.filter((x) => x.trader && x.trader.name === 'FAFFO').length, 1);
});

test('the zip: the last trades that ended, as they were - three, a week, each once', () => {
    let kept = ex.keepEndedTrades(null, trade(), 'traded', NOW);
    assert.equal(kept.length, 1);
    assert.deepEqual([kept[0].how, kept[0].endedAt, kept[0].trade.key], ['traded', NOW, 'id:5001']);
    // The same trade seen to end again by another tab: once.
    kept = ex.keepEndedTrades(kept, trade(), 'traded', NOW + 1000);
    assert.equal(kept.length, 1);
    for (let i = 1; i <= 4; i++) kept = ex.keepEndedTrades(kept, trade({ key: 'id:' + i, at: NOW + i * MIN }), 'cancel', NOW + i * MIN);
    assert.deepEqual(kept.map((k) => k.trade.key), ['id:4', 'id:3', 'id:2'], 'the newest three');
    assert.deepEqual(ex.keepEndedTrades(kept, null, 'traded', NOW + 8 * DAY), [], 'a week, then gone');
    assert.deepEqual(ex.keepEndedTrades('junk', null, 'traded', NOW), []);
    const files = ex.tradesFiles({ ended: kept, now: NOW + 5 * MIN });
    const got = JSON.parse(files.find((x) => x.name === 'accepted-trades.json').text);
    assert.deepEqual(got.ended.map((t) => [t.state, t.endedAt]), [4, 3, 2].map((i) => ['cancel', new Date(NOW + i * MIN).toISOString()]));
    assert.equal(got.ended[0].lines.length, 2);
});

test('the log: the listings a bazaar no longer has are one line a bazaar, not one each', () => {
    const gone = (itemId, qty, fold, at) => ({ at, kind: 'note', where: 'torn bazaar', what: log.goneLine([[itemId, qty]]), fold, gone: [[String(itemId), qty]] });
    // One: said as before.
    assert.equal(log.goneLine([[206, 5]]), 'A listing is no longer in this bazaar (item 206, 5 when last seen) - left out of the plans in Torn Bids');
    let stored = log.addLogEntries(null, [gone(206, 5, 'gone:a:1', NOW)], NOW);
    assert.equal(stored.length, 1);
    // More from the same bazaar, with other lines between: still one line, at its first time.
    stored = log.addLogEntries(stored, [
        { at: NOW + 1000, kind: 'note', where: 'torn bazaar', what: 'Stock of a listing dropped on the page (item 9): 1 fewer, 2 left' },
        gone(3004, 3, 'gone:a:1', NOW + 2000),
        gone(3005, 1, 'gone:a:1', NOW + 3 * MIN),
    ], NOW + 3 * MIN);
    assert.equal(stored.length, 2);
    assert.equal(stored[0].what, '3 listings are no longer in this bazaar (when last seen: item 206 ×5, 3004 ×3, 3005 ×1) - left out of the plans in Torn Bids');
    assert.deepEqual([stored[0].at, stored[0].lastAt], [NOW, NOW + 3 * MIN]);
    // The same item said twice counts once (its newest count).
    stored = log.addLogEntries(stored, [gone(206, 4, 'gone:a:1', NOW + 4 * MIN)], NOW + 4 * MIN);
    assert.match(stored[0].what, /^3 listings .*item 206 ×4, 3004 ×3, 3005 ×1\)/);
    // Another bazaar: its own line.
    stored = log.addLogEntries(stored, [gone(11, 2, 'gone:a:2', NOW + 5 * MIN)], NOW + 5 * MIN);
    assert.equal(stored.length, 3);
    // Very many: the line stays a line.
    const many = Array.from({ length: 60 }, (_, i) => gone(4000 + i, 1, 'gone:b:1', NOW + 6 * MIN + i));
    stored = log.addLogEntries(stored, many, NOW + 7 * MIN);
    const big = stored.find((e) => e.fold === 'gone:b:1');
    assert.match(big.what, /^60 listings are no longer in this bazaar \(when last seen: item 4000 ×1, .* and 40 more\) - left out of the plans in Torn Bids$/);
    assert.ok(big.what.length <= 300, 'within a log line: ' + big.what.length);
    assert.equal(stored.filter((e) => e.fold === 'gone:b:1').length, 1);
    // As text for the report: one line.
    assert.equal(log.logAsText(stored).trim().split('\n').length, stored.length);
});
