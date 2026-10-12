/*
 * The same goods in more than one trade (3.30.0).
 *
 * The owner, 2026-10-12, on Flips with a trade planned: "theres multiple traders
 * with multiple deals, but in reality they share the same or similar items".
 *
 * The cause: the trade with each trader is planned alone, from the same bazaar
 * listings, as if no other trade were made. That is right for one question -
 * "what would the trade with THIS trader make" - and wrong as a list of deals:
 * a listing can be bought once, so two trades that count it are one deal with
 * two possible buyers, not two deals. Nothing on the page said so.
 *
 * Nothing is re-planned here. Each trade stays what it would make alone (that
 * is the number to choose a trader by); this says how much of it is the same
 * goods as a trade already on show, so it reads as "instead", not "as well".
 *
 * Pure: no DOM, no storage, no clock.
 */

const sgIds = (flips) => (flips || []).map((r) => String(r.itemId));

/**
 * A trade against the trade on show: how many of its bazaar items are in that one too, and what its
 * other items make.
 *
 * @param {Array<{itemId, profit}>} flips - the trade's bazaar lines
 * @param {Iterable<string>} shownIds - the item ids of the trade on show
 * @returns {{same: number, of: number, own: number}} own: what the lines NOT in the trade on show make
 */
export function sameGoods(flips, shownIds) {
    const shown = shownIds instanceof Set ? shownIds : new Set([...(shownIds || [])].map(String));
    let same = 0;
    let own = 0;
    for (const r of flips || []) {
        if (shown.has(String(r.itemId))) same += 1;
        else own += Number(r.profit) || 0;
    }
    return { same, of: (flips || []).length, own };
}

/**
 * A list of trades, biggest first (By trader): for each, how many of its bazaar items a trade above it
 * already has, and what the rest of it makes - what it adds when the ones above are made first.
 * A trade that is not ready (nothing to make, hidden by a filter) takes nothing and is given nothing.
 *
 * @param {Array<{key, flips: Array<{itemId, profit}>, ready: boolean}>} list - in the order shown
 * @returns {Map<string, {same: number, of: number, own: number, with: string|null}>} by key; `with`: the key of
 *          the first trade above that has one of its items
 */
export function goodsAbove(list) {
    const taken = new Map();
    const out = new Map();
    for (const t of list || []) {
        if (!t || !t.ready) continue;
        let same = 0;
        let own = 0;
        let withKey = null;
        for (const r of t.flips || []) {
            const id = String(r.itemId);
            if (taken.has(id)) {
                same += 1;
                if (withKey === null) withKey = taken.get(id);
            } else own += Number(r.profit) || 0;
        }
        out.set(String(t.key), { same, of: (t.flips || []).length, own, with: withKey });
        for (const id of sgIds(t.flips)) if (!taken.has(id)) taken.set(id, String(t.key));
    }
    return out;
}

/** "The same item as", "The same 3 items as", "2 of its 5 items are also in" - before the other trade's name. */
export function sameGoodsWords(same, of) {
    if (!(same > 0)) return '';
    if (same >= of) return of === 1 ? 'The same item as' : 'The same ' + of + ' items as';
    return same + ' of its ' + of + ' items ' + (same === 1 ? 'is' : 'are') + ' also in';
}
