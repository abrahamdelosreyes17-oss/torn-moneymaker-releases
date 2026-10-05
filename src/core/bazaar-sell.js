/*
 * Your bazaar's sell list (3.22.0; the owner, 2026-10-03: "when were selling
 * in bazaar, items bought within the last 24 hours, some kind of overlay, that
 * calculates okay what havent we traded or sold in bazaar, same as the
 * checklist, fills all and it actually highlights that row ... everything
 * bought in last 24 hours, prioritise sell list ... only unsold units that ive
 * bought ... skip rows that would sell under what i paid. i need to see how
 * much i paid for that item as well").
 *
 * Two things say what you bought and still hold:
 *
 *   To sell   the list Torn Bids keeps (a cancelled trade's items, what a
 *             trader did not take, a bazaar buy no trade took) - first;
 *   your log  every buy of the last 24 hours, wherever it was made, less what
 *             you sold, traded or gave since (first in, first out, as the
 *             Ledger counts it). Torn Bids works this out when it reads your
 *             log (it needs the Ledger's Full key) and leaves the short answer
 *             for Torn's pages.
 *
 * What you bought for a trade that is still going is not in it: that is the
 * trader's. Pure - no DOM, no network.
 */

export const BOUGHT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** At most this many items are kept (the newest buys). */
export const BOUGHT_ITEMS_MAX = 200;

/**
 * What is left of what you bought since `since`, from the Ledger's rows:
 * a sale, a trade or a gift uses up the oldest units of that item first.
 *
 * @param {Array<{t, itemId, qty, each, side}>} rows - Ledger rows, oldest first
 * @param {object} o
 * @param {number} o.since - buys from here on count (ms)
 * @returns {Array<{itemId, qty, each, at}>} newest buy first; `each`: what the units left cost, on average
 */
export function unsoldBought(rows, { since = 0 } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    // Only the items bought in the window are walked.
    const wanted = new Set();
    let sorted = true;
    let last = -Infinity;
    for (const r of list) {
        if (!r) continue;
        const t = Number(r.t) || 0;
        if (t < last) sorted = false;
        last = t;
        if (r.side === 'buy' && t >= since && r.itemId && Number(r.qty) > 0) wanted.add(String(r.itemId));
    }
    if (!wanted.size) return [];
    const ordered = sorted ? list : list.slice().sort((a, b) => (Number(a && a.t) || 0) - (Number(b && b.t) || 0));
    const lots = new Map();
    for (const r of ordered) {
        if (!r || !wanted.has(String(r.itemId)) || !(Number(r.qty) > 0)) continue;
        const id = String(r.itemId);
        let q = lots.get(id);
        if (!q) lots.set(id, (q = []));
        if (r.side === 'buy') {
            q.push({ qty: Number(r.qty), each: Number(r.each) || 0, t: Number(r.t) || 0 });
            continue;
        }
        if (r.side !== 'sell' && r.side !== 'give') continue;
        let left = Number(r.qty);
        while (left > 0 && q.length) {
            const n = Math.min(left, q[0].qty);
            q[0].qty -= n;
            left -= n;
            if (q[0].qty <= 0) q.shift();
        }
    }
    const out = [];
    for (const [itemId, q] of lots) {
        let qty = 0;
        let cost = 0;
        let at = 0;
        for (const lot of q) {
            if (lot.t < since || !(lot.qty > 0)) continue;
            qty += lot.qty;
            cost += lot.qty * lot.each;
            if (lot.t > at) at = lot.t;
        }
        if (qty > 0) out.push({ itemId, qty, each: Math.round(cost / qty), at });
    }
    return out.sort((a, b) => b.at - a.at || a.itemId.localeCompare(b.itemId)).slice(0, BOUGHT_ITEMS_MAX);
}

/** What Torn Bids leaves for Torn's pages: {at (when your log was read), items}. */
export function boughtRecord(rows, { now = Date.now(), readAt = now } = {}) {
    return { at: Number(readAt) || now, items: unsoldBought(rows, { since: now - BOUGHT_WINDOW_MS }) };
}

