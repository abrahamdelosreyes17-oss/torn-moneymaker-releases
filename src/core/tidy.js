/*
 * Stored data nobody uses is deleted (3.17.0; the owner: "... and will
 * delete any unused memory").
 *
 * Several stored values hold entries with a life: an accepted trade a day,
 * a pin, a gone mark half an hour, a leftover a week. Every reader already
 * passes over the expired ones - but they stayed in storage until that value
 * was next written, and the browser hands every stored value to the script
 * on every page. About once an hour one tab now writes each such value back
 * without what has expired.
 *
 * The rule each function keeps: what a reader gets from the tidied value is
 * exactly what it gets from the stored one (test/tidy.test.js proves it for
 * each). The same object comes back when nothing goes, so nothing is written.
 *
 * Pure: no storage, no clock of its own.
 */

import { liveAccepted } from './accepted.js';
import { livePins } from './held.js';
import { liveGone, liveStock, liveBought } from './flips.js';
import { TE_ITEM_TTL_MS } from './selling.js';
import { liveAsked, liveEnded } from './trades-board.js';
import { liveWasToSell } from './to-sell.js';
import { liveBoughtItems } from './bazaar-sell.js';

/** `stored` with only the keys a reader still returns; `stored` itself when all are kept. */
function tidyKeep(stored, live) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored;
    const keys = Object.keys(stored);
    const keep = keys.filter((k) => Object.prototype.hasOwnProperty.call(live, k));
    if (keep.length === keys.length) return stored;
    const out = {};
    for (const k of keep) out[k] = stored[k];
    return out;
}

/** Accepted trades: a day (core/accepted.js liveAccepted). */
export function tidyAccepted(stored, now = Date.now()) {
    return tidyKeep(stored, liveAccepted(stored, now));
}

/** Pinned trades (core/held.js livePins). */
export function tidyPins(stored, now = Date.now()) {
    return tidyKeep(stored, livePins(stored, now));
}

/** Gone marks: half an hour (core/flips.js liveGone). */
export function tidyGone(stored, now = Date.now()) {
    return tidyKeep(stored, liveGone(stored, now));
}

/** Page stocks: half an hour (core/flips.js liveStock). */
export function tidyStock(stored, now = Date.now()) {
    return tidyKeep(stored, liveStock(stored, now));
}

/** Your own buys: half an hour (core/flips.js liveBought - a list). */
export function tidyBought(stored, now = Date.now()) {
    if (!Array.isArray(stored)) return stored;
    const live = liveBought(stored, now);
    return live.length === stored.length ? stored : live;
}

/** Declined trades: {key: until} - past ones go. */
export function tidyDeclined(stored, now = Date.now()) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored;
    const live = {};
    for (const [k, until] of Object.entries(stored)) if (Number(until) > now) live[k] = until;
    return tidyKeep(stored, live);
}

/** Trades asked about (core/trades-board.js liveAsked): an hour. */
export function tidyAsked(stored, now = Date.now()) {
    return tidyKeep(stored, liveAsked(stored, now));
}

/** Ended trades (core/trades-board.js liveEnded): a day - a list. */
export function tidyEnded(stored, now = Date.now()) {
    if (!Array.isArray(stored)) return stored;
    const live = liveEnded(stored, now);
    return live.length === stored.length ? stored : live;
}

/** What joined the To sell list (core/to-sell.js liveWasToSell): a month - a list. */
export function tidyWasToSell(stored, now = Date.now()) {
    if (!Array.isArray(stored)) return stored;
    const live = liveWasToSell(stored, now);
    return live.length === stored.length ? stored : live;
}

/** What you bought in the last 24 hours and still hold (core/bazaar-sell.js liveBoughtItems): {at, items}. */
export function tidyHeld(stored, now = Date.now()) {
    if (!stored || typeof stored !== 'object' || !Array.isArray(stored.items)) return stored;
    const live = liveBoughtItems(stored, now);
    return live.length === stored.items.length ? stored : { ...stored, items: live };
}

/** Cancelled trades kept to be put right: {key: {trade, at}} for `keepMs`. */
export function tidyCancelUndo(stored, now = Date.now(), keepMs = 3 * 60 * 60 * 1000) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored;
    const live = {};
    for (const [k, u] of Object.entries(stored)) if (u && u.trade && now - Number(u.at) < keepMs) live[k] = u;
    return tidyKeep(stored, live);
}

/** Leftovers: a list, each kept `keepMs` while it holds something. */
export function tidyLeftovers(stored, now = Date.now(), keepMs = 7 * 24 * 60 * 60 * 1000) {
    if (!Array.isArray(stored)) return stored;
    const live = stored.filter((l) => l && l.itemId && l.qty > 0 && now - Number(l.at) < keepMs);
    return live.length === stored.length ? stored : live;
}

/** TornExchange's full lists per item: half an hour each (core/selling.js readTeItemLists). */
export function tidyTeLists(stored, now = Date.now()) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored;
    const live = {};
    for (const [k, rec] of Object.entries(stored)) {
        const at = Number(rec && rec.at);
        if (rec && Array.isArray(rec.traders) && Number.isFinite(at) && now - at <= TE_ITEM_TTL_MS) live[k] = rec;
    }
    return tidyKeep(stored, live);
}

/*
 * Not tidied, on purpose: TornExchange's top buyers (teCache). Past a day a
 * fresh page reads it as nothing - but a Torn Bids tab left open goes on
 * showing the copy it holds for as long as the stored one is unchanged, and
 * deleting it would take those buyers off that tab. Not "what a reader gets".
 */
