// 3.28.0 - how many of an item a trade takes, by how fast it really moves (core/liquidity.js amountCap), and the
// three rules that keep it from costing a flip (the owner, 2026-10-12: "im just scared we find 0 deals now").

import test from 'node:test';
import assert from 'node:assert/strict';
import { measuredRate, amountCap, liquidityKind, EXTRA_CAP, AMOUNT_HOURS, FAST_PER_HOUR, MOVE_MIN_MS } from '../src/core/liquidity.js';
import { flipPlan, bazaarSellers } from '../src/core/flips.js';
import { planTrade } from '../src/core/trade.js';
import { keptPlanSig } from '../src/core/kept.js';
import { pastTook } from '../src/core/past-trades.js';
import { sharedMovesIn, sharedBody, sharedOutgoingOk, SHARED_MAX_MOVES } from '../src/core/shared.js';

const HOUR = 3600000;
const NOW = Date.UTC(2026, 9, 12, 12);
const rowsOf = (list) => list.map(([sellerId, price, qty]) => ({ sellerId: String(sellerId), sellerName: 'S' + sellerId, price, qty, stale: false, dataAt: NOW }));

test('a rate exists only where the shared server measured the item; this PC\'s own count can raise it, never lower it, never make one', () => {
    assert.equal(measuredRate(null), null);
    assert.equal(measuredRate(undefined, { units: 500, ms: 2 * HOUR }), null, 'a PC on its own was given a rate');
    assert.equal(measuredRate(NaN), null);
    assert.equal(measuredRate(-1), null);
    assert.equal(measuredRate(0), 0);
    assert.equal(measuredRate(12.5), 12.5);
    assert.equal(measuredRate(12.5, { units: 80, ms: 2 * HOUR }), 40);
    assert.equal(measuredRate(12.5, { units: 2, ms: 2 * HOUR }), 12.5);
    // This PC's count is not trusted before half an hour of it.
    assert.equal(measuredRate(3, { units: 100, ms: MOVE_MIN_MS - 1 }), 3);
});

test('not measured: every amount is what it always was - the main flip up to Most per flip, an extra by its kind', () => {
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: null }), 100);
    assert.equal(amountCap({ most: 40, kind: 'slow', rate: null }), 40);
    assert.equal(amountCap({ most: 100, kind: 'fast', rate: null, extra: true }), 100);
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: null, extra: true }), EXTRA_CAP.normal);
    assert.equal(amountCap({ most: 100, kind: 'slow', rate: null, extra: true }), EXTRA_CAP.slow);
    assert.equal(amountCap({ most: 2, kind: 'normal', rate: null, extra: true }), 2);
});

test('measured: no more than about an hour of what moves, the main flip and the extras alike - never under one, never over Most per flip', () => {
    assert.equal(AMOUNT_HOURS, 1);
    // His two examples: a Thimble that moves 2 an hour is not planned x10; cans that move 500 an hour are x100.
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: 2, extra: true }), 2);
    assert.equal(amountCap({ most: 100, kind: 'fast', rate: 500, extra: true }), 100);
    assert.equal(amountCap({ most: 100, kind: 'fast', rate: 500 }), 100);
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: 12.3 }), 13);
    assert.equal(amountCap({ most: 100, kind: 'slow', rate: 0 }), 1, 'an item that stands still was planned at none');
    assert.equal(amountCap({ most: 100, kind: 'slow', rate: 0.2, extra: true }), 1);
    assert.equal(amountCap({ most: 5, kind: 'fast', rate: 60 }), 5);
    // A normal item that moves well is no longer held to ten as an extra; one of a kind is still only a few as cover.
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: 30, extra: true }), 30);
    assert.equal(amountCap({ most: 100, kind: 'slow', rate: 30, extra: true }), EXTRA_CAP.slow);
});

test('what a trader took from you before is believed over the count: never fewer than that, never over Most per flip', () => {
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: 2, took: 25 }), 25);
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: 40, took: 25 }), 40);
    assert.equal(amountCap({ most: 20, kind: 'normal', rate: 2, took: 25 }), 20);
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: null, extra: true, took: 25 }), 25);
    assert.equal(amountCap({ most: 100, kind: 'normal', rate: null, extra: true, took: 3 }), EXTRA_CAP.normal);
});

