/*
 * 3.27.0 (the owner, 2026-10-11): "trader cancelled trade, and then he asked
 * what pricelist did you see, we couldnt find them again." / "can we have a
 * history showing the last 30 trades? with their pricelists and if success or
 * not etc?" - core/past-trades.js: a record written at the yes with the
 * prices the trade was made on, closed when the trade ends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptTrade, recordBuy, addExtraBuy, cancelledLeftovers } from '../src/core/accepted.js';
import { PAST_TRADES_MAX, pastTrades, pastTradeOf, addPastTrade, endPastTrade, pastBought, pastState, pastMoved, pastTotals, pastSpan, pastTct, pastSource, pastTradeText } from '../src/core/past-trades.js';

const YES = Date.UTC(2026, 9, 11, 3, 40);
const MIN = 60000;

/** Marla said yes to 10 Camel Plushies from two bazaars, and 5 Sticks of Dynamite of your own. */
function accepted(at = YES, key = 'id:77') {
    return acceptTrade({
        key,
        buyer: { id: key.slice(3), name: 'Marla' },
        flips: [{ itemId: '384', name: 'Camel Plushie', bid: 13500, steps: [{ sellerId: '1', sellerName: 'A', qty: 6, price: 13000 }, { sellerId: '2', sellerName: 'B', qty: 4, price: 13100 }] }],
        held: [{ itemId: '335', name: 'Stick of Dynamite', units: 5, bid: 18000, each: 17500 }],
    }, '384', at);
}

const seen = () => ({ changedAt: YES - 192 * MIN, readAt: YES - 40000, items: { 384: { w3b: 13500, te: 13600, checkedAt: YES - 40000 }, 335: { w3b: 0, te: 18000, checkedAt: 0 } } });

test('the record at the yes: each item at the price the trade was made on, where it came from, when it was checked, and their list\'s dates', () => {
    const rec = pastTradeOf(accepted(), seen());
    assert.equal(rec.key, 'id:77');
    assert.equal(rec.at, YES);
    assert.deepEqual(rec.trader, { id: '77', name: 'Marla' });
    assert.deepEqual(rec.list, { changedAt: YES - 192 * MIN, readAt: YES - 40000 });
    assert.deepEqual(rec.lines, [
        { itemId: '384', name: 'Camel Plushie', kind: 'flip', units: 10, bid: 13500, w3b: 13500, te: 13600, checkedAt: YES - 40000 },
        { itemId: '335', name: 'Stick of Dynamite', kind: 'yours', units: 5, bid: 18000, w3b: 0, te: 18000, checkedAt: 0 },
    ]);
    assert.equal(rec.pays, 10 * 13500 + 5 * 18000);
    assert.equal(rec.cost, 6 * 13000 + 4 * 13100);
    assert.equal(rec.end, null);
    assert.equal(pastState(rec), 'going');
    assert.equal(pastSource(rec.lines[0]), 'w3b');
    assert.equal(pastSource(rec.lines[1]), 'te');
});

test('a trade whose list was not known: the prices it was accepted at, and nothing said about the list', () => {
    const rec = pastTradeOf(accepted(), null);
    assert.equal(rec.list, null);
    assert.deepEqual(rec.lines[0], { itemId: '384', name: 'Camel Plushie', kind: 'flip', units: 10, bid: 13500 });
    assert.equal(pastSource(rec.lines[0]), null);
});

test('one trade is written once, the newest yes first, and only the last thirty are kept', () => {
    let list = [];
    for (let k = 0; k < PAST_TRADES_MAX + 5; k += 1) list = addPastTrade(list, pastTradeOf(accepted(YES + k * MIN, 'id:' + (100 + k)), seen()));
    assert.equal(list.length, PAST_TRADES_MAX);
    assert.equal(list[0].at, YES + (PAST_TRADES_MAX + 4) * MIN);
    assert.equal(list[list.length - 1].at, YES + 5 * MIN);
    const again = addPastTrade(list, pastTradeOf(accepted(list[0].at, list[0].key), null));
    assert.equal(again.length, PAST_TRADES_MAX);
    assert.notEqual(again[0].list, null, 'the first record of a trade stands');
    // The same trader, another yes: another trade.
    assert.equal(addPastTrade([list[0]], pastTradeOf(accepted(list[0].at + 1, list[0].key), seen())).length, 2);
    // Junk in the store is passed over.
    assert.deepEqual(pastTrades([null, { key: 'x' }, 7, 'a']), []);
    assert.deepEqual(pastTrades({}), []);
});

