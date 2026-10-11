/*
 * 3.26.0 (the owner, 2026-10-11): "nothing stale, no fake flips. everytime it
 * shows a flip, its because the item list is checked", "price list has to be
 * updated for at most 24 hours ago, prioritize recent updates", "when we find
 * the traders, make sure we automatically check their current prices all the
 * time" - core/checked.js, and what it asks of core/traders.js (which list is
 * read next) and core/desk.js (which read goes next).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { priceChecked, applyListToItemBuyers, buyersEveryMs, FLIP_CHECK_MS, FLIP_RECHECK_MS, DESK_RECHECK_MS, OTHER_RECHECK_MS } from '../src/core/checked.js';
import { emptyTraderDb, addTraders, recordW3bList, nextW3bTrader, liveW3bPrices, PRICES_STALE_MS, W3B_LIST_MAX_AGE_MS, W3B_HELD_REFRESH_MS, W3B_OTHER_REFRESH_MS, W3B_SLOW_REFRESH_MS } from '../src/core/traders.js';
import { nextW3bRead } from '../src/core/desk.js';

const NOW = 1_900_000_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const buyer = (o = {}) => ({ id: '7', name: 'Seven', price: 900, w3b: 900, te: null, ...o });

test('a price is checked when TornW3B named this trader at this price minutes ago, and their list changed within a day', () => {
    const item = { at: NOW - 2 * MIN, traders: [{ id: '7', price: 900 }, { id: '8', price: 880 }] };
    const o = { itemId: '206', item, listAt: NOW - 3 * HOUR, now: NOW };
    assert.deepEqual(priceChecked(buyer(), o), { ok: true, why: 'checked', at: NOW - 2 * MIN });

    // The check stands five minutes, and no longer.
    assert.equal(FLIP_CHECK_MS, 5 * MIN);
    assert.equal(priceChecked(buyer(), { ...o, item: { ...item, at: NOW - FLIP_CHECK_MS } }).ok, true);
    assert.deepEqual(priceChecked(buyer(), { ...o, item: { ...item, at: NOW - FLIP_CHECK_MS - 1 } }), { ok: false, why: 'not-checked', at: NOW - FLIP_CHECK_MS - 1 });

    // Never read, or read and they are not in it, or in it at another price: not checked.
    assert.deepEqual(priceChecked(buyer(), { ...o, item: null }), { ok: false, why: 'not-checked', at: 0 });
    assert.equal(priceChecked(buyer({ id: '9' }), o).why, 'not-checked');
    assert.equal(priceChecked(buyer({ price: 950, w3b: 950 }), o).why, 'not-checked');
});

test('a read kept in two parts checks a trader at the time of the part that names them, not of the newer part', () => {
    // Everyone was read 40 minutes ago; those who traded lately a minute ago. Eight is only in the older part.
    const item = {
        at: NOW - MIN,
        full: [{ id: '7', price: 900 }, { id: '8', price: 880 }], fullAt: NOW - 40 * MIN,
        lately: [{ id: '7', price: 900 }], latelyAt: NOW - MIN,
        traders: [{ id: '7', price: 900 }, { id: '8', price: 880 }],
    };
    const o = { itemId: '206', item, listAt: NOW - HOUR, now: NOW };
    assert.deepEqual(priceChecked(buyer(), o), { ok: true, why: 'checked', at: NOW - MIN });
    assert.deepEqual(priceChecked(buyer({ id: '8', price: 880, w3b: 880 }), o), { ok: false, why: 'not-checked', at: NOW - 40 * MIN });
    // The newer part names Seven at another price: the older part's price is not the one counted.
    const moved = { ...item, lately: [{ id: '7', price: 850 }], traders: [{ id: '8', price: 880 }, { id: '7', price: 850 }] };
    assert.equal(priceChecked(buyer({ price: 850, w3b: 850 }), { ...o, item: moved }).ok, true);
    assert.equal(priceChecked(buyer(), { ...o, item: moved }).at, NOW - 40 * MIN);

    // A list read between the two parts corrects the older part and leaves the newer one.
    const m = new Map([['206', item]]);
    assert.deepEqual(applyListToItemBuyers(m, '8', { 206: 700 }, NOW - 10 * MIN), ['206']);
    assert.deepEqual(m.get('206').full[1], { id: '8', price: 700 });
    assert.deepEqual(m.get('206').traders[1], { id: '8', price: 700 });
    assert.deepEqual(applyListToItemBuyers(m, '7', { 206: 1 }, NOW - 10 * MIN), ['206']);
    assert.equal(m.get('206').lately, item.lately, 'read after the list: it stands');
    assert.deepEqual(m.get('206').traders[0], { id: '7', price: 900 });
    assert.equal(m.get('206').full.find((t) => t.id === '7').price, 1);
});

test('their own list read minutes ago checks the price as well, and the newer of the two reads is the one told', () => {
    const list = { at: NOW - MIN, found: true, prices: { 206: 900, 180: 5 } };
    const o = { itemId: '206', list, listAt: NOW - HOUR, now: NOW };
    assert.deepEqual(priceChecked(buyer(), o), { ok: true, why: 'checked', at: NOW - MIN });
    // The list no longer holds the item, or holds it at another price.
    assert.equal(priceChecked(buyer(), { ...o, itemId: '1' }).ok, false);
    assert.equal(priceChecked(buyer({ w3b: 910, price: 910 }), o).ok, false);
    // A trader with no list on TornW3B.
    assert.equal(priceChecked(buyer(), { ...o, list: { at: NOW - MIN, found: false, prices: {} } }).ok, false);
    // Both reads: an old buyers read and a new list read is checked, at the list's time.
    const item = { at: NOW - 30 * MIN, traders: [{ id: '7', price: 900 }] };
    assert.deepEqual(priceChecked(buyer(), { ...o, item }), { ok: true, why: 'checked', at: NOW - MIN });
});

test('a TornExchange price makes no flip alone, a list not changed in a day neither, nor one whose date is not known', () => {
    const item = { at: NOW - MIN, traders: [{ id: '7', price: 900 }] };
    const o = { itemId: '206', item, listAt: NOW - HOUR, now: NOW };
    assert.deepEqual(priceChecked(buyer({ w3b: null, te: 900 }), o), { ok: false, why: 'te-only', at: 0 });
    assert.equal(priceChecked(buyer({ w3b: 0, te: 900 }), o).why, 'te-only');
    // What they last paid (TornW3B's receipts) is not what they pay.
    assert.equal(priceChecked(buyer({ lastPaidOnly: true }), o).why, 'te-only');
    assert.equal(priceChecked(buyer({ id: null }), o).why, 'no-id');
    assert.equal(priceChecked(null, o).why, 'no-id');

    assert.equal(PRICES_STALE_MS, DAY);
    assert.equal(priceChecked(buyer(), { ...o, listAt: NOW - DAY }).ok, true);
    assert.deepEqual(priceChecked(buyer(), { ...o, listAt: NOW - DAY - 1 }), { ok: false, why: 'old-list', at: NOW - MIN });
    assert.deepEqual(priceChecked(buyer(), { ...o, listAt: 0 }), { ok: false, why: 'no-date', at: NOW - MIN });
    assert.equal(priceChecked(buyer(), { itemId: '206', item, now: NOW }).why, 'no-date');
});

test('a list just read corrects every older read of an item\'s buyers: the new price, or no longer that trader', () => {
    const rec = (at, rows, more = {}) => ({ at, traders: rows, full: rows.slice(), lately: null, ...more });
    const a = rec(NOW - 10 * MIN, [{ id: '7', name: 'Seven', price: 900 }, { id: '8', name: 'Eight', price: 880 }]);
    const b = rec(NOW - 10 * MIN, [{ id: '8', name: 'Eight', price: 50 }, { id: '7', name: 'Seven', price: 40 }]);
    const c = rec(NOW - 10 * MIN, [{ id: '8', name: 'Eight', price: 7 }]);
    const newer = rec(NOW, [{ id: '7', name: 'Seven', price: 3 }]);
    const m = new Map([['206', a], ['180', b], ['1', c], ['2', newer]]);

    // Seven now pays 850 for 206 (under Eight), and no longer buys 180.
    assert.deepEqual(applyListToItemBuyers(m, '7', { 206: 850, 2: 99 }, NOW - MIN), ['206', '180']);
    assert.deepEqual(m.get('206').traders, [{ id: '8', name: 'Eight', price: 880 }, { id: '7', name: 'Seven', price: 850 }]);
    assert.deepEqual(m.get('206').full, m.get('206').traders);
    assert.deepEqual(m.get('180').traders, [{ id: '8', name: 'Eight', price: 50 }]);
    // Records are replaced, never written into: whoever holds the old one still sees the old read.
    assert.notEqual(m.get('206'), a);
    assert.equal(a.traders[0].price, 900);
    assert.equal(m.get('206').at, a.at, 'the read keeps its own time: it is the list that checks the price');
    // An item they were never in, and a read newer than the list: left alone.
    assert.equal(m.get('1'), c);
    assert.equal(m.get('2'), newer);

    // The same list again changes nothing.
    assert.deepEqual(applyListToItemBuyers(m, '7', { 206: 850, 2: 99 }, NOW - MIN), []);
    // A trader whose list is gone ({}): out of every older read.
    assert.deepEqual(applyListToItemBuyers(m, '8', {}, NOW - MIN), ['206', '180', '1']);
    assert.deepEqual(m.get('1').traders, []);
});

test('how often an item\'s buyers are read: the desk item every 2 minutes, a flip every 3, the rest every 10', () => {
    const flips = new Set(['206', '180']);
    assert.equal(buyersEveryMs('206', { desk: '206', flips }), DESK_RECHECK_MS);
    assert.equal(buyersEveryMs(180, { desk: '206', flips }), FLIP_RECHECK_MS);
    assert.equal(buyersEveryMs('1', { desk: '206', flips }), OTHER_RECHECK_MS);
    assert.equal(buyersEveryMs('1'), OTHER_RECHECK_MS);
    assert.deepEqual([DESK_RECHECK_MS, FLIP_RECHECK_MS, OTHER_RECHECK_MS], [2 * MIN, 3 * MIN, 10 * MIN]);
    // A flip's buyers are read again before its check runs out.
    assert.ok(FLIP_RECHECK_MS < FLIP_CHECK_MS);
});

/* ============================================ which list is read next (traders.js) */

