/*
 * Flips > For <the server's owner> (3.32.0, core/owner-tab.js): one trader, one price list - whole sets and single
 * pieces, the list as an accepted trade, the run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
    OWNER_MARKET, OWNER_SETS, OWNER_PIECES, ownerSet, ownerList, ownerLots, ownerSetsPlan, ownerPiecesPlan, ownerChosen, ownerOf,
    marketStep, marketItems, marketBuyRows, marketPageItem, marketNext, ownerCapped, ownerWhole, ownerRun, ownerShort, ownerAddSteps, ownerDropStep, marketRows, ownerAge,
} from '../src/core/owner-tab.js';
import { acceptTrade, nextStep, stepRank, sendUnits, recordBuy, stepState, leftoversOf, cancelledLeftovers, tradedLeftovers, acceptedTotals } from '../src/core/accepted.js';

const HIM = '2000001';
const NOW = 1_800_000_000_000;
const DAY = 86400000;
const PLUSH = ownerSet('plushie');
const IDS = PLUSH.pieces.map(String);

/** His list: 1,000 a piece for every plushie, the first two he holds enough of (off), still paid in a whole set. */
const stored = (more = {}) => ({
    mark: 4,
    lists: {
        [HIM]: {
            at: NOW - 9 * DAY, since: NOW - 10 * DAY, open: false, name: 'Buyer',
            prices: Object.fromEntries(IDS.slice(2).map((id) => [id, 1000])), off: IDS.slice(0, 2).map(Number),
            all: Object.fromEntries(IDS.map((id) => [id, 1000])),
            sets: { plushie: 3, flower: 0 }, take: Object.fromEntries(IDS.map((id, k) => [id, k < 2 ? 0 : 2])),
            ...more,
        },
    },
});

/** Every piece: 2 at 800 in bazaar A, 5 at 900 in bazaar B, 9 at 950 on the Item Market. */
const lotsOf = (from = { bazaar: true, market: true }, change = {}) => (id) => (id in change ? change[id] : ownerLots({
    bazaar: [{ sellerId: '71', sellerName: 'A', price: 800, qty: 2 }, { sellerId: '72', sellerName: 'B', price: 900, qty: 5 }],
    market: [{ price: 950, qty: 9 }],
    from,
}));

test('the sets: 13 plushies and 11 flowers, each id once', () => {
    assert.deepEqual(OWNER_SETS.map((s) => [s.key, s.pieces.length]), [['plushie', 13], ['flower', 11]]);
    assert.equal(new Set(OWNER_PIECES).size, 24);
    assert.equal(ownerSet('nope').key, 'plushie');
});

test('his list stands however old it is, and closed; the newest one held is his', () => {
    const list = ownerList(stored());
    assert.equal(list.id, HIM);
    assert.equal(list.name, 'Buyer');
    assert.equal(list.open, false);
    assert.equal(list.at, NOW - 9 * DAY, 'nine days old: still his word here');
    assert.equal(Object.keys(list.prices).length, 11);
    assert.equal(Object.keys(list.all).length, 13, 'a piece he holds enough of is still priced for a whole set');
    assert.deepEqual(list.sets, { plushie: 3, flower: 0 });
    assert.equal(ownerList(null), null);
    assert.equal(ownerList({ lists: { x: { at: 1, prices: {} } } }), null);
    // One from a Torn Archive before 1.3.10: no counts.
    const old = ownerList({ lists: { [HIM]: { at: NOW, since: NOW, open: true, prices: { 186: 5 }, off: [] } } });
    assert.equal(old.sets, null);
    assert.equal(old.take, null);
    assert.deepEqual(old.all, { 186: 5 });
});