test('what was bought for a trade: the plan\'s buys by bazaar, your own items, and buys outside the plan this trader pays for', () => {
    let t = accepted();
    t = recordBuy(t, 'flip:384', 0, 6, YES + MIN);
    t = addExtraBuy(t, { itemId: '384', name: 'Camel Plushie', qty: 2, price: 12900, bid: 13500, sellerId: '9', seller: 'C' }, YES + 2 * MIN);
    t = addExtraBuy(t, { itemId: '206', name: 'Xanax', qty: 1, price: 840000, bid: 850000, sellerId: '9', seller: 'C' }, YES + 2 * MIN);
    // One the trader does not buy is not the trade's.
    t = addExtraBuy(t, { itemId: '1', name: 'Hammer', qty: 3, price: 50, bid: 0, sellerId: '9', seller: 'C' }, YES + 2 * MIN);
    assert.deepEqual(pastBought(t), [
        { itemId: '384', name: 'Camel Plushie', kind: 'flip', got: 8, of: 10, each: Math.round((6 * 13000 + 2 * 12900) / 8), stops: 2, stopsAll: 2 },
        { itemId: '335', name: 'Stick of Dynamite', kind: 'yours', got: 5, of: 5, each: 17500, stops: 0, stopsAll: 0 },
        { itemId: '206', name: 'Xanax', kind: 'extra', got: 1, of: 0, each: 840000, stops: 1, stopsAll: 0 },
    ]);
    // Nothing bought yet: the bazaars planned are still said.
    assert.deepEqual(pastBought(accepted())[0], { itemId: '384', name: 'Camel Plushie', kind: 'flip', got: 0, of: 10, each: null, stops: 0, stopsAll: 2 });
});

test('cancelled after the yes: the record is closed with who pressed, what was bought and went to To sell, and their list by then', () => {
    let t = accepted();
    t = recordBuy(t, 'flip:384', 0, 6, YES + MIN);
    const stored = addPastTrade([], pastTradeOf(t, seen()));
    const left = cancelledLeftovers(t, YES + 12 * MIN);
    const list = endPastTrade(stored, t, 'cancel', { now: YES + 12 * MIN, by: 'torn', left, facts: { changedAt: YES + 7 * MIN, readAt: YES + 9 * MIN, bids: { 384: 12900, 335: 18000 } } });
    assert.equal(list.length, 1);
    const rec = list[0];
    assert.equal(pastState(rec), 'cancel');
    assert.equal(rec.end.at, YES + 12 * MIN);
    assert.equal(rec.end.by, 'torn');
    assert.deepEqual(rec.end.list, { changedAt: YES + 7 * MIN, readAt: YES + 9 * MIN });
    assert.deepEqual(rec.end.bids, { 384: 12900, 335: 18000 });
    assert.deepEqual(rec.end.bought.map((r) => [r.itemId, r.got, r.of, r.kept]), [['384', 6, 10, 6], ['335', 5, 5, 0]]);
    // The prices of the yes are untouched.
    assert.equal(rec.lines[0].bid, 13500);
    assert.deepEqual(pastMoved(rec, rec.end), { known: true, changedAt: YES + 7 * MIN, moved: [{ itemId: '384', name: 'Camel Plushie', was: 13500, is: 12900 }], readAfter: true });
});

test('the first ending stands - but a cancelled trade that had in fact gone through is put right to traded', () => {
    const t = recordBuy(recordBuy(accepted(), 'flip:384', 0, 6, YES + MIN), 'flip:384', 1, 4, YES + 2 * MIN);
    const stored = addPastTrade([], pastTradeOf(t, seen()));
    const cancelled = endPastTrade(stored, t, 'cancel', { now: YES + 30 * MIN, by: 'bids', facts: null });
    assert.equal(cancelled[0].end.bids, null, 'their list was not known then');
    assert.equal(pastMoved(cancelled[0], cancelled[0].end).known, false);
    // Expired later, or cancelled again: nothing changes.
    assert.equal(endPastTrade(cancelled, t, 'old', { now: YES + 90 * MIN })[0].end.how, 'cancel');
    const right = endPastTrade(cancelled, t, 'traded', { now: YES + 20 * MIN, by: 'seen', facts: { changedAt: YES - MIN, readAt: YES + 5 * MIN, bids: { 384: 13500, 335: 18000 } } });
    assert.equal(right[0].end.how, 'traded');
    assert.equal(right[0].end.by, 'seen');
    assert.equal(right[0].end.at, YES + 20 * MIN);
    assert.equal(right[0].end.pays, 10 * 13500 + 5 * 18000);
    assert.equal(right[0].end.profit, 6 * 500 + 4 * 400 + 5 * 500);
    assert.deepEqual(pastMoved(right[0], right[0].end), { known: true, changedAt: 0, moved: [], readAfter: true });
    // Traded stays traded.
    assert.equal(endPastTrade(right, t, 'cancel', { now: YES + 99 * MIN })[0].end.how, 'traded');
});