function dbOf(ids, at) {
    const db = emptyTraderDb();
    addTraders(db, ids.map((id) => ({ id, name: 'T' + id })), at);
    for (const id of ids) recordW3bList(db, id, { prices: { 1: 5 } }, at);
    return db;
}

test('a kept list lasts 7 days (shown as stale), and is read again by how much it matters', () => {
    assert.equal(W3B_LIST_MAX_AGE_MS, 7 * DAY);
    const db = dbOf([11], NOW);
    assert.deepEqual(liveW3bPrices(db.traders[11], NOW + 7 * DAY - 1), { 1: 5 });
    assert.equal(liveW3bPrices(db.traders[11], NOW + 7 * DAY + 1), null);
    assert.deepEqual([W3B_HELD_REFRESH_MS, W3B_OTHER_REFRESH_MS, W3B_SLOW_REFRESH_MS], [10 * MIN, HOUR, 6 * HOUR]);
});

test('next list: the traders behind a flip every 10 minutes, though they buy nothing you hold', () => {
    const db = dbOf([11, 12], NOW);
    const t = NOW + W3B_HELD_REFRESH_MS + 1;
    assert.equal(nextW3bTrader(db, new Set(), t), null);
    assert.equal(nextW3bTrader(db, new Set(), t, { hot: new Set(['12']) }), '12');
    assert.equal(nextW3bTrader(db, new Set(), NOW + W3B_HELD_REFRESH_MS - 1, { hot: new Set(['12']) }), null);
});