test('lots: cheapest first, a bazaar before the Item Market at one price, never a stale row or a skipped seller', () => {
    const got = ownerLots({
        bazaar: [{ sellerId: '9', sellerName: 'N', price: 500, qty: 3 }, { sellerId: '8', price: 400, qty: 1, stale: true }, { sellerId: HIM, price: 100, qty: 9 }, { sellerId: '7', sellerName: 'M', price: 450, qty: 2 }],
        market: [{ price: 500, qty: 4 }, { price: 0, qty: 1 }],
        skip: [HIM],
    });
    assert.deepEqual(got.lots.map((l) => [l.src, l.sellerId, l.price, l.qty]), [['bazaar', '7', 450, 2], ['bazaar', '9', 500, 3], ['market', OWNER_MARKET, 500, 4]]);
    assert.equal(got.unread, false);
    assert.equal(ownerLots({ bazaar: null, market: [] }).unread, true);
    assert.equal(ownerLots({ bazaar: null, market: [], from: { bazaar: false, market: true } }).unread, false);
    assert.equal(ownerLots({ bazaar: [{ sellerId: '9', price: 5, qty: 1 }], market: [{ price: 4, qty: 1 }], from: { bazaar: true, market: false } }).lots.length, 1);
});

test('whole sets: the k-th set takes the k-th cheapest unit of every piece, while it leaves your least profit', () => {
    const list = ownerList(stored());
    // Set 1 and 2 cost 13 x 800, set 3 costs 13 x 900: all under 13 x 1,000. He takes 3 - said, never a cap
    // (3.33.0, the owner's rule: a whole set is suggested whenever it pays): all 16 that pay can go on the list.
    assert.equal(ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5 }).most, 16);
    const plan = ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5, asked: 3 });
    assert.equal(plan.value, 13000);
    assert.equal(plan.takes, 3);
    assert.equal(plan.most, 16);
    assert.equal(plan.n, 3);
    assert.equal(plan.units, 39);
    assert.equal(plan.cost, 2 * 13 * 800 + 13 * 900);
    assert.equal(plan.pays, 39000);
    assert.equal(plan.makes, 39000 - plan.cost);
    assert.equal(plan.rows.length, 13);
    assert.equal(plan.rows[0].pay, 1000, 'a piece he holds too many of is paid in a whole set');
    assert.deepEqual(plan.rows[0].parts.map((p) => [p.sellerId, p.qty, p.price]), [['71', 2, 800], ['72', 1, 900]]);
    assert.deepEqual(plan.stops.map((s) => [s.sellerId, s.units, s.market]), [['71', 26, false], ['72', 13, false]]);
    assert.deepEqual(plan.ladder.slice(0, 4).map((l) => l.state), ['in', 'in', 'in', 'free']);
    // Fewer asked: the rest are free to add.
    const two = ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5, asked: 2 });
    assert.equal(two.n, 2);
    assert.deepEqual(two.ladder.slice(0, 3).map((l) => l.state), ['in', 'in', 'free']);
    assert.equal(ownerSetsPlan(PLUSH, list, lotsOf(), { asked: 99 }).n, 16, 'never more than can go on a list');
});

test('whole sets: a piece dearer than he pays is carried by its set, and the profit is the set\'s', () => {
    const list = ownerList(stored({ sets: { plushie: 9 } }));
    const dear = ownerLots({ bazaar: [{ sellerId: '71', sellerName: 'A', price: 1500, qty: 9 }], market: [] });
    const plan = ownerSetsPlan(PLUSH, list, lotsOf(undefined, { [IDS[0]]: dear }), { leastPct: 5 });
    // 12 x 800 + 1,500 = 11,100 (17% under 13,000) twice; then 12 x 900 + 1,500 = 12,300 (5.7%) five times;
    // then 12 x 950 + 1,500 = 12,900: under the least profit.
    assert.equal(plan.paying, 7);
    assert.equal(plan.most, 7);
    assert.equal(plan.rows[0].makes, 7 * (1000 - 1500));
    assert.equal(plan.ladder[7].state, 'out');
    assert.equal(plan.first.cost, 11100);
    // Your cash ends it sooner.
    const poor = ownerSetsPlan(PLUSH, list, lotsOf(undefined, { [IDS[0]]: dear }), { leastPct: 5, cash: 23000 });
    assert.equal(poor.most, 2);
    assert.equal(poor.ladder[2].state, 'cash');
    // One trade holds only so many items.
    assert.equal(ownerSetsPlan(PLUSH, list, lotsOf(), { maxUnits: 30 }).most, 2);
});

