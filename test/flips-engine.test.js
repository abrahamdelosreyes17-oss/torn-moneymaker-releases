/*
 * 3.33.0 - flips per trader (engines plan Stage 2): Best flips as traders ranked by the whole basket with each,
 * planned as the desk plans it (core/trade.js planTrade); each line with the next best trader for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { planTrade } from '../src/core/trade.js';
import { heldGain } from '../src/core/to-sell.js';
import { quickSum, topTraders, basketOrder, basketRank, basketLines, secondBest, TOP_TRADERS } from '../src/core/flips-engine.js';

const seller = (sellerId, price, qty) => ({ sellerId, sellerName: 'S' + sellerId, price, qty, stale: false });
const plan = (flips, o = {}) => planTrade({ flips, held: [], cash: null, minPct: 0, kindOf: null, traderId: '9', ...o });

test('the list total is the trade total: every line, yours too, adds up to what the plan makes', () => {
    const flips = [
        { itemId: '206', bid: 900, sellers: [seller('1', 800, 3), seller('2', 850, 2)] },
        { itemId: '180', bid: 50, sellers: [seller('3', 40, 10)] },
    ];
    const held = [{ itemId: '55', bid: 300, held: 4, each: 200 }];
    const p = planTrade({ flips, held, cash: null, minPct: 0, kindOf: null, traderId: '9' });
    const t = { ...p, profit: p.profit + heldGain(p.held) };
    const b = basketLines(t, { nameOf: (id) => 'item ' + id });
    assert.equal(b.profit, t.profit);
    assert.equal(b.lines.reduce((a, l) => a + l.profit, 0), t.profit);
    // What the bazaars take is the money the trade needs: yours is held already.
    const bought = b.lines.filter((l) => !l.yours);
    assert.equal(bought.reduce((a, l) => a + l.back - l.cost, 0), p.profit);
    assert.equal(b.lines.find((l) => l.yours).cost, 0);
    assert.equal(b.lines.filter((l) => !l.yours).reduce((a, l) => a + l.cost, 0), p.cost);
    const line = b.lines.find((l) => l.itemId === '206');
    assert.deepEqual([line.units, line.cost, line.bid, line.back], [5, 3 * 800 + 2 * 850, 900, 4500]);
    assert.equal(line.each, (3 * 800 + 2 * 850) / 5);
    // Yours, what you paid unknown: it makes nothing in the list, as it makes nothing in the trade.
    for (const each of [null, undefined, 'x', -1]) {
        const h = [{ itemId: '55', bid: 300, units: 2, each }];
        assert.equal(basketLines({ flips: [], held: h }).profit, heldGain(h), String(each));
    }
    assert.equal(basketLines({ flips: [], held: [{ itemId: '55', bid: 300, units: 2 }] }).lines[0].each, null, 'paid ? on the row');
});

test('your cash is never passed within one trader', () => {
    const flips = [{ itemId: '206', bid: 900, sellers: [seller('1', 800, 30)] }, { itemId: '180', bid: 50, sellers: [seller('3', 40, 500)] }];
    for (const cash of [1000, 5000, 12345, 30000]) {
        const b = basketLines(plan(flips, { cash }));
        assert.ok(b.cost <= cash, cash + ': ' + b.cost);
    }
});

test('the best whole basket wins across all items: many small flips over one big one', () => {
    // A: one item, $500 a flip. B: four items, $200 each.
    const a = [{ bid: 1500, sellers: [seller('1', 1000, 1)] }];
    const b = [1, 2, 3, 4].map((k) => ({ bid: 400, sellers: [seller(String(k), 200, 1)] }));
    assert.equal(quickSum(a), 500);
    assert.equal(quickSum(b), 800);
    // Stale listings and ones at or over the price count for nothing.
    assert.equal(quickSum([{ bid: 100, sellers: [{ price: 50, qty: 2, stale: true }, { price: 100, qty: 9 }, { price: 120, qty: 1 }] }]), 0);
    assert.deepEqual(topTraders(new Map([['id:1', 500], ['id:2', 800], ['id:3', 0]]), 5), ['id:2', 'id:1']);
    assert.deepEqual(topTraders(new Map([['id:1', 500], ['id:2', 800]]), 1), ['id:2']);
    assert.deepEqual(topTraders(new Map([['id:1', 500], ['id:2', 800]]), 5, new Set(['id:2'])), ['id:1'], 'a favourite is planned anyway');
    assert.equal(TOP_TRADERS, 20);
    const rows = [{ key: 'A', name: 'A', items: 1, profit: 500 }, { key: 'B', name: 'B', items: 4, profit: 800 }];
    assert.deepEqual(basketOrder(rows).map((x) => x.key), ['B', 'A']);
});

test('an offline trader, or one whose list is not seen open, ranks under one you can ask now; a hidden one last', () => {
    const rows = [
        { key: 'off', name: 'a', items: 3, profit: 9000, offline: true },
        { key: 'shut', name: 'b', items: 3, profit: 8000, notOpen: true },
        { key: 'ok', name: 'c', items: 1, profit: 100 },
        { key: 'hid', name: 'd', items: 3, profit: 99999, hiddenBy: 'offline' },
        { key: 'wait', name: 'e', items: 2, profit: 5000, waiting: true },
        { key: 'none', name: 'f', items: 0, profit: 0 },
    ];
    assert.deepEqual(basketOrder(rows).map((x) => x.key), ['ok', 'off', 'shut', 'wait', 'none', 'hid']);
    assert.equal(basketRank({ items: 1, profit: 1 }), 0);
});

test('each line names the next best trader for it, never this one', () => {
    const keyOf = (b) => 'id:' + b.id;
    const buyers = [{ id: 1, name: 'One', price: 900 }, { id: 2, name: 'Two', price: 880 }, { id: 3, name: 'Three', price: 870 }];
    assert.deepEqual(secondBest(buyers, keyOf, 'id:1'), { name: 'Two', price: 880 });
    assert.deepEqual(secondBest(buyers, keyOf, 'id:2'), { name: 'One', price: 900 });
    assert.equal(secondBest([buyers[0]], keyOf, 'id:1'), null);
    const b = basketLines(plan([{ itemId: '206', bid: 900, sellers: [seller('1', 800, 1)] }]), { secondOf: (id) => (id === '206' ? { name: 'Two', price: 880 } : null) });
    assert.deepEqual(b.lines[0].second, { name: 'Two', price: 880 });
});

test('wiring: the scan plans the top traders and ranks by basket; Today and By trader draw the baskets', () => {
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../src/ui/selling-page.js', import.meta.url), 'utf8');
    assert.ok(main.includes('for (const k of topTraders(sums, TOP_TRADERS).sort())'));
    assert.ok(main.includes("who.set(id, { id, name: fb.name || nameFromLists(id) || 'Player ' + id, favourite: false, top: true });"));
    assert.ok(main.includes('scan.list = basketOrder(cards.list);'));
    assert.ok(main.includes('secondOf: (itemId) => secondBest(flipCheckedOf(itemId), traderKey, key)'));
    assert.ok(page.includes('for (const x of traders.slice(0, 7)) {'));
    // The best trade is the first one you can ask now, not the biggest; no trader ready: the flips by item.
    assert.ok(page.includes('const best = traders[0] || null;'));
    assert.ok(page.includes('if (!traders.length && flips.length) {') && page.includes('for (const f of flips.slice(0, 7)) {'));
    // Their lists are kept checked open; their own word counts as open.
    assert.ok(main.includes('desk: sell.deskTraders, flips: sell.openWant, scan: sell.scanTraders'));
    assert.ok(main.includes("!((said.get(String(w.id)) || {}).at > 0)"));
    // The top traders are found when the scan is worked out again, not in its signature.
    assert.ok(main.indexOf('const sums = new Map();') > main.indexOf('sell.scanSig = scanSig;'));
    // 2026-10-17: By trader is one row a trader, its lines only in the desk.
    assert.ok(page.includes("return this.pickRow('lr' + (key === x.key ? ' sel' : ''), 'scan:' + x.id, pick, cells, 'Show the trade with ' + x.name);"));
    assert.ok(!page.includes("'scan:item:'"));
});
