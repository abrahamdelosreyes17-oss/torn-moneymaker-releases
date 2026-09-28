/*
 * 3.14.3: the traders you traded with (Ledger › Traders), favourites (5+
 * trades) and the blacklist (never a buyer) - core/partners.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { partnerStats, isFavourite, editFavourite, withoutBlacklisted, tradedLine, FAVOURITE_TRADES } from '../src/core/partners.js';
import { priceRecordOf, addPriceRecord } from '../src/core/ledger.js';

const H = 3600e3;
const T = 1_800_000_000_000;
const sale = (t, who, whoName, received, gave, extra = {}) => ({ id: String(t), t, who, whoName, gave, got: [], received, paid: 0, cost: received * 0.8, profit: received * 0.2, unknownQty: 0, ...extra });

test('per trader: trades, money, profit, the last trade - most trades first', () => {
    const r = [
        sale(T, '5001', 'KayMalta', 1000, [{ itemId: '870', qty: 1 }]),
        sale(T - 2 * H, '5001', 'KayMalta', 500, [{ itemId: '870', qty: 1 }]),
        sale(T - H, '11', 'Bob', 300, [{ itemId: '206', qty: 1 }]),
    ];
    const s = partnerStats(r);
    assert.deepEqual(s.map((x) => [x.who, x.trades, x.received, x.last]), [['5001', 2, 1500, T], ['11', 1, 300, T - H]]);
    assert.equal(s[0].profit, 300);
});

test('did they pay their list: what they accepted in Torn Bids against what they paid', () => {
    const acc = (at) => ({ trader: { id: '5001', name: 'KayMalta' }, at, items: [{ itemId: '870', bid: 1000 }] });
    let recs = addPriceRecord([], priceRecordOf(acc(T - 3 * H)), T);
    recs = addPriceRecord(recs, priceRecordOf(acc(T - 30 * H)), T);
    const s = partnerStats([
        sale(T - 2 * H, '5001', 'KayMalta', 2000, [{ itemId: '870', qty: 2 }]),
        sale(T - 29 * H, '5001', 'KayMalta', 1800, [{ itemId: '870', qty: 2 }]), // the ID Badge kind of loss: $200 short
        sale(T - 60 * H, '5001', 'KayMalta', 900, [{ itemId: '870', qty: 1 }]), // no accepted record: cannot say
    ], recs)[0];
    assert.equal(s.list.checked, 2);
    assert.equal(s.list.paid, 1);
    assert.deepEqual(s.list.short.map((x) => [x.expected, x.got]), [[2000, 1800]]);
});

test('favourites: 5+ trades, the last this month; added by hand; a removal sticks', () => {
    const five = { who: '5001', trades: FAVOURITE_TRADES, last: Date.now() - 3 * 24 * H };
    const four = { who: '11', trades: 4, last: Date.now() };
    assert.equal(FAVOURITE_TRADES, 5);
    assert.equal(isFavourite(five), true);
    assert.equal(isFavourite(four), false);
    // Not traded with for a month: no longer a favourite by itself.
    assert.equal(isFavourite({ ...five, last: Date.now() - 31 * 24 * H }), false, 'a month without a trade');
    let e = editFavourite({}, '5001', false);
    assert.equal(isFavourite({ ...five, trades: 40 }, e), false, 'removed stays removed, however many trades');
    e = editFavourite(e, '11', true);
    assert.equal(isFavourite(four, e), true);
    e = editFavourite(e, '5001', true);
    assert.equal(isFavourite(five, e), true, 'added back');
});

test('blacklisted traders are never buyers; everyone else is untouched', () => {
    const buyers = [{ id: '5001', name: 'KayMalta', price: 10 }, { id: null, name: 'Norker', price: 9 }, { id: '11', name: 'Bob', price: 8 }];
    assert.deepEqual(withoutBlacklisted(buyers, new Set(['id:5001', 'name:norker'])).map((b) => b.name), ['Bob']);
    assert.equal(withoutBlacklisted(buyers, []).length, 3);
});

test('"Traded 7× · last 3d ago" on a trader row', () => {
    assert.equal(tradedLine({ trades: 7, last: T - 3 * 24 * H }, T), 'Traded 7× · last 3d ago');
    assert.equal(tradedLine({ trades: 1, last: T - 5 * H }, T), 'Traded 1× · last 5h ago');
    assert.equal(tradedLine(null, T), null);
});

import { favouritesFirstOnTie, editBlacklist } from '../src/core/partners.js';

test('a favourite goes first only on a tie: never above a higher price', () => {
    const b = [{ name: 'A', price: 300 }, { name: 'B', price: 200 }, { name: 'Fav', price: 200 }, { name: 'Fav2', price: 100 }];
    const out = favouritesFirstOnTie(b, (x) => x.name.startsWith('Fav')).map((x) => x.name);
    assert.deepEqual(out, ['A', 'Fav', 'B', 'Fav2']);
});

test('blacklisting and taking a trader off again', () => {
    let l = editBlacklist([], { id: '5001', name: 'Baecon' }, true, 5);
    assert.deepEqual(l, [{ key: 'id:5001', id: '5001', name: 'Baecon', at: 5 }]);
    l = editBlacklist(l, { id: null, name: 'Norker' }, true, 6);
    assert.equal(l.length, 2);
    l = editBlacklist(l, { id: '5001', name: 'Baecon' }, false);
    assert.deepEqual(l.map((x) => x.key), ['name:norker']);
});

import { scanOrder } from '../src/core/partners.js';

test('Your traders: biggest trade first, then still reading, then no trade now; a favourite first only on a tie', () => {
    const out = scanOrder([
        { name: 'None', items: 0, profit: 0 },
        { name: 'Small', items: 3, profit: 1000 },
        { name: 'Reading', items: 0, profit: 0, reading: true },
        { name: 'Big', items: 5, profit: 9000 },
        { name: 'FavSmall', items: 2, profit: 1000, favourite: true },
    ]).map((x) => x.name);
    assert.deepEqual(out, ['Big', 'FavSmall', 'Small', 'Reading', 'None']);
});

import { blacklistKeys } from '../src/core/partners.js';

test('a trader blacklisted by id is left out as a name-only buyer too', () => {
    const keys = blacklistKeys([{ key: 'id:11', id: '11', name: 'Bob', at: 1 }]);
    const out = withoutBlacklisted([{ name: 'Bob', price: 5 }, { id: '11', name: 'Bob', price: 5 }, { id: '12', name: 'Alice', price: 4 }], keys);
    assert.deepEqual(out.map((b) => b.name), ['Alice']);
});

import { rowsFromTrade as rowsFromTrade3143, tradeReceipts as tradeReceipts3143, matchFifo as matchFifo3143 } from '../src/core/ledger.js';

test('"paid their list" is kept with the trade: still known once the accepted prices are forgotten', () => {
    const T = 1_800_000_000;
    const trade = { id: 9, completed_at: T, trader: { id: 5001, name: 'KayMalta' }, user: { id: 999 }, items: [
        { user_id: 999, type: 'Item', details: { id: 870, amount: 2 } },
        { user_id: 5001, type: 'Money', details: { amount: 1800 } },
    ] };
    const rows = rowsFromTrade3143(trade, '999', () => 1, () => 1000);
    assert.equal(rows[0].agreed, 1000, 'the agreed price is on the row');
    const receipts = tradeReceipts3143(rows, matchFifo3143(rows));
    assert.equal(receipts[0].expected, 2000);
    assert.equal(receipts[0].split, 'price');
    // No price records at all any more: the verdict still stands.
    const s = partnerStats(receipts, [])[0];
    assert.deepEqual([s.list.checked, s.list.paid, s.list.short.length], [1, 0, 1]);
});
