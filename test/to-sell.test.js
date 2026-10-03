/*
 * 3.21.0: To sell (core/to-sell.js; the owner, 2026-10-03, mockup U variant B)
 * - what you bought to resell and still hold, as a tab's rows, a board by
 * trader, and the "yours" lines of a trade. Your other items stay out of
 * every trade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toSellRows, toSellBoard, toSellHeld, heldGain, afterYoursSent, toSellWhy, TO_SELL_WHY } from '../src/core/to-sell.js';
import { planTrade } from '../src/core/trade.js';
import { acceptTrade, acceptedTotals, markLeft, leftoversOf, cancelledLeftovers, addLeftovers, recordBuy } from '../src/core/accepted.js';
import { EXTRA_CAP } from '../src/core/liquidity.js';

const NOW = 1_790_000_000_000;
const trusted = { level: 'Trusted', score: 500 };
const BUYERS = {
    258: [{ id: '7', name: 'Lumei', price: 13900, trust: trusted }, { id: '8', name: 'Bob', price: 13500, trust: trusted }],
    206: [{ id: '8', name: 'Bob', price: 850000, trust: trusted }],
    269: [{ id: '9', name: 'Kay', price: 32600, trust: trusted }, { id: '7', name: 'Lumei', price: 32000, trust: trusted }],
    276: [{ id: '9', name: 'Kay', price: 52400, trust: trusted }],
    268: [],
    300: [{ name: 'ByName', price: 500 }],
};
const buyersOf = (id) => BUYERS[id] || [];
const LEFT = [
    { itemId: '258', name: 'Jaguar Plushie', qty: 89, each: 13000, from: 'office_kitty', at: NOW, why: 'cancel' },
    { itemId: '206', name: 'Xanax', qty: 4, each: 840000, from: null, at: NOW, why: 'extra' },
    { itemId: '269', name: 'Monkey Plushie', qty: 12, each: 31990, from: 'Kay', at: NOW, why: 'left' },
    { itemId: '276', name: 'Peony', qty: 50, each: 53000, from: 'office_kitty', at: NOW, why: 'cancel' },
    { itemId: '268', name: 'Red Fox Plushie', qty: 13, each: 30300, from: 'office_kitty', at: NOW },
];

test('the To sell rows: who pays most now, what it makes, the best profit first, then what waits', () => {
    const rows = toSellRows(LEFT, { buyersOf });
    assert.deepEqual(rows.map((r) => [r.name, r.best && r.best.name, r.gain, r.ready]), [
        ['Jaguar Plushie', 'Lumei', 89 * 900, true],
        ['Xanax', 'Bob', 4 * 10000, true],
        // Kay did not take the Monkey Plushies: never offered back to her - Lumei is next.
        ['Monkey Plushie', 'Lumei', 12 * 10, true],
        ['Peony', 'Kay', 50 * -600, false],
        ['Red Fox Plushie', null, null, false],
    ]);
    assert.equal(rows[3].short, 600, 'waiting: $600 short each');
    assert.equal(rows[4].short, null);
    assert.deepEqual(rows.map((r) => r.why), ['cancel', 'extra', 'left', 'cancel', 'left'], 'a row kept before 3.21 does not say why: Not taken');
    assert.equal(rows[0].best.key, 'id:7');
    assert.equal(toSellRows([{ itemId: '300', name: 'X', qty: 1, each: 100 }], { buyersOf })[0].best.key, 'name:byname');
    // The margin rule is the page's (the same as a flip's): a profit under it waits.
    const strict = toSellRows(LEFT, { buyersOf, enough: (per, each) => per / each >= 0.01 });
    assert.deepEqual(strict.filter((r) => r.ready).map((r) => r.name), ['Jaguar Plushie', 'Xanax']);
    const monkey = strict.find((r) => r.name === 'Monkey Plushie');
    assert.equal(monkey.ready, false);
    assert.equal(monkey.short, -10, 'over what you paid, but under the margin');
    // Nothing, rubbish: no rows.
    assert.deepEqual(toSellRows([], { buyersOf }), []);
    assert.deepEqual(toSellRows([null, { itemId: '1', qty: 0, each: 5 }, { qty: 3 }], { buyersOf }), []);
    assert.equal(toSellWhy('cancel'), 'cancel');
    assert.equal(toSellWhy(undefined), 'left');
    assert.equal(toSellWhy('constructor'), 'left');
    assert.deepEqual(Object.keys(TO_SELL_WHY), ['cancel', 'left', 'extra']);
});

test('the board: one group per trader who pays most, the biggest first; the rest wait', () => {
    const board = toSellBoard(toSellRows(LEFT, { buyersOf }));
    assert.deepEqual(board.groups.map((g) => [g.trader.name, g.rows.map((r) => r.name), g.gain]), [
        ['Lumei', ['Jaguar Plushie', 'Monkey Plushie'], 89 * 900 + 120],
        ['Bob', ['Xanax'], 40000],
    ]);
    assert.deepEqual(board.waiting.map((r) => r.name), ['Peony', 'Red Fox Plushie']);
    assert.deepEqual(toSellBoard([]), { groups: [], waiting: [] });
});

test('what goes into a trade as yours: every To sell item that trader pays enough for - all of it, and nothing else', () => {
    const lines = toSellHeld(LEFT, { buyersOf });
    assert.deepEqual([...lines.keys()].sort(), ['id:7', 'id:8']);
    assert.deepEqual(lines.get('id:7'), [
        { itemId: '258', bid: 13900, held: 89, each: 13000, all: true },
        { itemId: '269', bid: 32000, held: 12, each: 31990, all: true },
    ]);
    // Bob pays more than you paid for the Jaguar Plushies too (not the most): his trade may take them.
    assert.deepEqual(lines.get('id:8').map((l) => [l.itemId, l.bid]), [['258', 13500], ['206', 850000]]);
    // Kay: not the Monkey Plushies she did not take, and not the Peony she pays less for than you paid.
    assert.equal(lines.has('id:9'), false);
    assert.equal(toSellHeld(LEFT, { buyersOf, enough: () => false }).size, 0);
});

test('a trade with To sell lines: all you hold of each, whatever its kind; its profit is what they pay over what you paid', () => {
    const held = toSellHeld(LEFT, { buyersOf }).get('id:7');
    // No flips at all: the trade is your items only.
    const t = planTrade({ first: '258', flips: [], held, cash: null, maxPerItem: 100, payCap: Infinity, minPct: 0, edits: {}, keep: {}, traderId: '7', kindOf: () => 'slow', extraItems: 5 });
    assert.deepEqual(t.held.map((r) => [r.itemId, r.units, r.each]), [['258', 89, 13000], ['269', 12, 31990]], 'all 89, not a slow item\'s "normal amount" of ' + EXTRA_CAP.slow);
    assert.equal(t.items, 2);
    assert.equal(t.profit, 0, 'the plan\'s own profit is its flips\'');
    assert.equal(heldGain(t.held), 89 * 900 + 12 * 10);
    assert.equal(t.pays, 89 * 13900 + 12 * 32000);
    // An item of yours that is not To sell (no `all`, no `each`): the kind's amount, as before - and no profit counted.
    const plain = planTrade({ first: null, flips: [], held: [{ itemId: '5', bid: 100, held: 500 }], kindOf: () => 'slow', minPct: 0 });
    assert.equal(plain.held[0].units, EXTRA_CAP.slow);
    assert.equal(heldGain(plain.held), 0, 'no cost known: nothing counted');
    // A number you typed, and what the trader can pay, still rule.
    const typed = planTrade({ first: null, flips: [], held, edits: { 'held:258': { qty: 10 } }, kindOf: () => 'slow', minPct: 0 });
    assert.equal(typed.held[0].units, 10);
    const capped = planTrade({ first: null, flips: [], held, payCap: 13900 * 5, kindOf: () => 'slow', minPct: 0 });
    assert.equal(capped.held[0].units, 5);
    assert.equal(capped.payCapped, true);
});

test('they said yes: the yours lines are in the trade with what you paid, and its profit counts them', () => {
    const chosen = { key: 'id:7', buyer: { id: '7', name: 'Lumei' }, flips: [], held: [{ itemId: '258', name: 'Jaguar Plushie', bid: 13900, held: 89, units: 89, each: 13000 }, { itemId: '5', name: 'Hammer', bid: 100, held: 3, units: 3 }] };
    let t = acceptTrade(chosen, '258', NOW);
    assert.deepEqual(t.items.map((i) => [i.line, i.kind, i.units, i.each]), [['yours:258', 'yours', 89, 13000], ['yours:5', 'yours', 3, undefined]]);
    assert.equal(t.profit, 89 * 900, 'the Hammer has no cost known: nothing counted for it');
    assert.equal(acceptedTotals(t).profit, 89 * 900);
    assert.equal(acceptedTotals(t).pays, 89 * 13900 + 300);
    // They took 60 of the 89: profit on what they took; the other 29 stay To sell.
    t = markLeft(t, 'yours:258', 29);
    assert.equal(acceptedTotals(t).profit, 60 * 900);
    const left = afterYoursSent([{ itemId: '258', name: 'Jaguar Plushie', qty: 89, each: 13000, from: 'office_kitty', at: 1, since: 1, why: 'cancel' }, { itemId: '206', name: 'Xanax', qty: 4, each: 840000, at: 2 }], t, NOW + 5);
    assert.deepEqual(left, [{ itemId: '258', name: 'Jaguar Plushie', qty: 29, each: 13000, from: 'office_kitty', at: 1, since: NOW + 5, why: 'cancel' }, { itemId: '206', name: 'Xanax', qty: 4, each: 840000, at: 2 }]);
    // All of it went: the row goes. A trade with nothing of yours: the very same list.
    assert.deepEqual(afterYoursSent([{ itemId: '258', qty: 89, each: 13000 }], acceptTrade(chosen, '258', NOW), NOW).map((l) => l.itemId), []);
    const list = [{ itemId: '258', qty: 89, each: 13000 }];
    assert.equal(afterYoursSent(list, { items: [{ kind: 'flip', itemId: '258', units: 5 }] }, NOW), list);
    assert.equal(afterYoursSent(list, null, NOW), list);
});

test('a leftover says why it is To sell: not taken, a cancelled trade - and the newer word wins when two meet', () => {
    const chosen = { key: 'id:11', buyer: { id: '11', name: 'Bob' }, flips: [{ itemId: '335', name: 'Stick of Dynamite', bid: 18000, steps: [{ sellerId: '2', sellerName: 'Y', qty: 50, price: 17500 }] }], held: [] };
    let t = acceptTrade(chosen, '335', 1000);
    t = recordBuy(t, 'flip:335', 0, 50);
    assert.deepEqual(cancelledLeftovers(t, 5000).map((l) => [l.itemId, l.qty, l.why]), [['335', 50, 'cancel']]);
    assert.deepEqual(leftoversOf(markLeft(t, 'flip:335', 20), 5000).map((l) => [l.itemId, l.qty, l.why]), [['335', 20, 'left']]);
    const both = addLeftovers([{ itemId: '335', name: 'x', qty: 20, each: 17500, at: 1, why: 'left' }], [{ itemId: '335', name: 'x', qty: 5, each: 17000, at: 2, why: 'extra' }]);
    assert.equal(both[0].why, 'extra');
    assert.equal(both[0].qty, 25);
    // One that does not say (kept before 3.21) changes nothing of the other's word.
    assert.equal(addLeftovers([{ itemId: '335', name: 'x', qty: 20, each: 17500, at: 1, why: 'cancel' }], [{ itemId: '335', name: 'x', qty: 5, each: 17000, at: 2 }])[0].why, 'cancel');
});
