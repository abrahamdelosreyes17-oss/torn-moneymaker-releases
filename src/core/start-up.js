/*
 * Torn Bids on a slow laptop (3.19.0; the owner, 2026-10-03: "the bazaar and
 * flips load really slowly for him, even in startup ... cant we chunk or
 * throttle? open html first? then slowly load? ... i dont want it to look
 * and feel weird").
 *
 * What it was (the friend's speed log, 3.17.1): a redraw took 788 ms on his
 * laptop, and in a session's first minutes 60 to 90 answers a minute came in,
 * each asking for one - 120 ms later. The page was redrawing most of every
 * minute: frozen, not short of data.
 *
 * Three things, none of them one more request than before:
 *
 *   1. Redraws on a budget. A redraw asked for by arriving data waits a few
 *      times as long as the last redraw took, counted from its end - so the
 *      page is free most of the time, however slow the machine. Where a
 *      redraw is quick the wait is what it always was (120 ms). What you do
 *      yourself - a click, a key - is drawn at once, as before.
 *   2. The first working-out in pieces. A page just opened has every item's
 *      buyers to work out, in one go (his longest redraw: 2.8 s). Now they
 *      are worked out a piece at a time before the first full draw, the page
 *      free between pieces; the draw then finds them done.
 *   3. The reads are remembered. Each item's bazaar listings, as last read,
 *      are kept in the page's own storage (not the script's: Torn's pages
 *      never load them) and are there again when the page opens. Nothing is
 *      trusted for longer than before: every listing carries when TornW3B
 *      last checked it, and one checked over half an hour ago is no flip,
 *      kept or not; and every kept item is read again in its turn, as on a
 *      page just opened - the kept reads are something to show meanwhile.
 *
 * Which read goes next is as it was: flips and price lists take turns, one
 * read a second.
 *
 * Pure: no DOM, no storage, no clock of its own.
 */

/** A redraw asked for by data waits this many times as long as the last redraw took. */
export const REDRAW_BUDGET_TIMES = 3;

/** ...and never longer than this: on the slowest machine the numbers still move every few seconds. */
export const REDRAW_WAIT_MAX_MS = 3000;

/** The first working-out goes in pieces of this long, the page free between them. */
export const WARM_SLICE_MS = 30;

/**
 * How long a redraw asked for by arriving data waits before it runs.
 *
 * The next one may not start before `ended + REDRAW_BUDGET_TIMES * took`
 * (never more than REDRAW_WAIT_MAX_MS after `ended`), and never sooner than
 * `base` from now - answers a moment apart share one redraw, as before.
 *
 * @param {object} p
 * @param {number} p.base - the shortest wait (SELL_RENDER_MS)
 * @param {number} p.took - how long the last redraw took (ms; 0: none yet)
 * @param {number} p.ended - when it ended, on the same clock as `now`
 * @param {number} p.now
 * @returns {number} ms from now
 */
export function redrawWait({ base = 0, took = 0, ended = 0, now = 0 } = {}) {
    const b = Math.max(0, Number(base) || 0);
    const t = Number(took);
    if (!(t > 0) || !Number.isFinite(t)) return b;
    const rest = Math.min(REDRAW_WAIT_MAX_MS, REDRAW_BUDGET_TIMES * t);
    const since = Number(now) - Number(ended);
    // A clock that went back (or no clock): the whole rest, never more.
    const left = since >= 0 ? rest - since : rest;
    return Math.max(b, Math.min(rest, left));
}

/**
 * One piece of a long working-out: `work(id)` for each id from `from` on,
 * until `ms` have gone by - always at least one, so it ends.
 *
 * @param {string[]} ids
 * @param {number} from - where this piece starts
 * @param {function} work - (id) => void
 * @param {object} o
 * @param {function} o.clock - () => ms
 * @param {number} [o.ms] - how long a piece may take
 * @param {number} [o.since] - when this piece's work began, if before now (what led up to it counts)
 * @returns {number} where the next piece starts (ids.length: all done)
 */
