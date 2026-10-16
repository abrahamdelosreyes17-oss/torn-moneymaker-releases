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
 * The rule here (3.33.0): a buyer makes a flip only when
 *   - their TornW3B list PAGE, read within OPEN_CHECK_MS (3 minutes), says the list is open and pays this
 *     price (core/open-check.js) - a read of the item's buyers or of their list cannot see a closed list;
 *   - and their list was last changed within PRICES_STALE_MS (a day).
 *   - Or the price is only on TornExchange: a flip, always marked amber (look at their list yourself).
 *   - Or it is the owner's own word (his Torn Archive, through the server): counts also while closed.
 * Everything else is a possible flip: it waits, and its check goes first.
 *
 * Pure: no DOM, no storage, no clock.
 */

import { PRICES_STALE_MS } from './traders.js';
import { openNow, OPEN_CHECK_MS } from './open-check.js';

/* How long a check stands. The buyers of a flip are read again well inside it (FLIP_RECHECK_MS). */
export const FLIP_CHECK_MS = 5 * 60 * 1000;
/* A shown or possible flip's buyers are read again this often, so a flip never lapses by the clock alone. */
export const FLIP_RECHECK_MS = 3 * 60 * 1000;
/* The item on the desk: its buyers, this often. */
export const DESK_RECHECK_MS = 2 * 60 * 1000;
/* Every other item whose buyers are read (what you hold, the other possible flips). */
export const OTHER_RECHECK_MS = 10 * 60 * 1000;

/**
 * Is this buyer's price for this item checked?
 *
 * @param {{id, price, w3b, te, lastPaidOnly}} b - a buyer row (buyersForItem)
 * @param {object} o
 * @param {string} o.itemId
 * @param {{at: number, state: string, prices: object|null, updatedAt: number}|null} o.open - the last page read of their
 *   TornW3B list (3.33.0, core/open-check.js), or null. Since 3.33.0 a read of the item's buyers or of their list
 *   (`item`, `list`, kept in the call for the callers) checks nothing: neither can see a closed list.
 * @param {number} o.listAt - when they last changed their list (ms), 0: not known; the page's own date goes first
 * @param {number} [o.teListAt] - when TornExchange says they last changed their list there (0: not known)
 * @param {{at: number, open: boolean, prices: object}|null} [o.said] - the trader's own word (3.31.0): what their Torn
 *   Archive told our server they pay, and when the server last heard it. A price that is this one is checked for as
 *   long as it was heard within `staleMs` - it needs no TornW3B read: TornW3B's copy is the older of the two.
 * @returns {{ok: boolean, why: 'checked'|'said'|'te-only'|'no-id'|'last-paid'|'no-price'|'closed'|'not-open'|'not-checked'|'old-list'|'no-date', at: number, closed?: boolean, open?: string, te?: boolean, warn?: 'te'}}
 *   at: when their list page last said open (0: never); for 'said', when the server last heard it.
 *   closed: their list is closed - for 'said', the price is what they would pay once they open (it counts: the owner's
 *   own list, so friends can buy for him while he sleeps); otherwise no flip.
 *   open: why not open - 'unread', 'stale', 'unclear', 'failed' (core/open-check.js openNow).
 *   warn 'te': a TornExchange-only price - shown, in amber: look at their list.
 */
export function priceChecked(b, { itemId, item = null, list = null, listAt = 0, said = null, open = null, teListAt = 0, now = Date.now(), checkMs = FLIP_CHECK_MS, openMs = OPEN_CHECK_MS, staleMs = PRICES_STALE_MS } = {}) {
    if (!b) return { ok: false, why: 'no-id', at: 0 };
    if (b.lastPaidOnly) return { ok: false, why: 'last-paid', at: 0 };
    /*
     * 3.33.0 - a price only on TornExchange is shown, and makes a flip, always in amber (the owner, 2026-10-16:
     * "always show the torn exchange ... just have a warning or pulsating amber so were reminded to click the
     * pricelist"): TornExchange cannot say whether a list is open, so you look at their list yourself. A list
     * TornExchange says was last changed over a day ago makes no flip, as a TornW3B one.
     */
    if (!(b.w3b > 0)) {
        if (!(b.te > 0)) return { ok: false, why: 'no-price', at: 0 };
        const teChanged = Number(teListAt) || 0;
        if (teChanged > 0 && now - teChanged > staleMs) return { ok: false, why: 'old-list', at: 0, te: true };
        return { ok: true, why: 'te-only', at: 0, te: true, warn: 'te' };
    }
    // A TornW3B price: its list is read by Torn id.
    if (!b.id) return { ok: false, why: 'no-id', at: 0 };
    if (said && said.at > 0 && said.prices && Number(said.prices[String(itemId)]) === b.w3b && now - said.at <= staleMs) return { ok: true, why: 'said', at: said.at, closed: !said.open };
    /*
     * 3.33.0 - and a TornW3B price only on a page read of their list that says it is OPEN, made within openMs, at
     * this price (core/open-check.js; the money loss of 2026-10-14: the list read returns every price while a list
     * is closed). Closed, not read, unclear or a failed read: no flip. The page carries the list itself, so the
     * price is the one it gave and the list's date its own.
     */
    const o = openNow(open, { now, within: openMs });
    if (!o.ok) return { ok: false, why: o.why === 'closed' ? 'closed' : 'not-open', open: o.why, at: o.at, closed: o.why === 'closed' };
    if (!open.prices || Number(open.prices[String(itemId)]) !== b.w3b) return { ok: false, why: 'not-checked', at: o.at };
    const changed = Number(open.updatedAt) || Number(listAt) || 0;
    if (!(changed > 0)) return { ok: false, why: 'no-date', at: o.at };
    if (now - changed > staleMs) return { ok: false, why: 'old-list', at: o.at };
    return { ok: true, why: 'checked', at: o.at };
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

/*
 * After their yes (3.33.0): a trade is frozen at the prices they said yes to, and buying it can take most of an
 * hour - their list went unread all that time. Now it is read again every few minutes while the trade is open,
 * and a line whose price their list no longer pays is said on that line, before more of it is bought.
 */

/**
 * What their list says now of a price they said yes to.
 * @param {number} bid - the price of the line at their yes
 * @param {object} o
 * @param {number|null} o.shown - what their list says for the item now (null: they are not paying for it now)
 * @param {number} o.readAt - when their list was last read (0: never)
 * @param {number} o.yesAt - when they said yes
 * @returns {{state: 'same'|'higher'|'lower'|'gone'|'unread', price: number|null}} unread: not read since the yes
 */
export function bidSinceYes(bid, { shown = null, readAt = 0, yesAt = 0 } = {}) {
    if (!(readAt > yesAt)) return { state: 'unread', price: null };
    const now = Number(shown) || 0;
    if (!(now > 0)) return { state: 'gone', price: null };
    return { state: now === bid ? 'same' : now > bid ? 'higher' : 'lower', price: now };
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