test('whole sets: why there is none', () => {
    const why = (list, lots, o) => ownerSetsPlan(PLUSH, list, lots, o).why;
    assert.equal(why(ownerList(stored({ all: {} })), lotsOf()), 'price');
    // His Torn Archive takes no set now: a whole set is suggested all the same (3.33.0).
    assert.equal(why(ownerList(stored({ sets: { plushie: 0 } })), lotsOf()), null);
    assert.equal(ownerSetsPlan(PLUSH, ownerList(stored({ sets: { plushie: 0 } })), lotsOf()).most, 16);
    assert.equal(why(ownerList(stored()), lotsOf(undefined, { [IDS[3]]: { lots: [], unread: true } })), 'unread');
    assert.equal(why(ownerList(stored()), lotsOf(undefined, { [IDS[3]]: { lots: [], unread: false } })), 'unlisted');
    assert.equal(why(ownerList(stored()), lotsOf(), { leastPct: 80 }), 'nopay');
    assert.equal(why(ownerList(stored()), lotsOf(), { cash: 100 }), 'cash');
    assert.equal(why(ownerList(stored()), lotsOf()), null);
    // His Torn Archive has not said how many sets: as many as pay.
    const old = ownerSetsPlan(PLUSH, ownerList(stored({ sets: undefined })), lotsOf());
    assert.equal(old.takes, null);
    assert.equal(old.most, 16, '2 + 5 + 9 of every piece');
});

test('pieces: each by itself - under his price by your least profit, up to what he still takes, never one he holds enough of', () => {
    const list = ownerList(stored());
    const plan = ownerPiecesPlan(PLUSH, list, lotsOf(), { leastPct: 12 });
    // 800 leaves 25%, 900 leaves 11.1%: only the two at 800. He takes 2 of 11 pieces.
    assert.equal(plan.known, true);
    assert.equal(plan.rows[0].off, true);
    assert.equal(plan.rows[0].units, 0);
    assert.equal(plan.rows[2].units, 2);
    assert.equal(plan.rows[2].under, 2);
    assert.equal(plan.units, 22);
    assert.equal(plan.takes, 22);
    assert.equal(plan.fills, true);
    assert.equal(plan.cost, 22 * 800);
    assert.equal(plan.makes, 22 * 200);
    assert.deepEqual(plan.stops.map((s) => [s.sellerId, s.units]), [['71', 22]]);
    // Your cash: the best ratio first, cheapest first within a piece.
    const poor = ownerPiecesPlan(PLUSH, list, lotsOf(), { leastPct: 1, cash: 2500 });
    assert.equal(poor.units, 3);
    assert.equal(poor.fills, false);
    // A Torn Archive that has not said how many: none can be promised.
    const old = ownerPiecesPlan(PLUSH, ownerList(stored({ take: undefined })), lotsOf());
    assert.equal(old.units, 0);
    assert.equal(old.why, 'unknown');
    assert.equal(ownerPiecesPlan(PLUSH, list, lotsOf(), { leastPct: 90 }).why, 'nopay');
});

const made = (plan, list, o) => ({
    ...acceptTrade(ownerChosen(plan, list, (id) => 'Piece ' + id), String(plan.rows[0].itemId), NOW),
    owner: o, stops: plan.stops.filter((s) => !s.market).map((s) => s.sellerId),
});

test('the list is an accepted trade with him: a flip line a piece, a step a seller and price', () => {
    const list = ownerList(stored());
    const plan = ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5 });
    const chosen = ownerChosen(plan, list, (id) => 'Piece ' + id);
    assert.equal(chosen.key, 'id:' + HIM);
    assert.deepEqual(chosen.buyer, { id: HIM, name: 'Buyer' });
    const t = made(plan, list, { mode: 'sets', set: 'plushie', n: 3 });
    assert.equal(t.items.length, 13);
    assert.equal(t.cost, plan.cost);
    assert.equal(t.pays, plan.pays);
    assert.equal(t.profit, plan.makes);
    assert.deepEqual(ownerOf(t), { mode: 'sets', set: 'plushie', n: 3 });
    assert.equal(ownerOf({ ...t, owner: { mode: 'x', set: 'plushie' } }), null);
    assert.equal(ownerOf(acceptTrade(chosen, IDS[0], NOW)), null, 'any other trade');
});

