import test from 'node:test';
import assert from 'node:assert/strict';
import { shownTraders, marketPrice } from '../src/core/trader-prices.js';

test('the best believable trader and the next one after them, a troll bid never either', () => {
    const buyers = [{ id: 1, name: 'Troll', price: 99e9 }, { id: 2, name: 'A', price: 1000 }, { id: 2, name: 'A', price: 990 }, { name: 'B', price: 980 }];
    const [top, second] = shownTraders(buyers, 1000, (b) => b.id === 2);
    assert.deepEqual(top, { id: 2, name: 'A', price: 1000, checked: true });
    assert.deepEqual(second, { id: null, name: 'B', price: 980, checked: false });
    // No average to tell by: the top row.
    assert.equal(shownTraders(buyers, null, () => false)[0].name, 'Troll');
    assert.deepEqual(shownTraders([], 1000, () => true), [null, null]);
});

test('the Item Market: the read cheapest, else the market value as about', () => {
    assert.deepEqual(marketPrice({ at: 5, lowest: 700 }, 900), { price: 700, about: false });
    assert.deepEqual(marketPrice({ at: 0, lowest: null, loading: true }, 900), { price: 900, about: true });
    assert.equal(marketPrice(null, 0), null);
});
