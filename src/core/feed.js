/*
 * The live feed: listings found anywhere in Torn, not just on this page.
 *
 * Pure - no DOM, no network, no storage. The controller fetches and stores;
 * this decides what is a candidate, what a snapshot means, and when a row
 * is too old to show.
 *
 * The rule that shapes everything here, learned the hard way: a listing is
 * only as live as the data behind it. So every row carries TWO times:
 *
 *   dataAt    - when the SOURCE last saw it (TornW3B's last_checked, the
 *               Item Market's cache_timestamp). Expiry and "age" use this.
 *   fetchedAt - when WE asked. Only a hard cap uses this.
 *
 * The old ledger stamped rows with the time the DOM was re-read, every 2.5s,
 * so a price from twenty minutes ago kept presenting as "just now" and the
 * panel linked trades that no longer existed. Nothing here refreshes a time
 * without new data behind it.
 *
 * And a new snapshot for an item REPLACES everything known about that item
 * from that source. Merging is how a sold listing survives.
 */

import { bestVenue, computeOpportunity } from './profit.js';
import { formatMoneyShort } from './parse.js';

export const FEED_CACHE_VERSION = 'feed-v1';

/*
 * Only what the latest refresh confirmed is shown. Nothing is greyed out:
 * a row that is not re-confirmed in time is removed.
 */

/** The list is rebuilt from fresh data this often. */
export const REFRESH_MS = 30 * 1000;

/** A bazaar row TornW3B has not checked within this long is not shown. */
export const BAZAAR_MAX_DATA_AGE_MS = 2 * 60 * 1000;

/**
 * Re-ask TornW3B about an item this often. Its server caches each answer for
 * 60s, so asking every 30s would return the same body half the time.
 */
export const BAZAAR_REFRESH_MS = 60 * 1000;

/** A bazaar snapshot not refreshed in time is dropped, rows and all. */
export const BAZAAR_SNAPSHOT_TTL_MS = BAZAAR_REFRESH_MS + REFRESH_MS;

/**
 * Item Market: Torn refreshes it every 30s, and items with a live
 * opportunity are re-checked each time. One missed refresh is tolerated;
 * two is removal.
 */
export const ITEM_MARKET_SNAPSHOT_TTL_MS = 2 * REFRESH_MS + 15 * 1000;

/**
 * Most candidates followed up per summary. 25 per minute plus two summaries
 * stays inside the 60/min this tool allows itself on TornW3B.
 */
export const MAX_CANDIDATES = 25;

export const SOURCE_BAZAAR = 'bazaar';
export const SOURCE_ITEM_MARKET = 'itemmarket';

export function emptyFeed() {
    return { bazaar: new Map(), itemmarket: new Map() };
}

/**
 * Where you could sell an item, under the current settings. Shared with the
 * page scanner so both price listings identically.
 *
 *   NPC            - "Sell to NPC": the item's Sell price, no tax. The main
 *                    job of this tool. Only when the item HAS a Sell price;
 *                    "Sell: N/A" in game (no sell_price) means no NPC buys it.
 *   BAZAAR_RESALE  - trading: relist in your own bazaar at the average value
 *                    (Torn's "Value"), no tax.
 *   ITEM_MARKET    - trading: sell on the Item Market at the average value,
 *                    minus the 5% tax.
 *
 * The average value is what an item tends to trade for, never an NPC price.
 *
 * @param {object} item - record from buildItemIndex
 * @param {object} settings - sellToNpc, resaleBazaar, resaleMarket
 */
export function exitsFor(item, settings = {}, traderPrice = 0) {
    const exits = {};
    if (!item) return exits;

    // What the chosen TornExchange trader pays - see core/traders.js.
    if (settings.sellToTrader && Number(traderPrice) > 0) {
        exits.TRADER = Number(traderPrice);
    }

    if (settings.sellToNpc !== false) {
        const sell = Number(item.sellPrice);
        if (Number.isFinite(sell) && sell > 0) exits.NPC = sell;
    }

    const value = Number(item.marketValue);
    if (Number.isFinite(value) && value > 0) {
        if (settings.resaleBazaar) exits.BAZAAR_RESALE = value;
        if (settings.resaleMarket) exits.ITEM_MARKET = value;
    }

    return exits;
}

