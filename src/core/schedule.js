/*
 * The Scheduler (3.33.0, engines plan Stage 5 step 1): what the next reads go to, worked out from what the redraw
 * found - and nothing else. The Reader (nextW3bJob, the open checks) takes these lists; the redraw only hands them
 * over, in one place (applyWants).
 * Pure: no page, no clock, no network.
 */

const isTornId = (x) => /^\d+$/.test(String(x || ''));

/**
 * Near-misses aside, every other item someone buys, the one read longest ago first.
 * @param {string[]} withBid - items with a buyer
 * @param {Set<string>} skip - the possible flips and the near-misses (read on their own turn)
 * @param {(id: string) => number} readAt - when the item's bazaars were last seen
 */
export function sweepOrder(withBid, skip, readAt) {
    return (withBid || []).filter((id) => !skip.has(id)).sort((a, b) => readAt(a) - readAt(b));
}

/**
 * What the price checks and the trader-list reads go to.
 * @param {{itemId: string, profit: number, traderId?: string|null}[]} waiting - possible flips waiting for their check
 * @param {{itemId: string, profit: number, traderId?: string|null}[]} shownFlips - the flips shown
 * @param {{itemId: string, kept?: boolean, best?: {id?: string|number}|null, unchecked?: boolean, check?: string}[]} toSell
 * @param {{filter?: string, openMax: number}} o - filter: the list in view ('sell' puts To sell's waiting rows first)
 * @returns {{toSellIds: string[], flipCheckIds: string[], flipTraders: Set<string>, openWant: string[]}}
 *   (waiting and shownFlips come back sorted, the biggest first: the redraw's log reads them so.)
 */
export function readWants(waiting, shownFlips, toSell, { filter, openMax }) {
    waiting.sort((a, b) => b.profit - a.profit);
    shownFlips.sort((a, b) => b.profit - a.profit);
    // A To sell row names a trader only at a checked price: its buyers are read as often as a flip's, and their best
    // payers' own lists as often as a flip's traders'. The flips come first - but the To sell rows waiting for their
    // check while To sell is the tab in view. (A price only on TornExchange never gets a check.)
    const sellRows = toSell.filter((r) => !r.kept && r.best);
    const sellWaiting = sellRows.filter((r) => r.unchecked && r.check !== 'closed' && r.check !== 'no-id').map((r) => r.itemId);
    const flipIds = [...waiting, ...shownFlips].map((f) => f.itemId);
    const toSellIds = toSell.filter((r) => !r.kept).map((r) => r.itemId);
    const flipCheckIds = [...new Set([...(filter === 'sell' ? [...sellWaiting, ...flipIds] : [...flipIds, ...sellWaiting]), ...sellRows.map((r) => r.itemId)])];
    const flipTraders = new Set([...[...waiting, ...shownFlips].map((f) => f.traderId), ...sellRows.map((r) => r.best.id)].filter(Boolean).map(String));
    // Whose list pages are read: the flips shown and waiting, the biggest first, then the To sell rows' best payers -
    // at most openMax, so the reads stay few (TornW3B's terms).
    const flipsByProfit = [...waiting, ...shownFlips].sort((a, b) => b.profit - a.profit);
    const openWant = [...new Set([...flipsByProfit.map((f) => f.traderId), ...sellRows.map((r) => r.best.id)].filter(isTornId).map(String))].slice(0, openMax);
    return { toSellIds, flipCheckIds, flipTraders, openWant };
}

/** The one place the redraw hands the Reader its lists. */
export function applyWants(store, wants) {
    for (const k of Object.keys(wants)) store[k] = wants[k];
    if (wants.flipCheckIds) store.flipCheck = new Set(wants.flipCheckIds);
}
