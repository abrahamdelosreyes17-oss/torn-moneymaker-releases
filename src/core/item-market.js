/*
 * The Item Market as a place to buy a flip's goods (3.35.0; the owner: "Cheapest bazaar or item market").
 *
 * Until now a flip's buy plan took bazaars only. The Item Market (Torn's /v2/market/{id}/itemmarket, on the Torn key,
 * counted in its budget) often sells under every bazaar: Beer at $800 there against a trader paying $943 is a flip.
 * Its listings have no seller, only a price and an amount, so they become bazaar-shaped rows with the seller
 * 'market' / 'Item Market' (core/owner-tab.js marketRows - the owner's tab buys there already) and are merged into
 * the item's sellers (main.js sellersOf): the plan takes the cheapest rows of both, and a step bought there says
 * "Item Market" and links the item's market page instead of a bazaar.
 *
 * Limit: a listing has no seller, so "never sell a trader items bought from their own bazaar" cannot be told of
 * a market row. Torn does not name the seller of an Item Market listing before you buy.
 *
 * Pure: no page, no clock, no network.
 */

import { OWNER_MARKET, marketRows } from './owner-tab.js';

/** Listings asked for per item (the cheapest). */
export const ITEM_MARKET_LISTINGS = 10;
/** A market row is as good as a fresh bazaar read this long (Torn renews its copy every 30 s). */
export const ITEM_MARKET_FRESH_MS = 5 * 60 * 1000;
/** The item in view, and the pressed trader's items, are read again after this. */
export const ITEM_MARKET_AGAIN_MS = 90 * 1000;
/** The other candidate flips' items. */
export const ITEM_MARKET_SLOW_MS = 4 * 60 * 1000;
/** A failed read is tried again after this. */
export const ITEM_MARKET_RETRY_MS = 60 * 1000;
/** Reads a minute: the pressed trader's items and the item in view, then the others (the rest of the Torn key's budget is not touched). */
export const ITEM_MARKET_PRESS_PER_MIN = 24;
export const ITEM_MARKET_SPARE_PER_MIN = 10;
/** Candidate flips whose Item Market is asked at all (the first by expected profit). */
export const ITEM_MARKET_CANDIDATES = 40;

/** Is this seller id the Item Market's? */
export const isMarketSeller = (sellerId) => String(sellerId) === OWNER_MARKET;

/**
 * An item's Item Market listings as the item's sellers rows (bazaar-shaped), or [] when there are none or they are
 * old. `dataAt` is moved back so the row turns stale by the clock after ITEM_MARKET_FRESH_MS, as the keeper of the
 * rows expects (a bazaar read is fresh for freshMs, much longer).
 * @param {{at: number, listings: {price: number, qty: number}[]}|null} rec
 * @param {object} o
 * @param {number} o.now
 * @param {number} o.freshMs - how long a bazaar row stays fresh (core/flips.js FLIP_FRESH_MS)
 */
export function itemMarketRows(rec, { now, freshMs }) {
    if (!rec || !(rec.at > 0) || !Array.isArray(rec.listings) || now - rec.at > freshMs) return [];
    const rows = marketRows(rec.listings) || [];
    const dataAt = rec.at - Math.max(0, freshMs - ITEM_MARKET_FRESH_MS);
    return rows.map((r) => ({ ...r, dataAt }));
}

/** The bazaar rows and the market rows as one list: bazaarSellers sorts by price, and a bazaar comes before the market at one price. */
export function withItemMarket(bazaarRows, marketList) {
    if (!marketList || !marketList.length) return bazaarRows;
    return [...(bazaarRows || []), ...marketList];
}

/**
 * Whose Item Market to read next: the pressed trader's items, the item in view, then the candidate flips' in the order
 * given. An item is asked when it was never read, or its read is older than its turn; a failed one waits a minute.
 * @param {object} o
 * @param {string[]} [o.pressed] - the pressed trader's items, the biggest gap first
 * @param {string|null} [o.view] - the item in view
 * @param {string[]} [o.candidates] - the candidate flips' items, the most expected profit first
 * @param {(id: string) => {at?: number, triedAt?: number, error?: boolean, loading?: boolean}|null} o.recOf
 * @param {number} o.now
 * @returns {{id: string, urgent: boolean}|null}
 */
export function nextItemMarket({ pressed = [], view = null, candidates = [], recOf, now }) {
    const due = (id, again) => {
        const r = recOf(id);
        if (!r) return true;
        if (r.loading) return false;
        if (r.error) return now - (r.triedAt || 0) >= ITEM_MARKET_RETRY_MS;
        return now - (r.at || 0) >= again;
    };
    for (const id of pressed) if (due(id, ITEM_MARKET_AGAIN_MS * 4)) return { id: String(id), urgent: true };
    if (view && due(view, ITEM_MARKET_AGAIN_MS)) return { id: String(view), urgent: true };
    for (const id of candidates.slice(0, ITEM_MARKET_CANDIDATES)) if (due(id, ITEM_MARKET_SLOW_MS)) return { id: String(id), urgent: false };
    return null;
}

/** May another read leave: the reads of the last minute against the share of its kind. */
export function itemMarketRoom(sentTimes, { now, urgent }) {
    const last = (sentTimes || []).filter((t) => now - t < 60000).length;
    return last < (urgent ? ITEM_MARKET_PRESS_PER_MIN : ITEM_MARKET_SPARE_PER_MIN);
}
