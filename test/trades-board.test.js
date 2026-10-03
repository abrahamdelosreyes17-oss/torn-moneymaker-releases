/*
 * 3.22.0 (the owner, 2026-10-03).
 *
 * - "cant we have a tab with active trades going? i cant figure out which
 *   trades havent been accepted, and depending on that, it automatically sorts
 *   it to to sell?" - core/trades-board.js: what you asked about and wait on,
 *   what was accepted (still buying, ready to trade), what ended today.
 * - "if the prices are too stale ... do not show them in tornbids, it means
 *   they are not updating"; "2 days update is fine" - core/traders.js
 *   stalePrice / freshOnly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { liveAsked, addAsked, liveEnded, addEnded, endedOf, tradesBoard, ASKED_KEEP_MS, ENDED_KEEP_MS } from '../src/core/trades-board.js';
import { acceptTrade, recordBuy, cancelledLeftovers } from '../src/core/accepted.js';
import { tidyAsked, tidyEnded } from '../src/core/tidy.js';
import { stalePrice, freshOnly, hiddenBuyers, PRICES_STALE_MS } from '../src/core/traders.js';

const NOW = 1_790_000_000_000;
const MIN = 60 * 1000;
const chosen = (id, name, steps) => ({ key: 'id:' + id, buyer: { id: String(id), name }, flips: [{ itemId: '206', name: 'Xanax', bid: 850000, steps }], held: [] });

test('asked: Chat or Trade on a plan is written down for an hour; asked again keeps the first time and takes the new numbers', () => {
    let s = addAsked(null, { itemId: '206', key: 'id:7', id: '7', name: 'Lumei', items: 3, profit: 87420 }, NOW);
    assert.deepEqual(s, { '206|id:7': { itemId: '206', key: 'id:7', id: '7', name: 'Lumei', items: 3, profit: 87420, at: NOW } });
    s = addAsked(s, { itemId: '206', key: 'id:7', id: '7', name: 'Lumei', items: 4, profit: 90000 }, NOW + 10 * MIN);
    assert.deepEqual([s['206|id:7'].at, s['206|id:7'].items, s['206|id:7'].profit], [NOW, 4, 90000]);
    // The same trader on another item is another trade.
    s = addAsked(s, { itemId: '258', key: 'id:7', id: '7', name: 'Lumei', items: 1, profit: 500 }, NOW + 20 * MIN);
    assert.equal(Object.keys(s).length, 2);
    // An hour after it was asked it is no longer waiting.
    assert.deepEqual(Object.keys(liveAsked(s, NOW + ASKED_KEEP_MS + 1)), ['258|id:7']);
    assert.deepEqual(liveAsked('junk', NOW), {});
    assert.deepEqual(addAsked(s, { key: 'id:7' }, NOW + 21 * MIN), liveAsked(s, NOW + 21 * MIN));
    // The hourly tidy keeps exactly what a reader gets, and the same object when nothing goes.
    assert.equal(tidyAsked(s, NOW + 30 * MIN), s);
    assert.deepEqual(tidyAsked(s, NOW + ASKED_KEEP_MS + 1), liveAsked(s, NOW + ASKED_KEEP_MS + 1));
});

test('the board: waiting for a yes, accepted and buying, accepted and ready - newest first, never a declined or an accepted one as waiting', () => {
    let buying = acceptTrade(chosen(11, 'Bob', [{ sellerId: '5', sellerName: 'A', qty: 2, price: 840000 }, { sellerId: '6', sellerName: 'B', qty: 1, price: 841000 }]), '206', NOW - 6 * MIN);
    buying = recordBuy(buying, 'flip:206', 0, 2, NOW - 5 * MIN);
    let ready = acceptTrade(chosen(12, 'ELIZA_BITE', [{ sellerId: '5', sellerName: 'A', qty: 2, price: 840000 }]), '206', NOW - 22 * MIN);
    ready = recordBuy(ready, 'flip:206', 0, 2, NOW - 20 * MIN);
    const b = tradesBoard({
        asked: [
            { itemId: '206', key: 'id:7', id: '7', name: 'Lumei', items: 3, profit: 87420, at: NOW - 12 * MIN },
            { itemId: '258', key: 'id:9', id: '9', name: 'KayMalta', items: 1, profit: 31000, at: NOW - 41 * MIN },
            // Asked, then they said yes: it is the accepted trade, not a waiting one.
            { itemId: '206', key: 'id:11', id: '11', name: 'Bob', items: 5, profit: 1, at: NOW - 50 * MIN },
            // Asked, then marked declined.
            { itemId: '300', key: 'id:13', id: '13', name: 'No', items: 1, profit: 1, at: NOW - 5 * MIN },
        ],
        pins: [
            // Pinned and asked: one row, the pin's live numbers, since when you asked.
            { k: '206|id:7', itemId: '206', key: 'id:7', id: '7', name: 'Lumei', items: 4, profit: 90000, at: NOW - 3 * 60 * MIN },
            // Pinned only.
            { k: '618|id:14', itemId: '618', key: 'id:14', id: '14', name: 'Pinned', items: 2, profit: 700, at: NOW - 2 * 60 * MIN },
        ],
        accepted: [ready, buying],
        ended: [],
        declined: (itemId, key) => itemId === '300' && key === 'id:13',
    });
    assert.deepEqual(b.waiting.map((w) => [w.name, w.items, w.profit, w.at, w.pinned, w.asked]), [
        ['Lumei', 4, 90000, NOW - 12 * MIN, true, true],
        ['KayMalta', 1, 31000, NOW - 41 * MIN, false, true],
        ['Pinned', 2, 700, NOW - 2 * 60 * MIN, true, false],
    ]);
    // The profit is the accepted card's: on what is bought so far, once buying has started.
    assert.deepEqual(b.buying.map((r) => [r.name, r.bazaarsDone, r.bazaars, r.bought, r.profit]), [['Bob', 1, 2, true, 2 * 10000]]);
    assert.deepEqual(b.ready.map((r) => [r.name, r.bazaarsDone, r.bazaars, r.profit]), [['ELIZA_BITE', 1, 1, 20000]]);
    assert.equal(b.going, 5);
    assert.deepEqual(tradesBoard(), { waiting: [], buying: [], ready: [], ended: [], going: 0 });
});

test('ended: traded, cancelled and never made are kept a day, each trade once, with what went to To sell', () => {
    let t = acceptTrade(chosen(11, 'Bob', [{ sellerId: '5', sellerName: 'A', qty: 2, price: 840000 }]), '206', NOW);
    t = recordBuy(t, 'flip:206', 0, 2, NOW + MIN);
    const left = cancelledLeftovers(t, NOW + 2 * MIN);
    const cancel = endedOf(t, 'cancel', left, NOW + 2 * MIN);
    assert.deepEqual(cancel, { key: 'id:11', name: 'Bob', how: 'cancel', at: NOW + 2 * MIN, yesAt: NOW, profit: 0, moved: [{ name: 'Xanax', qty: 2 }] });
    const traded = endedOf(t, 'traded', [], NOW + 3 * MIN);
    assert.deepEqual([traded.how, traded.profit, traded.moved], ['traded', 20000, []]);
    let list = addEnded(null, cancel, NOW + 2 * MIN);
    // The same trade ending the same way, seen by another tab: once.
    list = addEnded(list, endedOf(t, 'cancel', left, NOW + 2 * MIN + 500), NOW + 3 * MIN);
    assert.equal(list.length, 1);
    list = addEnded(list, endedOf({ ...t, key: 'id:12', trader: { id: '12', name: 'Kay' } }, 'old', left, NOW + 4 * MIN), NOW + 4 * MIN);
    assert.deepEqual(list.map((e) => [e.name, e.how]), [['Kay', 'old'], ['Bob', 'cancel']]);
    assert.deepEqual(liveEnded(list, NOW + 2 * MIN + ENDED_KEEP_MS + 1).map((e) => e.name), ['Kay']);
    assert.deepEqual(liveEnded('junk', NOW), []);
    assert.equal(tidyEnded(list, NOW + 5 * MIN), list);
    assert.deepEqual(tidyEnded(list, NOW + 2 * MIN + ENDED_KEEP_MS + 1).map((e) => e.name), ['Kay']);
    assert.equal(tidyEnded('junk', NOW), 'junk');
});

test('Fresh prices only: a TornW3B price from a list not changed in two days is stale - never one with a TornExchange price, never one whose date is not known', () => {
    const DAY = 24 * 60 * 60 * 1000;
    assert.equal(PRICES_STALE_MS, 2 * DAY);
    const listAt = new Map([['1', NOW - 3 * DAY], ['2', NOW - DAY], ['3', NOW - 30 * DAY], ['5', NOW - 30 * DAY]]);
    const listAtOf = (id) => listAt.get(String(id)) || 0;
    const buyers = [
        { id: '1', name: 'Old list', price: 900, w3b: 900, te: null },
        { id: '2', name: 'Changed yesterday', price: 890, w3b: 890, te: null },
        { id: '3', name: 'Old list, on TornExchange too', price: 880, w3b: 885, te: 880 },
        { id: '4', name: 'Date not known', price: 870, w3b: 870, te: null },
        { id: '5', name: 'TornExchange only', price: 860, w3b: null, te: 860 },
        { id: null, name: 'By name only', price: 850, w3b: null, te: 850 },
    ];
    assert.deepEqual(buyers.map((b) => stalePrice(b, listAtOf, NOW)), [true, false, false, false, false, false]);
    assert.deepEqual(freshOnly(buyers, listAtOf, NOW).map((b) => b.id), ['2', '3', '4', '5', null]);
    // Exactly two days is not over two days.
    assert.equal(stalePrice({ id: '9', w3b: 5 }, () => NOW - PRICES_STALE_MS, NOW), false);
    assert.equal(stalePrice({ id: '9', w3b: 5 }, () => NOW - PRICES_STALE_MS - 1, NOW), true);
    // Said on the desk, with why - only while the switch is on, and after the other two reasons.
    const levelOf = (id) => (id === '1' ? 'offline' : 'online');
    assert.deepEqual(hiddenBuyers(buyers, { prefs: { freshOnly: true }, listAtOf, now: NOW }).map((b) => [b.id, b.hiddenBy, b.listAt]), [['1', 'stale', NOW - 3 * DAY]]);
    assert.deepEqual(hiddenBuyers(buyers, { prefs: { freshOnly: true, onlineOnly: true }, levelOf, listAtOf, now: NOW }).map((b) => [b.id, b.hiddenBy]), [['1', 'offline']]);
    assert.deepEqual(hiddenBuyers(buyers, { prefs: {}, listAtOf, now: NOW }), []);
});