/** The stored record's items still inside the 24 hours; [] when there is none. */
export function liveBoughtItems(stored, now = Date.now()) {
    const items = stored && Array.isArray(stored.items) ? stored.items : [];
    return items.filter((i) => i && i.itemId && Number(i.qty) > 0 && Number(i.at) > 0 && now - Number(i.at) < BOUGHT_WINDOW_MS)
        .map((i) => ({ itemId: String(i.itemId), qty: Math.floor(Number(i.qty)), each: Number(i.each) || 0, at: Number(i.at) }));
}

/** Are two records the same list (the read time aside)? */
export function sameBoughtItems(a, b) {
    const x = a && Array.isArray(a.items) ? a.items : [];
    const y = b && Array.isArray(b.items) ? b.items : [];
    return x.length === y.length && x.every((i, n) => i.itemId === y[n].itemId && i.qty === y[n].qty && i.each === y[n].each && i.at === y[n].at);
}

/**
 * The list your bazaar's add page marks: the To sell items first (as the tab
 * orders them), then the rest of the last day's buys, newest first.
 *
 * An item on both: one row - the larger count (the To sell units are among
 * the log's, never added to them) at the higher of the two costs, so a price
 * that clears it is never a loss.
 *
 * A To sell row marked "Not for sale" (3.23.0, core/to-sell.js `keep`) is in
 * the list as `kept`: what you paid for it is still known (a price under it
 * still warns), and Fill all passes it by (fillAllList).
 *
 * @param {object} o
 * @param {Array<{itemId, name, qty, each, why, from, at}>} o.leftovers - the To sell list
 * @param {Array<{itemId, qty, each, at}>} [o.bought] - liveBoughtItems
 * @param {Map<string, number>|null} [o.reserved] - units bought for a trade still going, per item
 * @param {function} [o.nameOf] - (itemId) => name
 * @returns {Array<{itemId, name, qty, paid, source: 'tosell'|'bought', why, from, at}>}
 */
export function bazaarSellList({ leftovers = [], bought = [], reserved = null, nameOf = () => null } = {}) {
    const out = [];
    const byItem = new Map();
    for (const l of leftovers || []) {
        if (!l || !l.itemId || !(Number(l.qty) > 0)) continue;
        const id = String(l.itemId);
        const had = byItem.get(id);
        if (had) {
            // Two rows of one item (kept before rows were merged): one line, the cost averaged.
            const qty = had.qty + Number(l.qty);
            had.paid = Math.round((had.paid * had.qty + (Number(l.each) || 0) * Number(l.qty)) / qty);
            had.qty = qty;
            continue;
        }
        const row = { itemId: id, name: l.name || nameOf(id) || 'Item ' + id, qty: Math.floor(Number(l.qty)), paid: Number(l.each) || 0, source: 'tosell', why: l.why || 'left', from: l.from || null, at: Number(l.at) || 0 };
        if (Number(l.keep) > 0) row.kept = true;
        byItem.set(id, row);
        out.push(row);
    }
    const rest = [];
    for (const b of bought || []) {
        if (!b || !b.itemId) continue;
        const id = String(b.itemId);
        const free = Math.floor(Number(b.qty) || 0) - Math.max(0, Number(reserved && reserved.get(id)) || 0);
        const had = byItem.get(id);
        if (had) {
            if (free > had.qty) had.qty = free;
            if (Number(b.each) > had.paid) had.paid = Number(b.each);
            continue;
        }
        if (!(free > 0)) continue;
        const row = { itemId: id, name: nameOf(id) || 'Item ' + id, qty: free, paid: Number(b.each) || 0, source: 'bought', why: null, from: null, at: Number(b.at) || 0 };
        byItem.set(id, row);
        rest.push(row);
    }
    rest.sort((a, b) => b.at - a.at || String(a.name).localeCompare(String(b.name)));
    return [...out, ...rest];
}

/** The rows Fill all goes through: all but the ones marked "Not for sale" (3.23.0). */
export function fillAllList(list) {
    return (list || []).filter((r) => r && !r.kept);
}

/** Would listing at `price` give less than you paid for it? (Nothing known paid: never.) */
export function underPaid(price, paid) {
    return Number(paid) > 0 && Number(price) > 0 && Number(price) < Number(paid);
}
