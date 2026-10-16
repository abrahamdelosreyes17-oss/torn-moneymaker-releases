import test from 'node:test';
import assert from 'node:assert/strict';
import { readWants, sweepOrder, applyWants } from '../src/core/schedule.js';

test('the sweep: every item with a buyer, the one read longest ago first, flips and near-misses on their own turn', () => {
    const at = { a: 30, b: 10, c: 20, d: 0 };
    assert.deepEqual(sweepOrder(['a', 'b', 'c', 'd'], new Set(['d']), (id) => at[id]), ['b', 'c', 'a']);
});

test('the checks: the flips first, the biggest first, then To sell - To sell first while it is the tab in view', () => {
    const waiting = [{ itemId: '1', profit: 5, traderId: '11' }, { itemId: '2', profit: 50, traderId: '12' }];
    const shown = [{ itemId: '3', profit: 20, traderId: '13' }];
    const toSell = [
        { itemId: '9', best: { id: 19 }, unchecked: true },
        { itemId: '8', best: { id: 'x' }, unchecked: true, check: 'closed' },
        { itemId: '7', kept: true, best: { id: 17 } },
        { itemId: '6', best: null },
    ];
    const w = readWants(waiting, shown, toSell, { filter: 'all', openMax: 3 });
    assert.deepEqual(w.flipCheckIds, ['2', '1', '3', '9', '8']);
    assert.deepEqual(w.toSellIds, ['9', '8', '6']);
    assert.deepEqual([...w.flipTraders].sort(), ['11', '12', '13', '19', 'x']);
    // Torn ids only, the biggest flip's trader first, at most openMax.
    assert.deepEqual(w.openWant, ['12', '13', '11']);
    assert.deepEqual(readWants(waiting, shown, toSell, { filter: 'sell', openMax: 9 }).flipCheckIds, ['9', '2', '1', '3', '8']);
});

test('handed over in one place, the check set beside its list', () => {
    const store = {};
    applyWants(store, { flipCheckIds: ['1', '2'], nearIds: ['3'] });
    assert.deepEqual(store.nearIds, ['3']);
    assert.deepEqual([...store.flipCheck], ['1', '2']);
});
