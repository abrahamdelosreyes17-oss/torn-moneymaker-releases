/*
 * The server's copy first (3.33.0, engines plan Stage 6): the shared server crawls Torn's bazaars and sends them to
 * every PC; TornW3B fills the gaps; this PC reads a seller's bazaar from Torn itself only to confirm a flip just
 * before it is shown.
 *
 * The server's copy leads an item only once it has earned it: each time this PC reads the item's sellers from
 * TornW3B while the server holds fresh listings of it, the two are compared - does the server know the cheapest
 * price (or a cheaper one)? After SERVER_LEAD_AGREE such reads with at least SERVER_LEAD_RATIO of them agreeing, the
 * item is the server's: its background TornW3B reads stop while the server's copy is fresh, and a flip on the
 * server's rows waits for this PC's own read of the seller. Until then nothing changes. Effort counts and ratios
 * only, never money.
 * Pure: no page, no clock, no network.
 */

/** Reads compared before the server's copy can lead an item. */
export const SERVER_LEAD_AGREE = 3;
/** ...and the share of them that must agree. */
export const SERVER_LEAD_RATIO = 0.8;
/** An item the server leads is still read from TornW3B this many times less often: the two go on being compared. */
export const SERVER_LEAD_SLOWER = 4;
/** Items whose comparison is kept (the newest). */
export const SERVER_LEAD_MAX = 3000;
/** An own read of a seller confirms their rows this long. */
export const OWN_CONFIRM_MS = 3 * 60 * 1000;
/** Own reads of sellers a minute, at most (Torn's limit is shared with the statuses). */
export const OWN_CONFIRM_PER_MIN = 20;
/** Sellers wanted at once. */
export const OWN_CONFIRM_WANT = 10;

const lowestListed = (rows, ok = () => true) => {
    let low = Infinity;
    for (const r of rows || []) if (r && r.price > 1 && r.qty > 0 && ok(r) && r.price < low) low = r.price;
    return low < Infinity ? low : null;
};

/**
 * One comparison: TornW3B's sellers of an item against the server's listings of it (fresh ones, given).
 * Changes `kept` in place: itemId -> [agreed, compared, at]. Nothing is noted without both sides.
 * @returns {boolean} whether anything was noted
 */
export function noteAgreement(kept, itemId, w3bRows, serverListings, now) {
    const w = lowestListed(w3bRows);
    if (!(w > 0) || !Array.isArray(serverListings) || !serverListings.length) return false;
    const s = lowestListed(serverListings);
    const k = String(itemId);
    const e = kept[k] || [0, 0, 0];
    kept[k] = [e[0] + (s > 0 && s <= w ? 1 : 0), e[1] + 1, now];
    return true;
}

/** Does the server's copy lead this item? */
export function serverLeads(kept, itemId) {
    const e = kept && kept[String(itemId)];
    return Boolean(e && e[1] >= SERVER_LEAD_AGREE && e[0] / e[1] >= SERVER_LEAD_RATIO);
}

/** What is saved: the newest SERVER_LEAD_MAX comparisons, each over its last few reads (old ones weigh out). */
export function agreementKept(kept) {
    const rows = Object.entries(kept || {}).filter(([, e]) => Array.isArray(e) && e.length === 3);
    rows.sort((a, b) => b[1][2] - a[1][2]);
    // Halved past 20 reads: a server that stops knowing an item loses the lead within a few reads.
    return Object.fromEntries(rows.slice(0, SERVER_LEAD_MAX).map(([k, e]) => [k, e[1] > 20 ? [Math.round(e[0] / 2), Math.round(e[1] / 2), e[2]] : e]));
}

/**
 * Where each item's bazaars come from now, for the speed log: the server's copy (fresh), this PC's TornW3B read
 * (fresh, not kept from the last visit), both, or neither.
 * @param {Map<string, object>} bazaars - sell.bazaars
 * @param {Map<string, number>} serverSeen - sharedItemsSeen
 */
export function sourceSplit(bazaars, serverSeen, now, maxAge) {
    const out = { server: 0, w3b: 0, both: 0, none: 0 };
    const ids = new Set([...(bazaars ? bazaars.keys() : []), ...(serverSeen ? serverSeen.keys() : [])]);
    for (const id of ids) {
        const b = bazaars && bazaars.get(id);
        const at = b && !b.server && !b.kept ? Math.max(Number(b.at) || 0, Number(b.lightAt) || 0) : 0;
        const w = at > 0 && now - at <= maxAge;
        const s = Boolean(serverSeen && serverSeen.has(id));
        out[w && s ? 'both' : w ? 'w3b' : s ? 'server' : 'none'] += 1;
    }
    return out;
}

