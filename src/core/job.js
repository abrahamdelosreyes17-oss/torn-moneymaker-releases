/*
 * One job at a time (3.25.0, mockup AG; the owner, 2026-10-11): "npc arbitradge and tornbids kinda
 * got tangled ... a small toggle button somewhere, that turns what on, npc arbitradge or tornbids".
 *
 * His three rules:
 *   - "if there is an ongoing trade, you cant switch to npc arbitradge";
 *   - "if were at tornbids, npc arbitradge is closed. 0 api calls, same thing when we have npc
 *     arbitradge open, tornbids is closed";
 *   - "npc arbitradge can still use our server".
 *
 * The job is one stored word for the whole browser: every Torn tab, and the Torn Bids page, are on the
 * same one. Pure: who reads the store and who closes what is in main.js.
 */

export const JOB_NPC = 'npc';
export const JOB_BIDS = 'bids';

/** The job stored - or, never chosen yet: Torn Bids for someone who set Torn Bids up, else NPC Arbitrage. */
export function jobStored(stored, { bidsSetUp = false } = {}) {
    if (stored === JOB_NPC || stored === JOB_BIDS) return stored;
    return bidsSetUp ? JOB_BIDS : JOB_NPC;
}

/**
 * The trade that keeps the switch on Torn Bids: a trade a trader said yes to, until it is traded or
 * cancelled. The newest one's trader, for the words; null when none is going.
 *
 * @param {Array<{at: number, trader: {name: string}}>} accepted - core/accepted.js trades
 * @returns {{name: string, trades: number}|null}
 */
export function jobLock(accepted) {
    const going = (accepted || []).filter((t) => t && t.key);
    if (!going.length) return null;
    const newest = going.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))[0];
    return { name: (newest.trader && newest.trader.name) || 'your trader', trades: going.length };
}

/** The job now: a trade going is Torn Bids, whatever was stored. */
export function jobNow(stored, accepted, opts = {}) {
    return jobLock(accepted) ? JOB_BIDS : jobStored(stored, opts);
}

/** The words of the lock, the same wherever it is said. */
export function jobLockWords(lock) {
    if (!lock) return '';
    return 'NPC Arbitrage is locked. Finish or cancel ' + (lock.trades > 1 ? 'your ' + lock.trades + ' trades' : 'the trade with ' + lock.name) + ' first.';
}

/**
 * A press on the switch: may it turn to `to`?
 * @returns {{ok: boolean, why: string}} `why` is said when it may not
 */
export function jobSwitch(to, accepted) {
    if (to !== JOB_NPC && to !== JOB_BIDS) return { ok: false, why: '' };
    const lock = to === JOB_NPC ? jobLock(accepted) : null;
    return lock ? { ok: false, why: jobLockWords(lock) } : { ok: true, why: '' };
}

/**
 * What each side may do, from the job: the one that is off shows nothing and asks for nothing.
 * Both keep the bazaar owner's line, Fill on your own shop's pages, and the server.
 */
export function jobParts(job) {
    const bids = job === JOB_BIDS;
    return {
        // NPC Arbitrage: the deals list and its reads, Scan, the chips, the green outlines.
        deals: !bids,
        // Torn Bids: trader tags, the buying run, the trade box, Checkout, To sell, the Torn Bids page.
        trades: bids,
    };
}
