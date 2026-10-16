/*
 * Flips per trader (3.33.0, engines plan Stage 2): Best flips as traders, each ranked by what the whole basket
 * with them makes - the same plan the desk makes (core/trade.js planTrade), so the list's total is the trade's.
 *
 * Planning every trader is too slow on a big page, so a quick sum picks who gets a full plan: what every listing
 * under their price would leave, with no cash, pay or item limit. The top TOP_TRADERS of those are planned in full.
 * Pure: no page, no clock.
 */

/** How many traders, beyond favourites and Trusted ones, get a full plan each redraw (measured: about 20). */
export const TOP_TRADERS = 20;

/**
 * What a trader's items would leave if every listing under their price were bought - no limits.
 * @param {Array<{bid: number, sellers: Array<{price: number, qty: number, stale?: boolean}>}>} lines
 * @returns {number}
 */
export function quickSum(lines) {
    let sum = 0;
    for (const l of lines || []) {
        const bid = Number(l && l.bid);
        if (!(bid > 0)) continue;
        for (const s of (l && l.sellers) || []) {
            const price = Number(s && s.price);
            const qty = Number(s && s.qty);
            if (!s || s.stale || !(price > 0) || !(qty > 0) || price >= bid) continue;
            sum += (bid - price) * qty;
        }
    }
    return sum;
}

/**
 * The traders worth a full plan: the biggest quick sums, none already in `skip`.
 * @param {Map<string, number>|Array<[string, number]>} sums - trader key -> quickSum
 * @param {number} [k]
 * @param {Set<string>} [skip] - keys planned anyway (favourites, Trusted)
 * @returns {string[]} keys, biggest first
 */
export function topTraders(sums, k = TOP_TRADERS, skip = new Set()) {
    return [...(sums instanceof Map ? sums.entries() : sums || [])]
        .filter(([key, v]) => v > 0 && !skip.has(key))
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, Math.max(0, Math.floor(k)))
        .map(([key]) => key);
}

/**
 * Where a trader's row stands: a trade you can ask for now first - online and with their list seen open - then
 * one whose trader is offline or whose list is not seen open, then being checked, reading, no trade, and last
 * one a filter leaves out.
 */
export function basketRank(x) {
    if (x.hiddenBy) return 5;
    if (x.items && x.profit > 0) return x.waiting ? 2 : x.offline || x.notOpen ? 1 : 0;
    return x.reading ? 3 : 4;
}

/** Traders by basket: rank, then what the whole trade makes; a favourite only on a tie. */
export function basketOrder(list) {
    return [...(list || [])].sort((a, b) => basketRank(a) - basketRank(b) || b.profit - a.profit || (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
}

/**
 * The best other trader for an item: the one who pays most, not this one.
 * @param {Array<{id?, name?, price}>} buyers - the item's buyers with checked prices, best first or not
 * @param {function} keyOf - buyer -> trader key
 * @param {string} key - this trader's key
 * @returns {{name: string, price: number}|null}
 */
export function secondBest(buyers, keyOf, key) {
    let best = null;
    for (const b of buyers || []) {
        if (!b || !(Number(b.price) > 0) || keyOf(b) === key) continue;
        if (!best || b.price > best.price) best = { name: b.name || (b.id ? 'Player ' + b.id : '?'), price: Number(b.price) };
    }
    return best;
}

/**
 * A planned trade as lines: each with the bazaar price (each), your cost, their price and what it makes; your
 * own To sell items with what you paid (`each`, null when not known; `cost` 0: no money goes out for them).
 * The totals are the trade's own: `profit` = the plan's profit.
 * @param {object} t - a trade from tradeWith (planTrade + held gain)
 * @param {object} [o]
 * @param {function} [o.nameOf] - item id -> name
 * @param {function} [o.secondOf] - item id -> secondBest() for that item
 * @returns {{lines: Array, cost: number, back: number, profit: number}}
 */
export function basketLines(t, { nameOf = (id) => String(id), secondOf = () => null } = {}) {
    const lines = [];
    for (const r of (t && t.flips) || []) {
        if (!(r.units > 0)) continue;
        lines.push({ itemId: String(r.itemId), name: nameOf(r.itemId), units: r.units, each: r.cost / r.units, cost: r.cost, bid: r.bid, back: r.units * r.bid, profit: r.profit, second: secondOf(r.itemId), yours: false });
    }
    for (const h of (t && t.held) || []) {
        if (!(h.units > 0)) continue;
        // What you paid; not known (null), it makes nothing here, as in heldGain (core/to-sell.js).
        const each = Number(h.each) >= 0 ? Number(h.each) : null;
        lines.push({ itemId: String(h.itemId), name: nameOf(h.itemId), units: h.units, each, cost: 0, bid: h.bid, back: h.units * h.bid, profit: each === null ? 0 : h.units * (h.bid - each), second: secondOf(h.itemId), yours: true });
    }
    const sum = (f) => lines.reduce((a, l) => a + l[f], 0);
    // cost: what the bazaars take - the money this trade needs (yours is held already, cost 0 here).
    return { lines, cost: sum('cost'), back: sum('back'), profit: sum('profit') };
}
