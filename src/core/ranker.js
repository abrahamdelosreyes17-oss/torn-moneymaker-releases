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

/** Headline totals for the panel. */
export function summarize(rankedRows) {
    const rows = rankedRows || [];

    let totalProfit = 0;
    let cashRequired = 0;

    for (const row of rows) {
        totalProfit += row.profit.realizableProfit;
        cashRequired += row.profit.cashRequired;
    }

    return { count: rows.length, totalProfit, cashRequired };
}