test('the run: stop by stop, bazaars in the list\'s order, the Item Market last', () => {
    const list = ownerList(stored());
    // Only bazaar A's two and the Item Market: three sets = 2 at A + 1 on the market, of every piece.
    const lots = () => ownerLots({ bazaar: [{ sellerId: '71', sellerName: 'A', price: 800, qty: 2 }], market: [{ price: 950, qty: 9 }] });
    const plan = ownerSetsPlan(PLUSH, list, lots, { leastPct: 1, asked: 3 });
    assert.deepEqual(plan.stops.map((s) => [s.sellerId, s.market, s.units]), [['71', false, 26], [OWNER_MARKET, true, 13]]);
    let t = made(plan, list, { mode: 'sets', set: 'plushie', n: 3 });
    assert.deepEqual([...marketItems([t])].sort(), [...IDS].sort());
    assert.equal(marketStep(t.items[0].steps[1]), true);
    let run = ownerRun(t);
    assert.equal(run.stops.length, 2);
    assert.equal(run.cur, 0);
    assert.equal(run.stops[0].state, 'cur');
    assert.equal(run.next.market, true);
    assert.equal(run.whole, 0);
    assert.equal(nextStep(t).step.sellerId, '71', 'a bazaar before the Item Market');
    // Everything at A bought.
    for (const i of t.items) t = recordBuy(t, i.line, 0, 2);
    assert.equal(nextStep(t).step.sellerId, OWNER_MARKET);
    run = ownerRun(t);
    assert.equal(run.stops[0].state, 'done');
    assert.equal(run.stops[1].state, 'cur');
    assert.equal(run.whole, 2);
    assert.equal(run.got, 26);
    assert.equal(run.ready, 26000);
    assert.equal(run.spent, 26 * 800);
    assert.equal(run.done, false);
});

test('the Item Market after every bazaar also when a market step comes first in a line', () => {
    const t = {
        key: 'id:5', stops: ['72', '71'],
        items: [
            { line: 'flip:1', itemId: '1', name: 'One', kind: 'flip', units: 3, bid: 10, steps: [{ sellerId: OWNER_MARKET, qty: 1, price: 5, bought: false }, { sellerId: '71', qty: 2, price: 6, bought: false }] },
            { line: 'flip:2', itemId: '2', name: 'Two', kind: 'flip', units: 1, bid: 10, steps: [{ sellerId: '72', qty: 1, price: 6, bought: false }] },
        ],
    };
    assert.deepEqual([nextStep(t).line, nextStep(t).index], ['flip:2', 0], 'the first stop named');
    t.items[1].steps[0].bought = true;
    assert.deepEqual([nextStep(t).line, nextStep(t).index], ['flip:1', 1]);
    t.items[0].steps[1].bought = true;
    assert.deepEqual([nextStep(t).line, nextStep(t).index], ['flip:1', 0]);
    t.items[0].steps[0].bought = true;
    assert.equal(nextStep(t), null);
    // A trade without stops: the first step not done, as ever.
    const plain = { items: [{ itemId: '1', kind: 'flip', steps: [{ sellerId: '9', qty: 1, price: 1, bought: true }, { sellerId: '8', qty: 1, price: 1, bought: false }] }, { itemId: '2', kind: 'flip', steps: [{ sellerId: '7', qty: 1, price: 1, bought: false }] }] };
    assert.deepEqual([nextStep(plain).itemId, nextStep(plain).index], ['1', 1]);
    // The Trades desk draws its stops by the same order (stepRank): the stops named, a bazaar they do not name,
    // the Item Market last - and a trade without stops keeps its own order, but for the Item Market (3.36.0: a flip's
    // plan may buy there; no page counts that buy, so the bazaars come first and your log has ticked it by the end).
    const t2 = { stops: ['72', '71'] };
    assert.deepEqual([OWNER_MARKET, '99', '71', '72'].sort((a, b) => stepRank(t2, a) - stepRank(t2, b)), ['72', '71', '99', OWNER_MARKET]);
    assert.deepEqual([OWNER_MARKET, '8', '9'].map((s) => stepRank(plain, s)), [2e9, 0, 0]);
});

