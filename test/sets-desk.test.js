/*
 * 3.24.0: the Sets page's data (core/sets-desk.js) - one snapshot worked out
 * from what Torn Bids holds, drawn by the Sets page and read by the marks on
 * Torn's pages. And the v2 shape of a log row, and a press of EXCHANGE that
 * Torn's log never showed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SETS, setByKey, shortName, tradeOffer, tradeMessage } from '../src/core/sets.js';
import { SETS_DEFAULTS, setsSettings, setsSnapshot, snapPiece, snapTradeCtx, bazaarForSets, heldLots, pressedOff, snapForTabs, snapReady, tradeNote } from '../src/core/sets-desk.js';
import { bookAdd, bookSettle, pointsLogTypes, entryFromLog } from '../src/core/points.js';

const PLUSHIE = setByKey('plushie');
const ID = Object.fromEntries(SETS.flatMap((s) => s.pieces.map((p) => [shortName(p.name), p.id])));
const MV = { Panda: 35000, Nessie: 61300, Jaguar: 13200, 'Red Fox': 11400, Camel: 70900, Chamois: 14150, Monkey: 32000, Lion: 50000, 'Teddy Bear': 680, Wolverine: 4150, Sheep: 620, Stingray: 4800, Kitten: 550 };
const mv = (id) => { const p = PLUSHIE.pieces.find((x) => x.id === Number(id)); return p ? MV[shortName(p.name)] : 1000; };
const HELD = { Panda: 12, Nessie: 18, Jaguar: 22, 'Red Fox': 31, Camel: 35, Chamois: 38, 'Teddy Bear': 40, Wolverine: 40, Monkey: 40, Lion: 40, Sheep: 41, Stingray: 44, Kitten: 46 };
const heldOf = (id) => { const p = PLUSHIE.pieces.find((x) => x.id === Number(id)); return p ? HELD[shortName(p.name)] : 0; };
const NOW = Date.UTC(2026, 9, 5, 14, 30);
const LISTINGS = [{ id: 'a', cost: 30900, qty: 500 }, { id: 'b', cost: 30950, qty: 800 }, { id: 'c', cost: 31000, qty: 2000 }];

function snapOf(over = {}) {
    return setsSnapshot({
        settings: setsSettings({ on: true, which: { plushie: true, flower: false }, targetMode: 'number', target: 40 }),
        held: heldOf, mv, lots: () => [], cash: null, leastProfitPct: 2, listings: LISTINGS, pointsAt: NOW, days: [], gone: [], book: [],
        offers: (id) => (Number(id) === ID.Panda ? [{ price: 34900, qty: 20, src: 'bazaar', who: 'Marlowe', whoId: 7 }, { price: 36000, qty: 9, src: 'market' }, { price: 99000, qty: 4, src: 'bazaar', who: 'Dear', whoId: 8 }]
            : Number(id) === ID.Nessie ? [{ price: 60000, qty: 3, src: 'bazaar', who: 'Marlowe', whoId: 7 }] : []),
        money: { points: 950, onHand: 1_000_000, vault: 400_000_000 }, now: NOW, ...over,
    });
}

test('the settings: off until switched on, and what is stored is made safe', () => {
    assert.equal(SETS_DEFAULTS.on, false);
    assert.equal(setsSettings(null).on, false);
    assert.equal(setsSettings({ on: 'yes' }).on, false);
    const s = setsSettings({ on: true, pct: 999, target: -3, shareMax: 0, readMin: 7, pointsRule: 'x', which: { flower: false }, junk: 1 });
    assert.deepEqual([s.on, s.pct, s.target, s.shareMax, s.readMin, s.pointsRule, s.which.plushie, s.which.flower, 'junk' in s], [true, 101, 40, 30, 10, 'wall', true, false, false]);
    assert.equal(setsSettings({ pct: 99.46 }).pct, 99.5);
});

test('the snapshot: stock, what a set is worth, what to buy and from how many bazaars', () => {
    const s = snapOf();
    assert.equal(s.sets.length, 1);
    const set = s.sets[0];
    assert.deepEqual([set.key, set.full, set.target, set.short.name], ['plushie', 12, 40, 'Panda Plushie']);
    // No wall in three even steps: $1 under the lowest.
    assert.deepEqual([s.points.price, s.points.rule, s.points.held], [30899, 'lowest', 950]);
    assert.equal(set.value, 308990);
    const panda = snapPiece(s, ID.Panda).piece;
    assert.deepEqual([panda.held, panda.need, panda.top, panda.mv, panda.rate, panda.worth], [12, 28, true, 35000, 35350, 36199]);
    assert.deepEqual([panda.low.price, panda.low.who, panda.lowBazaar], [34900, 'Marlowe', 34900]);
    // Panda: 20 at 34,900 and 8 of the 9 at 36,000 (both under 36,199); the 99,000 ones never. Nessie: 3 at 60,000.
    const row = set.buy.rows.find((r) => r.id === ID.Panda);
    assert.deepEqual([row.count, row.cost, row.units.length], [28, 20 * 34900 + 8 * 36000, 2]);
    assert.deepEqual([s.buyTotals.count, s.buyTotals.bazaars, s.buyTotals.market], [31, 1, 8]);
    assert.equal(snapPiece(s, 1), null);
    // 12 full sets at market value where no buy is on record.
    assert.deepEqual([s.totals.full, s.totals.points, s.totals.known], [12, 120, false]);
    assert.equal(s.forum.title, '[OPEN] Buying Plushies · 101% of market value');
});

test('the snapshot with Sets off, and with no points price: nothing is guessed', () => {
    const off = snapOf({ settings: setsSettings({ on: false }) });
    assert.deepEqual([off.on, off.sets.length, off.totals.full], [false, 0, 0]);
    const blind = snapOf({ listings: [] });
    assert.equal(blind.points.price, 0);
    assert.equal(blind.sets[0].value, 0);
    assert.equal(blind.sets[0].buy.count, 0);
    assert.equal(snapPiece(blind, ID.Panda).piece.worth, 0);
});

test('what the Torn tabs get: the same numbers, the long tables left out', () => {
    const s = snapOf({ book: [{ id: 'page:1', t: NOW - 1000, kind: 'made', points: 30, each: 29000, set: 'plushie', src: 'page' }] });
    const t = snapForTabs(s);
    assert.equal(t.book.rows.length, 0);
    assert.equal(t.book.left, 30);
    assert.equal(t.sets[0].buy.count, s.sets[0].buy.count);
    assert.equal(t.sets[0].buy.rows, undefined);
    assert.equal(snapPiece(t, ID.Nessie).piece.need, 22);
    assert.ok(JSON.stringify(t).length < JSON.stringify(s).length);
});

test('a bazaar you are on: only pieces you need, only under their worth, never more than you need', () => {
    const s = snapOf();
    const r = bazaarForSets(s, [
        { itemId: ID.Panda, price: 34900, stock: 40 },
        { itemId: ID.Nessie, price: 70000, stock: 5 },
        { itemId: ID.Kitten, price: 100, stock: 9 },
        { itemId: 9999, price: 5, stock: 5 },
    ]);
    assert.deepEqual(r.rows.map((x) => [x.itemId, x.take, x.all]), [[ID.Panda, 28, false]]);
    assert.deepEqual([r.count, r.cost, r.gain], [28, 28 * 34900, 28 * (36199 - 34900)]);
    // Nessie (18) now holds the next set back.
    assert.equal(r.fullAfter.plushie, 18);
});

test('what your held pieces cost: your newest buys, up to the count held', () => {
    const rows = [
        { t: 1, qty: 30, each: 30000, side: 'buy' },
        { t: 3, qty: 10, each: 34000, side: 'buy' },
        { t: 2, qty: 5, each: 99999, side: 'sell' },
        { t: 4, qty: 4, each: 35000, side: 'buy' },
    ];
    assert.deepEqual(heldLots(rows, 12), [{ qty: 4, each: 35000 }, { qty: 8, each: 34000 }]);
    assert.deepEqual(heldLots(rows, 0), []);
    assert.deepEqual(heldLots(null, 5), []);
});

test('sets swapped since the inventory was read come off what it says', () => {
    const off = pressedOff([{ t: 200, set: 'plushie', sets: 3 }, { t: 50, set: 'plushie', sets: 9 }, { t: 300, set: 'nope', sets: 1 }], 100);
    assert.equal(off.get(String(ID.Panda)), 3);
    assert.equal(off.get('260'), undefined);
    assert.equal(pressedOff([{ t: 200, set: 'flower', sets: 2 }], 0).get('260'), 2);
});

test('the note for a trade open with you: who, how many kinds, what you need comes to', () => {
    const s = snapOf();
    const ctx = snapTradeCtx(s, setsSettings({ on: true, which: { plushie: true, flower: false } }));
    const items = [{ id: ID.Panda, name: 'Panda Plushie', qty: 10 }, { id: ID.Kitten, name: 'Kitten Plushie', qty: 4 }, { id: 5, name: 'Hammer', qty: 1 }];
    const n = tradeNote({ id: 77, who: 'Marlowe', whoId: 7, items }, tradeOffer(items, ctx));
    assert.equal(n.title, 'Trade open with Marlowe');
    assert.equal(n.text, '· 3 kinds of items · you need 1 of them · about $353,500 for those.');
    assert.equal(tradeNote({ id: 1, who: 'A' }, tradeOffer([], ctx)).text, '· nothing added yet.');
    assert.equal(tradeNote({ id: 1 }, tradeOffer([{ id: 5, name: 'Hammer', qty: 1 }], ctx)).text, '· 1 kind of item · no plushie or flower among them.');
    assert.equal(tradeNote({ id: 1 }, tradeOffer([{ id: ID.Kitten, name: 'Kitten Plushie', qty: 4 }], ctx)).text, '· 1 kind of item · pieces you have enough of for now.');
});

test("a row of Torn's v2 log: the type and title are under details", () => {
    const types = pointsLogTypes({ logtypes: { 7000: 'Museum exchange', 5011: 'Points market sell', 4900: 'Points use refill', 6001: 'Faction points use' } });
    assert.deepEqual([types.made, types.sold, types.used], [[7000], [5011], [4900]]);
    const ctx = { costOf: () => 29955, priceNow: 30899 };
    const row = { id: 'abc', timestamp: 100, details: { id: 7000, title: 'Museum exchange', category: 'Museum' }, data: { points: 120, set: 'Plushie Set' } };
    assert.deepEqual(entryFromLog(row.id, row, types, ctx), { id: 'log:abc', t: 100_000, kind: 'made', points: 120, each: 29955, set: 'plushie', src: 'log' });
    assert.equal(entryFromLog('x', { id: 'x', timestamp: 1, details: { id: 1225 }, data: { points: 5 } }, types, ctx), null);
});

test('a press of EXCHANGE the log never showed comes off, once the log is read past it', () => {
    const MIN = 60000;
    let book = bookAdd([], { id: 'page:1', t: 10 * MIN, kind: 'made', points: 30, each: 29000, set: 'plushie', src: 'page' });
    // The log is not read (no Full key): the press stands.
    assert.equal(bookSettle(book, 0), book);
    // Read up to two minutes after it: too soon to say.
    assert.equal(bookSettle(book, 12 * MIN), book);
    assert.equal(bookSettle(book, 20 * MIN).length, 0);
    // The log showed it: the merged entry stays, whenever.
    book = bookAdd(book, { id: 'log:9', t: 10 * MIN + 2000, kind: 'made', points: 30, each: 0, src: 'log' });
    assert.equal(bookSettle(book, 99 * MIN).length, 1);
});

test('a row with more than you need: the total for what you need counts only the units you need', () => {
    const s = snapOf();
    const ctx = snapTradeCtx(s, setsSettings({ on: true, which: { plushie: true, flower: false } }));
    // Chamois: you hold 38 of 40, they bring 10.
    const offer = tradeOffer([{ id: ID.Chamois, name: 'Chamois Plushie', qty: 10 }, { id: ID.Panda, name: 'Panda Plushie', qty: 10 }], ctx);
    const each = Math.round(14150 * 1.01);
    assert.deepEqual([offer.rows[0].take, offer.rows[0].extra, offer.rows[1].take, offer.rows[1].extra], [2, 8, 10, 0]);
    assert.deepEqual([offer.need.items, offer.need.total], [12, 2 * each + 10 * 35350]);
    assert.deepEqual([offer.all.items, offer.all.total], [20, 10 * each + 10 * 35350]);
});

test('the message for such a row: the units you need, and the rest at the same price if they want them gone', () => {
    const s = snapOf();
    const ctx = snapTradeCtx(s, setsSettings({ on: true, which: { plushie: true, flower: false } }));
    const offer = tradeOffer([{ id: ID.Chamois, name: 'Chamois Plushie', qty: 10 }], ctx);
    assert.equal(tradeMessage(offer, { open: true }), 'I can pay $28,584 for 2 Chamois Plushie ($14,292 each). 8 more Chamois ($14,292) I have enough of for now; same price if you want them gone.');
    assert.equal(tradeMessage(offer, { open: true, everything: true }), 'I can pay $142,920 for 10 Chamois Plushie ($14,292 each).');
});

test('a snapshot is shown on Torn pages only once your stock and the items\' values have been read', () => {
    assert.equal(snapReady(null), false);
    assert.equal(snapReady(snapOf()), false);                                   // stock never read
    assert.equal(snapReady(snapOf({ stockAt: NOW })), true);
    assert.equal(snapReady(snapOf({ stockAt: NOW, mv: () => 0 })), false);      // items not loaded yet
});