/**
 * The most a listing at `price` can earn with the user's cash: profit per
 * item x how many the cash buys (and no more than `qty`, when known).
 * Infinity when neither cash nor quantity limits it.
 *
 * This is what makes discovery cash-aware. Ranking by profit PER ITEM always
 * put the $200m items first; with $1m of cash every one of them was then
 * filtered out, and the cheap deals that fit were never fetched at all.
 */
export function reachableProfit(profitPerUnit, price, settings = {}, qty = Infinity) {
    let n = Number.isFinite(qty) && qty > 0 ? qty : Infinity;
    const cash = Number(settings.cashOnHand);
    if (cash > 0 && price > 0) n = Math.min(n, Math.floor(cash / price));
    if (n === 0) return 0;
    return profitPerUnit * n;
}

/**
 * Which items are worth a closer look, from TornW3B's one-call summary.
 *
 * Everything here is free - one summary for every item, plus the cached
 * item database - so the Cash and Min filters are applied BEFORE any request:
 * an item you cannot afford one of, or that cannot reach your Min with your
 * cash, is never fetched. What is left is ranked by the profit your cash can
 * actually make.
 *
 * One request covers every item; the friend's script made ~1,100 in a
 * 22-minute loop to answer the same question, and the answer was stale
 * before it finished.
 *
 * @param {Array} summary - from fetchW3bSummary
 * @param {object} index - from buildItemIndex
 * @param {object} settings
 * @returns {Array<{itemId: string, lowestPrice: number, profitPerUnit: number}>}
 */
export function selectCandidates(
    summary,
    index,
    settings = {},
    max = MAX_CANDIDATES,
    traderPriceOf = () => 0,
) {
    const out = [];

    for (const s of summary || []) {
        if (!s || !s.lowestPrice) continue;

        const item = index && index.byId && index.byId.get(String(s.itemId));
        if (!item) continue;

        const best = bestVenue({
            listingPrice: s.lowestPrice,
            exits: exitsFor(item, settings, traderPriceOf(item.id)),
            qty: 1,
        });

        if (!best || best.profitPerUnit < 1) continue;

        const reach = reachableProfit(best.profitPerUnit, s.lowestPrice, settings);
        if (reach < 1) continue; // cannot afford even one
        if (reach < (Number(settings.minTotalProfit) || 0)) continue;

        out.push({
            itemId: String(s.itemId),
            lowestPrice: s.lowestPrice,
            profitPerUnit: best.profitPerUnit,
            reach,
        });
    }

    // With cash set, what your cash can make; without, profit per item.
    out.sort((a, b) =>
        Number.isFinite(a.reach) && Number.isFinite(b.reach)
            ? b.reach - a.reach || b.profitPerUnit - a.profitPerUnit
            : b.profitPerUnit - a.profitPerUnit,
    );
    return max > 0 ? out.slice(0, max) : out;
}

/** Seconds, milliseconds, or nothing -> ms or null. Unknown is not "old". */
function toMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
}

/**
 * TornW3B listings -> feed rows. Rows with no seller are dropped: there is
 * nowhere to send the user, and "bazaar.php?userId=null" is not a link.
 * Sorted by price ourselves - TornW3B puts sponsored rows first.
 */
export function normalizeW3bListings(raw) {
    const rows = [];

    for (const l of raw || []) {
        if (!l) continue;

        const sellerId = Number(l.player_id);
        const price = Number(l.price);
        const qty = Number(l.quantity);

        if (!Number.isFinite(sellerId) || sellerId <= 0) continue;
        if (!Number.isFinite(price) || price <= 0) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        /*
         * $1 is Torn's locked "Dollar Sale" price: buyable by a random few
         * percent of players, and the usual price of a target trade meant for
         * one person. TornW3B cannot say which, so none are offered from the
         * feed. (On the page itself, an unlocked $1 card IS yours to buy and
         * is read normally.)
         */
        if (price <= 1) continue;

        rows.push({
            sellerId: String(sellerId),
            sellerName: l.player_name ? String(l.player_name) : null,
            price,
            qty: Math.floor(qty),
            dataAt: toMs(l.last_checked) || toMs(l.content_updated),
            changedAt: toMs(l.content_updated),
        });
    }

    rows.sort((a, b) => a.price - b.price);
    return rows;
}

