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

test('a price is checked only on a page read of their list in the last 3 minutes that says open, at this price (3.33.0)', () => {
    const open = { at: NOW - 2 * MIN, state: 'open', prices: { 206: 900 }, updatedAt: NOW - 3 * HOUR };
    const o = { itemId: '206', open, now: NOW };
    assert.deepEqual(priceChecked(buyer(), o), { ok: true, why: 'checked', at: NOW - 2 * MIN });

    // The open check stands three minutes, and no longer.
    assert.equal(priceChecked(buyer(), { ...o, open: { ...open, at: NOW - 3 * MIN } }).ok, true);
    assert.deepEqual(priceChecked(buyer(), { ...o, open: { ...open, at: NOW - 3 * MIN - 1 } }), { ok: false, why: 'not-open', open: 'stale', at: NOW - 3 * MIN - 1, closed: false });

    // Never read: not checked. An old read of the item's buyers, however new, checks nothing now.
    assert.equal(priceChecked(buyer(), { ...o, open: null, item: { at: NOW - MIN, traders: [{ id: '7', price: 900 }] } }).why, 'not-open');
    // Open, but not at this price, or not this item.
    assert.equal(priceChecked(buyer({ price: 950, w3b: 950 }), o).why, 'not-checked');
    assert.equal(priceChecked(buyer(), { ...o, itemId: '1' }).why, 'not-checked');
});

test('a read kept in two parts: a list read corrects the older part and leaves the newer one', () => {
    const item = {
        at: NOW - MIN,
        full: [{ id: '7', price: 900 }, { id: '8', price: 880 }], fullAt: NOW - 40 * MIN,
        lately: [{ id: '7', price: 900 }], latelyAt: NOW - MIN,
        traders: [{ id: '7', price: 900 }, { id: '8', price: 880 }],
    };
    const m = new Map([['206', item]]);
    assert.deepEqual(applyListToItemBuyers(m, '8', { 206: 700 }, NOW - 10 * MIN), ['206']);
    assert.deepEqual(m.get('206').full[1], { id: '8', price: 700 });
    assert.deepEqual(m.get('206').traders[1], { id: '8', price: 700 });
    assert.deepEqual(applyListToItemBuyers(m, '7', { 206: 1 }, NOW - 10 * MIN), ['206']);
    assert.equal(m.get('206').lately, item.lately, 'read after the list: it stands');
    assert.deepEqual(m.get('206').traders[0], { id: '7', price: 900 });
    assert.equal(m.get('206').full.find((t) => t.id === '7').price, 1);
});

test('a closed list, an unclear page or a failed read makes no flip, however new (the money loss of 2026-10-14)', () => {
    const o = { itemId: '206', listAt: NOW - HOUR, now: NOW };
    // TornW3B's list read still names every price of a closed list: none of them counts.
    const list = { at: NOW - MIN, found: true, prices: { 206: 900 } };
    assert.deepEqual(priceChecked(buyer(), { ...o, list, open: { at: NOW - 10_000, state: 'closed', prices: null } }), { ok: false, why: 'closed', open: 'closed', at: NOW - 10_000, closed: true });
    assert.equal(priceChecked(buyer(), { ...o, list, open: { at: NOW - 10_000, state: 'unclear', prices: null } }).why, 'not-open');
    assert.equal(priceChecked(buyer(), { ...o, list, open: { at: NOW - 10_000, state: 'failed', prices: null } }).ok, false);
    // A list read alone checks nothing any more.
    assert.equal(priceChecked(buyer(), { ...o, list }).ok, false);
});

test('a TornExchange-only price is shown, in amber; a TornExchange list not changed in a day is no flip, but an open TornW3B read is a flip whenever the list was edited (3.34.0)', () => {
    const open = { at: NOW - MIN, state: 'open', prices: { 206: 900 }, updatedAt: NOW - HOUR };
    const o = { itemId: '206', open, now: NOW };
    // The owner, 2026-10-16: "always show the torn exchange ... do not leave torn exhcagne out".
    assert.deepEqual(priceChecked(buyer({ w3b: null, te: 900 }), o), { ok: true, why: 'te-only', at: 0, te: true, warn: 'te' });
    assert.equal(priceChecked(buyer({ w3b: 0, te: 900, id: null }), o).why, 'te-only', 'known by name only: shown too');
    // TornExchange says their list was last changed over a day ago: no flip.
    assert.equal(priceChecked(buyer({ w3b: null, te: 900 }), { ...o, teListAt: NOW - DAY - 1 }).why, 'old-list');
    assert.equal(priceChecked(buyer({ w3b: null, te: 900 }), { ...o, teListAt: NOW - HOUR }).ok, true);
    // What they last paid (TornW3B's receipts) is not what they pay.
    assert.equal(priceChecked(buyer({ lastPaidOnly: true }), o).why, 'last-paid');
    assert.equal(priceChecked(buyer({ w3b: null, te: null }), o).why, 'no-price');
    assert.equal(priceChecked(buyer({ id: null }), o).why, 'no-id');
    assert.equal(priceChecked(null, o).why, 'no-id');

    assert.equal(PRICES_STALE_MS, DAY);
    assert.equal(priceChecked(buyer(), { ...o, open: { ...open, updatedAt: NOW - DAY } }).ok, true);
    // 3.34.0 (the owner: a $825 Bottle of Beer that Coolz, online, pays $943 for died as "Over a day old"): the page
    // was read minutes ago and says open at this price - the date the list was last edited is no gate.
    assert.deepEqual(priceChecked(buyer(), { ...o, open: { ...open, updatedAt: NOW - DAY - 1 } }), { ok: true, why: 'checked', at: NOW - MIN });
    assert.deepEqual(priceChecked(buyer(), { ...o, open: { ...open, updatedAt: NOW - 30 * DAY }, listAt: NOW - 30 * DAY }), { ok: true, why: 'checked', at: NOW - MIN });
    // No date on the page and none known otherwise: still a flip after a passing open read.
    assert.deepEqual(priceChecked(buyer(), { ...o, open: { ...open, updatedAt: 0 } }), { ok: true, why: 'checked', at: NOW - MIN });
    // ...but the open read still gates: old list or not, a read older than 3 minutes, or at another price, is no flip.
    assert.equal(priceChecked(buyer(), { ...o, open: { ...open, at: NOW - 4 * MIN, updatedAt: NOW - 30 * DAY } }).why, 'not-open');
    assert.equal(priceChecked(buyer({ price: 950, w3b: 950 }), { ...o, open: { ...open, updatedAt: NOW - 30 * DAY } }).why, 'not-checked');
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

test('a list another PC read (through the shared server) checks nothing: only an open check does', () => {
    const list = { at: NOW - MIN, checkedAt: NOW - MIN, found: true, shared: true, prices: { 206: 900 } };
    const o = { itemId: '206', list, listAt: NOW - HOUR, now: NOW };
    assert.equal(priceChecked(buyer(), o).ok, false);
    assert.equal(priceChecked(buyer(), { ...o, open: { at: NOW - MIN, state: 'open', prices: { 206: 900 }, updatedAt: 0 } }).ok, true);
});