export function warmSlice(ids, from, work, { clock, ms = WARM_SLICE_MS, since = null } = {}) {
    const t0 = since === null ? clock() : since;
    let i = Math.max(0, Number(from) || 0);
    while (i < ids.length) {
        work(ids[i]);
        i += 1;
        if (clock() - t0 >= ms) break;
    }
    return i;
}

/** Kept reads older than this are not brought back (the page forgets them after as long). */
export const KEPT_READS_MAX_AGE_MS = 60 * 60 * 1000;

/*
 * A listing as it is kept: its values in this order, without their names. A
 * page with 150 possible flips read holds some 20,000 listings; named, that
 * is over 3 MB of text to write (a browser gives a page about 5) - like this,
 * under half of it.
 */
const KEPT_ROW = ['sellerId', 'sellerName', 'price', 'qty', 'dataAt', 'changedAt', 'sponsored'];

/**
 * The reads to keep: {v, at, items: {itemId: {at, sweep, rows}}}, each row
 * its values in KEPT_ROW's order. Only whole reads (not one under way, not a
 * failed one with nothing), and none too old to be brought back.
 *
 * @param {Map<string, {at, rows, error, loading, sweep}>} reads - sell.bazaars
 */
export function packBazaarReads(reads, now = Date.now()) {
    const items = {};
    for (const [id, b] of reads || []) {
        if (!b || !(Number(b.at) > 0) || !Array.isArray(b.rows) || now - Number(b.at) >= KEPT_READS_MAX_AGE_MS) continue;
        items[String(id)] = { at: Number(b.at), sweep: Boolean(b.sweep), rows: b.rows.map((r) => KEPT_ROW.map((k) => (r ? r[k] : null))) };
    }
    return { v: 1, at: now, items };
}

/**
 * The kept reads, as the page holds them - what is whole and young enough.
 * A read "from the future" (the clock was changed) is not believed.
 *
 * @returns {Map<string, {at, triedAt, rows, error: null, loading: false, sweep}>}
 */
export function unpackBazaarReads(stored, now = Date.now()) {
    const out = new Map();
    const items = stored && stored.v === 1 && stored.items && typeof stored.items === 'object' ? stored.items : null;
    if (!items) return out;
    for (const [id, b] of Object.entries(items)) {
        const at = Number(b && b.at);
        if (!(at > 0) || at > now + 60000 || now - at >= KEPT_READS_MAX_AGE_MS || !Array.isArray(b.rows)) continue;
        const rows = [];
        for (const kept of b.rows) {
            if (!Array.isArray(kept) || kept.length !== KEPT_ROW.length) break;
            const [sellerId, sellerName, price, qty, dataAt, changedAt, sponsored] = kept;
            // Each value of the type a fresh read gives it (a stored value is not believed to be one).
            const when = (v) => (v === null ? null : typeof v === 'number' && v > 0 && Number.isFinite(v) ? v : undefined);
            const r = { sellerId, sellerName, price, qty, dataAt: when(dataAt), changedAt: when(changedAt), sponsored };
            if (typeof sellerId !== 'string' || !sellerId || !(sellerName === null || typeof sellerName === 'string')) break;
            if (typeof price !== 'number' || !(price > 1) || !Number.isFinite(price) || !Number.isInteger(qty) || !(qty > 0)) break;
            if (r.dataAt === undefined || r.changedAt === undefined || typeof sponsored !== 'boolean') break;
            rows.push(r);
        }
        // A read with a broken row is not half-believed: read again.
        if (rows.length !== b.rows.length) continue;
        // `kept`: shown until it is read again, in its turn, as on a page just opened (TornW3B may have checked since).
        out.set(String(id), { at, triedAt: at, rows, error: null, loading: false, sweep: Boolean(b.sweep), kept: true });
    }
    return out;
}
