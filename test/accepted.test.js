/*
 * A trade the trader said yes to: frozen, checked live per step, ticked as
 * bought and sent (core/accepted.js, 2026-09-27).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { acceptTrade, liveAccepted, stepState, tickAccepted, ACCEPTED_MAX_AGE_MS } from '../src/core/accepted.js';

const CHOSEN = {
    key: 'id:11',
    buyer: { id: '11', name: 'Bob', price: 18000 },
    flips: [
        { itemId: '335', name: 'Stick of Dynamite', units: 53, bid: 18000, profit: 26500, steps: [{ sellerId: '2', sellerName: 'Y', qty: 53, price: 17500 }] },
        { itemId: '206', name: 'Xanax', units: 2, bid: 850000, profit: 20000, steps: [{ sellerId: '888', sellerName: 'XanSeller', qty: 2, price: 840000 }, { sellerId: null, qty: 1, price: 839000 }] },
    ],
    held: [{ itemId: '1', name: 'Hammer', units: 10, bid: 110 }, { itemId: '180', name: 'Beer', units: 0, bid: 60 }],
};

test('accepting freezes the plan: what to buy, what to send, what they pay', () => {
    const t = acceptTrade(CHOSEN, '335', 1000);
    assert.equal(t.key, 'id:11');
    assert.deepEqual(t.trader, { id: '11', name: 'Bob' });
    assert.deepEqual(t.items.map((i) => [i.name, i.units, i.kind]), [['Stick of Dynamite', 53, 'flip'], ['Xanax', 2, 'flip'], ['Hammer', 10, 'yours']]);
    assert.equal(t.items[1].steps.length, 1, 'an estimate (no seller) is not a step you can buy');
    assert.equal(t.pays, 53 * 18000 + 2 * 850000 + 10 * 110);
    assert.equal(t.cost, 53 * 17500 + 2 * 840000);
    assert.equal(t.profit, 46500);
});

test('each step is checked against the bazaar now: still there, re-priced, fewer left, gone', () => {
    const step = { sellerId: '2', qty: 53, price: 17500, bought: false };
    const row = (price, qty, stale = false) => ({ sellerId: '2', price, qty, stale, dataAt: 5 });
    assert.deepEqual(stepState(step, [row(17500, 60)]), { state: 'ok', seenAt: 5 });
    assert.deepEqual(stepState(step, [row(17900, 60)]), { state: 'price', price: 17900, seenAt: 5 });
    assert.deepEqual(stepState(step, [row(17500, 20)]), { state: 'short', qty: 20, seenAt: 5 });
    assert.deepEqual(stepState(step, [{ sellerId: '9', price: 17000, qty: 5 }]), { state: 'gone' });
    assert.deepEqual(stepState(step, [row(17500, 60, true)]), { state: 'gone' }, 'not seen lately counts as gone');
    assert.deepEqual(stepState(step, null), { state: 'unknown' });
    assert.deepEqual(stepState({ ...step, bought: true }, []), { state: 'bought' });
});

test('ticks: a step bought, an item sent; old trades are let go', () => {
    const t = acceptTrade(CHOSEN, '335', 1000);
    const b = tickAccepted(t, 'flip:206', { step: 0, bought: true });
    assert.equal(b.items[1].steps[0].bought, true);
    assert.equal(t.items[1].steps[0].bought, false, 'a copy, not changed in place');
    const s = tickAccepted(b, 'yours:1', { sent: true });
    assert.equal(s.items[2].sent, true);
    // One item twice (flipped and your own): ticking one line leaves the other.
    const twice = acceptTrade({ ...CHOSEN, held: [{ itemId: '206', name: 'Xanax', units: 15, bid: 850000 }] }, '335', 1000);
    const one = tickAccepted(twice, 'yours:206', { sent: true });
    assert.deepEqual(one.items.filter((i) => i.itemId === '206').map((i) => [i.kind, i.sent]), [['flip', false], ['yours', true]]);

    const kept = liveAccepted({ a: { ...t, key: 'a', at: 1000 }, b: { ...t, key: 'b', at: 1000 - ACCEPTED_MAX_AGE_MS } }, 2000);
    assert.deepEqual(Object.keys(kept), ['a']);
});

/* ------------------------------------------------ the buying run */