test('whole sets only: a piece short holds the whole trade to the sets you have - the rest waits', () => {
    const list = ownerList(stored());
    const plan = ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5, asked: 3 });
    let t = made(plan, list, { mode: 'sets', set: 'plushie', n: 3 });
    // Every piece bought in full (2 at A, 1 at B) - but of the first only one was left at A, and none at B.
    t.items.forEach((i, k) => {
        t = recordBuy(t, i.line, 0, k === 0 ? 1 : 2);
        if (k === 0) t = { ...t, items: t.items.map((x) => (x.line === i.line ? { ...x, steps: x.steps.map((st, n) => (n === 1 ? { ...st, skipped: true } : st)) } : x)) };
        else t = recordBuy(t, i.line, 1, 1);
    });
    assert.equal(ownerWhole(t), 1);
    const capped = ownerCapped(t);
    assert.equal(capped.items[1].sendMax, 1);
    assert.equal(sendUnits(capped.items[1]), 1, 'three bought, one whole set: one is sent');
    assert.equal(sendUnits(capped.items[0]), 1);
    assert.equal(ownerCapped(capped), capped, 'nothing new: the same trade');
    const run = ownerRun(capped);
    assert.equal(run.done, true);
    assert.equal(run.whole, 1);
    assert.equal(run.sendUnits, 13);
    assert.equal(run.rest, 24);
    assert.equal(run.ready, 13000);
    // The money of what goes in and of what waits adds up to what was spent.
    const ran = ownerRun(capped);
    assert.equal(ran.sendCost + ran.restCost, ran.spent);
    assert.equal(ran.rest, 24);
    assert.ok(ran.sendCost > 0 && ran.restCost > 0);
    // What you bought but did not send is still yours: it goes to To sell however the trade ends.
    assert.equal(leftoversOf(capped, NOW).reduce((a, l) => a + l.qty, 0), 24, 'traded: the 24 that waited');
    assert.equal(cancelledLeftovers(capped, NOW).reduce((a, l) => a + l.qty, 0), 37, 'cancelled: everything bought');
    assert.equal(tradedLeftovers(capped, capped.items.map((i) => [i.itemId, 1]), NOW).reduce((a, l) => a + l.qty, 0), 24, 'as Torn says it went: one of each given');
    const totals = acceptedTotals(capped);
    assert.equal(totals.pays, 13000, 'he pays for one whole set');
    assert.equal(totals.left.units, 24);
    // What would close it: two more of the first piece, the cheapest still listed.
    const short = ownerShort(run, () => ownerLots({ bazaar: [{ sellerId: '73', sellerName: 'C', price: 880, qty: 1 }], market: [{ price: 990, qty: 4 }] }));
    assert.equal(short.length, 1);
    assert.equal(short[0].missing, 2);
    assert.deepEqual(short[0].parts.map((p) => [p.sellerId, p.qty, p.price]), [['73', 1, 880], [OWNER_MARKET, 1, 990]]);
    const more = ownerAddSteps(capped, short[0].itemId, short[0].parts);
    assert.equal(more.items[0].steps.length, 4);
    assert.deepEqual(more.stops, ['71', '72', '73']);
    assert.equal(nextStep(more).step.sellerId, '73');
    assert.equal(ownerRun(more).done, false);
    // The list's money follows: a step skipped counts for what was bought of it, the others in full.
    const counts = more.items.flatMap((i) => i.steps.map((st) => ({ n: st.skipped ? (st.boughtQty > 0 ? st.boughtQty : 0) : st.qty, price: st.price, bid: i.bid })));
    assert.equal(more.cost, counts.reduce((a, c) => a + c.n * c.price, 0));
    assert.equal(more.pays, counts.reduce((a, c) => a + c.n * c.bid, 0));
    assert.equal(more.profit, more.pays - more.cost);
    // A pieces list sends what was bought.
    const pieces = ownerCapped({ ...t, owner: { mode: 'pieces', set: 'plushie', n: 0 } });
    assert.equal(pieces.items[1].sendMax, undefined);
    assert.equal(sendUnits(pieces.items[1]), 3);
});