/** Item Market rows are anonymous; identical prices are merged. */
export function normalizeItemMarketRows(listings) {
    const byPrice = new Map();

    for (const l of listings || []) {
        const price = Number(l && l.price);
        const amount = Number(l && l.amount);
        if (!(price > 0) || !(amount > 0)) continue;
        byPrice.set(price, (byPrice.get(price) || 0) + amount);
    }

    return [...byPrice.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([price, qty]) => ({ price, qty }));
}

/** Replace everything known about an item's bazaar listings. */
export function setBazaarSnapshot(feed, itemId, rows, fetchedAt) {
    feed.bazaar.set(String(itemId), { fetchedAt, rows: rows || [] });
    return feed;
}

/** Replace everything known about an item's Item Market listings. */
export function setItemMarketSnapshot(
    feed,
    itemId,
    { rows, fetchedAt, dataAt = null, nextAt = null, averagePrice = null },
) {
    feed.itemmarket.set(String(itemId), {
        fetchedAt,
        dataAt: dataAt || fetchedAt,
        nextAt: nextAt || fetchedAt + 30000,
        averagePrice,
        rows: rows || [],
    });
    return feed;
}

/**
 * Drop whatever is too old to trust.
 * @returns {number} how many rows were removed
 */
export function expireFeed(feed, now = Date.now()) {
    let removed = 0;

    for (const [id, snap] of feed.bazaar) {
        if (!Number.isFinite(snap.fetchedAt) || now - snap.fetchedAt > BAZAAR_SNAPSHOT_TTL_MS) {
            removed += snap.rows.length;
            feed.bazaar.delete(id);
            continue;
        }

        const before = snap.rows.length;
        snap.rows = snap.rows.filter(
            (r) => r.dataAt === null || now - r.dataAt <= BAZAAR_MAX_DATA_AGE_MS,
        );
        removed += before - snap.rows.length;
    }

    for (const [id, snap] of feed.itemmarket) {
        if (!Number.isFinite(snap.fetchedAt) || now - snap.fetchedAt > ITEM_MARKET_SNAPSHOT_TTL_MS) {
            removed += snap.rows.length;
            feed.itemmarket.delete(id);
        }
    }

    return removed;
}

/**
 * Should this candidate's bazaar listings be (re)fetched now?
 * Yes when never fetched, when the summary's cheapest price moved, or when
 * the snapshot is older than TornW3B's own cache.
 */
export function bazaarDue(feed, candidate, now = Date.now()) {
    const snap = feed.bazaar.get(String(candidate.itemId));
    if (!snap) return true;
    if (now - snap.fetchedAt >= BAZAAR_REFRESH_MS) return true;

    const cheapest = snap.rows.length ? snap.rows[0].price : null;
    return cheapest !== candidate.lowestPrice;
}

/** Items that currently have an Item Market opportunity: re-check first. */
export function itemMarketLiveIds(feed) {
    const ids = [];
    for (const [id, snap] of feed.itemmarket) if (snap.rows.length) ids.push(id);
    return ids;
}

/** Item Market: never before Torn's global cache can have changed. */
export function itemMarketDue(feed, itemId, now = Date.now()) {
    const snap = feed.itemmarket.get(String(itemId));
    return !snap || now >= snap.nextAt;
}

/** Forget one seller's listing of one item (e.g. the page proved it gone). */
export function removeBazaarRows(feed, itemId, predicate) {
    const snap = feed.bazaar.get(String(itemId));
    if (!snap) return 0;

    const before = snap.rows.length;
    snap.rows = snap.rows.filter((r) => !predicate(r));
    return before - snap.rows.length;
}

/**
 * The page you are viewing is the most authoritative source there is. When
 * it contradicts the feed, the feed loses.
 *
 * - On a seller's bazaar: if the page shows an item from that seller only at
 *   a HIGHER price than a feed row claims, that row is gone.
 * - On the Item Market: the page shows the current cheapest price per item;
 *   any feed row cheaper than that has sold.
 *
 * Absence from the page proves nothing - bazaars render lazily - so only a
 * visible contradiction removes a row.
 *
 * @param {object} feed
 * @param {object} page
 * @param {'bazaar'|'itemmarket'} page.pageType
 * @param {string|null} page.sellerId - bazaar owner, from the URL
 * @param {Array<{itemId, listingPrice}>} page.listings
 * @returns {number} rows removed
 */
