/*
 * 3.30.0: the calm pace, and one trade once.
 *
 * The calm pace itself is in test/start-up.test.js (redrawWait). Here: the flips of one trader stand
 * together (core/still.js togetherBy, also while a trade holds the list still), what two trades share is
 * said (core/same-goods.js), and the joins in src/main.js and the page - no test can run those two, so
 * their text is read (test/wiring.test.js says why).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { stillStart, stillList, togetherBy, flipTraderKey } from '../src/core/still.js';
import { sameGoods, goodsAbove, sameGoodsWords } from '../src/core/same-goods.js';
import { REDRAW_CALM_MS, REDRAW_WAIT_MAX_MS } from '../src/core/start-up.js';

const NOW = 1_800_000_000_000;
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = read('src/main.js');
const page = read('src/ui/selling-page.js');
const has = (text, what) => assert.ok(main.includes(text), what + ' - not in src/main.js: ' + text);

const flip = (itemId, value, to, { id = null } = {}) => ({ itemId: String(itemId), name: 'Item ' + itemId, value, held: 0, bid: 0, badge: value > 0 ? { kind: 'flip', amount: value } : null, plan: value > 0 ? { profit: value, units: 1, buyer: id ? { id, name: to } : { name: to } } : null });
const sorted = (rows) => [...rows].sort((a, b) => b.value - a.value || String(a.name).localeCompare(String(b.name)));
const ids = (rows) => rows.map((r) => r.itemId);

/* ------------------------------------------------------- one trade, once */

test('the trader a flip sells to: by id, by name for a buyer known by name only, none for a row that is no flip', () => {
    assert.equal(flipTraderKey(flip(1, 500, 'Bob', { id: '7' })), 'id:7');
    assert.equal(flipTraderKey(flip(1, 500, 'Bob')), 'name:bob');
    assert.equal(flipTraderKey(flip(1, 0, 'Bob')), null);
    assert.equal(flipTraderKey({ itemId: '1', badge: { kind: 'list', amount: 5 }, plan: { buyer: { id: '7' } } }), null, 'a "list it on your bazaar" row sells to nobody');
    assert.equal(flipTraderKey(null), null);
});

test('Best flips: the flips of one trader stand together, the traders in the order of what their flips make together', () => {
    // By profit alone: Bob, Ann, Bob, Cy, Ann - five deals to the eye, three trades in fact.
    const list = sorted([flip(1, 900, 'Bob', { id: '1' }), flip(2, 800, 'Ann', { id: '2' }), flip(3, 700, 'Bob', { id: '1' }), flip(4, 650, 'Cy', { id: '3' }), flip(5, 100, 'Ann', { id: '2' })]);
    assert.deepEqual(ids(list), ['1', '2', '3', '4', '5']);
    const got = togetherBy(list, flipTraderKey, (r) => r.value);
    assert.deepEqual(ids(got), ['1', '3', '2', '5', '4'], 'Bob 1,600 · Ann 900 · Cy 650');
    // The same rows, none lost, none twice; inside a trader the order they came in.
    assert.deepEqual([...ids(got)].sort(), ['1', '2', '3', '4', '5']);
    // A trader whose flips together make more than one big flip of another's goes first.
    const two = togetherBy(sorted([flip(1, 1000, 'Ann'), flip(2, 600, 'Bob'), flip(3, 600, 'Bob')]), flipTraderKey, (r) => r.value);
    assert.deepEqual(ids(two), ['2', '3', '1']);
    // Equal totals: the one whose first row stood higher.
    assert.deepEqual(ids(togetherBy(sorted([flip(1, 500, 'Ann'), flip(2, 500, 'Bob')]), flipTraderKey, (r) => r.value)), ['1', '2']);
    // A row with no trader stands alone, in its own place by what it makes - never lumped with another such row.
    const loose = togetherBy([flip(1, 900, 'Bob'), { itemId: '8', value: 800 }, { itemId: '9', value: 700 }, flip(2, 100, 'Bob')], flipTraderKey, (r) => r.value);
    assert.deepEqual(ids(loose), ['1', '2', '8', '9']);
    assert.deepEqual(togetherBy(null, flipTraderKey, () => 0), []);
    assert.deepEqual(togetherBy([], flipTraderKey, () => 0), []);
});