/**
 * An item's rows, with this PC's own reads of their sellers (Torn's answer, read after the row's): the seller's
 * listings of the item as Torn gave them, marked own; a seller who no longer lists it, gone.
 * @param {object[]} rows
 * @param {Map<string, {at: number, items: Map<string, Array<{price: number, qty: number}>>}>} reads - sellerId -> read
 */
export function withOwnReads(rows, itemId, reads, now, maxAge = OWN_CONFIRM_MS) {
    if (!reads || !reads.size || !rows) return rows;
    const item = String(itemId);
    const out = [];
    const done = new Set();
    let changed = false;
    for (const r of rows) {
        const seller = String(r.sellerId);
        const read = reads.get(seller);
        if (!read || !(read.at > (r.dataAt || 0)) || now - read.at > maxAge) {
            out.push(r);
            continue;
        }
        changed = true;
        if (done.has(seller)) continue;
        done.add(seller);
        for (const l of read.items.get(item) || []) {
            if (l.price > 1 && l.qty > 0) out.push({ ...r, price: l.price, qty: l.qty, dataAt: read.at, changedAt: r.price === l.price && r.qty === l.qty ? r.changedAt : read.at, shared: false, own: true });
        }
    }
    return changed ? out.sort((a, b) => a.price - b.price) : rows;
}

/** Did this PC read the seller's bazaar from Torn lately, and does it list the item? */
export function ownConfirmed(reads, sellerId, itemId, now, maxAge = OWN_CONFIRM_MS) {
    const read = reads && reads.get(String(sellerId));
    return Boolean(read && now - read.at <= maxAge && (read.items.get(String(itemId)) || []).some((l) => l.price > 1 && l.qty > 0));
}

/**
 * The rows a server-led item's flip may stand on: this PC's own reads (TornW3B's rows, the sellers it read from
 * Torn) - a row of the server's only when this PC read that seller lately and they still list the item (the
 * server reading them again since does not undo that).
 */
export function confirmedRows(rows, itemId, reads, now) {
    return rows ? rows.filter((r) => !r.shared || r.own || ownConfirmed(reads, r.sellerId, itemId, now)) : rows;
}

/**
 * Whose bazaars to read from Torn: the sellers of server-led possible flips whose rows wait for a confirm, the
 * cheapest under the best bid first, none read lately, at most OWN_CONFIRM_WANT.
 * @param {Array<{itemId: string, rows: object[], bid: number}>} flips - in the order of the flips (the most made
 *   first); rows as the flips buy from them (yours, gone and the seller rule already out)
 * @param {Map<string, {at: number}>} reads
 */
export function confirmWants(flips, reads, now, { sent = new Map() } = {}) {
    const out = [];
    for (const f of flips || []) {
        for (const r of (f.rows || []).filter((x) => x.shared && !x.own && !x.stale && x.price < f.bid).sort((a, b) => a.price - b.price)) {
            const id = String(r.sellerId || '');
            if (!/^\d+$/.test(id) || out.includes(id)) continue;
            const read = reads && reads.get(id);
            if (read && now - read.at < OWN_CONFIRM_MS) continue;
            if (sent.has(id) && now - sent.get(id) < OWN_CONFIRM_MS) continue;
            out.push(id);
            if (out.length >= OWN_CONFIRM_WANT) return out;
        }
    }
    return out;
}

/**
 * Torn's answer to a player's bazaar (v2 user?selections=bazaar&id=, or v1): itemId -> listings.
 * @returns {Map<string, Array<{price: number, qty: number}>>|null} null when it is no bazaar answer
 */
export function parseOwnBazaar(data) {
    const list = data && Array.isArray(data.bazaar) ? data.bazaar : null;
    if (!list) return null;
    const out = new Map();
    for (const x of list) {
        const id = String((x && (x.ID ?? x.id ?? x.item_id)) ?? '');
        const price = Number(x && x.price);
        const qty = Number(x && (x.quantity ?? x.amount));
        if (!/^\d+$/.test(id) || !(price > 0) || !(qty > 0)) continue;
        if (!out.has(id)) out.set(id, []);
        out.get(id).push({ price, qty });
    }
    return out;
}
