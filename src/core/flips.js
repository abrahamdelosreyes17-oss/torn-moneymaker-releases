/*
 * Torn Bids' buy side: flips, and where to sell what you hold. Pure - no
 * DOM, no network. Who pays what is worked out in core/traders.js; the
 * bazaar listings come from TornW3B (core/feed.js normalizes them).
 *
 *   - A flip buys from bazaars, cheapest first, only below a trader's price,
 *     only with the cash you set, and only listings TornW3B saw lately.
 *   - Where to sell: a trader pays now; your bazaar and the Item Market pay
 *     only when someone buys, so the trader wins unless waiting pays at
 *     least LIST_EDGE more.
 */

import { VENUE_FEES } from './profit.js';
import { formatMoney } from './parse.js';

/** A listing TornW3B has not re-checked for this long may have sold: no flip is planned on it. */
export const FLIP_FRESH_MS = 30 * 60 * 1000;

/** Waiting for a buyer must pay at least this much more than a trader pays now. */
export const LIST_EDGE = 0.01;

/** How many flip candidates are checked against TornW3B's listings, best first. */
export const FLIP_CANDIDATES = 30;

/**
 * Bazaar listings to show and to plan on: your own left out (you cannot buy
 * from yourself, and you would not undercut yourself), each marked stale
 * when TornW3B has not seen it lately. Cheapest first.
 *
 * @param {Array<{sellerId, sellerName, price, qty, dataAt}>} rows - normalizeW3bListings output
 * @param {object} [opts]
 * @param {string|null} [opts.selfId] - your Torn id, when known
 */
export function bazaarSellers(rows, { selfId = null, now = Date.now(), freshMs = FLIP_FRESH_MS } = {}) {
    const self = selfId ? String(selfId) : null;
    return (rows || [])
        .filter((r) => r && r.price > 0 && r.qty > 0 && (!self || String(r.sellerId) !== self))
        .map((r) => ({ ...r, stale: !(r.dataAt && now - r.dataAt <= freshMs) }))
        .sort((a, b) => a.price - b.price);
}

/**
 * Buy from the cheapest fresh listings first, while they cost less than the
 * trader pays and the cash lasts. A listing only partly affordable is bought
 * in part, and nothing after it.
 *
 * @param {Array} sellers - bazaarSellers output
 * @param {number} bid - what the trader pays per item
 * @param {object} [opts]
 * @param {number|null} [opts.cash] - null or 0: no limit
 * @returns {null|{units, cost, profit, each, firstPrice, needs, steps: Array<{sellerId, sellerName, qty, price}>}}
 *   null when no fresh listing is under the bid. `units` 0 with `needs` set:
 *   the cheapest one costs more than your cash.
 */
export function flipPlan(sellers, bid, { cash = null } = {}) {
    if (!(bid > 0)) return null;
    const under = (sellers || []).filter((s) => !s.stale && s.price < bid);
    if (!under.length) return null;

    const limit = cash > 0 ? cash : Infinity;
    let left = limit;
    let units = 0;
    let cost = 0;
    let profit = 0;
    const steps = [];
    for (const s of under) {
        const n = Math.min(s.qty, Math.floor(left / s.price));
        if (n <= 0) break;
        steps.push({ sellerId: s.sellerId, sellerName: s.sellerName, qty: n, price: s.price });
        units += n;
        cost += n * s.price;
        profit += n * (bid - s.price);
        left -= n * s.price;
        if (n < s.qty) break;
    }
    return {
        units,
        cost,
        profit,
        steps,
        each: bid - under[0].price,
        firstPrice: under[0].price,
        needs: units ? 0 : under[0].price,
    };
}

/**
 * Where to sell what you hold, per item and for all of it.
 *
 * @param {object} p
 * @param {number} p.held
 * @param {number|null} p.bid           - the best trader's price (after your Show choices)
 * @param {number|null} p.bazaarLowest  - the cheapest bazaar listing, not yours
 * @param {number|null} p.marketLowest  - the cheapest Item Market listing
 * @returns {{options: Array<{venue, each}>, best: string|null, gain: number}}
 *   options in a fixed order (trader, bazaar, market), `each` null where not
 *   known; `best` the venue to use; `gain` what it makes over the trader for
 *   everything you hold (0 when the trader is best or there is none).
 */
export function whereToSell({ held, bid = null, bazaarLowest = null, marketLowest = null, edge = LIST_EDGE }) {
    const options = [
        { venue: 'trader', each: bid > 0 ? bid : null },
        // $1 under the cheapest; never below $1.
        { venue: 'bazaar', each: bazaarLowest > 1 ? bazaarLowest - 1 : null },
        { venue: 'market', each: marketLowest > 1 ? Math.floor((marketLowest - 1) * (1 - VENUE_FEES.ITEM_MARKET)) : null },
    ];
    const known = options.filter((o) => o.each !== null);
    if (!known.length) return { options, best: null, gain: 0 };

    let best = options[0].each !== null ? options[0] : null;
    for (const o of options.slice(1)) {
        if (o.each === null) continue;
        // Against a trader, waiting has to pay enough to be worth it.
        const floor = options[0].each !== null ? options[0].each * (1 + edge) : 0;
        if (o.each >= floor && (!best || o.each > best.each)) best = o;
    }
    const gain = best && options[0].each !== null && best.venue !== 'trader' ? (best.each - options[0].each) * (held || 0) : 0;
    return { options, best: best ? best.venue : null, gain };
}

/**
 * Items worth checking for a flip, from TornW3B's one-call summary (whose
 * lowest price can lag, so a candidate is only a candidate until its own
 * listings are read). Items you cannot afford one of are left out.
 *
 * @param {Map<string, {lowestPrice: number|null}>} summary
 * @param {function} bidOf - (itemId) => the best trader price or null
 * @param {object} [opts]
 * @param {number|null} [opts.cash]
 * @param {number} [opts.limit]
 * @returns {Array<{itemId, lowest, bid, each, score}>} best first
 */
export function flipCandidates(summary, bidOf, { cash = null, limit = FLIP_CANDIDATES } = {}) {
    const out = [];
    for (const [itemId, s] of summary || []) {
        const lowest = s && s.lowestPrice;
        if (!(lowest > 1)) continue;
        const bid = bidOf(itemId);
        if (!(bid > lowest)) continue;
        const afford = cash > 0 ? Math.floor(cash / lowest) : 100;
        if (afford <= 0) continue;
        const each = bid - lowest;
        out.push({ itemId: String(itemId), lowest, bid, each, score: each * Math.min(afford, 100) });
    }
    out.sort((a, b) => b.score - a.score || b.each - a.each);
    return out.slice(0, limit);
}

/**
 * The words on a bazaar card a trusted trader pays more for, or null.
 * Two lines, never cut: the card is narrow, so the line breaks instead.
 *
 * @param {{name, price, trust}|null} buyer - the best buyer
 * @param {number} listingPrice
 */
export function traderTagLabel(buyer, listingPrice) {
    if (!buyer || !buyer.trust || buyer.trust.level !== 'Trusted') return null;
    if (!(buyer.price > listingPrice) || !(listingPrice > 0)) return null;
    return buyer.name + ' pays ' + formatMoney(buyer.price) + '\n+' + formatMoney(buyer.price - listingPrice) + ' each';
}
