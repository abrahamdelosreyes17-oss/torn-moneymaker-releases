import test from 'node:test';
import assert from 'node:assert/strict';

import {
    rowsFromLog,
    rowsFromTrade,
    addLedgerRows,
    matchFifo,
    filterLedgerRows,
    ledgerTotals,
    ledgerByItem,
    ledgerByPeriod,
    emptyLedger,
    readLedger,
    periodStart,
    logSpan,
    mugFromLog,
    addMugs,
    mugTotals,
} from '../src/core/ledger.js';

// Real payload shapes (a public ledger project's fixtures of Torn API v2 /user/log).
const T0 = 1_780_000_000;
const bazaarBuy = { id: 'aaa', timestamp: T0, details: { id: 1225, title: 'Bazaar buy', category: 'Bazaars' }, data: { seller: 3630447, items: [{ id: 206, uid: null, qty: 2 }], cost_each: 820000, cost_total: 1640000 } };
const marketBuy = { id: 'bbb', timestamp: T0 + 60, details: { id: 1112, title: 'Item market buy', category: 'Item market' }, data: { seller: 2053127, anonymous: 0, items: [{ id: 206, uid: null, qty: 1 }], cost_total: 830000, cost_each: 830000 } };
const marketSell = { id: 'ccc', timestamp: T0 + 3600, details: { id: 1113, title: 'Item market sell', category: 'Item market' }, data: { buyer: 4114557, anonymous: 0, items: [{ id: 206, uid: null, qty: 2 }], cost_total: 1596000, fee: 84000, cost_each: 840000 } };
const bazaarSell = { id: 'ddd', timestamp: T0 + 7200, details: { id: 1226, title: 'Bazaar sell', category: 'Bazaars' }, data: { buyer: 4172398, items: [{ id: 206, uid: 0, qty: 2 }], cost_each: 850000, cost_total: 1700000 } };

test('each log type becomes a row: side, venue, who, price each, the fee', () => {
    const [b] = rowsFromLog(bazaarBuy);
    assert.deepEqual([b.side, b.venue, b.itemId, b.qty, b.each, b.fee, b.who, b.t], ['buy', 'bazaar', '206', 2, 820000, 0, '3630447', T0 * 1000]);
    const [s] = rowsFromLog(marketSell);
    assert.deepEqual([s.side, s.venue, s.qty, s.each, s.fee, s.who], ['sell', 'market', 2, 840000, 84000, '4114557']);
    assert.equal(rowsFromLog(bazaarSell)[0].side, 'sell');
    assert.equal(rowsFromLog(marketBuy)[0].venue, 'market');
    // Anything else in the log is not a trade of items.
    assert.deepEqual(rowsFromLog({ id: 'x', timestamp: T0, details: { id: 4200 }, data: { items: [{ id: 1, qty: 1 }] } }), []);
});

test('FIFO: a sale uses the oldest units; profit is after the Item Market fee', () => {
    const rows = [bazaarBuy, marketBuy, marketSell, bazaarSell].flatMap(rowsFromLog);
    const fifo = matchFifo(rows);
    // Sold 2 on the Item Market at $840,000 = $1,680,000 - $84,000 fee = $1,596,000,
    // using the 2 bought at $820,000: profit $1,596,000 - $1,640,000 = -$44,000.
    const im = fifo.get('ccc:0');
    assert.equal(im.net, 1596000);
    assert.equal(im.cost, 1640000);
    assert.equal(im.profit, -44000);
    // Then 2 in the bazaar at $850,000: 1 left at $830,000, 1 with no buy on record.
    const bz = fifo.get('ddd:0');
    assert.equal(bz.cost, 830000);
    assert.equal(bz.unknownQty, 1);
    assert.equal(bz.profit, 850000 - 830000);
    assert.deepEqual(im.from.map((f) => [f.who, f.qty, f.each]), [['3630447', 2, 820000]]);
});

test('totals, per item, per day; units with no buy are counted apart, never guessed', () => {
    const rows = [bazaarBuy, marketBuy, marketSell, bazaarSell].flatMap(rowsFromLog);
    const fifo = matchFifo(rows);
    const t = ledgerTotals(rows, fifo);
    assert.equal(t.spent, 1640000 + 830000);
    assert.equal(t.sold, 1596000 + 1700000);
    assert.equal(t.fees, 84000);
    assert.equal(t.profit, -44000 + 20000);
    assert.equal(t.unknownUnits, 1);
    const [xan] = ledgerByItem(rows, fifo);
    assert.equal(xan.itemId, '206');
    assert.equal(xan.profit, -24000);
    assert.equal(xan.avgBuy, Math.round(2470000 / 3));
    const days = ledgerByPeriod(rows, fifo, 'day');
    assert.equal(days.reduce((a, d) => a + d.profit, 0), -24000);
});

