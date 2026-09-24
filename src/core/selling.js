/*
 * The selling page's logic: which trader pays most for each item you hold.
 * Pure - no DOM, no network.
 *
 * Traders are ALWAYS ranked highest price first. "Online only" drops the
 * traders who are not online and ranks the rest the same way; it never
 * reorders by status. A trader's price is an offer on their TornExchange
 * list, so every row also shows what the item usually goes for (Torn's
 * market value, the daily average of actual sales) and what traders offer
 * on average, for a sense of whether the best offer is out of line.
 */

/** Ask TornExchange for the top buyers this often. It caches for 5 min. */
export const TE_REFRESH_MS = 30 * 60 * 1000;

/** Trader prices older than this are not used at all. */
export const TE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const TE_CACHE_VERSION = 1;

/** A per-item full buyer list is kept this long before it is asked again. */
export const TE_ITEM_TTL_MS = 30 * 60 * 1000;

/** 'online' | 'idle' | 'offline' | 'unknown' from a parsed presence. */
export function presenceLevel(presence) {
    const s = presence && presence.online;
    return s ? String(s).toLowerCase() : 'unknown';
}

/**
 * Highest price first; ties by TornExchange score. With onlineOnly, only
 * traders known to be online are kept.
 *
 * @param {Array<{name, id, price, score}>} traders
 * @param {object} ctx
 * @param {function} ctx.presenceOf - (traderId) => presence | null
 * @param {boolean} [ctx.onlineOnly]
 * @returns {Array<{trader, level}>}
 */
export function rankOffers(traders, { presenceOf = () => null, onlineOnly = false } = {}) {
    const ranked = [];
    for (const trader of traders || []) {
        if (!trader || !(trader.price > 0)) continue;
        const level = trader.id ? presenceLevel(presenceOf(trader.id)) : 'unknown';
        if (onlineOnly && level !== 'online') continue;
        ranked.push({ trader, level });
    }

    ranked.sort(
        (a, b) =>
            b.trader.price - a.trader.price ||
            (b.trader.score || 0) - (a.trader.score || 0) ||
            String(a.trader.name).localeCompare(String(b.trader.name)),
    );
    return ranked;
}

/** Plain average of every trader's price, or null with nothing to average. */
export function tradersAverage(traders) {
    let sum = 0;
    let n = 0;
    for (const t of traders || []) {
        if (t && t.price > 0) {
            sum += t.price;
            n += 1;
        }
    }
    return n ? Math.round(sum / n) : null;
}

/**
 * Traders from two sources, merged by name: TornExchange's top-three list
 * (with ids) and an item's full buyer list (names and prices only). A name
 * on the full list that the top-three or the active-traders list knows gets
 * its id; the rest keep no id and so no profile link or online status.
 *
 * The full list carries everyone, where the top-three list carries only
 * active traders with a non-negative score. So when the active-traders list
 * is known, a full-list name on neither it nor the top three is left out
 * (an inactive trader), and a known negative score is left out too.
 *
 * @param {Array} best - top-three traders for the item (name, id, price, score)
 * @param {Array|null} full - the full buyer list (name, price), or null if not loaded
 * @param {Map} [idsByName] - lowercase active trader name -> torn id
 * @returns {{traders: Array, partial: boolean}} partial = only the top three are known
 */
export function mergeTraders(best, full, idsByName = new Map()) {
    const known = new Map();
    const negative = new Set();
    for (const t of best || []) {
        if (!t || !t.name) continue;
        const key = String(t.name).toLowerCase();
        if (t.score < 0) negative.add(key);
        else known.set(key, { ...t });
    }

    if (!Array.isArray(full)) {
        return { traders: [...known.values()], partial: true };
    }

    const activeKnown = idsByName && idsByName.size > 0;
    const out = new Map();
    for (const t of full) {
        if (!t || !t.name || !(t.price > 0)) continue;
        const key = String(t.name).toLowerCase();
        if (negative.has(key)) continue;
        const b = known.get(key);
        if (!b && activeKnown && !idsByName.has(key)) continue;
        out.set(key, {
            name: b ? b.name : t.name,
            id: (b && b.id) || idsByName.get(key) || null,
            price: t.price,
            score: b ? b.score : 0,
        });
    }
    // A top-three trader missing from the full list (paging, a hidden
    // listing) is still a buyer.
    for (const [key, b] of known) if (!out.has(key)) out.set(key, b);

    return { traders: [...out.values()], partial: false };
}

/** How the item list is ordered: by the best single-item offer, or by the bundle (qty x offer). */
export const SORT_ITEM = 'item';
export const SORT_BUNDLE = 'bundle';

/**
 * One row per item you hold, with its best offer.
 *
 * @param {Array<{id, name, qty}>} inventory - from mergeInventory
 * @param {object} index - item index (market values, names)
 * @param {object} ctx
 * @param {function} ctx.tradersFor - (itemId) => {traders, partial}
 * @param {function} ctx.presenceOf
 * @param {boolean} [ctx.onlineOnly]
 * @param {string} [ctx.sortBy] - SORT_ITEM (default): best offer per item,
 *   highest first; SORT_BUNDLE: qty x best offer, highest first. Items with
 *   no buyer come last either way, by value.
 * @returns {Array<object>}
 */
