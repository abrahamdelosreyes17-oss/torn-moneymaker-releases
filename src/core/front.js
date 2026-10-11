/*
 * The requests go to where he is (3.25.0, plan part 1c). The owner, 2026-10-09:
 * "we can take it out, and just throttle depending on usage/page he is viewing
 * ... on the overlay/torn page, we can throttle the api calls from tornbids as
 * he is already actively buying, when hes in tornbids, throttle the overlay so
 * tornbids gets it all".
 *
 * So no switch ("Save API calls" and "Watch the Item Market anywhere" are gone).
 * There are two sides - Torn Bids, and the panel on Torn's pages - and each
 * leaves a sign of life while it is in view: when it was last seen, and when he
 * last came to it. From those four numbers every tab works out the same answer:
 *
 *   a Torn page in front   the page asks. Torn Bids keeps its turn for a short
 *                          while (a buying run goes back and forth), then asks
 *                          only for what an accepted or held trade needs.
 *   Torn Bids in front     Torn Bids has the reads; the panel asks nothing of
 *                          its own.
 *   neither in view        nothing of its own is asked by either.
 *
 * This divides the allowance, it does not make it larger: the pace is the gap
 * in api/w3b.js and Torn's own limit, whoever asks.
 *
 * Pure: no storage, no DOM.
 */

/** A side in view says so this often. */
export const FRONT_BEAT_MS = 10000;
/** In view = seen within this (two signs of life may be missed). */
export const FRONT_ALIVE_MS = 25000;
/** Torn Bids keeps its turn this long after he leaves it. */
export const FRONT_KEEP_MS = 30000;

function frontClean(side) {
    const time = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);
    const s = side && typeof side === 'object' ? side : {};
    return { seen: time(s.seen), front: time(s.front) };
}

function frontAlive(side, now) {
    // A time from the future (the clock was changed) is not believed.
    return side.seen > 0 && side.seen <= now + 60000 && now - side.seen < FRONT_ALIVE_MS;
}

/**
 * Where he is: 'bids', 'page' or 'none'.
 * @param {{bids: {seen, front}|null, page: {seen, front}|null}} sides
 */
export function frontSide(sides, now) {
    const bids = frontClean(sides && sides.bids);
    const page = frontClean(sides && sides.page);
    const b = frontAlive(bids, now);
    const p = frontAlive(page, now);
    // Both in view (two windows): the one he came to last.
    if (b && p) return bids.front >= page.front ? 'bids' : 'page';
    return b ? 'bids' : p ? 'page' : 'none';
}

/**
 * May this side ask for things of its own now? (What an accepted or held trade
 * needs is not asked about here: that is first on both sides, always.)
 * @param {'bids'|'page'} side
 */
export function frontMayAsk(side, sides, now) {
    const front = frontSide(sides, now);
    if (front === side) return true;
    if (side !== 'bids') return false;
    // Torn Bids keeps its turn for a short while after he leaves it.
    const bids = frontClean(sides && sides.bids);
    const page = frontClean(sides && sides.page);
    if (!bids.seen || bids.seen > now + 60000) return false;
    // Left when the page took over - or, hidden with no page in view, at its last sign of life.
    const leftAt = front === 'page' && page.front > bids.front ? Math.min(page.front, bids.seen + FRONT_BEAT_MS) : bids.seen;
    return now - leftAt < FRONT_KEEP_MS;
}

/**
 * A side's next sign of life, or null when none is due. Only a tab in view
 * writes one: every FRONT_BEAT_MS, and at once when he comes to it (`came`:
 * the tab was shown, or its window got the focus).
 */
export function frontBeat(was, { visible, came, now }) {
    if (!visible) return null;
    const had = frontClean(was);
    if (came || !had.front) return { seen: now, front: now };
    if (now - had.seen >= FRONT_BEAT_MS || had.seen > now) return { seen: now, front: had.front };
    return null;
}

/** The line in the panel's Settings, by where he is. */
export function frontWords(front) {
    if (front === 'page') return 'Reading for this page. Torn Bids in another tab asks only for a trade you accepted.';
    if (front === 'bids') return 'Torn Bids has the reads. This panel asks nothing of its own.';
    return 'Nothing is being read.';
}
