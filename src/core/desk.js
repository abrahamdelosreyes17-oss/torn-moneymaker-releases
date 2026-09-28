/*
 * Which item the desk shows, and which TornW3B read comes next (3.14).
 * Pure: no DOM, no network.
 */

/*
 * In the background (3.14, the owner: "can we do it automatically?"): Torn
 * Bids keeps reading TornExchange and TornW3B while its tab is hidden, and
 * works out the flips now and then, so the page is current when you look at
 * it. Torn API calls stay in-view only.
 *
 * 3.14.3: 3.14.1 allowed 6 reads a minute and gave every other one to a
 * trader's price list (2,482 of them), so a hidden page had checked 3 of 30
 * possible flips after five minutes (the owner's page). Hidden, the flips now
 * come before the price lists (nextW3bRead's `hidden`), at 20 reads a minute -
 * still below the in-view 24 - so all 30 are checked within two minutes.
 */
export const W3B_HIDDEN_PER_MIN = 20;
/* Of those, price lists at most this many (3.14.1's pace): a page that loads
 * hidden has no possible flips yet, and the lists took the whole minute's reads
 * in five seconds - the flips, found a moment later, waited a minute. */
export const W3B_HIDDEN_LISTS_PER_MIN = 6;
export const HIDDEN_RENDER_MS = 30 * 1000;

/** May a hidden tab make another TornW3B read now? `recent`: its reads' times. */
export function backgroundSlot(recent, now, perMinute = W3B_HIDDEN_PER_MIN) {
    return (recent || []).filter((t) => now - t < 60000).length < perMinute;
}

/** Hidden, may the next read be a price list? `lists`: the lists' read times. */
export function backgroundListSlot(lists, now) {
    return backgroundSlot(lists, now, W3B_HIDDEN_LISTS_PER_MIN);
}

/**
 * Hidden, work the flips out again now? Yes once newer data has come in (the
 * bazaar summary, TornExchange's buyers): until then the possible flips are
 * the old ones (or none, on a page that loaded hidden) and the reads would go
 * to price lists instead.
 */
export function flipsStale(dataAt, workedOutAt) {
    return !!dataAt && dataAt > (workedOutAt || 0);
}

/*
 * Declined is one trade, not the person (3.14.2, the owner: "if we decline
 * one trade, doesn't mean we would decline the other trades with the same
 * person"): stored per item and trader, 'itemId|traderKey' -> until. Older
 * per-trader entries (no item) count for nothing and expire within the hour.
 */
export function declineKey(itemId, traderKey) {
    return String(itemId) + '|' + String(traderKey);
}

/** The traders passed over on this item: trader key -> until. */
export function declinedOn(declined, itemId) {
    const out = new Map();
    const p = String(itemId) + '|';
    for (const [k, until] of declined || []) if (String(k).startsWith(p)) out.set(String(k).slice(p.length), until);
    return out;
}

/**
 * The item on the desk. One you picked stays picked (pressing a Best flips
 * card, a list row, or anything in the trade). Until you pick one, the desk
 * shows the #1 flip - the best there is right now - following it as better
 * flips are found (3.13 had kept it on the first flip that loaded while
 * that flip stayed in the top four: Small First Aid Kit +$2,308 on the desk
 * with far bigger flips beside it).
 *
 * @param {object} p
 * @param {boolean} p.pickedByYou
 * @param {string|null} p.selected - the item on the desk now
 * @param {string} p.filter - 'all' | 'mine' | 'flips'
 * @param {Array<{itemId}>} p.strip - the best flips, best first
 * @param {Array<{itemId}>} p.listed - the list, in its order
 */
export function deskItem({ pickedByYou = false, selected = null, filter = 'all', strip = [], listed = [] }) {
    if (pickedByYou && selected) return selected;
    if (filter !== 'mine' && strip.length) return strip[0].itemId;
    return listed.length ? listed[0].itemId : null;
}

/**
 * The next TornW3B read. The summary when old; the item on the desk; then -
 * only while you work on a trade (picked, held or pinned) - that trade's
 * items; then the possible flips and the traders' price lists taking
 * turns; then, with no trade under way, the unread items of the trade the
 * desk shows; then pinned trades' items (their profit on the list).
 *
 * Before 3.14 the desk's trade came before the possible flips even when
 * nobody was using it: the trade read up to 30 items for twelve traders'
 * totals first, the flips waited (Bazaars "checked 12/30"), and a flip only
 * counts once its bazaars are read - the big ones stayed unconfirmed.
 *
 * @param {object} p
 * @param {boolean} p.summaryDue
 * @param {string|null} p.picked - the item on the desk
 * @param {boolean} p.active - a trade under way (you picked, or it is held or pinned)
 * @param {string[]} p.live - the trade's items, kept live
 * @param {string[]} p.wanted - its items not read yet
 * @param {string[]} p.candidates - possible flips, best first
 * @param {string[]} p.pinned - pinned trades' items
 * @param {string|null} p.list - the next trader price list due, or null
 * @param {number} p.turn - 0 or 1: flips and lists take turns (in view)
 * @param {boolean} p.hidden - the tab is hidden: flips before lists
 * @param {function} p.due - (itemId, 'desk' | 'slow') => boolean
 * @returns {null|{kind: 'summary'}|{kind: 'bazaars', id: string}|{kind: 'list', id: string}}
 */
export function nextW3bRead({ summaryDue = false, picked = null, active = false, live = [], wanted = [], candidates = [], pinned = [], list = null, turn = 0, hidden = false, due }) {
    if (summaryDue) return { kind: 'summary' };
    if (picked && due(picked, 'desk')) return { kind: 'bazaars', id: picked };
    if (active) {
        const l = live.find((id) => due(id, 'desk'));
        if (l) return { kind: 'bazaars', id: l };
        const w = wanted.find((id) => due(id, 'slow'));
        if (w) return { kind: 'bazaars', id: w };
    }
    const cand = candidates.find((id) => due(id, 'slow'));
    // Hidden, the flips first: the price lists can wait until you look.
    if (cand && (turn || !list || hidden)) return { kind: 'bazaars', id: cand };
    if (list) return { kind: 'list', id: list };
    if (cand) return { kind: 'bazaars', id: cand };
    if (!active) {
        const w = wanted.find((id) => due(id, 'slow'));
        if (w) return { kind: 'bazaars', id: w };
    }
    const p = pinned.find((id) => due(id, 'slow'));
    if (p) return { kind: 'bazaars', id: p };
    return null;
}
