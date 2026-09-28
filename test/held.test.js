/*
 * 3.14: the desk follows the #1 flip until you pick; the possible flips are
 * read before an idle trade's items; a trade you start on (or pin) holds
 * still - only prices and profit move (core/desk.js, core/held.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { deskItem, nextW3bRead } from '../src/core/desk.js';
import { holdTrade, priceHeld, resolveEstimated, editHeld, livePins, PIN_MAX, PIN_MAX_AGE_MS } from '../src/core/held.js';

const f = (itemId) => ({ itemId });

test('the desk shows the #1 flip until you pick one - not the first flip that loaded', () => {
    // 3.13: the desk stayed on Small First Aid Kit (+$2,308) while it was anywhere in the top four.
    const strip = [f('virus'), f('cache'), f('kit'), f('xanax')];
    assert.equal(deskItem({ selected: 'kit', strip, listed: [f('a')] }), 'virus');
    assert.equal(deskItem({ pickedByYou: true, selected: 'kit', strip }), 'kit', 'one you picked stays');
    assert.equal(deskItem({ selected: 'kit', strip, filter: 'mine', listed: [f('held1')] }), 'held1', 'Mine: the first of yours');
    assert.equal(deskItem({ strip: [], listed: [f('a')] }), 'a');
    assert.equal(deskItem({ strip: [], listed: [] }), null);
});

const due = (set) => (id) => set.has(id);

test('the possible flips are read before an idle trade\'s items; a trade under way first', () => {
    const p = { picked: 'desk', live: ['t1'], wanted: ['t2'], candidates: ['c1'], pinned: ['p1'], list: null, turn: 1, due: due(new Set(['t1', 't2', 'c1', 'p1'])) };
    // Nobody working on the trade: the flips first (3.13 read the trade's items first, always).
    assert.deepEqual(nextW3bRead({ ...p, active: false }), { kind: 'bazaars', id: 'c1' });
    assert.deepEqual(nextW3bRead({ ...p, active: true }), { kind: 'bazaars', id: 't1' });
    // The flips done: then the idle trade's unread items, then pinned trades'.
    assert.deepEqual(nextW3bRead({ ...p, active: false, due: due(new Set(['t2', 'p1'])) }), { kind: 'bazaars', id: 't2' });
    assert.deepEqual(nextW3bRead({ ...p, active: false, due: due(new Set(['p1'])) }), { kind: 'bazaars', id: 'p1' });
    // The summary and the item on the desk come first; lists take turns with the flips.
    assert.deepEqual(nextW3bRead({ ...p, summaryDue: true }), { kind: 'summary' });
    assert.deepEqual(nextW3bRead({ ...p, due: due(new Set(['desk', 'c1'])) }), { kind: 'bazaars', id: 'desk' });
    assert.deepEqual(nextW3bRead({ ...p, active: false, list: 'L', turn: 0 }), { kind: 'list', id: 'L' });
    assert.equal(nextW3bRead({ ...p, due: () => false }), null);
});

const CHOSEN = {
    key: 'id:5001',
    buyer: { id: '5001', name: 'KayMalta', price: 1157499 },
    main: '870',
    flips: [
        { itemId: '870', name: 'Stealth Virus', bid: 1157499, units: 42, role: 'main', kind: 'normal', steps: [{ sellerId: 'A', sellerName: 'A', qty: 30, price: 809351 }, { sellerId: 'B', sellerName: 'B', qty: 12, price: 812000 }] },
        { itemId: '1006', name: 'Dahlia', bid: 1500, units: 25, role: 'extra', kind: 'fast', steps: [{ sellerId: 'A', sellerName: 'A', qty: 25, price: 1100 }] },
        { itemId: '1010', name: 'Lollipop', bid: 400, units: 1, role: 'extra', kind: 'fast', estimated: true, steps: [{ sellerId: null, sellerName: null, qty: 1, price: 300 }] },
    ],
};
const row = (sellerId, price, qty) => ({ sellerId, sellerName: sellerId, price, qty, stale: false });

test('holding a trade keeps what you unticked, unticked', () => {
    const held = holdTrade({ ...CHOSEN, off: [{ itemId: '9', name: 'Beer', bid: 70 }] }, '870');
    assert.deepEqual(held.off.map((o) => o.itemId), ['9']);
    // Ticked back with nothing held for it: its bazaars are picked afresh.
    const back = editHeld(held, '9', { qty: 5 }, (id, n) => [{ sellerId: 'Q', sellerName: 'Q', qty: n, price: 60 }]);
    assert.equal(back.lines.find((l) => l.itemId === '9').units, 5);
    const tick = editHeld(held, '9', null, (id, n) => [{ sellerId: 'Q', sellerName: 'Q', qty: n, price: 60 }], { units: 10 });
    assert.equal(tick.lines.find((l) => l.itemId === '9').units, 10, 'ticked back: its kinds amount');
});

test('a held trade keeps its items; only the prices and profit move', () => {
    const held = holdTrade(CHOSEN, '870', 1000);
    const rows = {
        870: [row('A', 815000, 30), row('B', 812000, 5)], // A re-priced, B has fewer left
        1006: [], // Dahlia gone from A
        1010: null,
    };
    const bids = { 870: 1160000, 1006: 1500 };
    const p = priceHeld(held, { rowsOf: (id) => rows[id], bidOf: (id) => bids[id] || null, lowestOf: (id) => (id === '1010' ? 310 : null) });
    assert.deepEqual(p.lines.map((l) => l.itemId), ['870', '1006', '1010'], 'every item stays, in its place');
    const virus = p.lines[0];
    assert.deepEqual(virus.steps.map((st) => st.check.state), ['price', 'short']);
    assert.equal(virus.units, 35);
    assert.equal(virus.profit, 30 * (1160000 - 815000) + 5 * (1160000 - 812000), 'their price now, the bazaars now');
    assert.equal(virus.plannedUnits, 42);
    const dahlia = p.lines[1];
    assert.equal(dahlia.units, 0, 'gone: nothing to buy, but still listed');
    assert.equal(dahlia.steps[0].check.state, 'gone');
    const lolly = p.lines[2];
    assert.equal(lolly.bid, 400, 'not on their list now: the held price stands in');
    assert.equal(lolly.noBid, true);
    assert.equal(lolly.profit, 400 - 310, '≈: the cheapest price known');
    assert.equal(p.profit, p.lines.reduce((a, l) => a + l.profit, 0));
    assert.equal(p.stops, 3, 'bazaars A and B, and one for the ≈ line');
});

test('a held trade never counts a unit twice, nor one that is gone', () => {
    const one = { key: 'k', trader: { id: '1', name: 'T' }, itemId: 'x', main: 'x', at: 0, lines: [
        { itemId: 'x', bid: 200, units: 15, steps: [{ sellerId: 'X', qty: 5, price: 100 }, { sellerId: 'X', qty: 10, price: 120 }] },
        { itemId: 'y', bid: 200, units: 10, steps: [{ sellerId: 'Y', qty: 10, price: 100 }] },
    ] };
    // X's $100 listing sold; Y re-priced AND has only 2 left.
    const rows = { x: [row('X', 120, 10)], y: [row('Y', 110, 2)] };
    const p = priceHeld(one, { rowsOf: (id) => rows[id], bidOf: () => 200 });
    assert.equal(p.lines[0].units, 10, 'X has 10, not 15');
    assert.equal(p.lines[1].units, 2);
    assert.equal(p.lines[1].profit, 2 * (200 - 110));
    assert.equal(p.lines[1].steps[0].check.state, 'short');
});

test('a held line that stops paying stays, marked as losing', () => {
    const held = holdTrade(CHOSEN, '870');
    const p = priceHeld(held, { rowsOf: (id) => (id === '1006' ? [row('A', 1600, 25)] : null), bidOf: () => null });
    const dahlia = p.lines.find((l) => l.itemId === '1006');
    assert.equal(dahlia.losing, true);
    assert.ok(dahlia.profit < 0);
});

test('an ≈ line takes its steps once read; the item and its place stay', () => {
    const held = holdTrade(CHOSEN, '870');
    const live = [{ itemId: '1010', units: 30, estimated: false, steps: [{ sellerId: 'C', sellerName: 'C', qty: 30, price: 300 }] }];
    const next = resolveEstimated(held, live);
    assert.notEqual(next, held);
    assert.equal(next.lines[2].estimated, false);
    assert.equal(next.lines[2].units, 30);
    assert.deepEqual(next.lines.map((l) => l.itemId), ['870', '1006', '1010']);
    assert.equal(resolveEstimated(next, live), next, 'nothing more to resolve: the same trade');
    // Read since, but no longer in the live plan: it picks its own bazaars, never stays ≈.
    const own = resolveEstimated(held, [], (id) => (id === '1010' ? [{ sellerId: 'D', sellerName: 'D', qty: 30, price: 301 }] : null));
    assert.equal(own.lines[2].estimated, false);
    assert.equal(own.lines[2].units, 30);
    assert.equal(resolveEstimated(held, [], () => null), held, 'not read yet: still ≈');
});

test('only you change a held trade: untick, tick back, a number re-picks that line only', () => {
    const held = holdTrade(CHOSEN, '870');
    const off = editHeld(held, '1006', { off: true }, () => null);
    assert.deepEqual(off.lines.map((l) => l.itemId), ['870', '1010']);
    assert.deepEqual(off.off.map((l) => l.itemId), ['1006']);
    const back = editHeld(off, '1006', null, () => [{ sellerId: 'Z', sellerName: 'Z', qty: 1, price: 1 }]);
    assert.deepEqual(back.lines, held.lines, 'ticked back: as it was - same bazaars, same place');
    assert.deepEqual(back.off, []);
    const more = editHeld(held, '870', { qty: 10 }, (id, n) => [{ sellerId: 'A', sellerName: 'A', qty: n, price: 809351 }]);
    assert.equal(more.lines[0].units, 10);
    assert.deepEqual(more.lines[1], held.lines[1], 'the other lines untouched');
    const added = editHeld(held, '1011', { qty: 30 }, (id, n) => [{ sellerId: 'D', sellerName: 'D', qty: n, price: 300 }], { name: 'Lollipop 2', bid: 400, kind: 'fast' });
    assert.equal(added.lines.length, 4);
    assert.equal(added.lines[3].bid, 400);
    assert.equal(editHeld(held, '870', { qty: 10 }, () => null), held, 'nothing to buy: unchanged');
});

test('pins: newest first, at most a few, a week at most', () => {
    const now = 10 * PIN_MAX_AGE_MS;
    const stored = {};
    for (let i = 0; i < PIN_MAX + 3; i++) stored['i' + i + '|k'] = { key: 'k', lines: [], at: now - i * 1000 };
    stored['old|k'] = { key: 'k', lines: [], at: now - PIN_MAX_AGE_MS - 1 };
    stored['bad|k'] = { key: 'k' };
    const out = livePins(stored, now);
    assert.equal(Object.keys(out).length, PIN_MAX);
    assert.equal(Object.keys(out)[0], 'i0|k');
    assert.equal('old|k' in out, false);
});
