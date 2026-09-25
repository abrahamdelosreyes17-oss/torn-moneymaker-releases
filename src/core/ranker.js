/*
 * Ranking and filtering. Pure, no DOM.
 *
 * The product decision lives here: opportunities rank by the profit you can
 * actually realize (profit/unit x quantity you can afford), not by profit per
 * unit and not by percentage. A $104/ea hit with 1 available is noise; the
 * same margin with 400 available is the whole afternoon. V1 gave both the
 * same badge.
 */

export const DEFAULT_RANK_OPTIONS = {
    minTotalProfit: 1000,
    minRoi: 0,
    cashOnHand: null,
    /* See main.js: this defaults on, because the verification is an inference. */
    includeUnverifiedNpc: true,
    /*
     * Rows whose unit price had to be inferred are excluded by default.
     *
     * This is not tidiness. Ranking is by profit, and a price read too LOW
     * produces a huge apparent profit — so without this filter the least
     * trustworthy rows sort straight to the top of the list, which is exactly
     * where a wrong number does the most damage.
     */
    includeAssumedPrice: false,
    limit: 100,
};

/**
 * @param {Array<object>} opportunities - rows carrying a computed `profit` block
 * @param {object} options - see DEFAULT_RANK_OPTIONS
 */
export function rankOpportunities(opportunities, options = {}) {
    const opts = { ...DEFAULT_RANK_OPTIONS, ...options };

    const kept = (opportunities || []).filter((row) => {
        if (!row || !row.profit) return false;

        if (!opts.includeUnverifiedNpc && row.npcVerified === false) {
            return false;
        }

        if (!opts.includeAssumedPrice && row.priceAssumed === true) {
            return false;
        }

        /*
         * The minimum applies only to rows that HAVE a real total.
         *
         * A category tile cannot say how many units are available at its
         * price, so its "total" is a single unit's profit. Testing that
         * against a total-profit threshold compares two different quantities
         * and silently deletes most of the list - which is exactly what
         * happened when the inflated market-wide totals were corrected.
         */
        if (
            row.qtyAtPrice !== false &&
            row.profit.realizableProfit < opts.minTotalProfit
        ) {
            return false;
        }

        if (row.qtyAtPrice === false && row.profit.profitPerUnit <= 0) {
            return false;
        }
        if (row.profit.roi < opts.minRoi) return false;

        /*
         * Cash: a listing you cannot buy one of is not a deal for you, and
         * is hidden - whether or not its quantity is known, and whatever Min
         * is. A row you can afford part of stays, priced for that part.
         */
        if (!affordableRow(row, opts.cashOnHand)) return false;

        return true;
    });

    kept.sort((a, b) => {
        const byProfit = b.profit.realizableProfit - a.profit.realizableProfit;
        if (byProfit !== 0) return byProfit;

        // Tie-break on ROI, so the cheaper route to the same money wins.
        return b.profit.roi - a.profit.roi;
    });

    return opts.limit > 0 ? kept.slice(0, opts.limit) : kept;
}

/** Can this cash buy at least one unit of the row? No cash set = yes. */
/**
 * Listings the Min keeps out of the list but that still make money: the
 * page marks these in a second colour, so a bazaar you are looking at shows
 * every profitable listing while the list shows only what meets your Min.
 * Every other rule (Cash, verified prices) still applies.
 *
 * @param {Array<object>} opportunities
 * @param {object} options - as rankOpportunities
 * @param {Array<object>} [kept] - what rankOpportunities kept (left out here)
 */
export function belowMinRows(opportunities, options = {}, kept = null) {
    const shown = new Set(kept || rankOpportunities(opportunities, { ...options, limit: 0 }));
    return rankOpportunities(opportunities, { ...options, minTotalProfit: 0, limit: 0 }).filter(
        (row) => !shown.has(row) && row.profit.profitPerUnit > 0 && row.profit.realizableProfit > 0,
    );
}

export function affordableRow(row, cashOnHand) {
    const cash = Number(cashOnHand);
    if (!(cash > 0)) return true;
    const p = row.profit;
    if (!p) return false;
    if (row.qtyAtPrice === false) return Number(p.listingPrice) <= cash;
    return Number(p.affordableQty) >= 1;
}

/**
 * What the Cash and Min filters took out of a list, so an empty list can say
 * why instead of looking like "no deals".
 * @returns {{cash: number, min: number}}
 *   cash: profitable, but you cannot afford enough of it (or any of it)
 *   min:  profitable, but under Min even buying every one
 */
export function hiddenCounts(opportunities, options = {}) {
    const min = Number(options.minTotalProfit) || 0;
    const out = { cash: 0, min: 0 };

    for (const row of opportunities || []) {
        if (!row || !row.profit || row.profit.profitPerUnit <= 0) continue;
        if (!affordableRow(row, options.cashOnHand)) {
            out.cash++;
            continue;
        }
        if (row.qtyAtPrice === false) continue;
        if (row.profit.realizableProfit >= min) continue;
        if (row.profit.totalProfit >= min) out.cash++;
        else out.min++;
    }
    return out;
}

/**
 * Headline totals for the panel.
 *
 * With cash set, the total is what that cash can make: rows are taken best
 * first, the last one that fits only for the units the remaining cash buys,
 * and nothing after it. Summing every row's own capped profit claimed the
 * cash could be spent on all of them at once.
 *
 * @returns {{count, totalProfit, cashRequired, capped: boolean}}
 */
export function summarize(rankedRows, options = {}) {
    const rows = rankedRows || [];
    const cash = Number(options.cashOnHand);
    const limited = cash > 0;

    let totalProfit = 0;
    let cashRequired = 0;
    let capped = false;

    for (const row of rows) {
        const p = row.profit;
        if (!limited) {
            totalProfit += p.realizableProfit;
            cashRequired += p.cashRequired;
            continue;
        }

        const left = cash - cashRequired;
        if (left <= 0) {
            capped = true;
            break;
        }
        if (p.cashRequired <= left) {
            totalProfit += p.realizableProfit;
            cashRequired += p.cashRequired;
            continue;
        }
        const units = p.listingPrice > 0 ? Math.floor(left / p.listingPrice) : 0;
        totalProfit += p.profitPerUnit * units;
        cashRequired += p.listingPrice * units;
        capped = true;
        break;
    }

    return { count: rows.length, totalProfit, cashRequired, capped };
}
