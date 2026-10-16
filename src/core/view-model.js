/*
 * The view model (3.33.0, engines plan Stage 5 step 6): the list's order and the cells of its rows, from the rows the
 * redraw worked out - what the page draws, with no page in it. Pure: no page, no clock.
 */
import { togetherBy, flipTraderKey } from './still.js';
import { sortItemRows, SORT_FIRST_DIR } from './traders.js';
import { isFlip } from './filters.js';

/**
 * The list's own order: money to be made first, then what you hold, then the best price. Best flips: the flips that
 * sell to one trader are one trade with them, and stand together under its total (3.30.0).
 */
export function listOrder(rows, pass, filter) {
    const listed = rows.filter(pass).sort((a, b) => b.value - a.value || (b.held > 0) - (a.held > 0) || b.bid - a.bid || String(a.name).localeCompare(String(b.name)));
    return filter === 'flips' ? togetherBy(listed, flipTraderKey, (r) => r.value) : listed;
}

/**
 * My items and All items: a header pressed sorts the whole list by its column (core/traders.js sortItemRows). Only
 * what the column needs is worked out: the traders (two price checks a row) only for a column about them.
 * @param {object[]} listed
 * @param {{key: string, dir?: number}|null|undefined} listSort
 * @param {{tradersShown: (id: string) => [object|null, object|null], marketOf: (id: string) => {price: number}|null}} o
 */
export function byColumn(listed, listSort, { tradersShown, marketOf }) {
    if (!listSort || SORT_FIRST_DIR[listSort.key] === undefined) return listed;
    const own = ['held', 'market', 'bazaar', 'cheap'].includes(listSort.key);
    return sortItemRows(listed.map((r) => {
        const [best, second] = own ? [null, null] : tradersShown(r.itemId);
        const m = listSort.key === 'market' || listSort.key === 'cheap' ? marketOf(r.itemId) : null;
        return { r, name: r.name, held: r.held, bazaar: r.lowest, market: m ? m.price : null, best, buyers: [best, second].filter(Boolean) };
    }), listSort).map((x) => x.r);
}

/**
 * A flip row's cells: what you buy at and what the trader pays, how many, from how many bazaars, and (3.28.0) units
 * an hour that leave the bazaars when that is what held the amount down.
 */
export function planCells(r) {
    const p = r.plan && r.plan.units > 0 ? r.plan : null;
    return {
        buy: isFlip(r) && r.plan ? r.plan.firstPrice : null,
        sell: isFlip(r) && r.plan && r.plan.buyer ? r.plan.buyer.price : null,
        units: p ? p.units : 0,
        pace: p && typeof p.pace === 'number' ? p.pace : null,
        stops: p ? new Set((p.steps || []).map((st) => st.sellerId || st.sellerName)).size : 0,
    };
}

/** Flips › Dropping: the biggest fall first, then the most traders cutting, then the name. */
export function droppingView(dropping, nameOf) {
    return [...(dropping || new Map())].map(([id, d]) => ({ itemId: id, name: nameOf(id), ...d }))
        .sort((a, b) => (b.fell || 0) - (a.fell || 0) || (b.cut || 0) - (a.cut || 0) || a.name.localeCompare(b.name));
}
