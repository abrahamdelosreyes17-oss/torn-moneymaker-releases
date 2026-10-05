/*
 * 3.23.0, item 9: "Not for sale" on a To sell row (asked 2026-10-03: "A To
 * sell row cannot be dismissed by hand: an item you decide to keep stays
 * until you no longer hold it, or a week"). The lock only: the row stays,
 * marked, and is in no trade, under no trader on the board and not on your
 * bazaar's Fill all - until you put it back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as ts from '../src/core/to-sell.js';
import * as acc from '../src/core/accepted.js';
import * as bz from '../src/core/bazaar-sell.js';

const NOW = 1_790_000_000_000;
const trusted = { level: 'Trusted', score: 500 };
const BUYERS = {
    258: [{ id: '7', name: 'Lumei', price: 13900, trust: trusted }],
    206: [{ id: '8', name: 'Bob', price: 850000, trust: trusted }],
    268: [],
};
const buyersOf = (id) => BUYERS[id] || [];
const LEFT = [
    { itemId: '258', name: 'Jaguar Plushie', qty: 89, each: 13000, from: 'office_kitty', at: NOW, why: 'cancel' },
    { itemId: '206', name: 'Xanax', qty: 4, each: 840000, from: null, at: NOW, why: 'extra' },
    { itemId: '268', name: 'Red Fox Plushie', qty: 13, each: 30300, from: 'office_kitty', at: NOW },
];

test('Not for sale: the row is marked, and put back the same way - nothing else on the list changes', () => {
    const locked = ts.setNotForSale(LEFT, '206', true, NOW + 5);
    assert.notEqual(locked, LEFT);
    assert.deepEqual(locked.map((l) => [l.itemId, l.keep || null]), [['258', null], ['206', NOW + 5], ['268', null]]);
    assert.equal(LEFT[1].keep, undefined, 'the list given is not written to');
    assert.deepEqual({ ...locked[1], keep: undefined }, { ...LEFT[1], keep: undefined });
    assert.equal(ts.notForSale(locked[1]), true);
    assert.equal(ts.notForSale(LEFT[1]), false);
    // Twice is once; an item not on the list changes nothing.
    assert.equal(ts.setNotForSale(locked, '206', true, NOW + 9), locked);
    assert.equal(ts.setNotForSale(LEFT, '999', true, NOW), LEFT);
    assert.equal(ts.setNotForSale(LEFT, '206', false, NOW), LEFT);
    // Back for sale: the mark is gone, not left as false.
    const back = ts.setNotForSale(locked, 206, false, NOW + 10);
    assert.deepEqual(back, LEFT);
    assert.equal(Object.prototype.hasOwnProperty.call(back[1], 'keep'), false);
});

test('Not for sale: the row stays on the tab, last, with no trader, no profit and no bazaar price', () => {
    const locked = ts.setNotForSale(LEFT, '206', true, NOW);
    const rows = ts.toSellRows(locked, { buyersOf, bazaarOf: () => 900000 });
    assert.deepEqual(rows.map((r) => [r.name, Boolean(r.kept), r.ready]), [['Jaguar Plushie', false, true], ['Red Fox Plushie', false, false], ['Xanax', true, false]]);
    const x = rows[2];
    assert.deepEqual([x.best, x.gain, x.short, x.bazaar, x.qty, x.each], [null, null, null, null, 4, 840000]);
    // Open, the same row sells to Bob.
    assert.equal(ts.toSellRows(LEFT, { buyersOf })[1].best.name, 'Bob');
    // How many are for sale: the tab's count leaves the locked ones out.
    assert.equal(ts.forSaleCount(rows), 2);
    assert.equal(ts.forSaleCount(ts.toSellRows(LEFT, { buyersOf })), 3);
});

test('Not for sale: an extra buy that is locked does not use up one of the ten "waiting" places, and is never cut', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ itemId: String(500 + i), name: 'Thing ' + i, qty: 1, each: 100, from: null, at: NOW + i, why: 'extra' }));
    const open = ts.toSellRows(many, { buyersOf });
    assert.equal(open.length, ts.TO_SELL_EXTRA_WAITING, 'the two oldest waiting extras are not listed');
    assert.equal(open.some((r) => r.itemId === '500'), false);
    // The oldest locked: it is listed (it is yours to put back), and ten others still wait.
    const rows = ts.toSellRows(ts.setNotForSale(many, '500', true, NOW), { buyersOf });
    assert.equal(rows.filter((r) => !r.kept).length, ts.TO_SELL_EXTRA_WAITING);
    assert.equal(rows[rows.length - 1].itemId, '500');
    assert.equal(rows[rows.length - 1].kept, true);
});

test('Not for sale: under no trader on the board, not among the waiting - a group of its own', () => {
    const rows = ts.toSellRows(ts.setNotForSale(LEFT, '206', true, NOW), { buyersOf });
    const board = ts.toSellBoard(rows);
    assert.deepEqual(board.groups.map((g) => [g.trader.name, g.rows.map((r) => r.name)]), [['Lumei', ['Jaguar Plushie']]]);
    assert.deepEqual(board.waiting.map((r) => r.name), ['Red Fox Plushie']);
    assert.deepEqual(board.kept.map((r) => r.name), ['Xanax']);
    assert.deepEqual(ts.toSellBoard(ts.toSellRows(LEFT, { buyersOf })).kept, []);
});

test('Not for sale: in no trade as "yours"', () => {
    const open = ts.toSellHeld(LEFT, { buyersOf });
    assert.deepEqual(open.get('id:8').map((l) => [l.itemId, l.held]), [['206', 4]]);
    const held = ts.toSellHeld(ts.setNotForSale(LEFT, '206', true, NOW), { buyersOf });
    assert.equal(held.has('id:8'), false);
    assert.deepEqual(held.get('id:7').map((l) => l.itemId), ['258']);
});

test('Not for sale: more of the item joining the list does not take the lock off - only you do', () => {
    const locked = ts.setNotForSale(LEFT, '206', true, NOW);
    const more = acc.addLeftovers(locked, [{ itemId: '206', name: 'Xanax', qty: 2, each: 846000, from: 'Bob', at: NOW + 60000, why: 'cancel' }]);
    const row = more.find((l) => l.itemId === '206');
    assert.deepEqual([row.qty, row.keep, row.why], [6, NOW, 'cancel']);
    assert.equal(ts.toSellHeld(more, { buyersOf }).has('id:8'), false);
});

test('Not for sale: off your bazaar\'s Fill all - also when your log shows the same item bought', () => {
    const locked = ts.setNotForSale(LEFT, '206', true, NOW);
    const bought = [{ itemId: '206', qty: 6, each: 851000, at: NOW - 1000 }, { itemId: '180', qty: 5, each: 40, at: NOW - 2000 }];
    const open = bz.bazaarSellList({ leftovers: LEFT, bought });
    assert.deepEqual(open.map((r) => r.itemId), ['258', '206', '268', '180']);
    assert.equal(bz.fillAllList(open).length, 4);
    const list = bz.bazaarSellList({ leftovers: locked, bought });
    assert.deepEqual(bz.fillAllList(list).map((r) => r.itemId), ['258', '268', '180']);
    // What you paid for it is still known on the page: a price under it still warns.
    const x = list.find((r) => r.itemId === '206');
    assert.deepEqual([x.kept, x.paid, x.qty], [true, 851000, 6]);
});