test('a trade accepted before there was a history is written down when it ends, with the prices it was accepted at', () => {
    const t = accepted();
    const list = endPastTrade([], t, 'old', { now: YES + 25 * 60 * MIN, facts: null });
    assert.equal(list.length, 1);
    assert.equal(list[0].list, null);
    assert.equal(list[0].lines[0].bid, 13500);
    assert.equal(pastState(list[0]), 'old');
    // No trade: nothing to close.
    assert.deepEqual(endPastTrade([], null, 'old', { now: YES }), []);
});

test('a price no longer on their list is said as that, and a list never read again says nothing moved only as far as it was known', () => {
    const rec = pastTradeOf(accepted(), seen());
    const m = pastMoved(rec, { list: { changedAt: YES - 192 * MIN, readAt: YES - 40000 }, bids: { 335: 18000 } });
    assert.deepEqual(m.moved, [{ itemId: '384', name: 'Camel Plushie', was: 13500, is: 0 }]);
    assert.equal(m.changedAt, 0, 'their list was last changed before the yes');
    assert.equal(m.readAfter, false);
    assert.deepEqual(pastMoved(rec, null), { known: false, changedAt: 0, moved: [], readAfter: false });
});

test('the totals: kept, still going, traded with what was made, cancelled, no trade in a day, a yes undone', () => {
    const mk = (k, how, profit = 0) => {
        const t = recordBuy(recordBuy(accepted(YES + k * MIN, 'id:' + k), 'flip:384', 0, 6), 'flip:384', 1, 4);
        const stored = [pastTradeOf(t, seen())];
        return how ? endPastTrade(stored, t, how, { now: YES + (k + 5) * MIN })[0] : stored[0];
    };
    const list = [mk(1, null), mk(2, 'traded'), mk(3, 'traded'), mk(4, 'cancel'), mk(5, 'old'), mk(6, 'back')];
    assert.deepEqual(pastTotals(list), { kept: 6, going: 1, traded: 2, profit: 2 * (6 * 500 + 4 * 400 + 5 * 500), cancelled: 1, old: 1, back: 1 });
    assert.deepEqual(pastTotals(null), { kept: 0, going: 0, traded: 0, profit: 0, cancelled: 0, old: 0, back: 0 });
});

test('lengths of time are never shortened to nothing', () => {
    assert.equal(pastSpan(40000), '40s');
    assert.equal(pastSpan(130000), '2m 10s');
    assert.equal(pastSpan(7 * MIN), '7 min');
    assert.equal(pastSpan(12 * MIN + 20000), '12 min');
    assert.equal(pastSpan(192 * MIN), '3h 12m');
    assert.equal(pastSpan(60 * MIN), '1h');
    assert.equal(pastSpan(52 * 60 * MIN), '2 days 4h');
    assert.equal(pastSpan(-5), '0s');
});

test('Torn\'s clock: the date and time, or the time alone on the same Torn day', () => {
    assert.equal(pastTct(YES), '11 Oct 03:40 TCT');
    assert.equal(pastTct(YES + 12 * MIN, YES), '03:52 TCT');
    assert.equal(pastTct(YES - 5 * 60 * MIN, YES), '10 Oct 22:40 TCT');
});

test('Copy for the trader: who, when on Torn\'s clock, each item at its price, the total, and what moved in their list', () => {
    let t = accepted();
    t = recordBuy(t, 'flip:384', 0, 6, YES + MIN);
    const stored = addPastTrade([], pastTradeOf(t, seen()));
    const rec = endPastTrade(stored, t, 'cancel', { now: YES + 12 * MIN, by: 'torn', facts: { changedAt: YES + 7 * MIN, readAt: YES + 9 * MIN, bids: { 384: 12900, 335: 18000 } } })[0];
    assert.equal(pastTradeText(rec), [
        'Trade with Marla [77]',
        'You said yes 11 Oct 03:40 TCT. Cancelled 03:52 TCT.',
        '',
        'Prices from your TornW3B list (you last changed it 00:28 TCT, I read it 03:39 TCT):',
        '  Camel Plushie x 10 at $13,500 = $135,000',
        '  Stick of Dynamite x 5 at $18,000 = $90,000 (your TornExchange price)',
        '  Total $225,000',
        '',
        'Your list changed at 03:47 TCT: Camel Plushie $13,500 -> $12,900.',
    ].join('\n'));
    // Still going, nothing moved: no ending, no last line.
    const going = pastTradeOf(t, seen());
    const text = pastTradeText(going, { list: { changedAt: seen().changedAt, readAt: YES + MIN }, bids: { 384: 13500, 335: 18000 } });
    assert.equal(text.split('\n')[1], 'You said yes 11 Oct 03:40 TCT.');
    assert.ok(!/changed at|After the yes/.test(text));
    // The list not written down: the prices alone.
    assert.equal(pastTradeText(pastTradeOf(t, null)).split('\n')[3], 'Prices the trade was made on:');
});
