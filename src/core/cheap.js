/*
 * TornW3B's light list of an item (3.26.0): GET /marketplace/{id}?filler=1 - by
 * its spec the ten cheapest listings with price and count and no seller, on a
 * limit of its own (200 a minute, 10,000 a day) where an item's sellers list
 * has ten a minute and a thousand a day.
 *
 * The owner, 2026-10-11: TornW3B is asked only what we cannot know. So the
 * light list stands in for a sellers list wherever the sellers are not the
 * question:
 *
 *   - every item in turn (the sweep), which only ever wanted the cheapest price;
 *   - a possible flip whose sellers were read in full: the light list either
 *     says what that read said - then nothing is new, and no sellers list is
 *     spent - or it does not, and then the sellers list is read at once.
 *
 * It only ever confirms a full read or calls for one. It never changes a row:
 * a listing is added, removed or counted down by a sellers list alone.
 *
 * Its shape is known from the spec only (it was never asked before this
 * version), so the answer is read liberally, and an answer that cannot be read
 * is said so (cheapKeys, for the log) and never guessed at.
 */

/** How many listings the light list holds at most: with fewer, it is everything listed. */
export const W3B_LIGHT_ROWS = 10;

const CHEAP_LISTS = ['listings', 'prices', 'cheapest', 'items', 'data', 'results'];
const CHEAP_PRICE = ['price', 'cost', 'value'];
const CHEAP_COUNT = ['quantity', 'amount', 'qty', 'count', 'available', 'stock'];

function cheapNumber(entry, names) {
    for (const name of names) {
        const n = Number(entry[name]);
        if (entry[name] !== null && entry[name] !== undefined && entry[name] !== '' && Number.isFinite(n)) return n;
    }
    return null;
}

/**
 * The light list as it came -> what it says, or null when it cannot be read.
 * @returns {{rows: {price: number, qty: number}[], whole: boolean}|null} rows by price, one a price, the count
 *   of every listing at it; `whole`: fewer than ten came, so it is everything listed. The $1 listings are left
 *   out, as a sellers list leaves them out (core/feed.js normalizeW3bListings).
 */
export function parseW3bCheapest(data) {
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && typeof data === 'object') {
        for (const name of CHEAP_LISTS) {
            if (Array.isArray(data[name])) {
                list = data[name];
                break;
            }
        }
    }
    if (!list) return null;
    const byPrice = new Map();
    for (const entry of list) {
        let price = null;
        let qty = null;
        if (Array.isArray(entry) && entry.length === 2) [price, qty] = entry.map(Number);
        else if (entry && typeof entry === 'object') {
            price = cheapNumber(entry, CHEAP_PRICE);
            qty = cheapNumber(entry, CHEAP_COUNT);
        }
        // One entry that is not a price and a count: the shape is not the one this reads.
        if (!Number.isFinite(price) || !Number.isFinite(qty) || !(price > 0) || !(qty > 0)) return null;
        if (price <= 1) continue;
        byPrice.set(price, (byPrice.get(price) || 0) + qty);
    }
    const rows = [...byPrice].map(([price, qty]) => ({ price, qty })).sort((a, b) => a.price - b.price);
    return { rows, whole: list.length < W3B_LIGHT_ROWS };
}

/** For the log, when the light list cannot be read: the names of its fields, never what they hold. */
export function cheapKeys(data) {
    const names = (o) => Object.keys(o).slice(0, 8).map((k) => String(k).slice(0, 20));
    if (Array.isArray(data)) return 'a list of ' + (data[0] && typeof data[0] === 'object' ? (Array.isArray(data[0]) ? 'lists' : '{' + names(data[0]).join(', ') + '}') : typeof data[0]);
    if (!data || typeof data !== 'object') return typeof data;
    const first = Object.keys(data).find((k) => Array.isArray(data[k]) && data[k][0] && typeof data[k][0] === 'object');
    return '{' + names(data).join(', ') + '}' + (first ? ', ' + first + ' of {' + names(data[first][0]).join(', ') + '}' : '');
}

/** The cheapest price in a light list; null when nothing is listed. */
export function cheapLowest(light) {
    const rows = light && Array.isArray(light.rows) ? light.rows : [];
    return rows.length ? rows[0].price : null;
}

/**
 * Does the light list say what the sellers list said? Compared a price at a time, the count of every listing at
 * it - below the price where either list may be cut short (the light list after ten listings; a kept sellers
 * list after the rows that were kept).
 *
 * @param {Array<{price:number, qty:number}>} rows - the sellers list as read (its rows, every seller)
 * @param {{rows: Array, whole: boolean}} light - parseW3bCheapest
 * @param {object} [o]
 * @param {boolean} [o.cut] - the sellers list was kept only in part (its cheapest rows)
 * @returns {{same: boolean, why: string, prices: number}} why: 'same' | 'new-price' (a price no seller we know
 *   has: an unknown seller, or a new price) | 'more' (more at a price than we know) | 'less' (fewer, or sold)
 *   | 'nothing' (nothing to compare: neither list reaches under the other's cut); prices: how many were compared
 */
export function cheapSame(rows, light, { cut = false } = {}) {
    const known = new Map();
    let knownTop = 0;
    for (const r of rows || []) {
        const price = Number(r && r.price);
        const qty = Number(r && (r.qty ?? r.quantity));
        if (!(price > 1) || !(qty > 0)) continue;
        known.set(price, (known.get(price) || 0) + qty);
        if (price > knownTop) knownTop = price;
    }
    const lightRows = light && Array.isArray(light.rows) ? light.rows : [];
    const lightTop = lightRows.length ? lightRows[lightRows.length - 1].price : 0;
    // Under this price both lists hold every listing: the last price of a list cut short may be there in part.
    const under = Math.min(light && light.whole ? Infinity : lightTop, cut ? knownTop : Infinity);
    const said = new Map(lightRows.map((r) => [r.price, r.qty]));
    let prices = 0;
    for (const price of new Set([...known.keys(), ...said.keys()])) {
        if (!(price < under)) continue;
        prices += 1;
        const had = known.get(price) || 0;
        const now = said.get(price) || 0;
        if (now === had) continue;
        return { same: false, why: !had ? 'new-price' : now > had ? 'more' : 'less', prices };
    }
    // Both empty and whole: nobody sells it, as before. Otherwise nothing under the cut is nothing learned.
    if (!prices && !(light && light.whole && !cut && !known.size)) return { same: false, why: 'nothing', prices: 0 };
    return { same: true, why: 'same', prices };
}