test('the kind: where the item was measured that decides, not its type; not measured, the type as before', () => {
    assert.equal(liquidityKind({ type: 'Flower', rate: 3 }), 'normal', 'a flower that moves 3 an hour was still "sells fast"');
    assert.equal(liquidityKind({ type: 'Flower', rate: FAST_PER_HOUR }), 'fast');
    assert.equal(liquidityKind({ type: 'Tool', rate: 55 }), 'fast');
    assert.equal(liquidityKind({ type: 'Drug', rate: 0.4 }), 'slow');
    assert.equal(liquidityKind({ type: 'Melee', statItem: true, rate: 80 }), 'slow');
    assert.equal(liquidityKind({ type: 'Flower', rate: null }), 'fast');
    assert.equal(liquidityKind({ type: 'Tool' }), 'normal');
});

// A small generator with a fixed seed: the same hundreds of markets every run.
function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

test('no flip is lost: whatever the measured rate, an item the old rule made a flip of is still one, with at least one unit and a profit', () => {
    const rnd = seeded(20261012);
    let flips = 0;
    let smaller = 0;
    for (let i = 0; i < 600; i += 1) {
        const bid = 1000 + Math.floor(rnd() * 900000);
        const listings = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, k) => [100 + k, Math.max(2, Math.floor(bid * (0.7 + rnd() * 0.5))), 1 + Math.floor(rnd() * 150)]);
        const rows = rowsOf(listings).sort((a, b) => a.price - b.price);
        const cash = rnd() < 0.3 ? Math.floor(bid * (0.5 + rnd() * 40)) : null;
        const most = [5, 25, 100][Math.floor(rnd() * 3)];
        const minPct = [0, 1, 3][Math.floor(rnd() * 3)];
        const was = flipPlan(rows, bid, { cash, maxUnits: amountCap({ most, rate: null }), minPct });
        for (const rate of [0, 0.3, 1, 2.5, 17, 400]) {
            const cap = amountCap({ most, kind: liquidityKind({ type: 'Tool', rate }), rate });
            const is = flipPlan(rows, bid, { cash, maxUnits: cap, minPct });
            assert.equal(is === null, was === null, `item ${i}: a flip appeared or went with the rate ${rate}`);
            if (!was || !(was.units > 0)) {
                if (was) assert.equal(is.units, 0);
                continue;
            }
            flips += 1;
            assert.ok(is.units >= 1, `item ${i} at ${rate} an hour: ${was.units} units before, ${is.units} now`);
            assert.ok(is.units <= cap && is.units <= was.units);
            assert.ok(is.profit > 0);
            // Fewer units are the cheaper ones: each makes at least what each made before.
            assert.ok(is.profit / is.units >= was.profit / was.units - 1e-6, `item ${i}: the smaller plan makes less on each`);
            if (is.units < was.units) smaller += 1;
        }
    }
    assert.ok(flips > 1000 && smaller > 300, `${flips} flips checked, ${smaller} of them planned smaller`);
});

const trade = (over = {}) => planTrade({
    first: '1',
    flips: [
        { itemId: '1', bid: 1000, sellers: rowsOf([[11, 800, 200]]) },
        { itemId: '2', bid: 500, sellers: rowsOf([[11, 400, 200]]) },
        { itemId: '3', bid: 300, sellers: rowsOf([[12, 200, 200]]) },
    ],
    maxPerItem: 100,
    kindOf: () => 'normal',
    ...over,
});

test('a trade: the main flip and its extras take what moves in an hour; a number you typed is yours; with no rule given it is the old trade', () => {
    const old = trade();
    assert.deepEqual(old.flips.map((r) => [r.itemId, r.units]), [['1', 100], ['2', 10], ['3', 10]]);
    // The same limits handed in as a rule: the very same trade.
    const same = trade({ capOf: (id, extra) => amountCap({ most: 100, kind: 'normal', rate: null, extra }) });
    assert.deepEqual(same.flips, old.flips);
    assert.equal(same.profit, old.profit);

    const rates = { 1: 6, 2: 40, 3: 0 };
    const paced = trade({ capOf: (id, extra) => amountCap({ most: 100, kind: 'normal', rate: rates[id], extra }) });
    assert.deepEqual(paced.flips.map((r) => [r.itemId, r.units]), [['2', 40], ['1', 6], ['3', 1]], 'the main flip is the one that makes most at what really moves');
    assert.equal(paced.main, '2');
    assert.ok(paced.flips.every((r) => r.units >= 1));

    const typed = trade({ capOf: () => 1, edits: { 1: { qty: 70 } } });
    assert.equal(typed.flips.find((r) => r.itemId === '1').units, 70);
    // A rule that answers nonsense is not followed into an empty trade.
    const odd = trade({ capOf: () => 0 });
    assert.deepEqual(odd.flips.map((r) => [r.itemId, r.units]), [['1', 100], ['2', 10], ['3', 10]]);
});