import { nextStep, boughtFromStock, recordBuy, sendUnits, replacementFor, replaceStep, dropLine, acceptedTotals } from '../src/core/accepted.js';

test('the buying run: next step, what you bought from the stock drop, what you then send', () => {
    let t = acceptTrade(CHOSEN, '335', 1000);
    assert.deepEqual([nextStep(t).itemId, nextStep(t).index], ['335', 0]);
    // 60 in stock when you arrived, 7 now: you took 53 (what you needed).
    assert.equal(boughtFromStock(60, 7, 53), 53);
    assert.equal(boughtFromStock(60, 40, 53), 20, 'part of it');
    assert.equal(boughtFromStock(60, 60, 53), 0, 'nothing: skipped');
    assert.equal(boughtFromStock(30, null, 53), 30, 'the listing went: all there was');
    assert.equal(boughtFromStock(null, 5, 53), 0, 'never seen: nothing counted');
    t = recordBuy(t, 'flip:335', 0, 20);
    assert.equal(sendUnits(t.items[0]), 20, 'send what you bought, not what was planned');
    assert.deepEqual([nextStep(t).itemId, nextStep(t).index], ['206', 0], 'on to the next item');
    t = recordBuy(t, 'flip:206', 0, 0);
    assert.equal(sendUnits(t.items[1]), 0, 'skipped: nothing to send');
    assert.equal(nextStep(t), null, 'every step done');
    assert.equal(sendUnits(t.items[2]), 10, 'yours as planned');
    const tot = acceptedTotals(t);
    assert.equal(tot.pays, 20 * 18000 + 10 * 110);
    assert.equal(tot.cost, 20 * 17500);
    assert.equal(tot.profit, 20 * 18000 - 20 * 17500);
});

test('a gone or re-priced listing: the next cheapest still under their price, or drop the item', () => {
    const step = { sellerId: '2', qty: 53, price: 17500 };
    const enough = (each, price) => each >= Math.max(1, price / 100);
    const rows = [
        { sellerId: '2', price: 19000, qty: 60 },
        { sellerId: '5', sellerName: 'Z', price: 17600, qty: 40 },
        { sellerId: '6', price: 17900, qty: 90 },
        { sellerId: '7', price: 17000, qty: 9, stale: true },
    ];
    assert.deepEqual(replacementFor(step, rows, 18000, enough), { sellerId: '5', sellerName: 'Z', price: 17600, qty: 40 });
    assert.equal(replacementFor(step, [{ sellerId: '5', price: 17990, qty: 9 }], 18000, enough), null, 'not profitable any more');
    let t = acceptTrade(CHOSEN, '335', 1000);
    t = replaceStep(t, 'flip:335', 0, { sellerId: '5', sellerName: 'Z', price: 17600, qty: 40 });
    assert.deepEqual(t.items[0].steps[0], { sellerId: '5', sellerName: 'Z', qty: 40, price: 17600, bought: false });
    t = dropLine(t, 'flip:206');
    assert.deepEqual(t.items.map((i) => i.line), ['flip:335', 'yours:1']);
});

test('a tick is the last word: ticked after a skip counts as bought, unticked undoes a count (bug hunt, 3.12.10)', () => {
    let t = acceptTrade(CHOSEN, '335');
    t = recordBuy(t, 'flip:335', 0, 0);
    assert.equal(t.items[0].steps[0].skipped, true);
    t = tickAccepted(t, 'flip:335', { step: 0, bought: true });
    assert.equal(t.items[0].steps[0].skipped, false);
    assert.equal(sendUnits(t.items[0]), 53, 'sends what was planned');
    const tot = acceptedTotals(t);
    assert.ok(tot.cost >= 53 * 17500, 'and its cost is counted');
    t = recordBuy(t, 'flip:335', 0, 20);
    t = tickAccepted(t, 'flip:335', { step: 0, bought: false });
    assert.equal(t.items[0].steps[0].boughtQty, 0);
    assert.equal(nextStep(t).line, 'flip:335', 'the step is to buy again');
});

