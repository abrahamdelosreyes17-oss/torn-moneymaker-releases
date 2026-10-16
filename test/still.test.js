// A trade stays still (core/still.js; plan part 3, drawing 2, the owner's yes of 2026-10-10 with his
// change: "the prices should still update"). From Plan trade until the trade ends the list and the
// Best flips cards keep their ORDER; every price and profit stays live where it stands, with a mark
// on a number that changed; new deals wait in one amber line until he lets them in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keptOrder, stillStart, stillList, stillCards, stillWaiting, stillLine, stillEnded, stillTrade, stillAdopt, STILL_ENDED_MS } from '../src/core/still.js';

const NOW = 1_800_000_000_000;
const MIN = 60000;
const row = (itemId, value, { flip = value > 0, held = 0, bid = 0, name = 'Item ' + itemId } = {}) => ({ itemId: String(itemId), name, value, held, bid, badge: flip ? { kind: 'flip', amount: value } : null });
const card = (itemId, profit, buyer = 'Bob', name = 'Item ' + itemId) => ({ itemId: String(itemId), name, plan: { profit, units: 3 }, buyer: { name: buyer } });
// The list's own order (main.js): money first, then what you hold, then the best price, then the name.
const sorted = (rows) => [...rows].sort((a, b) => b.value - a.value || (b.held > 0) - (a.held > 0) || b.bid - a.bid || String(a.name).localeCompare(String(b.name)));
const ids = (rows) => rows.map((r) => r.itemId);

test('held: the rows keep the order they had at Plan trade, whatever their numbers do - and the numbers shown are the live ones', () => {
    const before = sorted([row(1, 87420), row(2, 29800), row(3, 18400), row(4, 14700), row(5, 3960), row(6, 0, { held: 2, bid: 50 })]);
    assert.deepEqual(ids(before), ['1', '2', '3', '4', '5', '6']);
    const still = stillStart({ rows: before, cards: [], now: NOW });
    // Twenty seconds on: 2 fell, 4 rose above it, 3 is not a flip any more (bought out).
    const after = sorted([row(1, 87420), row(2, 21000), row(3, 0, { flip: false }), row(4, 41000), row(5, 3960), row(6, 0, { held: 2, bid: 50 })]);
    assert.deepEqual(ids(after), ['1', '4', '2', '5', '6', '3'], 'the live order has moved');
    const shown = stillList(still, after);
    assert.deepEqual(ids(shown), ['1', '2', '3', '4', '5', '6']);
    // Live numbers, where they stand; a mark on each that changed.
    assert.deepEqual(shown.map((r) => r.value), [87420, 21000, 0, 41000, 3960, 0]);
    assert.deepEqual(shown.map((r) => r.still.move), [null, 'down', 'down', 'up', null, null]);
    // A flip at Plan trade that is not one now greys in its place.
    assert.deepEqual(shown.map((r) => r.still.gone), [false, false, true, false, false, false]);
    // The rows given are not changed (the cards and the desk use them too).
    assert.equal(after.some((r) => 'still' in r), false);
});

test('a tab, a search or a category shows fewer rows: those shown are still in the held order, and one first seen during the hold stays where it first stood', () => {
    const all = sorted([row(1, 500), row(2, 400), row(3, 300), row(4, 200)]);
    const still = stillStart({ rows: all, cards: [], now: NOW });
    const moved = [row(4, 900), row(2, 100), row(1, 500)];
    assert.deepEqual(ids(stillList(still, sorted(moved))), ['1', '2', '4']);
    // A row that was not in the list at Plan trade (a new buyer's item): placed by what it was worth when first seen...
    const withNew = sorted([row(1, 500), row(2, 400), row(3, 300), row(4, 200), row(9, 350)]);
    assert.deepEqual(ids(stillList(still, withNew)), ['1', '2', '9', '3', '4']);
    // ...and it does not move after that, whatever it does.
    const later = sorted([row(1, 500), row(2, 400), row(3, 300), row(4, 200), row(9, 5)]);
    const shown = stillList(still, later);
    assert.deepEqual(ids(shown), ['1', '2', '9', '3', '4']);
    assert.equal(shown[2].still.move, 'down');
    // Not held: the rows as they are, untouched.
    assert.equal(stillList(null, later), later);
});

