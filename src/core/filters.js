/*
 * Filters (3.33.0, engines plan Stage 5 step 4): which rows of the list a tab and a category show, and the counts
 * on the tabs. Pure: no page, no clock.
 */

export const isFlip = (r) => Boolean(r.badge && r.badge.kind === 'flip');

/**
 * Does the row belong to the tab: My items (held), Flips, To sell, or All items.
 * @param {'all'|'mine'|'flips'|'sell'|string} filter
 * @param {Set<string>} toSellIds
 */
export function rowPass(filter, toSellIds) {
    if (filter === 'mine') return (r) => r.held > 0;
    if (filter === 'flips') return isFlip;
    if (filter === 'sell') return (r) => toSellIds.has(r.itemId);
    return () => true;
}

/**
 * The category's rows and the tab counts over them. To sell counts all of it, whatever the search or the category
 * shows (its own count, given).
 * @param {object[]} rows
 * @param {string} category - '' for every category
 * @param {number} sellCount
 */
export function filterRows(rows, category, sellCount) {
    const shown = category ? rows.filter((r) => r.category === category) : rows;
    return {
        rows: shown,
        counts: { all: shown.length, mine: shown.filter((r) => r.held).length, flips: shown.filter(isFlip).length, sell: sellCount },
    };
}