test('a kept flip plan is worked out again when the amount a trade takes changes', () => {
    const rows = rowsOf([[11, 800, 50]]);
    const prefs = { maxPerFlip: 100, cash: 0, minProfitPct: 1 };
    const buyers = [{ id: '7', name: 'T', price: 1000, maxUnits: null }];
    const a = keptPlanSig(rows, prefs, buyers, () => false, () => 100);
    const b = keptPlanSig(rows, prefs, buyers, () => false, () => 6);
    assert.notDeepEqual(a, b);
    assert.deepEqual(keptPlanSig(rows, prefs, buyers, () => false, () => 6), b);
});

test('what a trader took before: the most of an item in one trade that went through, less what stayed with you; a cancelled trade says nothing', () => {
    const rec = (key, at, how, bought) => ({ key, at, lines: [], end: how ? { how, bought } : null });
    const took = pastTook([
        rec('id:7', 1000, 'traded', [{ itemId: '206', kind: 'flip', got: 30, kept: 5 }, { itemId: '206', kind: 'extra', got: 4, kept: 0 }, { itemId: '180', kind: 'flip', got: 10, kept: 10 }]),
        rec('id:7', 2000, 'traded', [{ itemId: '206', kind: 'flip', got: 12, kept: 0 }]),
        rec('id:7', 3000, 'cancel', [{ itemId: '206', kind: 'flip', got: 90, kept: 0 }]),
        rec('id:8', 4000, null, []),
        rec('name:bob', 5000, 'traded', [{ itemId: '1', kind: 'yours', got: 3, kept: 0 }]),
    ]);
    assert.deepEqual([...took].sort(), [['id:7|206', 29], ['name:bob|1', 3]]);
    assert.equal(pastTook(null).size, 0);
});

test('the server\'s table as it is taken: numbers only, checked; the one number that leaves this PC for it', () => {
    assert.equal(sharedMovesIn({}), null);
    assert.equal(sharedMovesIn({ moves: { at: 0, rows: [] } }), null);
    assert.equal(sharedMovesIn({ moves: { at: 5, rows: 'x' } }), null);
    assert.deepEqual(sharedMovesIn({ moves: { at: 1760000000000, rows: [] } }), { at: 1760000000000, rows: {} });
    const got = sharedMovesIn({ moves: { at: 1760000000000, rows: [[206, 41.5], ['180', 0], [0, 3], [5, -1], [6, 'x'], [7, Infinity], [8], 'x', [9, 2, 3], [206, 44]] } });
    assert.deepEqual(got, { at: 1760000000000, rows: { 206: 44, 180: 0 } });
    const many = sharedMovesIn({ moves: { at: 7, rows: Array.from({ length: SHARED_MAX_MOVES + 50 }, (_, i) => [i + 1, 1]) } });
    assert.equal(Object.keys(many.rows).length, SHARED_MAX_MOVES);

    assert.equal(sharedBody({}).moves, undefined);
    assert.equal(sharedBody({ moves: 0 }).moves, 0);
    assert.equal(sharedBody({ moves: 1760000000000 }).moves, 1760000000000);
    assert.equal(sharedBody({ moves: -4 }).moves, undefined);
    assert.equal(sharedBody({ moves: 'x' }).moves, undefined);
    assert.ok(sharedOutgoingOk(sharedBody({ moves: 1760000000000 })));
    assert.equal(sharedOutgoingOk({ ...sharedBody({}), moves: 'everything' }), false);
    assert.equal(typeof bazaarSellers, 'function');
});