test('the cards: the same ones in the same places; one that is not a flip any more stays, greyed; a new deal is not a card - it waits', () => {
    const flips = [card(1, 87420, 'Lumei'), card(2, 29800), card(3, 18400, 'KayMalta'), card(4, 14700, 'Lumei'), card(5, 3960, 'ELIZA_BITE')];
    const rows = sorted(flips.map((f) => row(f.itemId, f.plan.profit)));
    const still = stillStart({ rows, cards: flips.slice(0, 4), now: NOW });
    // Later: 2 fell, 3 is gone, 4 rose, and three deals appeared that were not flips at Plan trade - one better than everything.
    const now = NOW + 3 * MIN;
    const live = [card(7, 41200, 'KayMalta', 'Xanax'), card(1, 87420, 'Lumei'), card(4, 30000, 'Lumei'), card(8, 22900, 'Bob', 'Erotic DVD'), card(2, 21000), card(9, 6300, 'ELIZA_BITE', 'Cannabis'), card(5, 3960, 'ELIZA_BITE')];
    const shown = stillCards(still, live, { limit: 4 });
    assert.deepEqual(ids(shown), ['1', '2', '3', '4']);
    assert.deepEqual(shown.map((c) => (c.still.gone ? 'gone' : c.plan.profit)), [87420, 21000, 'gone', 30000]);
    assert.deepEqual(shown.map((c) => c.still.move), [null, 'down', null, 'up']);
    // The greyed card keeps its name and says what it was.
    assert.equal(shown[2].name, 'Item 3');
    assert.equal(shown[2].still.was, 18400);
    assert.equal(shown[2].plan, null);
    // Waiting: the deals that were not flips at Plan trade, best first, each with when it was first seen.
    const waiting = stillWaiting(still, live, now);
    assert.deepEqual(waiting.map((w) => [w.itemId, w.name, w.trader, w.profit, w.since]), [
        ['7', 'Xanax', 'KayMalta', 41200, now],
        ['8', 'Erotic DVD', 'Bob', 22900, now],
        ['9', 'Cannabis', 'ELIZA_BITE', 6300, now],
    ]);
    // Item 5 was a flip at Plan trade (just not one of the four cards): it is not "new".
    assert.equal(waiting.some((w) => w.itemId === '5'), false);
    // A minute on, one of them is gone again and another came: "since" is each one's own first sight.
    const later = stillWaiting(still, [card(7, 41000, 'KayMalta', 'Xanax'), card(10, 900, 'Bob', 'Hammer'), card(9, 6300, 'ELIZA_BITE', 'Cannabis')], now + MIN);
    assert.deepEqual(later.map((w) => [w.itemId, w.since]), [['7', now], ['9', now], ['10', now + MIN]]);
    // Fewer than four cards at Plan trade: the free places stay free (a new deal waits, it does not take one).
    const two = stillStart({ rows, cards: flips.slice(0, 2), now: NOW });
    assert.deepEqual(ids(stillCards(two, live, { limit: 4 })), ['1', '2']);
    // Not held: the first four, as always.
    assert.deepEqual(ids(stillCards(null, live, { limit: 4 })), ['7', '1', '4', '8']);
});