test('Best flips while a trade holds the list still: each trader\'s flips stay together, by the trader and the numbers of the hold', () => {
    const before = togetherBy(sorted([flip(1, 900, 'Bob'), flip(2, 800, 'Ann'), flip(3, 700, 'Bob'), flip(4, 650, 'Cy'), flip(5, 100, 'Ann')]), flipTraderKey, (r) => r.value);
    assert.deepEqual(ids(before), ['1', '3', '2', '5', '4']);
    const still = stillStart({ rows: before, cards: [], now: NOW });
    // Later: Cy's flip is now the biggest, Bob's second flip is none any more, Ann's small one sells to Cy now.
    const after = [flip(1, 900, 'Bob'), flip(2, 800, 'Ann'), flip(3, 0, 'Bob'), flip(4, 5000, 'Cy'), flip(5, 100, 'Cy')];
    const held = stillList(still, after, { together: true });
    assert.deepEqual(ids(held), ['1', '3', '2', '5', '4'], 'the order of the hold');
    // The page is told the trader of the hold for each row: the line over a trader's flips does not break.
    assert.deepEqual(held.map((r) => r.still.to), ['name:bob', 'name:bob', 'name:ann', 'name:ann', 'name:cy']);
    assert.equal(held[1].still.gone, true);
    assert.equal(held[4].still.move, 'up');
    // Without it (All items, My items): as it always was, by the numbers of the hold alone.
    assert.deepEqual(ids(stillList(still, after)), ['1', '2', '3', '4', '5']);
    // A flip that came in later (let in) joins its trader's rows.
    const more = stillList(still, [...after, flip(6, 300, 'Ann')], { together: true });
    assert.deepEqual(ids(more), ['1', '3', '2', '6', '5', '4']);
});

/* ------------------------------------------------------- the same goods */

const line = (itemId, profit) => ({ itemId: String(itemId), profit });

test('a trade against the trade on show: how many of its items are the same goods, and what its other items make', () => {
    const shown = new Set(['206', '335']);
    assert.deepEqual(sameGoods([line(206, 19000)], shown), { same: 1, of: 1, own: 0 });
    assert.deepEqual(sameGoods([line(206, 19000), line(180, 50)], shown), { same: 1, of: 2, own: 50 });
    assert.deepEqual(sameGoods([line(1, 10), line(2, 20)], shown), { same: 0, of: 2, own: 30 });
    assert.deepEqual(sameGoods([line(206, 5)], ['206']), { same: 1, of: 1, own: 0 }, 'ids as a list, or numbers');
    assert.deepEqual(sameGoods([{ itemId: 206, profit: 5 }], new Set(['206'])), { same: 1, of: 1, own: 0 });
    assert.deepEqual(sameGoods(null, shown), { same: 0, of: 0, own: 0 });
    assert.deepEqual(sameGoods([line(1, 10)], null), { same: 0, of: 1, own: 10 });
});

test('By trader: what a trade shares with a bigger one above it, and what the rest of it makes', () => {
    const list = [
        { key: 'id:1', flips: [line(335, 26500), line(206, 20000)], ready: true },
        { key: 'id:2', flips: [line(206, 19000), line(180, 50)], ready: true },
        // Hidden by a filter or with nothing to make: it takes nothing from those under it.
        { key: 'id:3', flips: [line(999, 5)], ready: false },
        { key: 'id:4', flips: [line(180, 40), line(999, 5)], ready: true },
        { key: 'id:5', flips: [], ready: true },
    ];
    const got = goodsAbove(list);
    assert.deepEqual(got.get('id:1'), { same: 0, of: 2, own: 46500, with: null });
    assert.deepEqual(got.get('id:2'), { same: 1, of: 2, own: 50, with: 'id:1' });
    assert.equal(got.has('id:3'), false);
    assert.deepEqual(got.get('id:4'), { same: 1, of: 2, own: 5, with: 'id:2' }, '999 was only in a trade that is not ready');
    assert.deepEqual(got.get('id:5'), { same: 0, of: 0, own: 0, with: null });
    // What every ready trade adds, added up, is each item once at the first trade that has it.
    assert.equal([...got.values()].reduce((a, g) => a + g.own, 0), 26500 + 20000 + 50 + 5);
    assert.equal(goodsAbove(null).size, 0);
});

test('the words: all of it, one of it, part of it - and nothing where nothing is shared', () => {
    assert.equal(sameGoodsWords(0, 3), '');
    assert.equal(sameGoodsWords(1, 1), 'The same item as');
    assert.equal(sameGoodsWords(3, 3), 'The same 3 items as');
    assert.equal(sameGoodsWords(1, 2), '1 of its 2 items is also in');
    assert.equal(sameGoodsWords(2, 5), '2 of its 5 items are also in');
});