export function reconcileWithPage(feed, { pageType, sellerId, listings }) {
    const pageMin = new Map();
    for (const l of listings || []) {
        const id = String(l.itemId);
        const p = Number(l.listingPrice);
        if (!(p > 0)) continue;
        if (!pageMin.has(id) || p < pageMin.get(id)) pageMin.set(id, p);
    }

    let removed = 0;

    if (pageType === SOURCE_BAZAAR && sellerId) {
        for (const [id, min] of pageMin) {
            removed += removeBazaarRows(
                feed,
                id,
                (r) => r.sellerId === String(sellerId) && r.price < min,
            );
        }
    }

    if (pageType === SOURCE_ITEM_MARKET) {
        for (const [id, min] of pageMin) {
            const snap = feed.itemmarket.get(id);
            if (!snap) continue;
            const before = snap.rows.length;
            snap.rows = snap.rows.filter((r) => r.price >= min);
            removed += before - snap.rows.length;
        }
    }

    return removed;
}

/**
 * Has fresher data proved that a listing on the page you are viewing is gone?
 *
 * Torn's page does not update itself, and this script may not reload it -
 * so a listing can sell while it is still on screen. The feed re-checks it:
 *
 * - Item Market: if a snapshot taken AFTER the page showed the row has
 *   nothing at or below that price, it sold.
 * - Bazaar: if TornW3B checked that seller AFTER the page showed the row and
 *   has them at a higher price, it was bought or repriced. A seller missing
 *   from TornW3B's data proves nothing - it may simply not track them.
 *
 * @param {object} feed
 * @param {object} row - a page row: itemId, source, sellerId, seenAt, listingPrice
 */
export function pageRowContradicted(feed, row) {
    const id = String(row.itemId);
    const price = Number(row.listingPrice ?? (row.profit && row.profit.listingPrice));
    const seenAt = Number(row.seenAt) || 0;

    if (row.source === SOURCE_ITEM_MARKET) {
        const snap = feed.itemmarket.get(id);
        if (!snap || !(snap.dataAt > seenAt)) return false;
        return !snap.rows.some((r) => r.price <= price);
    }

    if (row.source === SOURCE_BAZAAR && row.sellerId) {
        const snap = feed.bazaar.get(id);
        if (!snap) return false;

        const mine = snap.rows.filter(
            (r) => r.sellerId === String(row.sellerId) && r.dataAt > seenAt,
        );
        return mine.length > 0 && !mine.some((r) => r.price <= price);
    }

    return false;
}

/** Deep link to one seller's bazaar, carrying what to highlight there. */
export function bazaarUrl(sellerId, itemId, price) {
    const params = new URLSearchParams({ userId: String(sellerId) });
    if (itemId) params.set('ttItem', String(itemId));
    if (price) params.set('ttPrice', String(price));
    return 'https://www.torn.com/bazaar.php?' + params.toString() + '#/';
}

/**
 * Feed rows -> priced opportunities the ranker and panel understand.
 *
 * @param {object} feed
 * @param {object} index - item index
 * @param {object} settings
 * @param {object} [ctx]
 * @param {function} [ctx.npcShopFor] - (itemId) => shop | null
 * @param {function} [ctx.itemMarketUrl] - (itemId, name) => url
 * @param {number} [ctx.now]
 */