test('a trade is under way: one they said yes to, or one you planned and still touch - and whose name the line carries', () => {
    const HOLD = 2 * 60 * MIN;
    const acc = (itemId, name, at) => ({ itemId: String(itemId), key: 'id:' + itemId, at, trader: { name } });
    const hold = (name, touched, itemId = 5) => ({ trade: { itemId: String(itemId), trader: { name } }, touched });
    // Nothing planned, nothing accepted: the list is live.
    assert.equal(stillTrade({ accepted: [], holds: [], now: NOW, holdMs: HOLD }), null);
    // Planned (held from Plan trade): under way, with that trader.
    assert.deepEqual(stillTrade({ holds: [hold('Lumei', NOW - MIN)], now: NOW, holdMs: HOLD }), { trader: 'Lumei', itemId: '5' });
    // Two plans: the one you touched last.
    assert.deepEqual(stillTrade({ holds: [hold('Lumei', NOW - 5 * MIN), hold('Bob', NOW - MIN, 6)], now: NOW, holdMs: HOLD }), { trader: 'Bob', itemId: '6' });
    // A plan left alone for the whole hold time is not a trade under way any more.
    assert.equal(stillTrade({ holds: [hold('Lumei', NOW - HOLD)], now: NOW, holdMs: HOLD }), null);
    // Accepted comes before a plan; with two accepted, the one on the desk, else the newest.
    const two = [acc(1, 'KayMalta', NOW - 9 * MIN), acc(2, 'ELIZA_BITE', NOW - 3 * MIN)];
    assert.deepEqual(stillTrade({ accepted: two, holds: [hold('Bob', NOW)], selected: '7', now: NOW, holdMs: HOLD }), { trader: 'ELIZA_BITE', itemId: '2' });
    assert.deepEqual(stillTrade({ accepted: two, selected: '1', now: NOW, holdMs: HOLD }), { trader: 'KayMalta', itemId: '1' });
    // No name stored: under way all the same, and no name is made up.
    assert.deepEqual(stillTrade({ accepted: [{ itemId: '1', at: NOW, trader: {} }], now: NOW }), { trader: null, itemId: '1' });
    // Their Torn id comes with it where the trade has one (the trade you are on first is matched by it).
    assert.deepEqual(stillTrade({ accepted: [{ itemId: '1', at: NOW, trader: { name: 'Trader 123', id: 123 } }], now: NOW }), { trader: 'Trader 123', itemId: '1', traderId: '123' });
});

test('a search changed during the hold: the rows it brings back were there all along - placed as they are, and never counted as new', () => {
    // At Plan trade he had typed "plush": only those rows existed.
    const still = stillStart({ rows: sorted([row(1, 500), row(2, 300)]), cards: [], now: NOW });
    // A deal that is really new, seen while the search was still on.
    assert.deepEqual(stillWaiting(still, [card(8, 900)], NOW + MIN).map((w) => w.itemId), ['8']);
    // The search is cleared: everything else is back.
    const all = sorted([row(1, 500), row(2, 300), row(3, 700), row(4, 0, { flip: false }), row(8, 900)]);
    stillAdopt(still, all);
    assert.deepEqual(stillWaiting(still, [card(3, 700), card(8, 900), card(1, 500)], NOW + 2 * MIN).map((w) => w.itemId), ['8'], 'only the new one waits');
    assert.deepEqual(ids(stillList(still, all)), ['8', '3', '1', '2', '4']);
    // Adopted once: what it does afterwards is a change like any other row's.
    stillAdopt(still, sorted([row(3, 100), row(4, 950)]));
    assert.deepEqual(stillWaiting(still, [card(4, 950)], NOW + 3 * MIN).map((w) => w.itemId), ['4']);
    assert.doesNotThrow(() => stillAdopt(null, all));
});

test('the amber line: who the list is held for, how many deals wait and the best of them - or that nothing is new', () => {
    const money = (n) => '+$' + n.toLocaleString('en-US');
    const waiting = [{ itemId: '7', name: 'Xanax', trader: 'KayMalta', profit: 41200, since: NOW - 2 * MIN }, { itemId: '8', name: 'Erotic DVD', trader: 'Bob', profit: 22900, since: NOW - MIN }, { itemId: '9', name: 'Cannabis', trader: 'ELIZA_BITE', profit: 6300, since: NOW - 40000 }];
    assert.deepEqual(stillLine({ trader: 'Lumei' }, waiting, NOW, money), {
        lead: 'Held while you trade with Lumei.',
        rest: '3 new deals waiting · best +$41,200',
        count: 3,
        rows: [
            { itemId: '7', text: 'Xanax → KayMalta · new 2m ago', profit: '+$41,200' },
            { itemId: '8', text: 'Erotic DVD → Bob · new 1m ago', profit: '+$22,900' },
            { itemId: '9', text: 'Cannabis → ELIZA_BITE · new 40 s ago', profit: '+$6,300' },
        ],
    });
    assert.equal(stillLine({ trader: 'Lumei' }, waiting.slice(0, 1), NOW, money).rest, '1 new deal waiting · +$41,200');
    // So he knows the list is held on purpose, not stuck.
    assert.deepEqual(stillLine({ trader: 'Lumei' }, [], NOW, money), { lead: 'Held while you trade with Lumei.', rest: 'Nothing new.', count: 0, rows: [] });
    // The trader's name is not known (a trade restored with no name): no name is made up.
    assert.equal(stillLine({ trader: null }, [], NOW, money).lead, 'Held while you trade.');
});

