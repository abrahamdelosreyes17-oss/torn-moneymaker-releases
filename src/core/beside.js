/*
 * Beside Torn Archive (3.25.0). The owner, 2026-10-10: both apps run together,
 * "when im viewing torn trading, it goes to torn trading, if were viewing torn
 * archive it goes to torn archive".
 *
 * Torn counts requests per player and TornW3B per address, so the two apps'
 * shares must fit under one limit. Two userscripts cannot read each other's
 * stored values, but Torn Bids' page and Torn Archive's page live on one site,
 * so both can read that site's own page storage. Three marks are kept there
 * (the agreement is written out in Torn Archive's src/core/turns.js):
 *
 *   tornapps.front    { app: 'archive' | 'trading', at }
 *                     whose page was looked at last. Torn Archive writes it for
 *                     both pages; Torn Bids only reads it.
 *   tornapps.archive  { app: 'archive', at }
 *                     Torn Archive is open (in any tab), renewed at least once a
 *                     minute. Without it Torn Archive counts as open only while
 *                     its `front` mark is still fresh.
 *   tornapps.behind   { app: 'trading', at, torn, w3b }
 *                     written HERE, and only while every tab of Torn Bids keeps
 *                     to the smaller share. Torn Archive takes the larger share
 *                     only while this mark is fresh, so a Torn Bids that says
 *                     nothing is never squeezed and the two never pass a limit.
 *
 * Going down is done at once; going up waits a minute, so what the other asked
 * in the minute before has left Torn's count.
 *
 * Only Torn Bids' own page can read the marks (the panel on Torn's pages is on
 * another site). It works the answer out and keeps it in a stored value every
 * tab of ours reads; when that page is closed the value goes stale and every
 * tab is back to its whole limit - later than Torn Archive stops believing the
 * `behind` mark, never sooner.
 *
 * Pure: no storage, no DOM, no clock.
 */

export const BESIDE_FRONT_MARK = 'tornapps.front';
export const BESIDE_ALIVE_MARK = 'tornapps.archive';
export const BESIDE_BEHIND_MARK = 'tornapps.behind';

/** What Torn Bids keeps to, all its tabs together, while Torn Archive is in front: requests a minute. */
export const BESIDE_TORN_PER_MINUTE = 15;
export const BESIDE_W3B_PER_MINUTE = 15;

/** A mark is believed this long (Torn Archive believes `behind` as long: over two of a hidden tab's once-a-minute ticks). */
export const BESIDE_FRESH_MS = 150 * 1000;
/** The whole limit is taken back this long after Torn Archive left the front. */
export const BESIDE_UP_MS = 60 * 1000;
/** Torn Bids' page looks at the marks this often (a hidden tab's timers run about once a minute). */
export const BESIDE_LOOK_EVERY_MS = 5 * 1000;
/** While behind, the `behind` mark and the stored answer are renewed this often. */
export const BESIDE_RENEW_MS = 30 * 1000;

/** One of the marks, read back from the page storage: null when it is missing or not one of ours. */
export function besideMark(text) {
    if (typeof text !== 'string' || !text || text.length > 300) return null;
    let m = null;
    try {
        m = JSON.parse(text);
    } catch {
        return null;
    }
    if (!m || typeof m !== 'object' || (m.app !== 'archive' && m.app !== 'trading')) return null;
    const at = Number(m.at);
    return Number.isFinite(at) && at > 0 ? { app: m.app, at } : null;
}

/** Is Torn Archive the one in front, and open? A time from the future (the clock was changed) is not believed. */
export function besideArchiveInFront(front, alive, now) {
    if (!front || front.app !== 'archive' || front.at > now + 60000) return false;
    const open = alive && alive.app === 'archive' && alive.at <= now + 60000 ? Math.max(front.at, alive.at) : front.at;
    return now - open < BESIDE_FRESH_MS;
}

/**
 * The answer Torn Bids' page keeps for every tab: { behind, leftAt, at }.
 *  behind: every tab keeps to the smaller share;
 *  leftAt: when Torn Archive was first found NOT in front while we were behind (0 = it is in front);
 *  at:     when this was worked out (a tab believes it only while fresh, see besideBehind()).
 * @param {object|null} prev - the stored answer
 */
export function besideStep(prev, { front = null, alive = null, now }) {
    const was = besideClean(prev);
    if (besideArchiveInFront(front, alive, now)) return { behind: true, leftAt: 0, at: now };
    if (!was.behind) return { behind: false, leftAt: 0, at: now };
    const leftAt = was.leftAt > 0 && was.leftAt <= now ? was.leftAt : now;
    return now - leftAt >= BESIDE_UP_MS ? { behind: false, leftAt: 0, at: now } : { behind: true, leftAt, at: now };
}

function besideClean(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    const time = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);
    return { behind: s.behind === true, leftAt: time(s.leftAt), at: time(s.at) };
}

/**
 * Does this tab keep to the smaller share now? `stored` is what Torn Bids' page last worked out. Stale while
 * behind (that page was closed): still behind until Torn Archive has stopped believing the `behind` mark
 * AND a minute more has passed.
 */
export function besideBehind(stored, now) {
    const s = besideClean(stored);
    if (!s.behind || !s.at || s.at > now + 60000) return false;
    return now - s.at < BESIDE_FRESH_MS + BESIDE_UP_MS;
}

/** May one more request go out now? `recent`: every tab's requests of this kind in the last minute. */
export function besideRoom(stored, recent, now, perMinute) {
    if (!besideBehind(stored, now)) return true;
    let n = 0;
    for (const t of recent || []) if (now - t < 60000) n += 1;
    return n < perMinute;
}

/** The `behind` mark as text, for the site's page storage. */
export function besideBehindText(now) {
    return JSON.stringify({ app: 'trading', at: now, torn: BESIDE_TORN_PER_MINUTE, w3b: BESIDE_W3B_PER_MINUTE });
}

/** Should the page write the stored answer (and, while behind, the mark) again? */
export function besideDue(prev, next, now) {
    const was = besideClean(prev);
    if (was.behind !== next.behind || was.leftAt !== next.leftAt) return true;
    // Not behind: nothing to renew, a stale "not behind" means the same as a fresh one.
    return next.behind && now - was.at >= BESIDE_RENEW_MS;
}

/** One line for Settings and the log, or null when Torn Bids has its whole limit. */
export function besideLine(stored, now) {
    if (!besideBehind(stored, now)) return null;
    return 'Torn Archive is the one you looked at last: Torn Bids keeps to ' + BESIDE_TORN_PER_MINUTE + ' Torn and ' + BESIDE_W3B_PER_MINUTE + ' TornW3B requests a minute until you come back to it.';
}
