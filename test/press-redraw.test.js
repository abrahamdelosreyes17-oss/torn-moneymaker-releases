/*
 * 3.33.0: a press drawn on the working out before (core/press-redraw.js). The owner, 2026-10-16: "i click
 * everything they buy, and its SO laggy" - stages 1-4 were nine tenths of every redraw, a press included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESS_KEPT_MS, pressReuse, idsMoved, rowsAgain, rowsOfEntries } from '../src/core/press-redraw.js';

const NOW = 1_800_000_000_000;

test('a press is drawn on the working out before only when nothing but presses asked, the word is the same, and it is young', () => {
    const kept = { word: 'w1', at: NOW - 2000 };
    assert.deepEqual(pressReuse({ kept, now: NOW, asked: false, word: () => 'w1' }), { ok: true, why: null });
    // Data asked for a redraw since: in full.
    assert.deepEqual(pressReuse({ kept, now: NOW, asked: true, word: () => 'w1' }), { ok: false, why: 'data' });
    // The press (or a store) changed what stages 1-4 read: in full.
    assert.deepEqual(pressReuse({ kept, now: NOW, asked: false, word: () => 'w2' }), { ok: false, why: 'changed' });
    // None kept, too old, or a clock gone back: in full.
    assert.deepEqual(pressReuse({ kept: null, now: NOW, asked: false, word: () => 'w1' }), { ok: false, why: 'old' });
    assert.deepEqual(pressReuse({ kept: { word: 'w1', at: NOW - PRESS_KEPT_MS }, now: NOW, asked: false, word: () => 'w1' }), { ok: false, why: 'old' });
    assert.deepEqual(pressReuse({ kept: { word: 'w1', at: NOW + 5 }, now: NOW, asked: false, word: () => 'w1' }), { ok: false, why: 'old' });
    assert.deepEqual(pressReuse({ kept: { word: 'w1', at: NaN }, now: NOW, asked: false, word: () => 'w1' }), { ok: false, why: 'old' });
    assert.equal(pressReuse({ kept, now: NOW, asked: false, word: () => 'w1', maxAge: 1000 }).why, 'old');
    // No word: never drawn on the kept one.
    assert.equal(pressReuse({ kept, now: NOW, asked: false }).ok, false);
});

test('the word is asked for last (it reads the stores) - not at all when the answer is known before', () => {
    let asks = 0;
    const word = () => { asks += 1; return 'w1'; };
    pressReuse({ kept: null, now: NOW, asked: false, word });
    pressReuse({ kept: { word: 'w1', at: NOW }, now: NOW, asked: true, word });
    assert.equal(asks, 0);
    pressReuse({ kept: { word: 'w1', at: NOW }, now: NOW, asked: false, word });
    assert.equal(asks, 1);
});

test('the items a press moved into or out of the trade on show, each once, as strings', () => {
    assert.deepEqual(idsMoved(new Set(['1', '2']), new Set(['2', '3'])), ['1', '3']);
    assert.deepEqual(idsMoved(new Set([1, 2]), new Set(['1', '2'])), []);
    assert.deepEqual(idsMoved(null, ['5', 5]), ['5']);
    assert.deepEqual(idsMoved([], undefined), []);
});

test('the rows of the moved items are worked out again, in their place; the rest are the very rows kept', () => {
    const e = (id, extra = {}) => ({ row: { itemId: id, v: 'old' }, ...extra });
    const entries = [e(1), e(2), e(3)];
    const asked = [];
    const rowFor = (id) => { asked.push(id); return { row: { itemId: id, v: 'new' } }; };
    const out = rowsAgain(entries, ['2'], rowFor);
    assert.notEqual(out, entries);
    assert.deepEqual(out.map((x) => x.row.v), ['old', 'new', 'old']);
    assert.equal(out[0], entries[0]);
    assert.deepEqual(asked, [2], 'handed the id as the list has it');
    assert.equal(entries[1].row.v, 'old', 'the kept array is not changed');
    // Not in the list (searched out): the very array.
    assert.equal(rowsAgain(entries, ['9'], rowFor), entries);
    assert.equal(rowsAgain(entries, [], rowFor), entries);
    // Worked out to nothing: left out.
    assert.deepEqual(rowsAgain(entries, ['1', '3'], () => null).map((x) => x.row.itemId), [2]);
});

test('the list\'s rows, the flips waiting and the flips shown come out in the items\' order', () => {
    const entries = [
        { row: { itemId: 1 }, wait: { itemId: '1' }, flip: null },
        { row: { itemId: 2 }, wait: null, flip: { itemId: '2' } },
        { row: { itemId: 3 }, wait: { itemId: '3' }, flip: { itemId: '3' } },
    ];
    const { rows, waiting, shownFlips } = rowsOfEntries(entries);
    assert.deepEqual(rows.map((r) => r.itemId), [1, 2, 3]);
    assert.deepEqual(waiting.map((w) => w.itemId), ['1', '3']);
    assert.deepEqual(shownFlips.map((f) => f.itemId), ['2', '3']);
    assert.deepEqual(rowsOfEntries(null), { rows: [], waiting: [], shownFlips: [] });
});
