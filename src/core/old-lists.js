/*
 * Old lists get an open check instead of being hidden (3.35.0; the owner's field report of 3.34.0: with Fresh prices
 * on, all but two traders were hidden - a trader whose list was edited over a day ago is hidden, though their shop may
 * be open and the price good).
 *
 * Fresh prices only hides a price from a list not edited for a day (core/traders.js stalePrice). Since 3.34.0 a list
 * page read OPEN a few minutes ago is current however old the edit (core/checked.js, main.js freshAtOf): so the way back
 * for such a trader is one page read of their list. This module finds whose: the traders of candidate flips - an item
 * with a cheapest bazaar price a buyer pays enough over - hidden only for the old edit date, the biggest expected profit
 * first. main.js hands them to openOrder (core/schedule.js), after the pressed trader and the item in view.
 *
 * The same pass counts what each Show choice hides (offline, trust, stale) for the zip.
 *
 * Pure: no page, no clock, no network.
 */

/** At most this many old lists are queued for a page read at once. */
export const OLD_OPEN_MAX = 12;
/** A list read closed is not asked again for this long (it would be read every few minutes for nothing). */
export const OLD_CLOSED_WAIT_MS = 10 * 60 * 1000;
/** The pass is worked out at most this often (a thousand items, each with its buyers). */
export const OLD_SCAN_EVERY_MS = 20 * 1000;

/**
 * @param {Iterable<string>} ids - the items to look at (the ones with a cheapest bazaar price)
 * @param {object} o
 * @param {(id: string) => number|null} o.lowestOf - the cheapest bazaar price known
 * @param {(id: string) => {id?: string|number, price: number, w3b?: number, maxUnits?: number}[]} o.buyersOf - the believable buyers
 *   the blacklist leaves, the best price first - before the Show choices hide any
 * @param {(buyer: object) => ('offline'|'trust'|'stale'|null)} o.hiddenBy - why the Show choices hide this buyer now
 * @param {(each: number, price: number) => boolean} o.enough - is that much over `price` worth a flip (the least profit)
 * @returns {{old: string[], hidden: {offline: number, trust: number, stale: number}}}
 *   old: trader ids whose flips are hidden only for an old list, the most expected profit first;
 *   hidden: items with a flip some Show choice hides, per choice (an item counted once per choice)
 */
export function oldListScan(ids, { lowestOf, buyersOf, hiddenBy, enough }) {
    const worth = new Map();
    const hidden = { offline: 0, trust: 0, stale: 0 };
    for (const id of ids) {
        const low = Number(lowestOf(id));
        if (!(low > 0)) continue;
        const seen = new Set();
        for (const b of buyersOf(id) || []) {
            // Best price first: from here no buyer pays enough over the cheapest.
            if (!(b.price > low) || !enough(b.price - low, low)) break;
            const why = hiddenBy(b);
            if (!why) continue;
            if (!seen.has(why)) {
                seen.add(why);
                hidden[why] += 1;
            }
            // Only a stale price can come back by an open check (offline and untrusted traders stay hidden).
            if (why === 'stale' && b.id && b.w3b > 0) {
                const units = Number.isFinite(b.maxUnits) && b.maxUnits > 0 ? b.maxUnits : 1;
                worth.set(String(b.id), (worth.get(String(b.id)) || 0) + (b.price - low) * units);
            }
        }
    }
    const old = [...worth].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).map(([id]) => id);
    return { old, hidden };
}

/**
 * The old lists to read now: the scan's, less the ones read closed lately (their shop is shut; the read said so), at most `max`.
 * @param {string[]} old - oldListScan().old
 * @param {(id: string) => {at?: number, state?: string}|null} checkOf - the latest page read of a trader's list
 */
export function oldListsWanted(old, checkOf, { now, max = OLD_OPEN_MAX, closedWait = OLD_CLOSED_WAIT_MS }) {
    const out = [];
    for (const id of old || []) {
        const c = checkOf(id);
        if (c && c.state === 'closed' && now - (c.at || 0) < closedWait) continue;
        out.push(String(id));
        if (out.length >= max) break;
    }
    return out;
}
