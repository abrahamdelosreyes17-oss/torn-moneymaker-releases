import test from 'node:test';
import assert from 'node:assert/strict';
import { listOrder, byColumn, planCells } from '../src/core/view-model.js';

const row = (itemId, o) => ({ itemId, name: 'I' + itemId, held: 0, value: 0, bid: 0, lowest: null, badge: null, ...o });

test('the list\'s own order: money first, then what you hold, then the best price, then the name', () => {
    const rows = [row('1', { bid: 5 }), row('2', { held: 1 }), row('3', { value: 9 }), row('4', { bid: 5, name: 'A' })];
    assert.deepEqual(listOrder(rows, () => true, 'all').map((r) => r.itemId), ['3', '2', '4', '1']);
    assert.deepEqual(listOrder(rows, (r) => r.held > 0, 'mine').map((r) => r.itemId), ['2']);
    // Best flips: one trader's flips stand together, under their total.
    const flip = (id, value, to) => row(id, { value, badge: { kind: 'flip' }, plan: { units: 1, buyer: { id: to, name: 'T' + to } } });
    assert.deepEqual(listOrder([flip('1', 9, 7), flip('2', 8, 6), flip('3', 1, 7)], () => true, 'flips').map((r) => r.itemId), ['1', '3', '2']);
});

test('a header pressed: by its column, the traders worked out only for a column about them', () => {
    const rows = [row('1', { held: 1 }), row('2', { held: 5 })];
    let asked = 0;
    const o = { tradersShown: () => (asked++, [null, null]), marketOf: () => null };
    assert.deepEqual(byColumn(rows, { key: 'held', dir: -1 }, o).map((r) => r.itemId), ['2', '1']);
    assert.equal(asked, 0);
    assert.equal(byColumn(rows, null, o), rows);
    assert.equal(byColumn(rows, { key: 'nonsense' }, o), rows);
});

test('a flip row\'s cells', () => {
    const plan = { units: 3, firstPrice: 90, buyer: { price: 120 }, pace: 4, steps: [{ sellerId: 1 }, { sellerId: 1 }, { sellerName: 'b' }] };
    assert.deepEqual(planCells(row('1', { badge: { kind: 'flip' }, plan })), { buy: 90, sell: 120, units: 3, pace: 4, stops: 2 });
    assert.deepEqual(planCells(row('1', {})), { buy: null, sell: null, units: 0, pace: null, stops: 0 });
});