test('next list: among the hourly ones the list changed most recently goes first; a date not known goes last', () => {
    const db = dbOf([11, 12, 13], NOW);
    const t = NOW + W3B_OTHER_REFRESH_MS + 1;
    const changed = { 11: t - 20 * HOUR, 12: t - 2 * HOUR, 13: 0 };
    const listAtOf = (id) => changed[id];
    assert.equal(nextW3bTrader(db, new Set(), t, { listAtOf }), '12');
    recordW3bList(db, 12, { prices: { 1: 5 } }, t);
    assert.equal(nextW3bTrader(db, new Set(), t, { listAtOf }), '11');
    recordW3bList(db, 11, { prices: { 1: 5 } }, t);
    assert.equal(nextW3bTrader(db, new Set(), t, { listAtOf }), '13');
});

test('next list: one not changed in a day, or of a trader Trusted hides, only every 6 hours', () => {
    const db = dbOf([11, 12, 13], NOW);
    const changed = { 11: NOW - 3 * DAY, 12: NOW - HOUR, 13: NOW - HOUR };
    const o = { listAtOf: (id) => changed[id], slow: (id) => id === '13' };
    const t = NOW + W3B_OTHER_REFRESH_MS + 1;
    // After an hour only the one that counts is due.
    assert.equal(nextW3bTrader(db, new Set(), t, o), '12');
    recordW3bList(db, 12, { prices: { 1: 5 } }, t);
    assert.equal(nextW3bTrader(db, new Set(), t + 1, o), null);
    // After six, the other two - and never ahead of the one that counts.
    const t6 = NOW + W3B_SLOW_REFRESH_MS + 1;
    assert.equal(nextW3bTrader(db, new Set(), t6, o), '12');
    recordW3bList(db, 12, { prices: { 1: 5 } }, t6);
    assert.ok(['11', '13'].includes(nextW3bTrader(db, new Set(), t6, o)));
    // A slow trader behind a flip is not slow.
    assert.equal(nextW3bTrader(db, new Set(), NOW + W3B_HELD_REFRESH_MS + 1, { ...o, hot: new Set(['13']) }), '13');
});