test('a re-priced or short seller can be its own replacement; a gone one never (bug hunt, 3.12.10)', () => {
    const enough = (each) => each > 0;
    const step = { sellerId: 'S', qty: 5, price: 100 };
    assert.deepEqual(replacementFor(step, [{ sellerId: 'S', price: 101, qty: 5 }], 200, enough, 'price'), { sellerId: 'S', sellerName: null, price: 101, qty: 5 });
    assert.equal(replacementFor(step, [{ sellerId: 'S', price: 101, qty: 5 }], 200, enough, 'gone'), null);
    assert.equal(replacementFor(step, [{ sellerId: 'S', price: 100, qty: 5 }], 200, enough, 'price'), null, 'the same listing is not a replacement');
    assert.deepEqual(replacementFor(step, [{ sellerId: 'S', price: 101, qty: 5 }, { sellerId: 'T', price: 150, qty: 5 }], 200, enough, 'price').sellerId, 'S', 'the cheapest');
});

import { buyingStatus } from '../src/core/accepted.js';
import { PANEL_CSS } from '../src/ui/styles.js';

test('the buying box: its status never breaks inside, the time in hours and minutes, the label never cut', () => {
    // The owner's page (3.13): "0 of 2 done · yes 100 / min ago".
    assert.deepEqual(buyingStatus(0, 2, 100 * 60000), ['0 of 2 done', 'yes 1h 40m ago']);
    assert.deepEqual(buyingStatus(1, 2, 12 * 60000 + 5000), ['1 of 2 done', 'yes 12m ago']);
    assert.deepEqual(buyingStatus(2, 3, 120 * 60000), ['2 of 3 done', 'yes 2h ago']);
    assert.deepEqual(buyingStatus(0, 1, 30000), ['0 of 1 done'], 'under a minute: no time');
    // Next's label ("Open the next bazaar: <a long name>") wraps instead of being cut.
    const rule = PANEL_CSS.match(/\.ttv2-panel button\.ttv2-buynext \{([^}]*)\}/);
    assert.ok(rule, 'the button has its own rule');
    assert.match(rule[1], /white-space: normal/);
    assert.match(rule[1], /height: auto/);
    assert.match(PANEL_CSS, /\.ttv2-nobr \{ white-space: nowrap; \}/);
});

import { cancelledLeftovers, addExtraBuy } from '../src/core/accepted.js';

test('Cancel trade: what you already bought for it (planned and not) is yours to sell elsewhere', () => {
    let t = acceptTrade(CHOSEN, '335', 1000);
    // 40 of the 53 Dynamite bought, Xanax not started; one unplanned Beer bought on the way.
    t = recordBuy(t, 'flip:335', 0, 40);
    t = addExtraBuy(t, { itemId: '180', name: 'Beer', qty: 3, price: 55, bid: 60, sellerId: '321' });
    const left = cancelledLeftovers(t, 5000);
    assert.deepEqual(left.map((l) => [l.itemId, l.qty, l.each, l.from]), [['335', 40, 17500, 'Bob'], ['180', 3, 55, 'Bob']]);
    // Nothing bought yet: nothing to keep (your own items were never moved).
    assert.deepEqual(cancelledLeftovers(acceptTrade(CHOSEN, '335', 1000)), []);
});

import { sendList, fillNote } from '../src/core/accepted.js';

/*
 * The friend, 2026-10-03 (3.17.1 live): ELIZA_BITE accepted four items; he
 * bought 1,320 Camel Plushies, ran out of cash for the other three, and made
 * the trade mid flip. The add step had no Fill all, then - with all 1,320 in
 * the trade - said "none of ELIZA_BITE's items are in this list".
 */
const MID = () => {
    const chosen = {
        key: 'id:3767921',
        buyer: { id: '3767921', name: 'ELIZA_BITE', price: 71620 },
        flips: [
            { itemId: '384', name: 'Camel Plushie', units: 1320, bid: 71620, steps: [{ sellerId: '5', sellerName: 'S', qty: 1320, price: 70000 }] },
            { itemId: '35', name: 'Box of Chocolate Bars', units: 200, bid: 805, steps: [{ sellerId: '6', sellerName: 'T', qty: 200, price: 780 }] },
            { itemId: '260', name: 'Dahlia', units: 400, bid: 2413, steps: [{ sellerId: '7', sellerName: 'U', qty: 400, price: 2300 }] },
        ],
        held: [],
    };
    return acceptTrade(chosen, '384', 1000);
};

