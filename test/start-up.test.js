/*
 * 3.19.0: Torn Bids on a slow laptop (core/start-up.js) - redraws on a budget,
 * the first working-out in pieces, and the reads remembered across reloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { redrawWait, warmSlice, packBazaarReads, unpackBazaarReads, REDRAW_BUDGET_TIMES, REDRAW_WAIT_MAX_MS, WARM_SLICE_MS, KEPT_READS_MAX_AGE_MS } from '../src/core/start-up.js';
import { nextW3bRead } from '../src/core/desk.js';
import { bazaarSellers, FLIP_FRESH_MS } from '../src/core/flips.js';
import { normalizeW3bListings } from '../src/core/feed.js';

const BASE = 120;

test('the redraw budget: where a redraw is quick, the wait is what it always was', () => {
    // No redraw yet: the first one, as before.
    assert.equal(redrawWait({ base: BASE, took: 0, ended: 0, now: 5000 }), BASE);
    // A quick machine (30 ms a redraw): three times that is under the old wait - no change at all.
    for (const since of [0, 1, 50, 119, 120, 5000]) assert.equal(redrawWait({ base: BASE, took: 30, ended: 1000, now: 1000 + since }), BASE, 'since ' + since);
    assert.equal(redrawWait({ base: BASE, took: BASE / REDRAW_BUDGET_TIMES, ended: 1000, now: 1000 }), BASE, 'up to 40 ms a redraw: exactly as before');
});

test('the redraw budget: a slow redraw is followed by a rest a few times as long, counted from its end', () => {
    // The friend's laptop: 788 ms a redraw. The next one starts no sooner than 3 x 788 ms after it ended.
    const took = 788;
    const rest = REDRAW_BUDGET_TIMES * took;
    assert.equal(redrawWait({ base: BASE, took, ended: 10000, now: 10000 }), rest);
    assert.equal(redrawWait({ base: BASE, took, ended: 10000, now: 10000 + 1000 }), rest - 1000, 'an answer a second later: only what is left of the rest');
    assert.equal(redrawWait({ base: BASE, took, ended: 10000, now: 10000 + rest - 50 }), BASE, 'near its end: the old wait, never less');
    assert.equal(redrawWait({ base: BASE, took, ended: 10000, now: 10000 + 60000 }), BASE, 'a quiet page: an answer is drawn as fast as ever');
    // Never longer than the most, however slow: the numbers still move.
    assert.equal(redrawWait({ base: BASE, took: 2755, ended: 10000, now: 10000 }), REDRAW_WAIT_MAX_MS);
    assert.equal(redrawWait({ base: BASE, took: 1e9, ended: 10000, now: 10000 }), REDRAW_WAIT_MAX_MS);
    // A clock that went back, or rubbish: the rest at most, the old wait at least - never stuck.
    assert.equal(redrawWait({ base: BASE, took, ended: 10000, now: 2000 }), rest);
    assert.equal(redrawWait({ base: BASE, took: NaN, ended: 10000, now: 10000 }), BASE);
    assert.equal(redrawWait({ base: BASE, took: -5, ended: 10000, now: 10000 }), BASE);
    assert.equal(redrawWait({ base: BASE, took: Infinity, ended: 10000, now: 10000 }), BASE);
    assert.equal(redrawWait(), 0);
});

/*
 * A model of a session's first minutes on the friend's laptop: an answer a
 * second asks for a redraw, a redraw takes 788 ms. How much of the time is
 * the page stuck - as it was (each redraw 120 ms after the first answer
 * waiting), and on the budget.
 */
function busyShare({ budget, took, everyMs = 1000, forMs = 5 * 60000 }) {
    let busy = 0;
    let redraws = 0;
    let ended = 0;
    let lastTook = 0;
    let timerAt = null;
    let longestGap = 0;
    let t = 0;
    for (let ask = 0; ask < forMs; ask += everyMs) {
        // The redraw on its way runs before this answer, if it is due.
        while (timerAt !== null && timerAt <= ask) {
            t = Math.max(timerAt, t);
            longestGap = Math.max(longestGap, t - ended);
            t += took;
            busy += took;
            redraws += 1;
            ended = t;
            lastTook = took;
            timerAt = null;
        }
        // The answer lands when the page is free.
        const at = Math.max(ask, t);
        if (timerAt === null) timerAt = at + (budget ? redrawWait({ base: BASE, took: lastTook, ended, now: at }) : BASE);
    }
    return { share: busy / forMs, redraws, longestGap };
}

