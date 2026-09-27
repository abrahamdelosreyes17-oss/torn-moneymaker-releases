/*
 * The profit model. Pure functions, no DOM.
 *
 * One formula, venue is a parameter:
 *
 *     net_per_unit = exit_price * (1 - fee) - listing_price
 *
 * V1 hardcoded the NPC route (fee 0) and labelled ROI as "margin". Both are
 * fixed here, and the fee parameter is in place from the start so the Item
 * Market and Auction House routes do not mean touching every call site later.
 */

/**
 * Sale fees by exit venue, as a fraction of the sale price.
 *
 * - NPC: shops pay the listed sell_price with no tax.
 * - ITEM_MARKET: 5% sales tax (introduced 22 June 2025).
 * - BAZAAR_RESALE: relisting in your own bazaar carries no tax.
 * - ITEM_MARKET_ANON: listing anonymously adds a further 10%, so 15% total.
 * - AUCTION_HOUSE: 3%.
 *
 * These are game-balance numbers and Torn has changed them before, so they
 * live in one place where a change is a one-line edit.
 */
export const VENUE_FEES = {
    NPC: 0,
    ITEM_MARKET: 0.05,
    // Relisting in your own bazaar: no sales tax. The price is still an
    // estimate - someone has to buy it at market value.
    BAZAAR_RESALE: 0,
    ITEM_MARKET_ANON: 0.15,
    AUCTION_HOUSE: 0.03,
    // A player trader (TornExchange price list): paid in the trade, no tax.
    // An offer, not a guarantee - see core/traders.js.
    TRADER: 0,
};

/**
 * The least a deal must make per item when it is NOT sold to an NPC, as a
 * percent of what you pay. An NPC shop pays its price every time, so $1 is a
 * real profit there; a trader, your bazaar or the Item Market is a person
 * who may pay less or never buy, so a $1 margin on a $140,000 item is noise
 * (the owner, 2026-09-27: "$1 is only for NPC").
 */
export const MIN_PROFIT_PCT = 1;

/** Does this profit per item clear the bar for its venue? NPC: any profit; anything else: MIN_PROFIT_PCT. */
export function enoughProfit(profitPerUnit, listingPrice, venue, pct = MIN_PROFIT_PCT) {
    if (!(profitPerUnit > 0)) return false;
    if (venue === 'NPC') return true;
    const p = Number(pct);
    return profitPerUnit >= Math.max(1, (listingPrice * (Number.isFinite(p) && p >= 0 ? p : MIN_PROFIT_PCT)) / 100);
}

/*
 * "Market" is Torn's rolling average, not a price anyone has offered you -
 * the live floor can sit well above or below it. The label says so; the NPC
 * price is the only exit that is guaranteed.
 */
export const VENUE_LABELS = {
    NPC: 'NPC',
    ITEM_MARKET: 'Avg value',
    BAZAAR_RESALE: 'Avg value',
    ITEM_MARKET_ANON: 'Market (anon)',
    AUCTION_HOUSE: 'Auction',
    TRADER: 'Trader',
};

/**
 * How many units you can actually afford. This is what turns a theoretical
 * opportunity into a realizable one.
 */
export function capQuantityByCash(qty, listingPrice, cashOnHand) {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    if (!Number.isFinite(cashOnHand) || cashOnHand <= 0) return qty;
    if (!Number.isFinite(listingPrice) || listingPrice <= 0) return qty;

    return Math.max(0, Math.min(qty, Math.floor(cashOnHand / listingPrice)));
}

/**
 * Compute one opportunity.
 *
 * @param {object} input
 * @param {number} input.listingPrice - price per unit you would pay
 * @param {number} input.exitPrice    - price per unit you would receive
 * @param {number} [input.qty]        - units available at this listing
 * @param {string} [input.venue]      - key of VENUE_FEES
 * @param {number} [input.cashOnHand] - optional cash cap
 * @returns {object|null} null when the inputs cannot produce a real number.
 */
export function computeOpportunity({
    listingPrice,
    exitPrice,
    qty = 1,
    venue = 'NPC',
    cashOnHand = null,
}) {
    if (!Number.isFinite(listingPrice) || listingPrice <= 0) return null;
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) return null;

    const fee = VENUE_FEES[venue];
    if (!Number.isFinite(fee)) return null;

    const quantity = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;

    const netExit = exitPrice * (1 - fee);
    const profitPerUnit = netExit - listingPrice;

    const affordableQty = capQuantityByCash(
        quantity,
        listingPrice,
        cashOnHand,
    );

    return {
        venue,
        fee,
        listingPrice,
        exitPrice,
        netExit,
        profitPerUnit,
        // ROI on cash deployed. V1 called this "margin"; it never was.
        roi: profitPerUnit / listingPrice,
        qty: quantity,
        affordableQty,
        totalProfit: profitPerUnit * quantity,
        realizableProfit: profitPerUnit * affordableQty,
        cashRequired: listingPrice * affordableQty,
    };
}

/**
 * Pick the best exit venue for a listing, given a price for each.
 *
 * @param {object} input
 * @param {number} input.listingPrice
 * @param {object} input.exits - { VENUE_KEY: exitPrice }
 * @param {number} [input.minPct] - resale venues must make this % per item (see enoughProfit)
 */
export function bestVenue({ listingPrice, exits, qty = 1, cashOnHand = null, minPct = MIN_PROFIT_PCT }) {
    let best = null;

    for (const [venue, exitPrice] of Object.entries(exits || {})) {
        const candidate = computeOpportunity({
            listingPrice,
            exitPrice,
            qty,
            venue,
            cashOnHand,
        });

        if (!candidate) continue;
        // A resale that makes almost nothing is not a deal (NPC is exempt).
        if (candidate.venue !== 'NPC' && !enoughProfit(candidate.profitPerUnit, listingPrice, candidate.venue, minPct)) continue;

        if (!best || candidate.realizableProfit > best.realizableProfit) {
            best = candidate;
        }
    }

    return best;
}
