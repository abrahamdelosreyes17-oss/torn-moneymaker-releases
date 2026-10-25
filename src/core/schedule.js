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

/** The item in view: this many of its best payers have their list page read before the flips' traders (3.34.0). */
export const OPEN_DESK_FIRST = 5;

/**
 * 3.34.0 - whose TornW3B list pages are read open, first to last (the Reader takes them in this order and reads
 * about ten a minute). The flips' traders come due every 150 s and used the whole budget, so the item in view stayed
 * "Checking their list is open..." for good; now the item you are looking at gets its top payers read first.
 *   1. the trader of the trade on show   2. your pinned trades' traders
 *   3. the top OPEN_DESK_FIRST payers of the item in view
 *   4. the flips' traders (and To sell's best payers), the biggest first
 *   5. the item in view's other payers   6. Your traders' (By trader) ready trades
 * @param {{shown?: string|null, pinned?: string[], desk?: Iterable<string>, flips?: string[], scan?: string[], max: number, deskFirst?: number}} o
 *   desk: the item in view's TornW3B payers, the best price first
 * @returns {string[]} trader ids, no repeats, at most `max`
 */
export function openOrder({ shown = null, pressed = null, pinned = [], desk = [], old = [], flips = [], scan = [], max, deskFirst = OPEN_DESK_FIRST }) {
    const payers = [...(desk || [])];
    const list = [pressed, shown, ...(pinned || []), ...payers.slice(0, deskFirst), ...(old || []), ...(flips || []), ...payers.slice(deskFirst), ...(scan || [])];
    return [...new Set(list.filter(Boolean).map(String))].slice(0, max);
}

/**
 * 3.34.0 - the item in view's payers for openOrder's `desk`, the best price first: the shown ones and the ones Fresh
 * prices hides only for an old edit date (a read that finds their list open shows them again).
 * @param {{id, price, w3b}[]} shown
 * @param {{id, price, w3b}[]} stale
 * @returns {string[]} TornW3B traders' ids, no repeats, at most `max`
 */
export function deskPayers(shown, stale, max) {
    const rows = [...(shown || []), ...(stale || [])].filter((b) => b && b.id && b.w3b > 0).sort((a, b) => b.price - a.price);
    return [...new Set(rows.map((b) => String(b.id)))].slice(0, max);
}

/** The one place the redraw hands the Reader its lists. */
export function applyWants(store, wants) {
    for (const k of Object.keys(wants)) store[k] = wants[k];
    if (wants.flipCheckIds) store.flipCheck = new Set(wants.flipCheckIds);
}
