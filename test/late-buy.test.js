/*
 * 3.21.1 (the owner, 2026-10-03: "i accidentally clicked next bazaar. i went
 * back ... i bought it it wasnt in checkout and i couldnt find it in my cart
 * so i didnt sell"; and "the extra items i bought even though its not part of
 * a trade? just most recent?").
 *
 * - A buy at a bazaar whose step Next had already passed fills that step
 *   (core/accepted.js recordLateBuy): Checkout, the cart and Fill see it.
 * - Every bazaar buy no trade takes is To sell; of the ones still waiting for
 *   a price, the newest few are listed (core/to-sell.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptTrade, recordBuy, recordLateBuy, checkoutList, boughtSince, sendUnits, sendList, applyLogBuys } from '../src/core/accepted.js';
import { toSellRows, TO_SELL_EXTRA_WAITING } from '../src/core/to-sell.js';

const NOW = 1_790_000_000_000;
const chosen = {
    key: 'id:11',
    buyer: { id: '11', name: 'Bob' },
    flips: [
        { itemId: '206', name: 'Xanax', bid: 850000, steps: [{ sellerId: '5', sellerName: 'BigSeller', qty: 2, price: 840000 }, { sellerId: '4242', sellerName: 'Other', qty: 1, price: 841000 }] },
        { itemId: '335', name: 'Stick of Dynamite', bid: 18000, steps: [{ sellerId: '5', sellerName: 'BigSeller', qty: 50, price: 17500 }] },
    ],
    held: [],
};

test('Next pressed by mistake, then bought after going back: the step is bought, in the cart and in what you send', () => {
    let t = acceptTrade(chosen, '206', NOW);
    // Next with nothing taken: the step is skipped.
    t = recordBuy(t, 'flip:206', 0, 0, NOW + 1000);
    assert.equal(checkoutList(t).lines[0].state, 'skipped');
    assert.equal(boughtSince(t).rows.length, 0);
    // Back at that bazaar, both bought.
    const late = recordLateBuy(t, '5', '206', 2, 840000, NOW + 60000);
    assert.equal(late.rest, 0);
    const st = late.trade.items[0].steps[0];
    assert.deepEqual([st.bought, st.skipped, st.boughtQty, st.boughtAt], [true, false, 2, NOW + 60000]);
    assert.deepEqual(checkoutList(late.trade).lines.map((l) => [l.state, l.bought]), [['done', 2], ['todo', 0], ['todo', 0]]);
    assert.deepEqual(boughtSince(late.trade).rows.map((r) => [r.name, r.qty, r.send]), [['Xanax', 2, 2]]);
    assert.equal(sendUnits(late.trade.items[0]), 2);
    assert.deepEqual(sendList(late.trade).send, [{ itemId: '206', name: 'Xanax', qty: 2 }]);
    // The other seller's step, and the other item at this bazaar, are untouched.
    assert.equal(late.trade.items[0].steps[1], t.items[0].steps[1]);
    assert.equal(late.trade.items[1], t.items[1]);
});

test('a late buy: a step bought short is topped up at what you paid; more than planned is handed back; a step still to buy is not touched', () => {
    let t = acceptTrade(chosen, '206', NOW);
    t = recordBuy(t, 'flip:335', 0, 20, NOW + 1000);
    // 40 more at a dearer price: 30 fill the step (20 at 17,500 + 30 at 17,800), 10 are over the plan.
    const late = recordLateBuy(t, '5', '335', 40, 17800, NOW + 2000);
    assert.equal(late.rest, 10);
    const st = late.trade.items[1].steps[0];
    assert.deepEqual([st.bought, st.boughtQty, st.price, st.planned], [true, 50, (20 * 17500 + 30 * 17800) / 50, 17500]);
    // Full already: all of it is over the plan, the trade itself unchanged.
    const again = recordLateBuy(late.trade, '5', '335', 3, 17800, NOW + 3000);
    assert.equal(again.rest, 3);
    assert.equal(again.trade, late.trade);
    // A step not been through yet is the buying run's to count: never here.
    const open = recordLateBuy(t, '5', '206', 2, 840000, NOW + 2000);
    assert.equal(open.rest, 2);
    assert.equal(open.trade, t);
    // Another bazaar, another item, nothing bought: nothing.
    assert.equal(recordLateBuy(t, '999', '335', 5, 17800).trade, t);
    assert.equal(recordLateBuy(t, '5', '1', 5, 100).trade, t);
    assert.deepEqual(recordLateBuy(t, '5', '335', 0, 17800), { trade: t, rest: 0 });
    assert.deepEqual(recordLateBuy(null, '5', '335', 2, 17800), { trade: null, rest: 2 });
});

test('a late buy and your log agree: the log says the same buy, and takes it back when it has none', () => {
    let t = acceptTrade(chosen, '206', NOW);
    t = recordBuy(t, 'flip:206', 0, 0, NOW + 1000);
    const late = recordLateBuy(t, '5', '206', 2, 840000, NOW + 60000).trade;
    const withLog = applyLogBuys(late, [{ id: 'a', t: NOW + 59000, itemId: '206', qty: 2, each: 840000, sellerId: '5' }], { readTo: NOW + 120000 });
    assert.deepEqual([withLog.items[0].steps[0].bought, withLog.items[0].steps[0].boughtQty], [true, 2]);
    assert.equal((withLog.extra || []).length, 0);
    // A log read through past that moment with no such buy: it was not yours.
    const none = applyLogBuys(late, [], { readTo: NOW + 120000 });
    assert.deepEqual([none.items[0].steps[0].bought, none.items[0].steps[0].skipped], [false, true]);
});

test('To sell: every extra buy a trader pays enough for is listed; of the ones waiting, only the newest few', () => {
    const buyersOf = (id) => (id === '900' ? [{ id: '7', name: 'Lumei', price: 500, trust: null }] : id === '901' ? [{ id: '7', name: 'Lumei', price: 90, trust: null }] : []);
    const extras = [];
    for (let i = 0; i < TO_SELL_EXTRA_WAITING + 5; i++) extras.push({ itemId: String(1000 + i), name: 'Thing ' + i, qty: 1, each: 100, from: null, at: NOW + i, why: 'extra' });
    const list = [
        ...extras,
        // Older than all of them, and a trader pays more: always listed.
        { itemId: '900', name: 'Old but wanted', qty: 2, each: 100, from: null, at: NOW - 999, why: 'extra' },
        // Older, waiting, but from a trade: never cut.
        { itemId: '901', name: 'Cancelled', qty: 2, each: 100, from: 'Bob', at: NOW - 999, why: 'cancel' },
    ];
    const rows = toSellRows(list, { buyersOf });
    const ids = rows.map((r) => r.itemId);
    assert.equal(rows.length, TO_SELL_EXTRA_WAITING + 2);
    assert.ok(ids.includes('900') && ids.includes('901'));
    // The five oldest waiting extras are the ones left out.
    for (let i = 0; i < 5; i++) assert.ok(!ids.includes(String(1000 + i)), 'oldest ' + i);
    for (let i = 5; i < TO_SELL_EXTRA_WAITING + 5; i++) assert.ok(ids.includes(String(1000 + i)), 'newest ' + i);
    assert.equal(rows[0].itemId, '900');
    // Fewer than the limit: all of them.
    assert.equal(toSellRows(extras.slice(0, 3), { buyersOf }).length, 3);
});