test('the item filter answers "how much did I make on this item"; a filter never changes a sale\'s cost', () => {
    const plush = { id: 'eee', timestamp: T0 + 100, details: { id: 1225 }, data: { seller: 1, items: [{ id: 384, qty: 10 }], cost_each: 70000 } };
    const plushSell = { id: 'fff', timestamp: T0 + 200, details: { id: 1226 }, data: { buyer: 2, items: [{ id: 384, qty: 10 }], cost_each: 73500 } };
    const rows = [bazaarBuy, plush, marketSell, plushSell].flatMap(rowsFromLog);
    const fifo = matchFifo(rows);
    const onPlush = filterLedgerRows(rows, { itemId: '384' });
    assert.equal(ledgerTotals(onPlush, fifo).profit, 35000);
    // Only the sale in the date range - its cost still comes from the earlier buy.
    const onlySales = filterLedgerRows(rows, { from: (T0 + 150) * 1000 });
    assert.equal(ledgerTotals(onlySales, fifo).profit, 35000 + (1596000 - 1640000));
    assert.equal(filterLedgerRows(rows, { venue: 'market' }).length, 1);
    assert.equal(filterLedgerRows(rows, { who: '2' }).length, 1);
    assert.equal(filterLedgerRows(rows, { category: 'Plushie' }, (id) => (id === '384' ? 'Plushie' : 'Drug')).length, 2);
});

test('a trade: money you gave buys what you got, shared by value; items for no money cost $0', () => {
    const me = '999';
    const trade = { id: 55, completed_at: T0, trader: { id: 11, name: 'Bob' }, user: { id: 999, name: 'Me' }, items: [
        { user_id: 999, type: 'Money', details: { amount: 3000000 } },
        { user_id: 11, type: 'Item', details: { id: 206, uid: null, amount: 2 } },
        { user_id: 11, type: 'Item', details: { id: 180, uid: null, amount: 10 } },
    ] };
    const rows = rowsFromTrade(trade, me, (id) => ({ 206: 830000, 180: 55 })[id]);
    assert.deepEqual(rows.map((r) => [r.side, r.itemId, r.qty, r.venue, r.who, r.whoName]), [['buy', '206', 2, 'trade', '11', 'Bob'], ['buy', '180', 10, 'trade', '11', 'Bob']]);
    const spent = rows.reduce((a, r) => a + r.each * r.qty, 0);
    assert.equal(Math.round(spent), 3000000);
    // Selling to a trader: items out, money in.
    const sale = rowsFromTrade({ id: 56, completed_at: T0 + 10, trader: { id: 11, name: 'Bob' }, items: [
        { user_id: 999, type: 'Item', details: { id: 206, amount: 1 } },
        { user_id: 11, type: 'Money', details: { amount: 850000 } },
    ] }, me);
    assert.deepEqual(sale.map((r) => [r.side, r.each]), [['sell', 850000]]);
    // A gift in: bought at $0. A swap of items: not priced.
    assert.equal(rowsFromTrade({ id: 57, completed_at: T0, items: [{ user_id: 11, type: 'Item', details: { id: 1, amount: 1 } }] }, me)[0].each, 0);
    assert.deepEqual(rowsFromTrade({ id: 58, completed_at: T0, items: [{ user_id: 11, type: 'Item', details: { id: 1, amount: 1 } }, { user_id: 999, type: 'Item', details: { id: 2, amount: 1 } }] }, me), []);
});

test('rows are added once each, oldest first; a stored ledger of another version starts fresh', () => {
    const l = emptyLedger();
    assert.equal(addLedgerRows(l, rowsFromLog(marketSell)), 1);
    assert.equal(addLedgerRows(l, [...rowsFromLog(bazaarBuy), ...rowsFromLog(marketSell)]), 1);
    assert.deepEqual(l.rows.map((r) => r.id), ['aaa:0', 'ccc:0']);
    assert.deepEqual(readLedger({ version: 0, rows: [1] }).rows, []);
    assert.equal(readLedger(l).rows.length, 2);
    assert.deepEqual(logSpan([bazaarBuy, marketSell]), { min: T0, max: T0 + 3600 });
});

