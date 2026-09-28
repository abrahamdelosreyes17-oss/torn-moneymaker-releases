/*
 * 3.14.3: Bought since you accepted - its own window while a trade is
 * accepted, and a checklist on Torn's trade page (core/accepted.js boughtSince).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { boughtSince, recordBuy } from '../src/core/accepted.js';

const trade = () => ({
    key: 'id:5001',
    trader: { id: '5001', name: 'KayMalta' },
    at: 1000,
    items: [
        { line: 'flip:870', itemId: '870', name: 'Stealth Virus', units: 6, bid: 1000, kind: 'flip', steps: [{ sellerId: '1', sellerName: 'Havean', qty: 4, price: 800, bought: false }, { sellerId: '2', sellerName: 'Baecon', qty: 2, price: 900, bought: false }] },
        { line: 'flip:206', itemId: '206', name: 'Xanax', units: 3, bid: 500, kind: 'flip', steps: [{ sellerId: '3', sellerName: 'Kingpigg3344', qty: 3, price: 400, bought: false }] },
    ],
});

test('what you bought for the trade, in the order you bought it, with cost, what they pay and what is left', () => {
    let t = recordBuy(trade(), 'flip:206', 0, 3, 2000);
    t = recordBuy(t, 'flip:870', 0, 4, 3000);
    const b = boughtSince(t);
    assert.deepEqual(b.rows.map((r) => [r.name, r.qty, r.at]), [['Xanax', 3, 2000], ['Stealth Virus', 4, 3000]]);
    assert.equal(b.toBuy, 1, 'one step still to buy');
    assert.deepEqual(b.totals, { cost: 3 * 400 + 4 * 800, pays: 3 * 500 + 4 * 1000, profit: 3 * 100 + 4 * 200 });
    assert.deepEqual(b.missing, [], 'off the trade page: no checklist');
    // A skipped step is not bought.
    assert.equal(boughtSince(recordBuy(trade(), 'flip:206', 0, 0)).rows.length, 0);
});

test('the trade page checklist: ticks what is in the trade, names what is missing', () => {
    let t = recordBuy(trade(), 'flip:206', 0, 3, 2000);
    t = recordBuy(t, 'flip:870', 0, 4, 3000);
    const half = boughtSince(t, { inside: new Map([['xanax', 3]]) });
    assert.deepEqual(half.rows.map((r) => [r.name, r.inTrade, r.send]), [['Xanax', 3, 3], ['Stealth Virus', 0, 4]]);
    assert.deepEqual(half.missing, [{ name: 'Stealth Virus', qty: 4 }]);
    assert.equal(half.done, false);
    const all = boughtSince(t, { inside: new Map([['xanax', 3], ['stealth virus', 4]]) });
    assert.equal(all.done, true);
    assert.deepEqual(all.missing, []);
});

test('unplanned buys: only what the trader buys; orange while profitable, red at a loss', () => {
    const t = { ...trade(), extra: [
        { itemId: '1', name: 'Hammer', qty: 2, price: 50, bid: 70, at: 5 },
        { itemId: '2', name: 'Dahlia', qty: 1, price: 900, bid: 800, at: 6 },
        { itemId: '3', name: 'Parcel', qty: 1, price: 10, bid: 0, at: 7 },
    ] };
    const b = boughtSince(t);
    assert.deepEqual(b.rows.map((r) => [r.name, r.tone]), [['Hammer', 'extra'], ['Dahlia', 'loss']], 'Parcel: they do not buy it, left off');
    assert.deepEqual(b.rows.map((r) => r.each), [50, 900], 'each at what you paid');
});

import { clampWindowPos } from '../src/ui/bought-window.js';

test('the Bought window goes anywhere on the page, but its title bar never leaves the view', () => {
    const v = { width: 300, height: 400, viewW: 1400, viewH: 900 };
    assert.deepEqual(clampWindowPos(260, 388, v), { x: 260, y: 388 }, 'over Torn\'s page: allowed (the owner moves it)');
    assert.deepEqual(clampWindowPos(-50, -20, v), { x: 0, y: 0 });
    assert.deepEqual(clampWindowPos(1300, 895, v), { x: 1100, y: 868 }, 'always a title bar to grab');
});

import { stockBuys, addExtraBuy } from '../src/core/accepted.js';

test('unplanned buys are counted from the page the way planned ones are: a card\'s stock dropping', () => {
    const card = (itemId, name, price, qty, extra = {}) => ({ itemId, name, listingPrice: price, qty, ...extra });
    let r = stockBuys({}, [card('1', 'Hammer', 50, 10), card('2', 'Dahlia', 900, 3)]);
    assert.deepEqual(r.bought, [], 'the first read only notes the stock');
    r = stockBuys(r.seen, [card('1', 'Hammer', 50, 7), card('2', 'Dahlia', 900, 3)]);
    assert.deepEqual(r.bought, [{ itemId: '1', name: 'Hammer', price: 50, qty: 3 }], 'Hammer 10 -> 7: you took 3');
    // Gone: only counted when you pressed a button on that card.
    const gone = stockBuys(r.seen, [card('1', 'Hammer', 50, 7)]);
    assert.deepEqual(gone.bought, [], 'Dahlia gone, nothing pressed: someone else - not counted');
    const pressed = stockBuys(r.seen, [card('1', 'Hammer', 50, 7)], new Set(['2|900']));
    assert.deepEqual(pressed.bought, [{ itemId: '2', name: 'Dahlia', price: 900, qty: 3 }]);
    // A card whose stock the page does not say is never counted.
    const unknown = stockBuys({ '3|10': { qty: 1, itemId: '3', price: 10, name: 'X' } }, [card('3', 'X', 10, 1, { qtyAssumed: true })]);
    assert.deepEqual(unknown.bought, []);
});

test('an unplanned buy joins the trade, merged with the same item and seller', () => {
    let t = addExtraBuy({ key: 'k', extra: [] }, { itemId: '1', name: 'Hammer', price: 50, qty: 3, bid: 70, sellerId: '9' }, 10);
    t = addExtraBuy(t, { itemId: '1', name: 'Hammer', price: 50, qty: 2, bid: 70, sellerId: '9' }, 20);
    assert.deepEqual(t.extra.map((x) => [x.name, x.qty, x.at]), [['Hammer', 5, 20]]);
});
