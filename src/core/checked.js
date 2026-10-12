/*
 * A flip only on a price checked just now (3.26.0).
 *
 * The owner, 2026-10-11: "tornbids currently shows stale prices. shows a 100m
 * flip. but trader already price changed ... when it calculates these flips.
 * it has to look at the real price list first. and remember, price list has
 * to be updated for at most 24 hours ago", then: "nothing stale, no fake
 * flips. everytime it shows a flip, its because the item list is checked."
 *
 * Why it was stale (his zips): a trader's TornW3B list was re-read once an
 * hour and used for six; the read that gives every buyer of one item ran at
 * 0.4 a minute where 8.5 were due (the sellers lists went first, and were
 * always due); and nothing looked at the buyer again before a flip was shown.
 *
 * The rule here: a buyer makes a flip only when
 *   - the price is their TornW3B price (TornExchange gives no date for a
 *     price: one that is only there is shown under "Traders pay", and makes
 *     no flip alone);
 *   - TornW3B was asked about it in the last FLIP_CHECK_MS - the item's
 *     buyers (it names them at that price), or their own list (it holds the
 *     item at that price);
 *   - and their list was last changed within PRICES_STALE_MS (a day).
 * Everything else is a possible flip: it waits, and its check goes first.
 *
 * Pure: no DOM, no storage, no clock.
 */

import { PRICES_STALE_MS } from './traders.js';

/* How long a check stands. The buyers of a flip are read again well inside it (FLIP_RECHECK_MS). */
export const FLIP_CHECK_MS = 5 * 60 * 1000;
/* A shown or possible flip's buyers are read again this often, so a flip never lapses by the clock alone. */
export const FLIP_RECHECK_MS = 3 * 60 * 1000;
/* The item on the desk: its buyers, this often. */
export const DESK_RECHECK_MS = 2 * 60 * 1000;
/* Every other item whose buyers are read (what you hold, the other possible flips). */
export const OTHER_RECHECK_MS = 10 * 60 * 1000;

const checkedIdsOf = new WeakMap();

/** trader id -> price, from one read of an item's buyers (made once per read). */
function checkedNamedIn(traders) {
    if (!Array.isArray(traders)) return null;
    let m = checkedIdsOf.get(traders);
    if (!m) {
        m = new Map();
        for (const t of traders) if (t && t.id) m.set(String(t.id), Number(t.price) || 0);
        checkedIdsOf.set(traders, m);
    }
    return m;
}

/**
 * When TornW3B last named this trader at this price in a read of the item's
 * buyers (0: never). A read is kept in two parts when the item has more buyers
 * than one answer holds - everyone (`full`, read at `fullAt`) and those who
 * traded lately (`lately`, at `latelyAt`) - and each part checks only what it
 * names, at its own time: `at` is the newer of the two, and is not the time
 * of a trader only the older part names.
 */
function checkedNamedAt(item, id, price) {
    if (!item || !(item.at > 0)) return 0;
    const parts = [[item.full, item.fullAt], [item.lately, item.latelyAt]].filter(([rows, readAt]) => Array.isArray(rows) && readAt > 0);
    if (!parts.length) {
        const m = checkedNamedIn(item.traders);
        return m && m.get(id) === price ? item.at : 0;
    }
    let at = 0;
    for (const [rows, readAt] of parts) if (readAt > at && checkedNamedIn(rows).get(id) === price) at = readAt;
    return at;
}

/**
 * Is this buyer's price for this item checked?
 *
 * @param {{id, price, w3b, te, lastPaidOnly}} b - a buyer row (buyersForItem)
 * @param {object} o
 * @param {string} o.itemId
 * @param {{at: number, traders: Array, full?: Array, fullAt?: number, lately?: Array, latelyAt?: number}|null} o.item - the last read of the item's buyers, or null
 * @param {{at: number, found: boolean, prices: object, shared?: boolean}|null} o.list - the last read of this trader's own list, or null
 * @param {number} o.listAt - when they last changed their list (ms), 0: not known
 * @returns {{ok: boolean, why: 'checked'|'no-id'|'te-only'|'not-checked'|'old-list'|'no-date', at: number}}
 *   at: when TornW3B last confirmed this price (0: never)
 */
export function priceChecked(b, { itemId, item = null, list = null, listAt = 0, now = Date.now(), checkMs = FLIP_CHECK_MS, staleMs = PRICES_STALE_MS } = {}) {
    if (!b || !b.id) return { ok: false, why: 'no-id', at: 0 };
    if (!(b.w3b > 0) || b.lastPaidOnly) return { ok: false, why: 'te-only', at: 0 };
    let at = checkedNamedAt(item, String(b.id), b.w3b);
    // A list another PC read (it came through the shared server, by that PC's clock) is shown, and checks nothing.
    if (list && list.found && !list.shared && list.prices && Number(list.prices[String(itemId)]) === b.w3b && list.at > at) at = list.at;
    if (!(at > 0) || now - at > checkMs) return { ok: false, why: 'not-checked', at };
    const changed = Number(listAt) || 0;
    if (!(changed > 0)) return { ok: false, why: 'no-date', at };
    if (now - changed > staleMs) return { ok: false, why: 'old-list', at };
    return { ok: true, why: 'checked', at };
}

