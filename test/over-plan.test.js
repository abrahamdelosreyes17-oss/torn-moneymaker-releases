/*
 * 3.22.2: more bought from a planned listing than the plan asked. The friend,
 * 2026-10-04 (3.22.0): 508 Kitten Plushies in his items, the trade page
 * offering "Fill 28 for MrReeko" - "it misses some stuff that I add along the
 * line for the trader that are still profitable but not in the flip plan ...
 * include them also on Fill all". And his "2 errors today": TornExchange's
 * slow list of active traders, twice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { boughtFromStock, boughtOverStock, recordBuy, addExtraBuy, sendList, applyLogBuys, boughtSince } from '../src/core/accepted.js';
import { lateButHeld } from '../src/core/errlog.js';

const trade = () => ({
    key: 'id:9',
    trader: { id: '9', name: 'MrReeko' },
    itemId: '215',
    at: 1_000_000,
    items: [
        { line: 'flip:215', itemId: '215', name: 'Kitten Plushie', units: 28, bid: 601, kind: 'flip', sent: false, steps: [{ sellerId: '4', sellerName: 'Cat', qty: 28, price: 501, bought: false }] },
    ],
});

test('what left the listing over the step\'s number: counted from what this load of the page showed', () => {
    // 508 there, all bought: the step counts its 28, and 480 are over.
    assert.equal(boughtFromStock(508, 0, 28), 28);
    assert.equal(boughtOverStock(508, 28, 28), 452, 'stock dropped by 480: 452 over the 28');
    assert.equal(boughtOverStock(508, 480, 28), 0, 'exactly what was planned');
    assert.equal(boughtOverStock(508, 490, 28), 0, 'fewer than planned');
    assert.equal(boughtOverStock(508, 508, 28), 0, 'nothing bought');
    // The listing left the page: yours only when you had just pressed on it.
    assert.equal(boughtOverStock(508, null, 28, true), 480);
    assert.equal(boughtOverStock(508, null, 28, false), 0, 'gone with no press: someone else may have bought it out');
    assert.equal(boughtOverStock(null, null, 28, true), 0, 'never seen on this load: nothing counted');
    assert.equal(boughtOverStock(20, null, 28, true), 0, 'fewer there than planned');
});

test('the friend\'s Kitten Plushies: Fill offered 28 of the 508 bought; now all 508, before the log is read', () => {
    let t = recordBuy(trade(), 'flip:215', 0, 28, 1_100_000);
    assert.deepEqual(sendList(t).send, [{ itemId: '215', name: 'Kitten Plushie', qty: 28 }], 'as it was: the plan\'s number');
    t = addExtraBuy(t, { itemId: '215', name: 'Kitten Plushie', qty: 480, price: 501, bid: 601, sellerId: '4', seller: 'Cat' }, 1_100_000);
    const list = sendList(t);
    assert.deepEqual(list.send, [{ itemId: '215', name: 'Kitten Plushie', qty: 508 }]);
    assert.equal(list.pays, 508 * 601);
    assert.equal(boughtSince(t).totals.profit, 508 * (601 - 501));
});

test('your log read afterwards takes over: still 508, never counted twice', () => {
    let t = recordBuy(trade(), 'flip:215', 0, 28, 1_100_000);
    t = addExtraBuy(t, { itemId: '215', name: 'Kitten Plushie', qty: 480, price: 501, bid: 601, sellerId: '4', seller: 'Cat' }, 1_100_000);
    const log = [{ id: 'a:0', t: 1_099_000, itemId: '215', qty: 508, each: 501, sellerId: '4' }];
    const got = applyLogBuys(t, log, { readTo: 1_200_000 });
    assert.deepEqual(sendList(got).send, [{ itemId: '215', name: 'Kitten Plushie', qty: 508 }]);
    assert.deepEqual(got.extra.map((x) => [x.qty, Boolean(x.fromLog)]), [[480, true]], 'the page\'s count gave way to the log\'s');
    // The page counted 480 over, the log says only the 28 were yours (someone else took the rest): the log wins.
    const less = applyLogBuys(t, [{ id: 'a:0', t: 1_099_000, itemId: '215', qty: 28, each: 501, sellerId: '4' }], { readTo: 1_200_000 });
    assert.deepEqual(sendList(less).send, [{ itemId: '215', name: 'Kitten Plushie', qty: 28 }]);
});

test('TornExchange\'s slow list of active traders: a note while the last list is held, an error without one', () => {
    const late = { reason: 'no answer in 90 s' };
    assert.equal(lateButHeld('active_traders', late, true), true);
    assert.equal(lateButHeld('active_traders', late, false), false, 'nothing held: it is a failure');
    assert.equal(lateButHeld('active_traders', { reason: 'no connection' }, true), false);
    assert.equal(lateButHeld('active_traders', { http: 500 }, true), false);
    assert.equal(lateButHeld('all_best_listings', late, true), false, 'only the list that is slow by nature');
});