test('an answer a second at 788 ms a redraw: stuck most of the time before, a quarter of it on the budget', () => {
    const before = busyShare({ budget: false, took: 788 });
    const after = busyShare({ budget: true, took: 788 });
    assert.ok(before.share > 0.7, 'as it was: ' + JSON.stringify(before));
    assert.ok(after.share <= 1 / (REDRAW_BUDGET_TIMES + 1) + 0.01, 'on the budget: ' + JSON.stringify(after));
    assert.ok(after.longestGap <= REDRAW_WAIT_MAX_MS + 1000 + BASE, 'and what arrives is still drawn within seconds: ' + after.longestGap);
    // A quick machine: the same redraws, at the same moments, as before.
    assert.deepEqual(busyShare({ budget: true, took: 30 }), busyShare({ budget: false, took: 30 }));
});

test('the working-out in pieces: each piece stops when its time is up, every item is done once, in order', () => {
    const ids = Array.from({ length: 100 }, (_, i) => 'i' + i);
    let now = 0;
    const done = [];
    const work = (id) => {
        done.push(id);
        now += 7;
    };
    const pieces = [];
    let at = 0;
    while (at < ids.length) {
        const from = at;
        at = warmSlice(ids, at, work, { clock: () => now });
        pieces.push(at - from);
        now += 4;
    }
    assert.deepEqual(done, ids);
    // 7 ms an item, WARM_SLICE_MS a piece: five items (35 ms) each.
    assert.ok(pieces.every((n) => n === Math.ceil(WARM_SLICE_MS / 7)), JSON.stringify(pieces));
    // Nothing to work out (every item kept: no time passes): one piece is all of them.
    assert.equal(warmSlice(ids, 0, () => {}, { clock: () => 0 }), ids.length);
    // An item slower than a whole piece still gets done: one a piece, never none.
    now = 0;
    assert.equal(warmSlice(ids, 10, () => { now += 500; }, { clock: () => now }), 11);
    // What led up to the piece (making the lookup) counts towards its time.
    now = 100;
    assert.equal(warmSlice(ids, 0, () => { now += 7; }, { clock: () => now, since: 100 - 28 }), 1);
    // Past the end, or nothing: nothing done.
    assert.equal(warmSlice(ids, ids.length, () => assert.fail('nothing is left'), { clock: () => 0 }), ids.length);
    assert.equal(warmSlice([], 0, () => assert.fail('nothing to do'), { clock: () => 0 }), 0);
});

test('which read goes next is as it was: flips and price lists take turns', () => {
    const due = () => true;
    const candidates = ['c1', 'c2', 'c3'];
    assert.deepEqual(nextW3bRead({ candidates, list: 'L1', turn: 0, due }), { kind: 'list', id: 'L1' });
    assert.deepEqual(nextW3bRead({ candidates, list: 'L1', turn: 1, due }), { kind: 'bazaars', id: 'c1' });
    // "Flips first at start-up" was built and taken out (the owner, 2026-10-03): asking for it changes nothing.
    assert.deepEqual(nextW3bRead({ candidates, list: 'L1', turn: 0, startUp: true, due }), { kind: 'list', id: 'L1' });
});

