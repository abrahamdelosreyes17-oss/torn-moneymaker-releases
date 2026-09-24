/*
 * Traders: which one to sell to, and the "By trader" grouping. Pure, no DOM.
 *
 * A trader's price is an OFFER, not a fact like an NPC's Sell price: the
 * trader may be offline, may have changed the price, or may refuse. So the
 * trader a deal is priced against is the one you can most likely sell to NOW:
 *
 *   1. a sane price first - more than TRADER_SUSPECT_RATIO x the item's value
 *      is usually a price the trader forgot to update, not a real bid;
 *   2. then online, idle, not-yet-known, offline - in that order;
 *   3. then the highest price, then the best TornExchange score.
 *
 * If someone further down that order pays more, the row says so ("best
 * offline: Alice $24,500") rather than hiding it.
 */

/** Above this multiple of the item's value, a trader's price gets a "check" flag. */
export const TRADER_SUSPECT_RATIO = 1.05;

/** Ask TornExchange this often. It caches for 5 min; prices move slowly. */
export const TE_REFRESH_MS = 30 * 60 * 1000;

/** Trader prices older than this are not used at all. */
export const TE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const TE_CACHE_VERSION = 1;

const LEVEL_RANK = { online: 0, idle: 1, unknown: 2, offline: 3 };

/** 'online' | 'idle' | 'offline' | 'unknown' from a parsed presence. */
export function presenceLevel(presence) {
    const s = presence && presence.online;
    return s ? String(s).toLowerCase() : 'unknown';
}

function isSuspect(price, marketValue) {
    return Number(marketValue) > 0 && price > marketValue * TRADER_SUSPECT_RATIO;
}

/**
 * Sane prices first, then online / idle / unknown / offline, then price, then score.
 * @returns {Array<{trader, level, suspect}>}
 */
export function rankTraders(traders, { presenceOf = () => null, marketValue = 0 } = {}) {
    const ranked = (traders || []).map((trader) => ({
        trader,
        level: presenceLevel(presenceOf(trader.id)),
        suspect: isSuspect(trader.price, marketValue),
    }));

    ranked.sort(
        (a, b) =>
            Number(a.suspect) - Number(b.suspect) ||
            (LEVEL_RANK[a.level] ?? 2) - (LEVEL_RANK[b.level] ?? 2) ||
            b.trader.price - a.trader.price ||
            b.trader.score - a.trader.score,
    );
    return ranked;
}

/**
 * @param {Array<{name, id, price, score}>} traders - TornExchange's top buyers
 * @param {object} ctx
 * @param {function} ctx.presenceOf - (traderId) => presence | null
 * @param {number} [ctx.marketValue]
 * @returns {null | {trader, level, suspect, pctOfValue, better}}
 *   better: a trader who pays more but is further down the order, or null
 */
export function pickTrader(traders, { presenceOf = () => null, marketValue = 0 } = {}) {
    if (!Array.isArray(traders) || !traders.length) return null;

    const ranked = rankTraders(traders, { presenceOf, marketValue });
    const chosen = ranked[0];

    let better = null;
    for (const r of ranked.slice(1)) {
        if (r.suspect || r.trader.price <= chosen.trader.price) continue;
        if (!better || r.trader.price > better.trader.price) better = r;
    }

    return {
        trader: chosen.trader,
        level: chosen.level,
        suspect: chosen.suspect,
        pctOfValue: Number(marketValue) > 0 ? chosen.trader.price / marketValue : null,
        better: better ? { trader: better.trader, level: better.level } : null,
    };
}

/**
 * The Traders page: every item in the deal list, the cheapest place to buy
 * it, and ALL its TornExchange traders ranked the same way pickTrader does
 * (sane price, online first, then price), each with the profit of selling
 * that listing to them.
 *
 * @param {Array} rows - the deal list (bazaar + Item Market), any exit
 * @param {Map} tradersMap - itemId -> traders, from TornExchange
 * @param {object} ctx - { presenceOf }
 * @returns {Array<{itemId, name, item, listing, listings, bestVenue, traders, bestTrader}>}
 */
export function buildTraderBoard(rows, tradersMap, { presenceOf = () => null } = {}) {
    const byItem = new Map();

    for (const row of rows || []) {
        if (!row || !row.profit) continue;
        const id = String(row.itemId);
        if (!byItem.has(id)) byItem.set(id, []);
        byItem.get(id).push(row);
    }

    const out = [];

    for (const [itemId, listings] of byItem) {
        listings.sort((a, b) => a.profit.listingPrice - b.profit.listingPrice);
        const listing = listings[0];
        const item = listing.item || {};
        const value = Number(item.marketValue) || 0;
        const qty = listing.profit.affordableQty || 1;

        const traders = rankTraders((tradersMap && tradersMap.get(itemId)) || [], {
            presenceOf,
            marketValue: value,
        }).map((r) => {
            const perUnit = r.trader.price - listing.profit.listingPrice;
            return {
                ...r,
                pctOfValue: value > 0 ? r.trader.price / value : null,
                profitPerUnit: perUnit,
                profit: perUnit * qty,
            };
        });

        // The trader you would actually sell to: the first who pays more than it costs.
        const bestTrader = traders.find((t) => !t.suspect && t.profitPerUnit > 0) || null;

        out.push({
            itemId,
            name: listing.name,
            item,
            listing,
            listings,
            bestVenue: listing.profit.venue,
            traders,
            bestTrader,
        });
    }

    return out;
}

/**
 * The most any sane trader pays - used to decide which items are worth
 * fetching listings for, before anyone's online status is known.
 */
export function maxTraderPrice(traders, marketValue = 0) {
    let best = 0;
    for (const t of traders || []) {
        if (isSuspect(t.price, marketValue)) continue;
        if (t.price > best) best = t.price;
    }
    return best;
}

/**
 * Deals sold to a trader, grouped by that trader: one trade window each.
 * Online traders first, then the biggest total.
 *
 * @param {Array} rows - priced rows; only those whose best exit is TRADER count
 * @returns {Array<{trader, level, score, rows, totalProfit, cashRequired}>}
 */
export function groupByTrader(rows) {
    const groups = new Map();

    for (const row of rows || []) {
        if (!row || !row.profit || row.profit.venue !== 'TRADER' || !row.traderPick) continue;

        const pick = row.traderPick;
        const id = pick.trader.id;
        if (!groups.has(id)) {
            groups.set(id, {
                trader: pick.trader,
                level: pick.level,
                rows: [],
                totalProfit: 0,
                cashRequired: 0,
            });
        }

        const g = groups.get(id);
        g.rows.push(row);
        g.totalProfit += row.profit.realizableProfit;
        g.cashRequired += row.profit.cashRequired;
    }

    const out = [...groups.values()];
    for (const g of out) {
        g.rows.sort((a, b) => b.profit.realizableProfit - a.profit.realizableProfit);
    }

    out.sort(
        (a, b) =>
            (LEVEL_RANK[a.level] ?? 2) - (LEVEL_RANK[b.level] ?? 2) ||
            b.totalProfit - a.totalProfit,
    );
    return out;
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
