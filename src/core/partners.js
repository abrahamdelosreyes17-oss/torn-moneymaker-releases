/*
 * The traders you have traded with (3.14.3; the owner, 2026-09-28): who,
 * how many trades, money, profit, the last trade, and whether they paid what
 * they accepted. From the Ledger's finished trades - no new calls. "Trusted"
 * stays TornExchange / TornW3B's own rating; this is your history beside it.
 *
 * Favourite: 5 or more finished trades, automatically; you can add one by
 * hand, and a removal sticks. Blacklisted: never a buyer (flips, trades,
 * Where to sell), though their bazaars are still bought from. Pure: no DOM,
 * no network.
 */
import { acceptedPricesFor } from './ledger.js';

/** Finished trades that make a trader a favourite by themselves. */
export const FAVOURITE_TRADES = 5;
/* ...as long as the last one was within this (the owner: "just keep them, unless we haven't traded with them for the past month"). */
export const FAVOURITE_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Per trader, from the Ledger's receipts (tradeReceipts): most trades first.
 *
 * @param {Array} receipts - tradeReceipts(rows, fifo)
 * @param {Array} priceRecords - what traders accepted (core/ledger.js addPriceRecord)
 * @returns {Array<{who, whoName, trades, received, paid, cost, profit, last, list: {checked, paid, short: Array<{t, expected, got}>}}>}
 */
export function partnerStats(receipts, priceRecords = []) {
    const by = new Map();
    for (const r of receipts || []) {
        if (!r || !r.who) continue;
        const key = String(r.who);
        const s = by.get(key) || { who: key, whoName: r.whoName || null, trades: 0, received: 0, paid: 0, cost: 0, profit: 0, last: 0, list: { checked: 0, paid: 0, short: [] } };
        s.trades += 1;
        s.received += r.received || 0;
        s.paid += r.paid || 0;
        s.cost += r.cost || 0;
        s.profit += r.profit || 0;
        if (r.t > s.last) {
            s.last = r.t;
            if (r.whoName) s.whoName = r.whoName;
        }
        // Did they pay what they accepted? Only trades sold on accepted prices can say:
        // the amount kept with the trade (r.expected), else the accepted prices still stored.
        const sold = (r.gave || []).filter((g) => !g.given);
        const agreed = r.expected > 0 || !(sold.length && r.received > 0) ? null : acceptedPricesFor(priceRecords, key, r.t);
        const expected = r.expected > 0 ? r.expected : agreed && sold.every((g) => Number(agreed[String(g.itemId)]) > 0) ? sold.reduce((a, g) => a + g.qty * Number(agreed[String(g.itemId)]), 0) : 0;
        if (expected > 0 && r.received > 0) {
            s.list.checked += 1;
            if (Math.round(r.received) >= Math.round(expected)) s.list.paid += 1;
            else s.list.short.push({ t: r.t, expected, got: r.received });
        }
        by.set(key, s);
    }
    return [...by.values()].sort((a, b) => b.trades - a.trades || b.last - a.last);
}

/**
 * Is this trader a favourite? 5+ trades with the last one this month, unless
 * you removed them; or added by hand (kept until you remove them).
 * @param {object} edits - {added: [ids], removed: [ids]}
 */
export function isFavourite(stat, edits = {}, now = Date.now()) {
    const id = stat ? String(stat.who) : '';
    if (!id) return false;
    if ((edits.removed || []).map(String).includes(id)) return false;
    if ((edits.added || []).map(String).includes(id)) return true;
    return stat.trades >= FAVOURITE_TRADES && now - (Number(stat.last) || 0) <= FAVOURITE_RECENT_MS;
}

/** Favourite edits after a press: add or remove by hand; the opposite entry goes. */
export function editFavourite(edits = {}, id, on) {
    const key = String(id);
    const added = (edits.added || []).map(String).filter((x) => x !== key);
    const removed = (edits.removed || []).map(String).filter((x) => x !== key);
    if (on) added.push(key);
    else removed.push(key);
    return { added, removed };
}

/** A buyer's key as the blacklist stores it: 'id:<torn id>' or 'name:<lowercase name>'. */
export function partnerKey(b) {
    return b && b.id ? 'id:' + String(b.id) : 'name:' + String((b && b.name) || '').toLowerCase();
}

/** Buyers without the blacklisted ones: they are never offered anything. */
export function withoutBlacklisted(buyers, blacklist) {
    const set = blacklist instanceof Set ? blacklist : new Set(blacklist || []);
    if (!set.size) return buyers || [];
    return (buyers || []).filter((b) => !set.has(partnerKey(b)) && !(b && b.name && set.has('name:' + String(b.name).toLowerCase())));
}

/** "Traded 7× · last 3d ago" for a trader row; null when never traded. */
export function tradedLine(stat, now = Date.now()) {
    if (!stat || !(stat.trades > 0)) return null;
    const ago = Math.max(0, now - stat.last);
    const m = Math.floor(ago / 60000);
    const when = m < 60 ? Math.max(1, m) + 'm' : m < 1440 ? Math.floor(m / 60) + 'h' : Math.floor(m / 1440) + 'd';
    return 'Traded ' + stat.trades + '× · last ' + when + ' ago';
}

/**
 * Buyers in price order with favourites first among equal prices - never a
 * better place than their price earns (no ranking bias toward anyone).
 */
export function favouritesFirstOnTie(buyers, isFav) {
    // Whether a buyer is a favourite only matters between two at the same price: it is asked
    // only then, and once per buyer (3.17.1 - asking it of every buyer of every item was a
    // fifth of Torn Bids' redraw). The order that comes out is the same.
    const rank = (x) => (x.f === null ? (x.f = isFav(x.b) ? 0 : 1) : x.f);
    return (buyers || [])
        .map((b, i) => ({ b, i, f: null }))
        .sort((x, y) => (Number(y.b.price) || 0) - (Number(x.b.price) || 0) || rank(x) - rank(y) || x.i - y.i)
        .map((x) => x.b);
}

/** The blacklist after a press: add (with name and time) or take a trader off. */
export function editBlacklist(list, buyer, on, now = Date.now()) {
    const key = partnerKey(buyer);
    const kept = (Array.isArray(list) ? list : []).filter((x) => x && x.key !== key);
    return on ? [{ key, id: buyer.id ? String(buyer.id) : null, name: buyer.name || null, at: now }, ...kept] : kept;
}

/**
 * Your traders' cards in order: trades that make money, biggest first; then
 * the ones still reading their list; then "no trade now". A favourite goes
 * first only on a tie.
 */
export function scanOrder(list) {
    const rank = (x) => (x.items && x.profit > 0 ? 0 : x.reading ? 1 : 2);
    return [...(list || [])].sort((a, b) => rank(a) - rank(b) || b.profit - a.profit || (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
}

/**
 * The keys the blacklist matches (3.14.3 review): each trader's own key and
 * their name too - a trader blacklisted by id still turned up as a name-only
 * buyer row before TornExchange's ids had loaded.
 */
export function blacklistKeys(list) {
    const out = new Set();
    for (const x of Array.isArray(list) ? list : []) {
        if (!x || !x.key) continue;
        out.add(x.key);
        if (x.name) out.add('name:' + String(x.name).toLowerCase());
        if (x.id) out.add('id:' + String(x.id));
    }
    return out;
}
