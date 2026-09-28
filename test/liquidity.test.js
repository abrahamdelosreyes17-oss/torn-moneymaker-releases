/*
 * Smart extras (3.13, the owner, 2026-09-28): how easily an item trades
 * (core/liquidity.js), the plan that fills a trade by time not just profit
 * (core/trade.js with kindOf), leftovers (core/accepted.js) and receipts
 * (core/ledger.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { liquidityKind, stopsFor, unitsMoved, addMovement, perHour, extraStopBudget, MOVE_STILL_MS, MOVE_MIN_MS } from '../src/core/liquidity.js';
import { planTrade } from '../src/core/trade.js';
import { acceptTrade, markLeft, leftoversOf, addLeftovers, acceptedTotals, recordBuy, takenUnits } from '../src/core/accepted.js';
import { tradeReceipts, matchFifo } from '../src/core/ledger.js';

const s = (price, qty, who = 'S' + price) => ({ sellerId: who, sellerName: who, price, qty, stale: false });

test('kind: drugs, flowers, plushies are fast; weapons slow; thin listings slow; the rest normal', () => {
    assert.equal(liquidityKind({ type: 'Drug' }), 'fast');
    assert.equal(liquidityKind({ type: 'Plushie' }), 'fast');
    assert.equal(liquidityKind({ type: 'Melee', statItem: true }), 'slow');
    // Hand Drill, 2026-09-27: one or two per bazaar - ten take more than five bazaars.
    const thin = Array.from({ length: 9 }, (_, i) => s(450 + i, 1));
    assert.equal(liquidityKind({ type: 'Tool', sellers: thin }), 'slow');
    assert.equal(liquidityKind({ type: 'Tool', sellers: [s(450, 30)] }), 'normal');
    assert.equal(stopsFor([s(1, 4), s(2, 4), s(3, 4)], 10), 3);
    assert.equal(stopsFor([s(1, 4)], 10), null);
});

test('kind: what was seen moving beats the type; hours with nothing moving is slow', () => {
    const quick = addMovement(null, 30, MOVE_MIN_MS);
    assert.equal(liquidityKind({ type: 'Tool', move: quick }), 'fast', '60 an hour');
    const still = addMovement(null, 0, MOVE_STILL_MS);
    assert.equal(liquidityKind({ type: 'Drug', move: still }), 'slow', 'two hours, none moved');
    const brief = addMovement(null, 0, MOVE_MIN_MS);
    assert.equal(liquidityKind({ type: 'Drug', move: brief }), 'fast', 'a quiet half hour says little');
    assert.equal(perHour(addMovement(null, 5, 10 * 60 * 1000)), null, 'too short to trust');
});

test('units moved: drops and listings gone, never ones past a capped read', () => {
    const before = [s(100, 10, 'A'), s(110, 5, 'B'), s(500, 3, 'C')];
    const after = [s(100, 4, 'A'), s(120, 5, 'B')];
    assert.equal(unitsMoved(before, after, false), 6 + 3, 'A sold 6, C went; B re-priced is not a sale');
    assert.equal(unitsMoved(before, after, true), 6, 'C was past the end of a capped read');
});

test('extra bazaars: two at least, more when the item itself takes several, four at most', () => {
    assert.equal(extraStopBudget(0), 2);
    assert.equal(extraStopBudget(1), 2);
    assert.equal(extraStopBudget(4), 3);
    assert.equal(extraStopBudget(20), 4);
});

// The owner's Stealth Virus trade: the virus, then nine small extras.
const KINDS = { V: 'normal', F: 'fast', G: 'fast', H: 'slow', P: 'fast', Q: 'fast', R: 'fast' };
const kindOf = (id) => KINDS[id] || 'normal';
const TRADE = [
    { itemId: 'V', bid: 1157499, sellers: [s(800000, 1, 'Twinkie'), s(830000, 50, 'Woog')] },
    { itemId: 'F', bid: 2600, sellers: [s(2400, 500, 'Woog'), s(2400, 500, 'Far1')] }, // sold where you go anyway
    { itemId: 'H', bid: 900, sellers: Array.from({ length: 60 }, (_, i) => s(450 + i, 1, 'D' + i)) }, // hand drills
    { itemId: 'P', bid: 50000, sellers: [s(48000, 30, 'P1')] },
    { itemId: 'Q', bid: 14000, sellers: [s(13000, 40, 'Q1')] },
    { itemId: 'R', bid: 5000, sellers: [s(4800, 40, 'R1')] },
    { itemId: 'G', bid: 40000, sellers: [s(37000, 20, 'Twinkie')] }, // also at a bazaar on the route
];

test('smart extras: the route first, then one new bazaar each, fast items first; never 100 hand drills', () => {
    const t = planTrade({ first: 'V', flips: TRADE, maxPerItem: 100, kindOf });
    const by = new Map(t.flips.map((r) => [r.itemId, r]));
    assert.equal(by.get('V').units, 51, 'the main flip as before');
    assert.equal(t.main, 'V');
    assert.equal(by.get('F').steps.length, 1, 'one bazaar for this extra');
    assert.equal(by.get('F').steps[0].sellerId, 'Woog', 'from a bazaar you visit anyway');
    assert.equal(by.get('F').steps[0].along, true);
    assert.ok(by.get('G').units > 0, 'also on the route');
    assert.equal(by.has('H'), false, 'slow items only where you go anyway');
    // Two bazaars for the virus; five extras (the soft cap): two on the route, three one bazaar each.
    assert.equal(t.mainStops, 2);
    assert.equal(t.flips.length, 6);
    assert.equal(t.stops, 5);
    assert.deepEqual(t.left.map((r) => r.itemId), ['H'], 'the rest said, not planned');
    assert.equal(t.more, 1);
    assert.equal(t.minutes, 3);
});

test('smart extras: normal items at most 10, slow at most 3, yours too - unless you typed a number', () => {
    const flips = [
        { itemId: 'V', bid: 2000, sellers: [s(50, 5, 'A')] }, // the main flip: it makes the most
        { itemId: 'N', bid: 100, sellers: [s(50, 500, 'A')] },
        { itemId: 'H', bid: 100, sellers: [s(50, 500, 'A')] },
    ];
    const kinds = (id) => ({ N: 'normal', H: 'slow' })[id] || 'fast';
    let t = planTrade({ first: 'V', flips, kindOf: kinds });
    assert.equal(t.flips.find((r) => r.itemId === 'N').units, 10);
    assert.equal(t.flips.find((r) => r.itemId === 'H').units, 3);
    t = planTrade({ first: 'V', flips, kindOf: kinds, edits: { N: { qty: 40 } } });
    assert.equal(t.flips.find((r) => r.itemId === 'N').units, 40, 'a number you typed wins');
    // 150,000 Hammers (the test page, 2026-09-28): a trade takes 3.
    const held = [{ itemId: 'Hm', bid: 118, held: 150000 }];
    t = planTrade({ first: 'V', flips, held, kindOf: (id) => (id === 'Hm' ? 'slow' : kinds(id)) });
    assert.equal(t.held[0].units, 3);
    t = planTrade({ first: 'V', flips, held, kindOf: (id) => (id === 'Hm' ? 'slow' : kinds(id)), edits: { 'held:Hm': { qty: 500 } } });
    assert.equal(t.held[0].units, 500);
});

test('never a listing in the trader\'s own bazaar', () => {
    const flips = [{ itemId: 'V', bid: 100, sellers: [s(50, 5, '777'), s(60, 5, 'A')] }];
    const t = planTrade({ first: 'V', flips, traderId: 777 });
    assert.deepEqual(t.flips[0].steps.map((st) => st.sellerId), ['A']);
});

const CHOSEN = {
    key: 'id:11',
    buyer: { id: '11', name: 'Bob', price: 18000 },
    flips: [{ itemId: '335', name: 'Stick of Dynamite', units: 50, bid: 18000, profit: 25000, steps: [{ sellerId: '2', sellerName: 'Y', qty: 50, price: 17500 }] }],
    held: [{ itemId: '1', name: 'Hammer', units: 3, bid: 110 }],
};

test('what they did not take: out of the totals, kept at its cost for Traded - done', () => {
    let t = acceptTrade(CHOSEN, '335', 1000);
    t = recordBuy(t, 'flip:335', 0, 50);
    t = markLeft(t, 'flip:335', 20);
    const line = t.items.find((i) => i.line === 'flip:335');
    assert.equal(takenUnits(line), 30);
    const tot = acceptedTotals(t);
    assert.equal(tot.pays, 30 * 18000 + 3 * 110);
    assert.equal(tot.cost, 50 * 17500, 'you still bought 50');
    assert.equal(tot.profit, 30 * 500, 'profit on what they took; the 20 are still yours');
    assert.deepEqual(leftoversOf(t, 5000), [{ itemId: '335', name: 'Stick of Dynamite', qty: 20, each: 17500, from: 'Bob', at: 5000 }]);
    assert.equal(markLeft(t, 'flip:335', 999).items[0].left, 50, 'never more than you send');
    // Two trades leave the same item: one row, the cost averaged.
    const both = addLeftovers([{ itemId: '335', name: 'x', qty: 20, each: 17500, at: 1 }], [{ itemId: '335', name: 'x', qty: 20, each: 17700, at: 2 }]);
    assert.equal(both.length, 1);
    assert.equal(both[0].qty, 40);
    assert.equal(both[0].each, 17600);
});

test('receipts: one per trade, each item, what it cost and made', () => {
    const rows = [
        { id: 'b1:0', t: 1, itemId: '335', qty: 50, each: 17500, side: 'buy', venue: 'bazaar', who: '2', whoName: 'Y', fee: 0 },
        { id: 'trade:77:out:0', t: 2, itemId: '335', qty: 30, each: 18000, side: 'sell', venue: 'trade', who: '11', whoName: 'Bob', fee: 0 },
        { id: 'trade:77:out:1', t: 2, itemId: '1', qty: 3, each: 110, side: 'sell', venue: 'trade', who: '11', whoName: 'Bob', fee: 0 },
    ];
    const r = tradeReceipts(rows, matchFifo(rows));
    assert.equal(r.length, 1);
    assert.equal(r[0].whoName, 'Bob');
    assert.equal(r[0].gave.length, 2);
    assert.equal(r[0].received, 30 * 18000 + 330);
    assert.equal(r[0].gave[0].profit, 30 * 500);
    assert.equal(r[0].unknownQty, 3, 'hammers bought before the Ledger: not in the profit');
});

/* The Fable review of 3.13 (bugs pass): each fix pinned. */

