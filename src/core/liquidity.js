/*
 * How easily an item trades (the owner, 2026-09-28: "some items sell faster
 * than others... a trader would only buy 5 of those, not 100", and "the
 * default has to be the baseline - we have never touched the settings").
 *
 * A trade's extra items are there so the trade looks normal, and every extra
 * bazaar is time in which prices move and the trader loses interest. So an
 * item is sorted into one of three kinds, from what we already read:
 *
 *   fast   - used up and bought again all day (drugs, flowers, plushies,
 *            boosters, medical, candy, alcohol, energy drinks, temporaries),
 *            or seen selling quickly in the bazaars;
 *   slow   - one of a kind (weapons, armour), thin (one here, one there), or
 *            seen not selling at all;
 *   normal - the rest.
 *
 * Measured 2026-09-27 (176 items, TornW3B, two reads 28 minutes apart):
 * flowers, plushies and drugs filled 25 units from 1-2 bazaars and moved
 * hundreds an hour; Hand Drills needed 21 bazaars for 25 and none moved.
 * Pure: no DOM, no network.
 */

export const FAST_TYPES = new Set(['Alcohol', 'Booster', 'Candy', 'Drug', 'Energy Drink', 'Flower', 'Medical', 'Plushie', 'Supply Pack', 'Temporary']);
/* Torn's v2 type names were never seen: any spelling of these (Drugs, Plushies, Energy drink...). */
const FAST_TYPE_RE = /^(alcohol|booster|cand|drug|energy|flower|medical|plush|supply|temporar)/i;

/** The most of an extra item a trade takes, by kind (fast: up to Most per flip). */
export const EXTRA_CAP = { fast: Infinity, normal: 10, slow: 3 };

/** About how long one bazaar takes: open it, find the listing, buy, confirm. */
export const STOP_SECONDS = 30;

/** Seen moving at least this many an hour: fast, whatever its type. */
export const FAST_PER_HOUR = 20;

/** A movement record is only trusted after this long; older reads are dropped. */
export const MOVE_MIN_MS = 30 * 60 * 1000;
export const MOVE_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Nothing moved in this long: slow (a quiet half hour says little). */
export const MOVE_STILL_MS = 2 * 60 * 60 * 1000;

/**
 * How many bazaars it takes to get `n` from these listings, cheapest first
 * (fresh ones only). Null when they don't hold `n` between them.
 */
export function stopsFor(sellers, n) {
    let units = 0;
    let stops = 0;
    for (const s of (sellers || []).filter((r) => r && !r.stale && r.qty > 0)) {
        units += s.qty;
        stops += 1;
        if (units >= n) return stops;
    }
    return null;
}

/**
 * Units that left the bazaars between two reads of one item: a listing that
 * dropped, or went (its seller no longer lists it). Re-listed or re-priced
 * stock in between is not counted. Listings past the end of a capped read
 * (TornW3B returns at most 100) are not counted as gone.
 *
 * @param {Array} before - listings {sellerId, qty, price}
 * @param {Array} after
 * @param {boolean} [capped] - the read was cut off at its end (TornW3B's 100)
 */
export function unitsMoved(before, after, capped = (after || []).length >= 100) {
    const now = new Map();
    for (const r of after || []) if (r && r.sellerId) now.set(String(r.sellerId), (now.get(String(r.sellerId)) || 0) + (Number(r.qty) || 0));
    const top = capped && (after || []).length ? Math.max(...after.map((r) => Number(r.price) || 0)) : Infinity;
    const was = new Map();
    for (const r of before || []) {
        if (!r || !r.sellerId || !(Number(r.price) < top)) continue;
        was.set(String(r.sellerId), (was.get(String(r.sellerId)) || 0) + (Number(r.qty) || 0));
    }
    let moved = 0;
    let total = 0;
    for (const [id, q] of was) {
        moved += Math.max(0, q - (now.get(id) || 0));
        total += q;
    }
    // One read cannot say a whole market sold out: a quarter at most (a
    // listing TornW3B dropped without re-reading it is not a sale either).
    return Math.min(moved, Math.max(50, Math.ceil(total / 4)));
}

/**
 * One item's movement record after a new read: {units, ms} over the reads
 * kept (at most MOVE_WINDOW_MS - older time is scaled away).
 *
 * @param {{units, ms}|null} rec
 * @param {number} moved - unitsMoved since the last read
 * @param {number} gapMs - time since the last read
 */
export function addMovement(rec, moved, gapMs) {
    if (!(gapMs > 0)) return rec || null;
    const r = rec && rec.ms > 0 ? { units: rec.units, ms: rec.ms } : { units: 0, ms: 0 };
    r.units += Math.max(0, moved);
    r.ms += gapMs;
    if (r.ms > MOVE_WINDOW_MS) {
        const keep = MOVE_WINDOW_MS / r.ms;
        r.units *= keep;
        r.ms = MOVE_WINDOW_MS;
    }
    return r;
}

/** Units an hour from a movement record, or null until it covers MOVE_MIN_MS. */
export function perHour(rec) {
    if (!rec || !(rec.ms >= MOVE_MIN_MS)) return null;
    return (rec.units / rec.ms) * 3600000;
}

/**
 * The kind of an item: 'fast', 'normal' or 'slow'.
 *
 * @param {object} p
 * @param {string|null} p.type - Torn's item type
 * @param {boolean} [p.statItem] - one of a kind (weapons, armour, cars)
 * @param {Array|null} [p.sellers] - its bazaar listings, when read
 * @param {{units, ms}|null} [p.move] - its movement record (addMovement)
 */
export function liquidityKind({ type = null, statItem = false, sellers = null, move = null } = {}) {
    if (statItem) return 'slow';
    const rate = perHour(move);
    if (rate !== null && rate >= FAST_PER_HOUR) return 'fast';
    // Watched for hours and nothing moved: whatever its type, nobody is buying.
    if (rate !== null && move.ms >= MOVE_STILL_MS && move.units < 1) return 'slow';
    if (FAST_TYPES.has(type) || FAST_TYPE_RE.test(String(type || '').trim())) return 'fast';
    // Thin: ten of them take more than five bazaars.
    if (sellers) {
        const n = stopsFor(sellers, 10);
        if (n === null ? sellers.filter((r) => !r.stale).length > 5 : n > 5) return 'slow';
    }
    return 'normal';
}

/**
 * How many new bazaars the extra items may add to a trade: two at least, more
 * when the item itself already takes several (the extras then cost little
 * next to it), never more than four.
 */
export function extraStopBudget(mainStops) {
    return Math.min(4, Math.max(2, Math.ceil((Number(mainStops) || 0) / 2) + 1));
}

/** "about 2 min" for a number of bazaars. */
export function stopsMinutes(stops) {
    return Math.max(1, Math.round(((Number(stops) || 0) * STOP_SECONDS) / 60));
}
