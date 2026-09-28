/*
 * Which item the desk shows, and which TornW3B read comes next (3.14).
 * Pure: no DOM, no network.
 */

/*
 * In the background (3.14, the owner: "can we do it automatically?"): Torn
 * Bids keeps reading TornExchange and TornW3B while its tab is hidden - a
 * quarter of TornW3B's in-view pace - and works out the flips now and then,
 * so the page is current when you look at it. Torn API calls stay in-view only.
 */
export const W3B_HIDDEN_PER_MIN = 6;
export const HIDDEN_RENDER_MS = 30 * 1000;

/** May a hidden tab make another TornW3B read now? `recent`: its reads' times. */
export function backgroundSlot(recent, now, perMinute = W3B_HIDDEN_PER_MIN) {
    return (recent || []).filter((t) => now - t < 60000).length < perMinute;
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
 * @param {number} p.turn - 0 or 1: flips and lists take turns
 * @param {function} p.due - (itemId, 'desk' | 'slow') => boolean
 * @returns {null|{kind: 'summary'}|{kind: 'bazaars', id: string}|{kind: 'list', id: string}}
 */
export function nextW3bRead({ summaryDue = false, picked = null, active = false, live = [], wanted = [], candidates = [], pinned = [], list = null, turn = 0, due }) {
    if (summaryDue) return { kind: 'summary' };
    if (picked && due(picked, 'desk')) return { kind: 'bazaars', id: picked };
    if (active) {
        const l = live.find((id) => due(id, 'desk'));
        if (l) return { kind: 'bazaars', id: l };
        const w = wanted.find((id) => due(id, 'slow'));
        if (w) return { kind: 'bazaars', id: w };
    }
    const cand = candidates.find((id) => due(id, 'slow'));
    if (cand && (turn || !list)) return { kind: 'bazaars', id: cand };
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
