/*
 * A pressed trader is read first (3.35.0; the owner's field report, 3.34.0: after a press the trader's rows filled in
 * minute by minute behind the background queue, and only the first 30 items of their basket were ever asked for).
 *
 * A press is Best flips' row, Plan trade, Every flip or a deal picked (main.js checkTraderNow). From then, for
 * PRESS_LIVE_MS, before any other background read:
 *   1. the trader's list page is read (open or closed - core/open-check.js), at once, if older than a minute;
 *   2. the sellers of EVERY item on their list are read: the ones the trader pays most over the cheapest bazaar
 *      get a full sellers list (TornW3B: ten a minute), every other one the light list (a limit of its own, 200 a
 *      minute) - and the Item Market, on Torn's key, for all of them (core/item-market.js pressedMarket).
 * Rows fill in as checked as the answers arrive; when every item was asked once, the background queue goes on.
 *
 * Pure: no page, no clock, no network.
 */

import { OPEN_PRESS_MS } from './open-check.js';

/** A press holds the queue at most this long (a list of hundreds of items must not hold the page for good). */
export const PRESS_LIVE_MS = 10 * 60 * 1000;
/** The trader's best items read in full (sellers lists are TornW3B's ten-a-minute kind). */
export const PRESS_FULL_MAX = 8;
/** How many presses the zip remembers the wait of. */
export const PRESS_LOG_MAX = 8;

const isItemId = (id) => /^\d+$/.test(String(id));

/**
 * A press, as the page keeps it.
 * @param {string} key - the trader's key ('id:123', or 'name:bob' for one known by name only)
 * @returns {{key: string, traderId: string|null, itemId: string|null, why: string, at: number, firstAt: number}}
 */
export function pressNew({ key, itemId = null, why = 'press', now }) {
    const m = /^id:(\d+)$/.exec(String(key || ''));
    return { key: String(key || ''), traderId: m ? m[1] : null, itemId: itemId ? String(itemId) : null, why, at: now, firstAt: 0 };
}

/** Is the press still the one being worked for? */
export function pressLive(press, now) {
    return Boolean(press && press.traderId && now - press.at < PRESS_LIVE_MS);
}

/**
 * The trader's items to ask the sellers of, the best first.
 *
 * Every item on their list that a bazaar could still sell cheaper than they pay (or whose cheapest price is not
 * known yet), by what they pay over the cheapest bazaar. Sets (negative ids) are not items to buy.
 *
 * @param {Object<string, number>} prices - their list: item id -> price
 * @param {object} o
 * @param {(id: string) => number|null} o.lowestOf - the cheapest bazaar price known (null: not known)
 * @param {(each: number, price: number) => boolean} o.enough - is that much over `price` worth a flip (the least profit)
 * @returns {{all: string[], full: string[], wide: string[], gap: Object<string, number>}} full: the first PRESS_FULL_MAX that have a price over a
 *   known cheapest; wide: `all`, then the items no bazaar undercuts, the dearest bid first - the Item Market may
 *   (core/item-market.js), so its listings are asked for every item they pay for
 */
export function pressItems(prices, { lowestOf, enough }) {
    const rows = [];
    const rest = [];
    for (const [id, raw] of Object.entries(prices || {})) {
        const bid = Number(raw);
        if (!isItemId(id) || !(bid > 0)) continue;
        const low = Number(lowestOf(id));
        if (low > 0) {
            if (!enough(bid - low, low)) {
                rest.push({ id, bid });
                continue;
            }
            rows.push({ id, over: bid - low, known: true });
        } else {
            rows.push({ id, over: 0, known: false });
        }
    }
    rows.sort((a, b) => b.over - a.over || Number(a.id) - Number(b.id));
    rest.sort((a, b) => b.bid - a.bid || Number(a.id) - Number(b.id));
    const all = rows.map((r) => r.id);
    // gap: what they pay over the cheapest bazaar known, per item (the weight the who-sells index is asked with).
    const gap = Object.fromEntries(rows.filter((r) => r.known).map((r) => [r.id, r.over]));
    return { all, full: rows.filter((r) => r.known).slice(0, PRESS_FULL_MAX).map((r) => r.id), wide: [...all, ...rest.map((r) => r.id)], gap };
}

/**
 * The next sellers read for a press, or null when every item was asked since the press.
 *
 * @param {{at: number}} press
 * @param {{all: string[], full: string[]}} items - pressItems()
 * @param {object} o
 * @param {(id: string) => {fullAt?: number, lightAt?: number, triedAt?: number, loading?: boolean, error?: boolean}} o.stateOf
 * @param {boolean} o.fullOk - a sellers list may leave now
 * @param {boolean} o.lightOk - a light list may leave now
 * @returns {{id: string, how: 'full'|'light'}|null}
 */
export function nextPressRead(press, items, { stateOf, fullOk, lightOk }) {
    if (!press || !items) return null;
    const since = press.at;
    const fullDone = (s) => (s.fullAt || 0) >= since || (s.error && (s.triedAt || 0) >= since);
    const lightDone = (s) => fullDone(s) || (s.lightAt || 0) >= since;
    if (fullOk) {
        for (const id of items.full) {
            const s = stateOf(id) || {};
            if (!s.loading && !fullDone(s)) return { id, how: 'full' };
        }
    }
    if (lightOk) {
        for (const id of items.all) {
            const s = stateOf(id) || {};
            if (!s.loading && !lightDone(s)) return { id, how: 'light' };
        }
    }
    return null;
}

/**
 * Is every item of the press asked (or its read under way, or it cannot be asked now)? Then the queue is free again.
 * Reads that cannot leave (no room, a light list that is off) do not hold the others: only what can be asked counts.
 */
export function pressDone(press, items, { stateOf, fullOk, lightOk }) {
    return !nextPressRead(press, items, { stateOf, fullOk, lightOk });
}

/**
 * Whose list page to read for a press: the trader's, if it is not read within the last minute (a press wants a
 * check made after it, not one made before).
 * @returns {string|null} the trader's id
 */
export function pressOpenWanted(press, check, { now, reading = false }) {
    if (!press || !press.traderId || reading) return null;
    if (check && check.at > 0 && now - check.at < OPEN_PRESS_MS) return null;
    return press.traderId;
}

/**
 * The wait from the press to the first check of the trader's list: the first page read at or after the press, or 0
 * when the list was seen open in the minutes before it (the check already stood). null: not checked yet.
 * @param {{at: number, state: string}|null} check
 * @param {number} openMs - how long an open check stands
 */
export function pressWait(press, check, openMs) {
    if (!press || !check || !(check.at > 0)) return null;
    if (check.at >= press.at) return check.at - press.at;
    return check.state === 'open' && press.at - check.at <= openMs ? 0 : null;
}

/** The zip's line: the last few waits, newest last: [{ms, state, why}]. */
export function pressLogAdd(log, entry, max = PRESS_LOG_MAX) {
    return [...(log || []), entry].slice(-max);
}
