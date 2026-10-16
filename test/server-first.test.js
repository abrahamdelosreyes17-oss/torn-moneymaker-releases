import test from 'node:test';
import assert from 'node:assert/strict';
import { noteAgreement, serverLeads, agreementKept, sourceSplit, withOwnReads, confirmedRows, confirmWants, parseOwnBazaar, SERVER_LEAD_AGREE, OWN_CONFIRM_MS } from '../src/core/server-first.js';

const row = (sellerId, price, qty = 1, o = {}) => ({ sellerId: String(sellerId), price, qty, dataAt: 0, ...o });

test('the server leads an item only once it knew what TornW3B said, often enough', () => {
    const kept = {};
    assert.equal(noteAgreement(kept, 206, [row(1, 100)], [], 1), false, 'nothing from the server: nothing compared');
    for (let i = 0; i < SERVER_LEAD_AGREE - 1; i++) noteAgreement(kept, 206, [row(1, 100)], [{ price: 99, qty: 1 }], i);
    assert.equal(serverLeads(kept, 206), false);
    noteAgreement(kept, 206, [row(1, 100)], [{ price: 100, qty: 1 }], 9);
    assert.equal(serverLeads(kept, '206'), true);
    // The server missing the cheapest: no lead.
    const other = {};
    for (let i = 0; i < 5; i++) noteAgreement(other, 7, [row(1, 100)], [{ price: 150, qty: 1 }], i);
    assert.equal(serverLeads(other, 7), false);
});

test('what is saved weighs old reads out', () => {
    assert.deepEqual(agreementKept({ a: [30, 30, 5], b: [1, 1, 9] }), { b: [1, 1, 9], a: [15, 15, 5] });
});

test('the split, for the speed log', () => {
    const now = 1e6;
    const bazaars = new Map([['1', { at: now - 10 }], ['2', { at: now - 10, server: true }], ['3', { at: now - 10 }], ['4', { at: now - 1e9 }]]);
    const seen = new Map([['2', now], ['3', now], ['5', now]]);
    assert.deepEqual(sourceSplit(bazaars, seen, now, 1000), { server: 2, w3b: 1, both: 1, none: 1 });
});

test('an own read of a seller stands over older rows; a seller who sold out goes', () => {
    const now = 1e6;
    const reads = new Map([['1', { at: now - 1000, items: new Map([['206', [{ price: 120, qty: 2 }]]]) }], ['2', { at: now - 1000, items: new Map() }]]);
    const rows = [row(1, 100, 5, { shared: true }), row(2, 110, 1, { shared: true }), row(3, 130, 1, { shared: true })];
    const got = withOwnReads(rows, 206, reads, now);
    assert.deepEqual(got.map((r) => [r.sellerId, r.price, r.qty, Boolean(r.own)]), [['1', 120, 2, true], ['3', 130, 1, false]]);
    // Too old: as it was.
    assert.equal(withOwnReads(rows, 206, reads, now + OWN_CONFIRM_MS), rows);
    // A server-led flip stands only on what this PC read.
    assert.deepEqual(confirmedRows(got, 206, reads, now).map((r) => r.sellerId), ['1']);
    // The server read seller 1 again since: their row is the server's, and still stands on this PC's read.
    const again = [row(1, 125, 1, { shared: true, dataAt: now })];
    assert.deepEqual(confirmedRows(withOwnReads(again, 206, reads, now), 206, reads, now).map((r) => r.price), [125]);
    // ...but not once that read is old.
    assert.deepEqual(confirmedRows(again, 206, reads, now + OWN_CONFIRM_MS + 1), []);
});

test('whose bazaars to confirm: under the bid, cheapest first, not read lately', () => {
    const now = 1e6;
    const rows = [row(3, 90, 1, { shared: true }), row(1, 80, 1, { shared: true }), row(2, 85, 1, { own: true, shared: false }), row(4, 200, 1, { shared: true }), row(5, 70, 1)];
    assert.deepEqual(confirmWants([{ rows, bid: 100 }], new Map(), now), ['1', '3']);
    assert.deepEqual(confirmWants([{ rows, bid: 100 }], new Map([['1', { at: now - 10 }]]), now), ['3']);
    assert.deepEqual(confirmWants([{ rows, bid: 100 }], new Map(), now, { sent: new Map([['3', now - 5]]) }), ['1']);
});

test('Torn\'s bazaar answer, v1 or v2 names', () => {
    const got = parseOwnBazaar({ bazaar: [{ ID: 206, price: 100, quantity: 2 }, { id: 206, price: 90, amount: 1 }, { ID: 'x', price: 1, quantity: 1 }] });
    assert.deepEqual([...got], [['206', [{ price: 100, qty: 2 }, { price: 90, qty: 1 }]]]);
    assert.equal(parseOwnBazaar({ error: { code: 2 } }), null);
});
