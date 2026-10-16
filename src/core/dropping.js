/*
 * Dropping fast (3.33.0, engines plan 4a): an item whose price is falling is no flip - what you buy now a trader
 * pays less for by the time the trade is done.
 *
 * Two signs, either one is enough:
 *  - the bazaars: the item's lowest bazaar price (the server samples it every ten minutes) fell by more than a
 *    set % within a set number of hours, and stayed down (the last half hour, not one cheap listing - one cheap
 *    listing is a flip);
 *  - the traders: at least DROP_TRADERS_CUT of the traders who buy it lowered what they pay for it within the window.
 * Both settings are a ratio and a window: never a money amount.
 *
 * Pure: no clock, no network.
 */

export const DROP_PCT = 15;
export const DROP_HOURS = 6;
/** Traders lowering their price within the window: this many, and it is dropping. */
export const DROP_TRADERS_CUT = 2;
/** The price now: the last half hour of samples (three, ten minutes apart). */
const NOW_SAMPLES = 3;
/** A table arrived longer ago than this (minutes): no verdict from it. */
const LATE_MAX_MIN = 30;

const median = (list) => {
    const s = [...list].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param {number[]} flat - [minutes ago, price, minutes ago, price, ...] oldest first, as the server sends it
 * @param {{pct?: number, hours?: number, late?: number}} o - late: minutes since the server sent the table
 * @returns {{from: number, to: number, fell: number}|null} the price at the window's start and now, and the fall (0-1)
 */
export function bazaarDrop(flat, { pct = DROP_PCT, hours = DROP_HOURS, late = 0 } = {}) {
    const p = Number(pct);
    const h = Number(hours);
    const l = Number(late) > 0 ? Number(late) : 0;
    // A table that old says nothing of the price now (the server took no samples since).
    if (!Array.isArray(flat) || !(p > 0) || !(h > 0) || l > LATE_MAX_MIN) return null;
    const win = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
        const ago = Number(flat[i]) + l;
        const price = Number(flat[i + 1]);
        if (ago >= 0 && ago <= h * 60 && price > 0) win.push([ago, price]);
    }
    if (win.length < 2 * NOW_SAMPLES) return null;
    win.sort((a, b) => b[0] - a[0]);
    const recent = win.slice(-NOW_SAMPLES).map((x) => x[1]);
    // The window's start: its older half.
    const older = win.slice(0, Math.max(NOW_SAMPLES, Math.floor(win.length / 2))).filter((x) => x[0] > NOW_SAMPLES * 10).map((x) => x[1]);
    if (older.length < NOW_SAMPLES) return null;
    const from = median(older);
    // Stayed down: every one of the last half hour, not one cheap listing.
    const to = Math.max(...recent);
    const fell = (from - to) / from;
    // The price shown is the one judged: the highest of the last half hour.
    return fell * 100 > p ? { from, to, fell } : null;
}

/**
 * Traders lowering what they pay: from each trader's price for the item now and before (their list's last change).
 * @param {{now: number, was?: number|null, at?: number}[]} cuts - one per trader buying the item
 * @param {{hours?: number, nowMs: number}} o
 * @returns {number} how many cut within the window
 */
export function tradersCut(cuts, { hours = DROP_HOURS, nowMs } = {}) {
    const h = Number(hours);
    if (!Array.isArray(cuts) || !(h > 0)) return 0;
    return cuts.filter((c) => c && c.was > 0 && c.now > 0 && c.now < c.was && nowMs - c.at <= h * 3600000).length;
}

/**
 * The item's verdict.
 * @returns {{why: 'bazaars'|'traders', fell?: number, from?: number, to?: number, cut?: number}|null}
 */
export function droppingNow({ flat, cuts, nowMs }, o = {}) {
    const b = bazaarDrop(flat, o);
    if (b) return { why: 'bazaars', ...b };
    const cut = tradersCut(cuts, { hours: o.hours, nowMs });
    return cut >= DROP_TRADERS_CUT ? { why: 'traders', cut } : null;
}

/** A trader's price is remembered this long: enough for any window (24 hours at most). */
export const DROP_CUTS_KEEP_MS = 2 * 24 * 3600000;
export const DROP_CUTS_MAX = 4000;

/**
 * Each trader's price for an item, and the one before it when it changed: "item|trader" -> [price, was, changed at].
 * Changes `kept` in place; true when something changed (then it is due to be saved).
 * @param {object} kept
 * @param {string|number} itemId
 * A change is dated by `at`, when the trader's list last changed, when known (else now): a change seen late (this PC
 * was off) is dated when it was made, not when it was seen.
 * @param {{price: number, id?: string|number, name?: string, at?: number}[]} buyers
 */
export function notePrices(kept, itemId, buyers, now) {
    let changed = false;
    for (const b of buyers || []) {
        const who = b && (b.id ? 'id:' + b.id : b.name ? 'name:' + String(b.name).toLowerCase() : null);
        const price = Number(b && b.price);
        if (!who || !(price > 0)) continue;
        const at = Number(b.at) > 0 && Number(b.at) <= now ? Number(b.at) : now;
        const k = itemId + '|' + who;
        const was = kept[k];
        if (!was) {
            kept[k] = [price, 0, at];
            changed = true;
        } else if (was[0] !== price) {
            kept[k] = [price, was[0], at];
            changed = true;
        }
    }
    return changed;
}

/** One item's cuts for tradersCut: [{now, was, at}] from what notePrices kept. */
export function cutsOf(kept, itemId, buyers) {
    const out = [];
    for (const b of buyers || []) {
        const who = b && (b.id ? 'id:' + b.id : b.name ? 'name:' + String(b.name).toLowerCase() : null);
        const e = who ? kept[itemId + '|' + who] : null;
        if (e) out.push({ now: e[0], was: e[1], at: e[2] });
    }
    return out;
}

/**
 * What is saved: the newest DROP_CUTS_MAX. A change older than DROP_CUTS_KEEP_MS forgets the price before it (it is
 * no cut in any window) but the price stays known - dropped, an old list would be "new" again at every redraw.
 */
export function cutsKept(kept, now) {
    const rows = Object.entries(kept || {}).filter(([, e]) => Array.isArray(e) && e.length === 3).map(([k, e]) => [k, now - e[2] < DROP_CUTS_KEEP_MS ? e : [e[0], 0, e[2]]]);
    rows.sort((a, b) => b[1][2] - a[1][2]);
    return Object.fromEntries(rows.slice(0, DROP_CUTS_MAX));
}
