/*
 * Who is online (3.20.5, the friend: "pag start up nirerecommend niya mga
 * offline naman"): whose status Torn is asked for and when, which flips wait
 * for an answer, and what TornW3B said of a trader, kept across a reload.
 * Pure - no DOM, no network.
 */

/** The traders you can see are asked again this often; the rest, STATUS_EVERY_MS. */
export const STATUS_OPEN_EVERY_MS = 90000;
export const STATUS_EVERY_MS = 10 * 60 * 1000;
/** Something you pressed (a flip, Plan trade, coming back to the tab): a status older than this is read again, first in line. */
export const STATUS_PRESSED_MS = 20000;
/** Asks a minute kept for the desk and the flips: what you hold and the list never use the last of them. */
export const STATUS_KEPT_FOR_FIRST = 10;
/** Flips waiting for a status, asked about at one time. */
export const STATUS_WAITING_MAX = 8;

/**
 * Whose online status to keep fresh, most useful first: the traders of the
 * item on the desk (even ones the Show switches hide: Online only needs to
 * know about them), the buyers on the Best flips cards, the buyers of flips
 * waiting for a status, Your traders' cards in view, then the best buyer of
 * each item you hold and of the first items in the list.
 *
 * `open`: read again every 90 s - the desk's rows and (3.20.5) the Best flips
 * cards, which were read every 10 minutes: a card went on naming a trader who
 * had logged off up to 10 minutes before.
 * `first`: the desk and the flips - they may use every ask of the minute.
 *
 * @param {object} p
 * @param {Array<{id}>} [p.deskBuyers] - every buyer of the item on the desk, best first
 * @param {string} [p.planned] - the trade's trader, as 'id:123'
 * @param {Array<{buyer}>} [p.strip] - the Best flips cards
 * @param {Array<{buyer}>} [p.waiting] - flips not shown until their buyer's status is read
 * @param {Array<{id}>} [p.traders] - Your traders' cards in view (traderCards)
 * @param {Array<{id}>} [p.heldBest] - the best buyer of each item you hold
 * @param {Array<{id}>} [p.listedBest] - the best buyer of the list's first items
 * @param {number} [p.deskRows] - the desk's rows asked about
 * @returns {{ids: string[], open: Set<string>, first: Set<string>}}
 */
export function statusWatch({ deskBuyers = [], planned = '', strip = [], waiting = [], traders = [], heldBest = [], listedBest = [], deskRows = 6 } = {}) {
    const ids = [];
    const seen = new Set();
    const open = new Set();
    const first = new Set();
    const push = (b, isOpen = false, isFirst = false) => {
        if (!b || !b.id) return;
        const id = String(b.id);
        if (isOpen) open.add(id);
        if (isFirst) first.add(id);
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
    };
    deskBuyers.forEach((b, i) => {
        if (i < deskRows || (b && b.id && planned === 'id:' + b.id)) push(b, true, true);
    });
    for (const f of strip) push(f && f.buyer, true, true);
    for (const f of waiting) push(f && f.buyer, false, true);
    for (const t of traders) push(t, true, true);
    for (const b of heldBest) push(b);
    for (const b of listedBest) push(b);
    return { ids, open, first };
}

/**
 * The statuses to ask Torn for now, in the watch's order.
 *
 * After something you pressed (`pressed`), an open trader's status older than
 * 20 s is read again ahead of everything else ('high'), whatever is under way:
 * the trader you are about to deal with is known now, not within 90 s.
 *
 * @param {object} p
 * @param {string[]} p.ids
 * @param {Set<string>} p.open
 * @param {Set<string>} [p.first]
 * @param {Map<string, {fetchedAt: number, pending: boolean, retryAt: number}>} p.entries
 * @param {number} p.now
 * @param {boolean} [p.pressed]
 * @param {number} [p.pending] - asks under way
 * @param {number} [p.asked] - asks sent in the last minute
 * @param {number} [p.maxPending]
 * @param {number} [p.perMin]
 * @returns {Array<{id: string, priority: 'high'|'low'}>}
 */
export function statusAsks({ ids = [], open = new Set(), first = new Set(), entries, now, pressed = false, pending = 0, asked = 0, maxPending = 3, perMin = 30 }) {
    const out = [];
    let under = pending;
    for (const id of ids) {
        if (asked + out.length >= perMin) break;
        const s = entries.get(id);
        if (!s || s.pending || now < s.retryAt) continue;
        const age = now - s.fetchedAt;
        if (pressed && open.has(id) && age >= STATUS_PRESSED_MS) {
            out.push({ id, priority: 'high' });
            under += 1;
            continue;
        }
        if (under >= maxPending) continue;
        if (age < (open.has(id) ? STATUS_OPEN_EVERY_MS : STATUS_EVERY_MS)) continue;
        if (!first.has(id) && asked + out.length >= perMin - STATUS_KEPT_FOR_FIRST) continue;
        out.push({ id, priority: 'low' });
        under += 1;
    }
    return out;
}