export function buildSellingRows(inventory, index, { tradersFor, presenceOf = () => null, onlineOnly = false, sortBy = SORT_ITEM }) {
    const rows = [];

    for (const held of inventory || []) {
        const item = index && index.byId ? index.byId.get(String(held.id)) : null;
        const { traders, partial } = tradersFor(held.id) || { traders: [], partial: true };
        const offers = rankOffers(traders, { presenceOf, onlineOnly });
        const best = offers[0] || null;
        const marketValue = item ? Number(item.marketValue) || null : null;

        rows.push({
            itemId: String(held.id),
            name: (item && item.name) || held.name || 'Item ' + held.id,
            qty: held.qty,
            marketValue,
            offers,
            best,
            bestPrice: best ? best.trader.price : null,
            total: best ? best.trader.price * held.qty : null,
            tradersAvg: tradersAverage(traders),
            avgPartial: partial,
            buyers: traders.length,
        });
    }

    const bundle = sortBy === SORT_BUNDLE;
    rows.sort((a, b) => {
        if ((a.total === null) !== (b.total === null)) return a.total === null ? 1 : -1;
        if (a.total !== null) {
            return bundle
                ? b.total - a.total || b.bestPrice - a.bestPrice
                : b.bestPrice - a.bestPrice || b.total - a.total;
        }
        const av = (a.marketValue || 0) * (bundle ? a.qty : 1);
        const bv = (b.marketValue || 0) * (bundle ? b.qty : 1);
        return bv - av || String(a.name).localeCompare(String(b.name));
    });
    return rows;
}

/** Everyone a selling list would like a status for: best traders first. */
export function tradersToWatch(rows, { expanded = new Set(), max = 20 } = {}) {
    const ids = [];
    const push = (id) => {
        if (id && !ids.includes(id) && ids.length < max) ids.push(String(id));
    };
    for (const r of rows) if (r.best) push(r.best.trader.id);
    for (const r of rows) {
        if (!expanded.has(r.itemId)) continue;
        for (const o of r.offers) push(o.trader.id);
    }
    for (const r of rows) for (const o of r.offers) push(o.trader.id);
    return ids;
}

/* -------------------------------------------------------------- storage */

/** Compact form for GM storage: {id: [[name, traderId, price, score], ...]}. */
export function makeTeCacheEntry(map, now = Date.now()) {
    const items = {};
    for (const [itemId, traders] of map) {
        items[itemId] = traders.map((t) => [t.name, t.id, t.price, t.score]);
    }
    return { version: TE_CACHE_VERSION, fetchedAt: now, items };
}

/** @returns {{fetchedAt: number, map: Map}|null} null if absent, old-format or too old */
export function readTeCacheEntry(entry, now = Date.now()) {
    if (!entry || entry.version !== TE_CACHE_VERSION || !entry.items) return null;

    const fetchedAt = Number(entry.fetchedAt);
    if (!Number.isFinite(fetchedAt) || now - fetchedAt > TE_MAX_AGE_MS) return null;

    const map = new Map();
    for (const [itemId, rows] of Object.entries(entry.items)) {
        if (!Array.isArray(rows)) continue;
        const traders = rows
            .filter((r) => Array.isArray(r) && r.length >= 3)
            .map(([name, id, price, score]) => ({
                name: String(name),
                id: String(id),
                price: Number(price),
                score: Number(score) || 0,
            }))
            .filter((t) => t.id && t.price > 0);
        if (traders.length) map.set(itemId, traders);
    }

    return { fetchedAt, map };
}

/** Per-item full buyer lists: {itemId: {at, traders: [[name, price], ...]}}. */
export function readTeItemLists(entry, now = Date.now()) {
    const out = new Map();
    if (!entry || typeof entry !== 'object') return out;
    for (const [itemId, rec] of Object.entries(entry)) {
        if (!rec || !Array.isArray(rec.traders)) continue;
        const at = Number(rec.at);
        if (!Number.isFinite(at) || now - at > TE_ITEM_TTL_MS) continue;
        out.set(itemId, {
            at,
            traders: rec.traders
                .filter((r) => Array.isArray(r) && r.length >= 2)
                .map(([name, price]) => ({ name: String(name), price: Number(price) }))
                .filter((t) => t.name && t.price > 0),
        });
    }
    return out;
}

export function writeTeItemList(entry, itemId, traders, now = Date.now(), max = 200) {
    const next = { ...(entry && typeof entry === 'object' ? entry : {}) };
    next[String(itemId)] = { at: now, traders: (traders || []).map((t) => [t.name, t.price]) };
    const keys = Object.keys(next);
    if (keys.length > max) {
        keys.sort((a, b) => Number(next[a].at) - Number(next[b].at));
        for (const k of keys.slice(0, keys.length - max)) delete next[k];
    }
    return next;
}