test('review: one read cannot say a whole market sold out; any spelling of a fast type', () => {
    const before = [s(100, 200, 'A'), s(110, 300, 'B')];
    assert.equal(unitsMoved(before, [], false), 125, 'an empty read: a quarter at most, not 500');
    assert.equal(liquidityKind({ type: 'Drugs' }), 'fast');
    assert.equal(liquidityKind({ type: 'energy drink' }), 'fast');
});

test('review: an ≈ line (no seller read yet) is not frozen into the accepted trade', () => {
    const chosen = {
        key: 'id:1',
        buyer: { id: '1', name: 'Z' },
        flips: [
            { itemId: 'A', name: 'A', units: 5, bid: 110, profit: 50, steps: [{ sellerId: '9', qty: 5, price: 100 }] },
            { itemId: 'E', name: 'E', units: 1, bid: 110, profit: 10, steps: [{ sellerId: null, qty: 1, price: 100 }] },
        ],
        held: [],
    };
    const t = acceptTrade(chosen, 'A', 1);
    assert.deepEqual(t.items.map((i) => i.itemId), ['A']);
    assert.equal(t.pays, 550);
    assert.equal(t.profit, 50);
});

test('review: ticking Bought after a partial count sends the planned amount', async () => {
    const { tickAccepted, sendUnits } = await import('../src/core/accepted.js');
    let t = acceptTrade(CHOSEN, '335', 1000);
    t = recordBuy(t, 'flip:335', 0, 20);
    assert.equal(sendUnits(t.items[0]), 20);
    t = tickAccepted(t, 'flip:335', { step: 0, bought: true });
    assert.equal(sendUnits(t.items[0]), 50);
});

test('review: leftovers a trader refused come off what they are offered, not off what you hold', () => {
    const flips = [{ itemId: 'V', bid: 100, sellers: [s(50, 5, 'A')] }];
    const t = planTrade({ first: 'V', flips, held: [{ itemId: 'D', bid: 18000, held: 8, refused: 3 }] });
    assert.equal(t.held[0].held, 8);
    assert.equal(t.held[0].units, 5);
});