/**
 * A trader's own list was read: every kept read of an item's buyers older
 * than it now says what the list says - their new price, or no longer them.
 * (The buyers read overrides a list's price for the hour it is kept; without
 * this a trader's price read a moment ago lost to the buyers read before it.)
 *
 * @param {Map<string, object>} itemTraders - item id -> {at, traders, full, fullAt, lately, latelyAt, ...}; entries are replaced, never written into
 * @param {string} traderId
 * @param {object} prices - {itemId: price}, {} when they have no list
 * @param {number} at - when the list was read
 * @returns {string[]} the items whose buyers changed
 */
export function applyListToItemBuyers(itemTraders, traderId, prices, at) {
    const id = String(traderId);
    const changed = [];
    const fix = (rows, price) => {
        if (!Array.isArray(rows)) return rows;
        const i = rows.findIndex((t) => t && String(t.id) === id);
        if (i < 0 || Number(rows[i].price) === price) return rows;
        const next = rows.slice();
        if (price > 0) next[i] = { ...rows[i], price };
        else next.splice(i, 1);
        return price > 0 ? next.sort((a, b) => b.price - a.price) : next;
    };
    const names = (rows) => Array.isArray(rows) && rows.some((t) => t && String(t.id) === id);
    for (const [itemId, rec] of itemTraders) {
        if (!rec || !(rec.at > 0)) continue;
        // Each part by its own time; the merged list by the newest part that names them.
        const fullAt = rec.fullAt > 0 ? rec.fullAt : rec.at;
        const latelyAt = rec.latelyAt > 0 ? rec.latelyAt : rec.at;
        const namedAt = Math.max(names(rec.full) ? fullAt : 0, names(rec.lately) ? latelyAt : 0) || rec.at;
        if (fullAt >= at && latelyAt >= at && namedAt >= at) continue;
        const price = Number((prices || {})[String(itemId)]) || 0;
        const traders = namedAt < at ? fix(rec.traders, price) : rec.traders;
        const full = fullAt < at ? fix(rec.full, price) : rec.full;
        const lately = latelyAt < at ? fix(rec.lately, price) : rec.lately;
        if (traders === rec.traders && full === rec.full && lately === rec.lately) continue;
        itemTraders.set(itemId, { ...rec, traders, full, lately });
        changed.push(String(itemId));
    }
    return changed;
}

/*
 * The prices a check stands on, for the pages on torn.com (3.29.0).
 *
 * The overlay names a trader on a bazaar card ("X pays $Y"), in "In this
 * bazaar" and in Checkout ("sell to X at $Y") from the lists this browser
 * has stored - with no check at all: a price hours old looked as sure as
 * one read a minute ago. Torn Bids alone asks TornW3B; so it writes down
 * what it has checked - item, trader, price, when - and the overlay shows a
 * price as sure only while it is in this table and under FLIP_CHECK_MS old.
 * Anything else it shows muted, "not checked". With Torn Bids closed the
 * table stops being written, and within five minutes every tag is muted.
 *
 * Small and seldom: only checks still standing, at most CHECKED_TABLE_MAX of
 * them, written at most every CHECKED_TABLE_WRITE_MS and only when it says
 * something else than it did.
 */
export const CHECKED_TABLE_WRITE_MS = 30 * 1000;
export const CHECKED_TABLE_MAX = 2000;

/**
 * @param {Map<string, {price: number, at: number}>} lastChecked - 'itemId|traderId' -> the price a check stood on, and when
 * @returns {{at: number, p: Object<string, Array<[string, number, number]>>}} item id -> [[trader id, price, checked at (s)]]
 */
export function checkedTable(lastChecked, now = Date.now(), { checkMs = FLIP_CHECK_MS, max = CHECKED_TABLE_MAX } = {}) {
    const rows = [];
    for (const [k, v] of lastChecked || []) {
        const cut = String(k).indexOf('|');
        const itemId = cut > 0 ? String(k).slice(0, cut) : '';
        const traderId = cut > 0 ? String(k).slice(cut + 1) : '';
        // (A trader known by name only has no TornW3B price: nothing of theirs is ever checked.)
        if (!/^\d+$/.test(itemId) || !/^\d+$/.test(traderId) || !v || !(v.price > 0) || !(v.at > 0) || now - v.at > checkMs) continue;
        rows.push([itemId, traderId, v.price, Math.floor(v.at / 1000)]);
    }
    rows.sort((a, b) => b[3] - a[3] || Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
    const p = {};
    for (const [itemId, traderId, price, at] of rows.slice(0, max)) (p[itemId] || (p[itemId] = [])).push([traderId, price, at]);
    return { at: now, p };
}

/** Is this trader's price for this item in the table, at this price, checked within `checkMs`? */
export function checkedInTable(table, itemId, traderId, price, now = Date.now(), checkMs = FLIP_CHECK_MS) {
    const rows = table && table.p && traderId ? table.p[String(itemId)] : null;
    if (!Array.isArray(rows)) return false;
    for (const r of rows) {
        if (!Array.isArray(r) || String(r[0]) !== String(traderId)) continue;
        return Number(r[1]) === Number(price) && now - Number(r[2]) * 1000 <= checkMs && now - Number(r[2]) * 1000 > -60000;
    }
    return false;
}

/**
 * How often an item's buyers are read again, by what the item is to you.
 *
 * @param {string} itemId
 * @param {{desk: string|null, flips: Set<string>}} o - the item on the desk; the items with a flip shown or possible
 */
export function buyersEveryMs(itemId, { desk = null, flips = null } = {}) {
    const id = String(itemId);
    if (desk && id === String(desk)) return DESK_RECHECK_MS;
    if (flips && flips.has(id)) return FLIP_RECHECK_MS;
    return OTHER_RECHECK_MS;
}