test('a trade made mid flip: what goes in is what you bought; the rest is "not bought yet", never offered to Fill', () => {
    const fresh = MID();
    // Nothing counted yet: the plan's numbers, as before.
    assert.deepEqual(sendList(fresh).send.map((n) => [n.name, n.qty]), [['Camel Plushie', 1320], ['Box of Chocolate Bars', 200], ['Dahlia', 400]]);
    assert.deepEqual(sendList(fresh).waiting, []);
    assert.equal(sendList(fresh).pays, acceptedTotals(fresh).pays);

    const mid = recordBuy(fresh, 'flip:384', 0, 1320, 5000);
    const list = sendList(mid);
    assert.deepEqual(list.send, [{ itemId: '384', name: 'Camel Plushie', qty: 1320 }], 'only what was bought goes in');
    assert.deepEqual(list.waiting, ['Box of Chocolate Bars', 'Dahlia']);
    assert.equal(list.pays, 1320 * 71620, 'and they pay for that, not for the whole plan');

    // An unplanned buy this trader pays for goes in too (the Bought window lists it); one they do not buy never.
    const extra = addExtraBuy(addExtraBuy(mid, { itemId: '187', name: 'Teddy Bear Plushie', qty: 3, price: 400, bid: 486 }, 6000), { itemId: '9', name: 'Junk', qty: 5, price: 10, bid: 0 }, 6000);
    assert.deepEqual(sendList(extra).send.map((n) => [n.name, n.qty]), [['Camel Plushie', 1320], ['Teddy Bear Plushie', 3]]);
    assert.equal(sendList(extra).pays, 1320 * 71620 + 3 * 486);

    // A skipped line is neither sent nor waiting; a part-bought one sends what was bought.
    const skipped = recordBuy(recordBuy(mid, 'flip:35', 0, 0, 7000), 'flip:260', 0, 150, 7000);
    assert.deepEqual(sendList(skipped).send.map((n) => [n.name, n.qty]), [['Camel Plushie', 1320], ['Dahlia', 150]]);
    assert.deepEqual(sendList(skipped).waiting, []);
});

test('your own items in a trade always go in, bought or not', () => {
    const t = acceptTrade(CHOSEN, '335', 1000);
    const run = recordBuy(t, 'flip:335', 0, 53, 2000);
    assert.deepEqual(sendList(run).send.map((n) => [n.name, n.qty]), [['Hammer', 10], ['Stick of Dynamite', 53]]);
    assert.deepEqual(sendList(run).waiting, ['Xanax']);
    assert.equal(sendList(run).pays, 10 * 110 + 53 * 18000);
});

test('Fill\'s line on a part-bought trade: says it is all in, and how many are not bought yet', () => {
    const base = { accepted: ['ELIZA_BITE'], trader: 'ELIZA_BITE' };
    // Everything bought is in the trade: said so - never "none of their items are in this list".
    const allIn = fillNote({ ...base, toSend: 1, marked: 0, open: 0, waiting: ['Box of Chocolate Bars', 'Dahlia'] });
    assert.equal(allIn.text, 'Fill: everything you bought for ELIZA_BITE is in the trade · 2 not bought yet');
    assert.equal(allIn.ok, true);
    assert.equal(fillNote({ ...base, toSend: 2, marked: 2, open: 0 }).text, 'Fill: everything for ELIZA_BITE is in the trade');
    // Still to add, its row marked.
    assert.equal(fillNote({ ...base, toSend: 1, marked: 1, open: 1, waiting: ['Dahlia'] }).text, 'Fill for ELIZA_BITE: 1 item marked · 1 not bought yet');
    // Still to add, no row here.
    assert.match(fillNote({ ...base, toSend: 1, marked: 0, open: 1 }).text, /none of ELIZA_BITE's items are in this list/);
});