test('weeks start on Monday, months on the 1st', () => {
    const wed = new Date(2026, 8, 23, 15, 0).getTime();
    assert.equal(new Date(periodStart(wed, 'week')).getDay(), 1);
    assert.equal(new Date(periodStart(wed, 'month')).getDate(), 1);
    assert.equal(new Date(periodStart(wed, 'day')).getHours(), 0);
});

test('buy under the NPC price on the Item Market, sell to the NPC: that is profit, bought from whom at what', () => {
    // A real 4210 sample's shape: {item, quantity, value_each, total_value}.
    const buy = { id: 'm1', timestamp: T0, details: { id: 1112 }, data: { seller: 777, items: [{ id: 180, qty: 30 }], cost_each: 40, cost_total: 1200 } };
    const npc = { id: 'n1', timestamp: T0 + 60, details: { id: 4210, title: 'Item shop sell' }, data: { item: 180, quantity: 30, value_each: 50, total_value: 1500, color: 'green' } };
    const rows = [buy, npc].flatMap(rowsFromLog);
    const [s] = rows.filter((r) => r.side === 'sell');
    assert.deepEqual([s.venue, s.qty, s.each, s.fee], ['npc', 30, 50, 0]);
    const fifo = matchFifo(rows);
    const m = fifo.get('n1:0');
    assert.equal(m.profit, 300);
    assert.deepEqual(m.from.map((f) => [f.who, f.venue, f.each]), [['777', 'market', 40]]);
    // Filter to NPC sales: what they made, and what their units cost.
    const t = ledgerTotals(filterLedgerRows(rows, { venue: 'npc' }), fifo);
    assert.deepEqual([t.profit, t.sold, t.cost, t.spent], [300, 1500, 1200, 0]);
});

test('city shop and abroad buys are buys', () => {
    const shop = rowsFromLog({ id: 's1', timestamp: T0, details: { id: 4200 }, data: { item: 97, quantity: 100, cost_total: 500 } })[0];
    assert.deepEqual([shop.side, shop.venue, shop.qty, shop.each], ['buy', 'shop', 100, 5]);
    const abroad = rowsFromLog({ id: 'a1', timestamp: T0, details: { id: 4201 }, data: { item: 206, quantity: 2, cost_total: 1500000 } })[0];
    assert.deepEqual([abroad.side, abroad.venue, abroad.each], ['buy', 'abroad', 750000]);
});

test('muggings: the amount lost, by whom; one it cannot read is counted apart, never guessed', () => {
    const a = mugFromLog({ id: 'g1', timestamp: T0, details: { id: 8156 }, data: { attacker: 123, money_mugged: 4446201 } });
    assert.deepEqual([a.amount, a.who, a.anonymous], [4446201, '123', false]);
    const b = mugFromLog({ id: 'g2', timestamp: T0 + 10, details: { id: 8156 }, data: { anonymous: 1, money: 13584 } });
    assert.deepEqual([b.amount, b.anonymous], [13584, true]);
    const c = mugFromLog({ id: 'g3', timestamp: T0 + 20, details: { id: 8156 }, data: { something: 'x' } });
    assert.equal(c.amount, null);
    assert.equal(mugFromLog({ id: 'x', timestamp: T0, details: { id: 1225 }, data: {} }), null);
    const l = emptyLedger();
    assert.equal(addMugs(l, [a, b, c, a]), 3);
    assert.deepEqual(l.mugKeys, ['anonymous', 'attacker', 'money', 'money_mugged', 'something']);
    assert.deepEqual(mugTotals(l.mugs), { lost: 4446201 + 13584, count: 3, unknown: 1, biggest: 4446201 });
    assert.equal(mugTotals(l.mugs, { from: (T0 + 5) * 1000 }).lost, 13584);
    // A mugging is not an item row.
    assert.deepEqual(rowsFromLog({ id: 'g1', timestamp: T0, details: { id: 8156 }, data: { money_mugged: 5 } }), []);
});

test('mug totals follow exactly the muggings given (the page filters, then totals)', () => {
    const l = emptyLedger();
    addMugs(l, [
        mugFromLog({ id: 'a', timestamp: T0, details: { id: 8156 }, data: { attacker: 1, money_mugged: 100 } }),
        mugFromLog({ id: 'b', timestamp: T0 + 86400, details: { id: 8156 }, data: { anonymous: 1, money: 50 } }),
    ]);
    const named = l.mugs.filter((m) => m.who);
    assert.deepEqual(mugTotals(named), { lost: 100, count: 1, unknown: 0, biggest: 100 });
    assert.deepEqual(mugTotals(l.mugs, { from: (T0 + 3600) * 1000 }), { lost: 50, count: 1, unknown: 0, biggest: 50 });
});