test('the reads remembered: back as they were, none too old, none broken - and no listing trusted longer than before', () => {
    const now = 50_000_000_000;
    const row = (sellerId, price, qty, checkedAgo) => ({ sellerId: String(sellerId), sellerName: 'S' + sellerId, price, qty, dataAt: now - checkedAgo, changedAt: now - checkedAgo, sponsored: false });
    const reads = new Map([
        ['206', { at: now - 60000, triedAt: now - 60000, rows: [row(1, 840000, 2, 90000), row(2, 845000, 5, 40 * 60000)], error: null, loading: false, sweep: false }],
        ['180', { at: now - 30 * 60000, triedAt: now - 30 * 60000, rows: [row(3, 40, 100, 31 * 60000)], error: null, loading: false, sweep: true }],
        ['old', { at: now - KEPT_READS_MAX_AGE_MS - 1, rows: [row(4, 5, 5, 0)], error: null, loading: false }],
        ['loading', { at: 0, rows: [], error: null, loading: true, triedAt: now }],
    ]);
    const stored = JSON.parse(JSON.stringify(packBazaarReads(reads, now)));
    assert.deepEqual(Object.keys(stored.items).sort(), ['180', '206'], 'a read under way, and one over an hour old, are not kept');
    // The page opens two minutes later.
    const later = now + 2 * 60000;
    const back = unpackBazaarReads(stored, later);
    // Marked as kept: shown at once, and read again in its turn, as on a page just opened (bazaarsDue in main.js).
    assert.deepEqual(back.get('206'), { at: now - 60000, triedAt: now - 60000, rows: reads.get('206').rows, error: null, loading: false, sweep: false, kept: true });
    assert.equal(back.get('180').sweep, true);
    // A kept listing is as fresh, or as stale, as TornW3B's own check of it says: the same rule as on an open page.
    const sellers = bazaarSellers(back.get('206').rows, { now: later, freshMs: FLIP_FRESH_MS });
    assert.deepEqual(sellers.map((s) => [s.sellerId, s.stale]), [['1', false], ['2', true]]);
    // An hour on: nothing is brought back.
    assert.equal(unpackBazaarReads(stored, now + KEPT_READS_MAX_AGE_MS + 1).size, 0);
    // Rubbish, another version, a clock set back, a broken row: not believed.
    assert.equal(unpackBazaarReads(null, later).size, 0);
    assert.equal(unpackBazaarReads({ v: 2, items: stored.items }, later).size, 0);
    assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later + 10 * 60000, rows: [] } } }, later).size, 0);
    assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later - 1000, rows: [{ sellerId: '1', price: 0, qty: 1 }] } } }, later).size, 0);
    assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later - 1000, rows: [['1', 'S1', 0, 1, later, later, false]] } } }, later).size, 0, 'a price of 0');
    assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later - 1000, rows: [['1', 'S1', 5, 1, later, later, false], ['2', 'S2', 5]] } } }, later).size, 0, 'a row cut short');
    assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later - 1000, rows: [['1', 'S1', 5, 1, later, later, false]] } } }, later).size, 1);
    // Values of another type are not believed either (a price "5000" would be joined, not added).
    for (const bad of [['1', 'S1', '5000', 1, later, later, false], ['1', 'S1', 5, 1.5, later, later, false], ['1', 'S1', 5, '2', later, later, false], [1, 'S1', 5, 1, later, later, false], ['1', 7, 5, 1, later, later, false], ['1', 'S1', 5, 1, 'x', later, false], ['1', 'S1', 5, 1, later, later, 1], ['1', 'S1', 1, 1, later, later, false]]) {
        assert.equal(unpackBazaarReads({ v: 1, items: { 5: { at: later - 1000, rows: [bad] } } }, later).size, 0, JSON.stringify(bad));
    }
});

test('the reads remembered: a listing comes back exactly as TornW3B\'s answer was read - every field, whatever it holds', () => {
    const now = 50_000_000_000;
    // As normalizeW3bListings makes them: a sponsored one, one with no name, one TornW3B never dated.
    const rows = normalizeW3bListings([
        { player_id: 42, player_name: 'Sponsored', price: 95, quantity: 1, last_checked: now / 1000 - 20, content_updated: now / 1000 - 500, sponsored: 1 },
        { player_id: 777, price: 50, quantity: 4, last_checked: now / 1000 - 30 },
        { player_id: 9, player_name: 'Undated', price: 70, quantity: 2 },
    ]);
    assert.equal(rows.length, 3);
    const back = unpackBazaarReads(JSON.parse(JSON.stringify(packBazaarReads(new Map([['1', { at: now, rows, sweep: false }]]), now))), now);
    // (Should a listing ever get another field, this fails until it is kept too.)
    assert.deepEqual(back.get('1').rows, rows);
    // And what is written is small: a page with 150 possible flips read whole stays well inside a page's storage.
    const many = new Map(Array.from({ length: 190 }, (_, k) => [String(k), { at: now, sweep: false, rows: Array.from({ length: 100 }, (_, i) => ({ sellerId: String(2000000 + i), sellerName: 'Seller_Name' + i, price: 840000 + i, qty: 1 + i, dataAt: now - i * 1000, changedAt: now - i * 3000, sponsored: false })) }]));
    const text = JSON.stringify(packBazaarReads(many, now));
    assert.ok(text.length < 1.6e6, 'kept as text: ' + text.length);
});
