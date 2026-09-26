/*
 * The Fill button's price: what to type into Torn's price box for one row
 * on your bazaar's add / manage pages, or the Item Market's. Pure - no DOM,
 * no network.
 *
 * The friend's request, modelled on Greasy Fork's "Customizable Bazaar
 * Filler" (527925) and "Torn Market Filler" (513920): undercut the lowest
 * (or 2nd, 3rd...) listing by an amount in dollars or percent. The default
 * is the lowest bazaar listing minus $1 - his script's own setting (source
 * Bazaars/weav3r.dev, Listing Index 1, Margin -1, Absolute).
 *
 * Only real competition counts: your own listing, $1 (padlocked) ones,
 * sponsored ones, ones TornW3B has not seen for 30 minutes, and trolls far
 * under the average are never the one undercut. Never below the NPC price;
 * optionally never below the Item Market Average.
 */

/** A listing TornW3B has not re-checked for this long may have sold. */
export const FILL_FRESH_MS = 30 * 60 * 1000;

/** Under this share of the Item Market Average, a listing is a troll or a mistake. */
export const FILL_TROLL_SHARE = 0.25;

/** A price read for Fill is reused for this long, then read again. */
export const FILL_REUSE_MS = 60 * 1000;

/** How many listings the panel shows per market. */
export const FILL_SHOW_LISTINGS = 5;

/** The settings, one row per market. The default is the friend's own. */
export const FILL_DEFAULTS = {
    bazaar: { index: 1, amount: 1, unit: '$', qty: 'all', floorAvg: false },
    market: { index: 1, amount: 1, unit: '$', qty: 'all', floorAvg: false },
};

/** "lowest", "2nd lowest", "3rd lowest", "4th lowest"... */
export function ordinalLowest(index) {
    const n = Math.max(1, Math.floor(Number(index) || 1));
    if (n === 1) return 'lowest';
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
    return n + suffix + ' lowest';
}

/** One market's settings, cleaned: anything missing or bad falls back to the default. */
export function cleanFillSettings(raw, market = 'bazaar') {
    const d = FILL_DEFAULTS[market] || FILL_DEFAULTS.bazaar;
    const r = raw && typeof raw === 'object' ? raw : {};
    const index = Math.floor(Number(r.index));
    const amount = Number(r.amount);
    return {
        index: index >= 1 && index <= 20 ? index : d.index,
        amount: Number.isFinite(amount) && amount >= 0 && amount < 1e12 ? amount : d.amount,
        unit: r.unit === '%' ? '%' : '$',
        qty: r.qty === 'allbut1' ? 'allbut1' : 'all',
        floorAvg: typeof r.floorAvg === 'boolean' ? r.floorAvg : d.floorAvg,
    };
}

/**
 * Which listings may be undercut, cheapest first, and why the rest were not.
 *
 * @param {Array<{price, qty?, sellerId?, sponsored?, dataAt?, mine?}>} listings
 * @param {object} [opts]
 * @param {string|null} [opts.selfId] - your Torn id; a listing of yours is never undercut
 * @param {number|null} [opts.avg]    - the Item Market Average, for the troll check
 * @param {number} [opts.now]
 * @param {boolean} [opts.checkFresh] - bazaar listings carry TornW3B's check time; the
 *                                      Item Market's are live and have none
 */
export function realListings(listings, { selfId = null, avg = null, now = Date.now(), checkFresh = true } = {}) {
    const self = selfId ? String(selfId) : null;
    const skipped = { mine: 0, dollar: 0, sponsored: 0, stale: 0, troll: 0 };
    const rows = [];
    for (const l of listings || []) {
        const price = Number(l && l.price);
        if (!(price > 0)) continue;
        if (l.mine || (self && l.sellerId !== undefined && l.sellerId !== null && String(l.sellerId) === self)) skipped.mine += 1;
        else if (price <= 1) skipped.dollar += 1;
        else if (l.sponsored) skipped.sponsored += 1;
        else if (checkFresh && !(l.dataAt && now - l.dataAt <= FILL_FRESH_MS)) skipped.stale += 1;
        else if (avg > 0 && price < avg * FILL_TROLL_SHARE) skipped.troll += 1;
        else rows.push(l);
    }
    rows.sort((a, b) => a.price - b.price);
    return { rows, skipped };
}

/**
 * The price Fill types.
 *
 * @param {Array} listings - raw listings for the market (see realListings)
 * @param {object} settings - cleanFillSettings output
 * @param {object} [ctx]
 * @param {number|null} [ctx.npc] - what an NPC shop pays; never gone under
 * @param {number|null} [ctx.avg] - the Item Market Average
 * @returns {{price: number|null, base: object|null, index: number, used: number,
 *   floor: 'npc'|'avg'|null, skipped: object, count: number, why: string|null}}
 *   `index` asked for (1-based), `used` the one undercut (fewer listings than
 *   asked: the highest there is). `price` null with `why` when there is nothing
 *   to go by.
 */
export function fillPrice(listings, settings, { npc = null, avg = null, selfId = null, now = Date.now(), checkFresh = true } = {}) {
    const s = cleanFillSettings(settings);
    const { rows, skipped } = realListings(listings, { selfId, avg, now, checkFresh });
    const out = { price: null, base: null, index: s.index, used: 0, floor: null, skipped, count: rows.length, why: null };
    if (!rows.length) {
        out.why = 'No listing to undercut.';
        return out;
    }
    out.used = Math.min(s.index, rows.length);
    out.base = rows[out.used - 1];
    const base = out.base.price;
    // Percent in whole-dollar steps without float error (6% of $2,150 is $2,021, not $2,020).
    let price = s.unit === '%' ? Math.floor((base * (100 - s.amount)) / 100 + 1e-9) : Math.round(base - s.amount);
    // $1 is Torn's padlocked price, and nothing sells for less: never typed.
    if (!(price > 1)) {
        out.why = 'That undercut would go to $1 or less. Lower the amount in Fill settings.';
        return out;
    }
    if (s.floorAvg && avg > 0 && price < avg) {
        price = Math.ceil(avg);
        out.floor = 'avg';
    }
    if (npc > 0 && price < npc) {
        price = Math.ceil(npc);
        out.floor = 'npc';
    }
    out.price = price;
    return out;
}

/**
 * How many Fill types: everything you have of it, or everything but one.
 * null leaves Torn's quantity box alone (nothing to list, or not known).
 */
export function fillQuantity(have, mode = 'all') {
    const n = Math.floor(Number(have));
    if (!(n > 0)) return null;
    const q = mode === 'allbut1' ? n - 1 : n;
    return q > 0 ? q : null;
}

/**
 * The line shown after a fill: the price against the Item Market Average.
 * Green at or above it, amber below it.
 *
 * @returns {{level: 'good'|'warn'|null, text: string}}
 */
export function fillVerdict(price, avg) {
    if (!(price > 0) || !(avg > 0)) return { level: null, text: '' };
    const diff = (price - avg) / avg;
    const pct = Math.abs(diff * 100);
    const shown = pct < 0.1 ? '0' : pct < 10 ? pct.toFixed(1).replace(/\.0$/, '') : String(Math.round(pct));
    if (diff >= 0) return { level: 'good', text: shown === '0' ? 'at the average' : shown + '% over the average' };
    return { level: 'warn', text: shown + '% under the average' };
}
