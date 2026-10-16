import test from 'node:test';
import assert from 'node:assert/strict';
import { rowPass, filterRows } from '../src/core/filters.js';

const rows = [
    { itemId: '1', held: 2, category: 'Drug', badge: { kind: 'flip' } },
    { itemId: '2', held: 0, category: 'Drug', badge: { kind: 'sell' } },
    { itemId: '3', held: 1, category: 'Flower', badge: null },
];

test('each tab its rows', () => {
    const sellIds = new Set(['3']);
    const ids = (f) => rows.filter(rowPass(f, sellIds)).map((r) => r.itemId);
    assert.deepEqual(ids('mine'), ['1', '3']);
    assert.deepEqual(ids('flips'), ['1']);
    assert.deepEqual(ids('sell'), ['3']);
    assert.deepEqual(ids('all'), ['1', '2', '3']);
});

test('a category filters the rows and their counts; To sell keeps its own count', () => {
    assert.deepEqual(filterRows(rows, 'Drug', 7).counts, { all: 2, mine: 1, flips: 1, sell: 7 });
    assert.equal(filterRows(rows, '', 0).rows, rows);
});