/**
 * The Best flips cards. With "Buyers online only" on, a flip whose buyer's
 * status is not read yet is not a card: it waits (`waiting`, asked about
 * first), and the next flips with a buyer known to be on take its place. A
 * page just opened showed the remembered flips at once, before any status
 * was read - traders who had logged off among them.
 *
 * Not held (`hold` false: the switch is off, no key to ask with, the tab is
 * hidden): the first `limit` flips, as before. A buyer known by name only is
 * never waited for - there is nobody to ask about.
 *
 * @param {Array<{buyer: {id?: string}}>} flips - best first
 * @param {object} o
 * @param {boolean} [o.hold]
 * @param {function} [o.unread] - (id) => boolean: no status yet, and one can still come
 * @param {number} [o.limit]
 * @returns {{strip: Array, waiting: Array}}
 */
export function flipCards(flips, { hold = false, unread = () => false, limit = 4 } = {}) {
    if (!hold) return { strip: flips.slice(0, limit), waiting: [] };
    const strip = [];
    const waiting = [];
    for (const f of flips) {
        if (strip.length >= limit) break;
        const id = f && f.buyer && f.buyer.id;
        if (id && unread(String(id))) {
            if (waiting.length < STATUS_WAITING_MAX) waiting.push(f);
            continue;
        }
        strip.push(f);
    }
    return { strip, waiting };
}

/** Your traders: the cards of each row (favourites, trusted) whose trader's status is kept fresh. */
export const STATUS_TRADER_CARDS = 6;

/**
 * Your traders with "Buyers online only" on: the first cards of each row
 * that have a trade are the ones in view - their traders' statuses are kept
 * fresh (`watch`), and one not read yet says so instead of offering its trade
 * (`waiting`). Before 3.20.5 nobody asked about these traders unless they were
 * also on the desk or a flip card: a trusted trader who had logged off kept
 * "Trade +$X · Put on desk" at the top of the page.
 *
 * Not held (the switch off, no key, a hidden tab): the list as it is, nobody
 * watched.
 *
 * @param {Array<{id, favourite, items, profit, hiddenBy}>} list - in the page's order
 * @param {object} o
 * @param {boolean} [o.hold]
 * @param {function} [o.unread] - (id) => boolean
 * @param {number} [o.perRow]
 * @returns {{list: Array, watch: Array<{id: string}>}}
 */
export function traderCards(list, { hold = false, unread = () => false, perRow = STATUS_TRADER_CARDS } = {}) {
    if (!hold) return { list, watch: [] };
    const seen = { fav: 0, rest: 0 };
    const watch = [];
    const out = list.map((x) => {
        const row = x.favourite ? 'fav' : 'rest';
        if (!x.id || x.hiddenBy || !(x.items > 0 && x.profit > 0) || seen[row] >= perRow) return x;
        seen[row] += 1;
        watch.push({ id: String(x.id) });
        return unread(String(x.id)) ? { ...x, waiting: true } : x;
    });
    return { list: out, watch };
}

/** What TornW3B said of a trader is believed this long after it was read (a page reads an item's buyers again every 20 minutes). */
export const ACTIVITY_KEEP_MS = 20 * 60 * 1000;
export const ACTIVITY_KEEP_MAX = 600;

/**
 * When TornW3B last saw each trader active, to keep across a reload:
 * {v, rows: [[id, lastActionAt, name, readAt], ...]}, the newest reads first.
 *
 * @param {Map<string, {at: number, name?: string, readAt?: number}>} activity
 */
export function packActivity(activity, now = Date.now()) {
    const rows = [];
    for (const [id, a] of activity || []) {
        if (!a || !(Number(a.at) > 0) || !(Number(a.readAt) > 0) || now - Number(a.readAt) >= ACTIVITY_KEEP_MS) continue;
        rows.push([String(id), Number(a.at), a.name ? String(a.name) : null, Number(a.readAt)]);
    }
    rows.sort((x, y) => y[3] - x[3]);
    return { v: 1, rows: rows.slice(0, ACTIVITY_KEEP_MAX) };
}

/**
 * The kept activity, as the page holds it. Only what was read within the last
 * 20 minutes: older, and "last active 2 minutes ago" would call a trader
 * online who has long gone. A time "from the future" is not believed.
 *
 * @returns {Map<string, {at: number, name: string|null, readAt: number}>}
 */
export function unpackActivity(stored, now = Date.now()) {
    const out = new Map();
    const rows = stored && stored.v === 1 && Array.isArray(stored.rows) ? stored.rows : [];
    for (const row of rows) {
        if (!Array.isArray(row) || row.length !== 4) continue;
        const [id, at, name, readAt] = row;
        if (typeof id !== 'string' || !/^\d+$/.test(id)) continue;
        if (typeof at !== 'number' || !(at > 0) || typeof readAt !== 'number' || !(readAt > 0)) continue;
        if (readAt > now + 60000 || at > readAt + 60000 || now - readAt >= ACTIVITY_KEEP_MS) continue;
        if (!(name === null || typeof name === 'string')) continue;
        out.set(id, { at, name, readAt });
    }
    return out;
}