/* ============================================ which read goes next (desk.js) */

test('next read: the buyers of a possible flip go before the sellers lists of the candidates', () => {
    const p = { desk: 'desk', candidates: ['c1', 'c2'], check: ['f1', 'f2'], active: true };
    const dueOf = (bazaars, buyers) => ({ due: (id) => bazaars.has(id), buyersDue: (id) => buyers.has(id) });
    assert.deepEqual(nextW3bRead({ ...p, ...dueOf(new Set(['c1']), new Set(['f2'])) }), { kind: 'buyers', id: 'f2' });
    // Nothing to check: as before.
    assert.deepEqual(nextW3bRead({ ...p, ...dueOf(new Set(['c1']), new Set()) }), { kind: 'bazaars', id: 'c1' });
    assert.deepEqual(nextW3bRead({ ...p, check: undefined, ...dueOf(new Set(['c1']), new Set(['f2'])) }).kind, 'bazaars');
});

test('a list another PC read (through the shared server) checks nothing: only this PC\'s own read of TornW3B does', () => {
    const list = { at: NOW - MIN, checkedAt: NOW - MIN, found: true, shared: true, prices: { 206: 900 } };
    const o = { itemId: '206', list, listAt: NOW - HOUR, now: NOW };
    assert.deepEqual(priceChecked(buyer(), o), { ok: false, why: 'not-checked', at: 0 });
    // This PC's own read of the item's buyers still checks it, at its own time, whatever the shared list says.
    const item = { at: NOW - 2 * MIN, traders: [{ id: '7', price: 900 }] };
    assert.deepEqual(priceChecked(buyer(), { ...o, item }), { ok: true, why: 'checked', at: NOW - 2 * MIN });
    // And the same list read by this PC checks it.
    assert.equal(priceChecked(buyer(), { ...o, list: { ...list, shared: false } }).ok, true);
});