export function feedOpportunities(feed, index, settings = {}, ctx = {}) {
    const now = ctx.now || Date.now();
    const shopOf = ctx.npcShopFor || (() => null);
    const out = [];

    const traderFor = ctx.traderFor || (() => null);

    const price = (item, row, extra) => {
        const npcShop = shopOf(item.id);
        const pick = traderFor(item);
        const profit = bestVenue({
            listingPrice: row.price,
            exits: exitsFor(item, settings, pick && pick.trader.price),
            qty: row.qty,
            cashOnHand: settings.cashOnHand,
        });

        if (!profit || profit.profitPerUnit <= 0) return;

        out.push({
            itemId: item.id,
            name: item.name,
            item,
            el: null,
            fromFeed: true,
            qtyAtPrice: true,
            npcShop,
            npcVerified: npcShop !== null,
            profit,
            traderPick: profit.venue === 'TRADER' ? pick : null,
            cardLabel: '+' + formatMoneyShort(profit.totalProfit),
            ...extra,
        });
    };

    for (const [id, snap] of feed.bazaar) {
        const item = index && index.byId && index.byId.get(id);
        if (!item) continue;

        for (const row of snap.rows) {
            price(item, row, {
                source: SOURCE_BAZAAR,
                sellerId: row.sellerId,
                sellerName: row.sellerName,
                dataAt: row.dataAt || snap.fetchedAt,
                dataAgeKnown: row.dataAt !== null,
                fetchedAt: snap.fetchedAt,
                url: bazaarUrl(row.sellerId, id, row.price),
            });
        }
    }

    for (const [id, snap] of feed.itemmarket) {
        const item = index && index.byId && index.byId.get(id);
        if (!item) continue;

        for (const row of snap.rows) {
            price(item, row, {
                source: SOURCE_ITEM_MARKET,
                sellerId: null,
                sellerName: null,
                dataAt: snap.dataAt,
                dataAgeKnown: true,
                fetchedAt: snap.fetchedAt,
                url: ctx.itemMarketUrl ? ctx.itemMarketUrl(id, item.name) : null,
            });
        }
    }

    // Keep `now` meaningful for callers that sort by freshness.
    for (const row of out) row.ageMs = Math.max(0, now - row.dataAt);

    return out;
}

/* -------------------------------------------------------------- storage */

export function makeFeedCacheEntry(feed, now = Date.now()) {
    return {
        version: FEED_CACHE_VERSION,
        savedAt: now,
        bazaar: [...feed.bazaar.entries()],
        itemmarket: [...feed.itemmarket.entries()],
    };
}

export function readFeedCacheEntry(entry, now = Date.now()) {
    const feed = emptyFeed();
    if (!entry || entry.version !== FEED_CACHE_VERSION) return feed;

    for (const [id, snap] of entry.bazaar || []) {
        if (snap && Array.isArray(snap.rows)) feed.bazaar.set(String(id), snap);
    }
    for (const [id, snap] of entry.itemmarket || []) {
        if (snap && Array.isArray(snap.rows)) feed.itemmarket.set(String(id), snap);
    }

    expireFeed(feed, now);
    return feed;
}

/**
 * Items worth sweeping on the Item Market when TornW3B has nothing to say
 * about them: an NPC hit there is only possible when the NPC price is close
 * to what the item normally trades for.
 */
export function itemMarketSweepList(index, settings = {}, traderPriceOf = () => 0) {
    const scored = [];
    const cash = Number(settings.cashOnHand) || 0;

    for (const item of (index && index.byId && index.byId.values()) || []) {
        const sell = Number(item.sellPrice);
        const mv = Number(item.marketValue);
        if (!(mv > 0)) continue;

        // Probe: a listing 15% under market value - what would it make?
        const probePrice = mv * 0.85;
        const perUnit = (exitPrice, venue) => {
            const probe = computeOpportunity({ listingPrice: probePrice, exitPrice, venue });
            return probe ? probe.profitPerUnit : 0;
        };

        let best = 0;
        let floor = mv * 0.5; // the cheapest a real listing plausibly gets
        if (settings.sellToNpc !== false && sell > 0) {
            const p = perUnit(sell, 'NPC');
            if (p > best) { best = p; floor = Math.min(sell, mv) * 0.5; }
        }
        if (settings.sellToTrader) {
            best = Math.max(best, perUnit(Number(traderPriceOf(item.id)) || 0, 'TRADER'));
        }
        // The Market / My bazaar chips used to add nothing here, so with them
        // on, only NPC items were ever swept on the Item Market.
        if (settings.resaleMarket) best = Math.max(best, perUnit(mv, 'ITEM_MARKET'));
        if (settings.resaleBazaar) best = Math.max(best, perUnit(mv, 'BAZAAR_RESALE'));

        if (!(best > 0)) continue;
        // Not even one affordable at half its value: skip it.
        if (cash > 0 && floor > cash) continue;

        scored.push({ id: item.id, key: reachableProfit(best, probePrice, settings) || best });
    }

    // What your cash could make first, so the likeliest deals are checked soonest.
    scored.sort((a, b) => b.key - a.key);
    return scored.map((s) => s.id);
}
