/*
 * Trader prices (3.33.0, engines plan Stage 5 step 3): which traders' prices an item's row shows, and the Item
 * Market price beside them. Pure: no page, no clock.
 */
import { believableBid } from './flips.js';

const keyOf = (b) => (b.id ? 'id:' + b.id : 'name:' + String(b.name).toLowerCase());

/**
 * The best believable trader (a troll bid - $99b for a Parcel - is never it; with no average to tell by, the top
 * row) and the next believable one after them, each with whether that price is checked.
 * @param {Array<{id?: string|number, name: string, price: number}>} buyers - best first
 * @param {number|null} avg - Torn's market value
 * @param {(b: object) => boolean} checked
 * @returns {[object|null, object|null]}
 */
export function shownTraders(buyers, avg, checked) {
    const ok = (buyers || []).filter((x) => x && (!(avg > 0) || believableBid(x.price, avg)));
    const as = (b) => (b ? { id: b.id || null, name: b.name, price: b.price, checked: Boolean(checked(b)) } : null);
    const top = ok[0] || null;
    return [as(top), as(top ? ok.find((x) => keyOf(x) !== keyOf(top)) : null)];
}

/**
 * The Item Market's cheapest when it was read (an item you picked), else Torn's market value, marked as about.
 * @param {{at?: number, lowest?: number}|null|undefined} read
 * @param {number|null} avg
 */
export function marketPrice(read, avg) {
    if (read && read.at && read.lowest > 0) return { price: read.lowest, about: false };
    return avg > 0 ? { price: avg, about: true } : null;
}