test('the trade ended: said once, with how many came in - and gone after a few seconds', () => {
    const ended = { trader: 'Lumei', came: 3, at: NOW };
    assert.equal(stillEnded(ended, NOW + 1000), 'Trade with Lumei ended. 3 new deals came in, and the rows sorted.');
    assert.equal(stillEnded({ ...ended, came: 1 }, NOW + 1000), 'Trade with Lumei ended. 1 new deal came in, and the rows sorted.');
    assert.equal(stillEnded({ ...ended, came: 0 }, NOW + 1000), 'Trade with Lumei ended. The rows sorted.');
    // "Let them in now": the trade goes on; only the list was let go.
    assert.equal(stillEnded({ ...ended, let: true }, NOW + 1000), '3 new deals came in, and the rows sorted.');
    assert.equal(stillEnded(ended, NOW + STILL_ENDED_MS), null);
    assert.equal(stillEnded(null, NOW), null);
});

test('held, Best flips: a flip that sells to another trader now stands with that trader - one trader, one row (2026-10-16)', () => {
    const flip = (itemId, value, buyer) => ({ ...row(itemId, value), plan: { buyer: { id: buyer, name: 'T' + buyer } } });
    const still = stillStart({ rows: [flip(1, 900, 7), flip(2, 500, 8), flip(3, 100, 9)], cards: [], now: NOW });
    // 3 sold to trader 9 at the hold; now trader 7 pays most for it.
    const shown = stillList(still, [flip(1, 900, 7), flip(2, 500, 8), flip(3, 120, 7)], { together: true });
    assert.deepEqual(ids(shown), ['1', '3', '2'], "trader 7's two flips stand together");
    // A flip that is none now keeps the hold's trader.
    const gone = stillList(still, [flip(1, 900, 7), flip(2, 500, 8), row(3, 0, { flip: false })], { together: true });
    assert.deepEqual(ids(gone), ['1', '2', '3']);
});

test('the order kept under the pointer: rows stay where they were drawn, and a trader is never two rows (2026-10-16)', () => {
    const r = (itemId, group = null) => ({ itemId: String(itemId), group });
    const ids2 = (rows) => rows.map((x) => x.itemId);
    // Nothing moved: as drawn; a new row with no trader goes last.
    assert.deepEqual(ids2(keptOrder(['1', '2', '3'], [r(3, 'c'), r(9), r(1, 'a'), r(2, 'b')])), ['1', '2', '3', '9']);
    // The Dahlia: a new row of KayMalta's joins KayMalta, not the end.
    assert.deepEqual(ids2(keptOrder(['870', '335', '206'], [r(870, 'k'), r(335, 'c'), r(206, 'b'), r(1006, 'k')])), ['870', '1006', '335', '206']);
    // (a) the middle row of Ann's leaves for W, who has no other row: Ann's stay together.
    assert.deepEqual(ids2(keptOrder(['a', 'b', 'c'], [r('a', 'ann'), r('b', 'w'), r('c', 'ann')])), ['a', 'c', 'b']);
    // (b) two rows far apart now both sell to K: together at the first.
    assert.deepEqual(ids2(keptOrder(['1', '2', '3', '4', '5', '6'], ['x', 'y', 'z', 'q', 'v'].map((g, i) => r(i + 1, g)).concat(r(6, 'x')).map((x) => (x.itemId === '1' || x.itemId === '5' ? { ...x, group: 'k' } : x)))), ['1', '5', '2', '3', '4', '6']);
    // (c) an old row now K's and a new K row: together.
    assert.deepEqual(ids2(keptOrder(['1', '2'], [r(1, 'k'), r(2, 'b'), r(7, 'k')])), ['1', '7', '2']);
});