test('a stop\'s chip x: a step not bought leaves the list, its money with it; one bought stays', () => {
    const list = ownerList(stored());
    const plan = ownerSetsPlan(PLUSH, list, lotsOf(), { leastPct: 5, asked: 3 });
    let t = made(plan, list, { mode: 'sets', set: 'plushie', n: 3 });
    const line = t.items[0].line;
    const less = ownerDropStep(t, line, 1);
    assert.equal(less.items[0].steps.length, 1);
    assert.equal(less.items[0].units, 2);
    assert.equal(less.cost, t.cost - 900);
    assert.equal(less.pays, t.pays - 1000);
    assert.equal(less.profit, t.profit - 100);
    t = recordBuy(t, line, 0, 2);
    assert.equal(ownerDropStep(t, line, 0), t, 'bought: it stays');
    assert.equal(ownerDropStep(t, 'flip:none', 0), t);
});

test('a step bought on the Item Market: its buys come from your log\'s market rows, its state from the market\'s listings', () => {
    const wanted = new Set(['186']);
    const rows = [
        { id: 'a', t: 5, side: 'buy', venue: 'market', itemId: '186', qty: 2, each: 940 },
        { id: 'b', t: 6, side: 'buy', venue: 'market', itemId: '999', qty: 1, each: 5 },
        { id: 'c', t: 7, side: 'buy', venue: 'bazaar', itemId: '186', qty: 1, each: 5, who: '71' },
        { id: 'd', t: 8, side: 'sell', venue: 'market', itemId: '186', qty: 1, each: 5 },
    ];
    assert.deepEqual(marketBuyRows(rows, wanted), [{ id: 'a', t: 5, itemId: '186', qty: 2, each: 940, sellerId: OWNER_MARKET }]);
    assert.deepEqual(marketBuyRows(rows, new Set()), []);
    const step = { sellerId: OWNER_MARKET, qty: 2, price: 950, bought: false };
    assert.equal(marketRows(null), null);
    assert.equal(stepState(step, marketRows([{ price: 950, qty: 9 }])).state, 'ok');
    assert.equal(stepState(step, marketRows([{ price: 950, qty: 1 }, { price: 950, qty: 1 }, { price: 960, qty: 4 }])).state, 'ok', 'two listings at one price are one lot');
    assert.equal(stepState(step, marketRows([{ price: 950, qty: 1 }])).state, 'short');
    assert.notEqual(stepState(step, marketRows([{ price: 990, qty: 9 }])).state, 'ok');
});

test('Next on the Item Market: piece by piece, then the trade', () => {
    const MARKET_URL = 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=186&itemName=Sheep+Plushie';
    assert.equal(marketPageItem(MARKET_URL), '186');
    assert.equal(marketPageItem('https://www.torn.com/page.php?sid=ItemMarket#/market/view=category&categoryName=Plushie'), null);
    assert.equal(marketPageItem('https://www.torn.com/bazaar.php?userId=5&itemID=186'), null);
    const step = (sellerId, bought = false) => ({ sellerId, qty: 1, price: 5, bought });
    const t = { items: [
        { itemId: '186', name: 'Sheep', kind: 'flip', steps: [step('71', true), step(OWNER_MARKET)] },
        { itemId: '187', name: 'Teddy', kind: 'flip', steps: [step('71', true)] },
        { itemId: '215', name: 'Kitten', kind: 'flip', steps: [step(OWNER_MARKET)] },
        { itemId: '258', name: 'Jaguar', kind: 'flip', steps: [step(OWNER_MARKET, true)] },
    ] };
    assert.deepEqual(marketNext(t), { itemId: '186', name: 'Sheep' });
    assert.deepEqual(marketNext(t, '999'), { itemId: '186', name: 'Sheep' }, 'on another item\'s market page: the first');
    assert.deepEqual(marketNext(t, '186'), { itemId: '215', name: 'Kitten' });
    assert.equal(marketNext(t, '215'), null, 'after the last: the trade');
});

test('ages stay short', () => {
    assert.deepEqual([5000, 185000, 3 * 3600000 + 12 * 60000, 2 * DAY + 4 * 3600000, 3 * DAY].map(ownerAge), ['5s', '3m', '3h 12m', '2d 4h', '3d']);
});