/* ------------------------------------------------------------- the joins */

test('the calm pace is no longer than the longest wait there ever was', () => {
    assert.ok(REDRAW_CALM_MS > 0 && REDRAW_CALM_MS <= REDRAW_WAIT_MAX_MS);
});

test('the joins: a redraw for data keeps the calm pace unless it is about what is on the desk', () => {
    has('redrawWait({ base: SELL_RENDER_MS, took: sell.redrawTook, ended: sell.redrawEnded, now, calm: sell.nearAsked ? 0 : REDRAW_CALM_MS })', 'the wait');
    has('if (!yours && !sell.nearAsked && sellNearMoved()) sell.nearAsked = true;', 'asked before the pieces are looked at');
    has('sell.nearDrawn = sellNearStamp();', 'what a redraw drew of the desk is noted');
    has('sell.nearAsked = false;', 'and the ask is over once it is drawn');
    // One on its way at the calm pace is brought forward by an answer about the desk; a press still goes first.
    has('if (!yours && !(due < sell.renderDue - 1)) return;', 'brought forward');
    // The one place a wait is worked out.
    assert.equal(main.split('redrawWait(').length - 1, 1);
    // What is on the desk: the item, the trade\'s items, its trader.
    for (const part of ['sell.bazaars.get(sell.selected)', 'sell.itemTraders.get(sell.selected)', 'sell.tradeLive', 'sell.tradeWanted', 'b ? b.rows : null', 'it ? it.traders : null', 'sell.deskTrader', 'sell.presence.get(traderId)', 'sell.listReading']) {
        assert.ok(main.slice(main.indexOf('function sellNearStamp()'), main.indexOf('function sellNearMoved()')).includes(part), part);
    }
});

test('the joins: the traders are counted again only when an item\'s buyers were worked out', () => {
    has('countWas && countKeeper.on() && countWas.redone === countKeeper.stats.redone && countWas.items === allIds.size ? countWas.out : countTraders(allIds, buyersAll)', 'the count');
    has('sell.countKept = { redone: countKeeper.stats.redone, items: allIds.size, out: counted };', 'noted after the count');
    assert.equal(main.split('countTraders(allIds, buyersAll)').length - 1, 1);
});

test('the joins: Best flips puts each trader\'s flips together, live and held, and the page draws one line over them', () => {
    has('if (sell.filter === \'flips\') listed = togetherBy(listed, flipTraderKey, (r) => r.value);', 'the live list');
    has('{ together: sell.filter === \'flips\' }', 'the held list');
    has('group: sell.filter === \'flips\' ? (r.still ? r.still.to || null : flipTraderKey(r)) : null,', 'each row\'s trader, for the page');
    assert.ok(page.includes('list[j].group === list[i].group'), 'the page finds a trader\'s rows by it');
    assert.ok(page.includes('\'group:\' + r.group'), 'and draws the line');
    assert.ok(page.includes('r.still && [r.still.move, r.still.gone, r.still.was], r.group,'), 'a row that changes trader draws the list again');
});

test('the joins: a trade that has the goods of another says so - beside the trade on show, and down By trader', () => {
    has('const g = sameGoods(t.flips, shownGoods);', 'Traders pay');
    has('new Set((hold ? hold.held.lines || [] : chosen.flips).map((r) => String(r.itemId)))', 'against the trade on show, as it is held');
    has('goodsAbove(scan.list.map((x) => ({ key: x.key, flips: x.flipLines, ready: x.items > 0 && x.profit > 0 && !x.hiddenBy && !x.waiting })))', 'By trader');
    has('flipLines: t ? t.flips.map((r) => ({ itemId: r.itemId, profit: r.profit })) : [],', 'each trade\'s lines');
    // "Ready" here is the page\'s own word for a trade that can be offered.
    assert.ok(page.includes('return x.items > 0 && x.profit > 0 && !x.hiddenBy && !x.waiting;'));
    assert.ok(page.includes('sameGoodsWords(t.same, t.flips) + \' the trade with \' + T.chosen.buyer.name'));
    assert.ok(page.includes('sameGoodsWords(x.same.n, x.same.of) + \' the trade with \' + x.same.with'));
    assert.ok(page.includes('x.same && [x.same.n, x.same.of, x.same.own, x.same.with]'), 'By trader draws again when it changes');
});
