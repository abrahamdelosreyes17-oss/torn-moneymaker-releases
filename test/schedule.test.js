import test from 'node:test';
import assert from 'node:assert/strict';
import { readWants, sweepOrder, applyWants, openOrder, deskPayers, OPEN_DESK_FIRST } from '../src/core/schedule.js';

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

test('whose list pages are read first (3.34.0): the trade on show, the pinned, the top payers of the item in view, then the flip traders', () => {
    const flips = ['f1', 'f2', 'f3', 'f4'];
    const desk = new Set(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']);
    assert.equal(OPEN_DESK_FIRST, 5);
    const all = openOrder({ shown: 'd3', pinned: ['p1'], desk, flips, scan: ['s1', 'f2'], max: 25 });
    // d3 once (shown), the pinned, the five best payers (d3 already in), the flips, the other payers, Your traders'.
    assert.deepEqual(all, ['d3', 'p1', 'd1', 'd2', 'd4', 'd5', 'f1', 'f2', 'f3', 'f4', 'd6', 'd7', 's1']);
    // With the budget cut short it is the flips' tail and the rest that go, never the item in view.
    const cut = openOrder({ shown: null, pinned: [], desk, flips: Array.from({ length: 30 }, (_, i) => 'f' + i), max: 25 });
    assert.deepEqual(cut.slice(0, 5), ['d1', 'd2', 'd3', 'd4', 'd5']);
    assert.equal(cut.length, 25);
    assert.equal(cut[5], 'f0');
    assert.equal(cut.includes('d6'), false);
    // No item in view, nothing pinned: the flips as before. Empty and numeric ids are handled.
    assert.deepEqual(openOrder({ flips: [7, null, '8', 7], max: 25 }), ['7', '8']);
    assert.deepEqual(openOrder({ max: 25 }), []);
});

test('3.34.0: the item in view\'s payers include the ones Fresh prices hides, best price first - even when they are all it has', () => {
    const shown = [{ id: 1, price: 900, w3b: 900 }, { id: 2, price: 800, w3b: 0, te: 800 }];
    const stale = [{ id: 3, price: 943, w3b: 943 }, { id: 1, price: 900, w3b: 900 }];
    assert.deepEqual(deskPayers(shown, stale, 12), ['3', '1']);
    assert.deepEqual(deskPayers([], [{ id: 7, price: 943, w3b: 943 }], 12), ['7']);
    assert.deepEqual(deskPayers(stale, [], 1), ['3']);
});

test('the pressed trader is read before everything (3.35.0), the old lists after the top payers and before the flips', () => {
    const all = openOrder({ shown: 'd3', pressed: 'x9', pinned: ['p1'], desk: ['d1', 'd2', 'd3'], old: ['o1', 'o2'], flips: ['f1'], max: 25 });
    assert.deepEqual(all, ['x9', 'd3', 'p1', 'd1', 'd2', 'o1', 'o2', 'f1']);
    assert.deepEqual(openOrder({ pressed: 'x9', shown: 'x9', max: 25 }), ['x9']);
});
