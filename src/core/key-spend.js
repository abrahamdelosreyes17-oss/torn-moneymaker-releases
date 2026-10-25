/*
 * What Torn Bids spends of the Torn key (3.35.0; the field report of 3.34.0: the key's budget of ~70 a minute went to
 * your own inventory (t.inventory, 27-34 a minute), to statuses (18-22) and to networth (11), leaving none for the
 * Item Market and the pressed trader's items).
 *
 * Three places:
 *   1. Your inventory (api/torn.js fetchInventory). Torn answers "Incorrect category" without a category for some keys,
 *      and the page then asked 25 categories, each paged - every time, and after any failure from the start again.
 *      Now it remembers that the no-category read is refused, skips the categories that held nothing (asked again every
 *      INVENTORY_EMPTY_RECHECK_MS), resumes after a failed read from where it stopped, and is read again only when it
 *      can have changed (a buy or a trade finished, Refresh, the tab back) and then not sooner than a minute after
 *      the last read - else on the hour, as before.
 *   2. Networth (the buyers a flip sells to): only the ones in view, not every candidate flip's buyer.
 *   3. Statuses: only the traders on screen or in a candidate flip (core/status.js sellWatch).
 *
 * Pure: no page, no clock, no network.
 */

import { INVENTORY_TTL_MS } from './inventory.js';

/** A category that held nothing is asked again after this (a bought item may be the first of its kind). */
export const INVENTORY_EMPTY_RECHECK_MS = 6 * 60 * 60 * 1000;
/** A read that can have changed the inventory is not repeated sooner than this. */
export const INVENTORY_DIRTY_GAP_MS = 60 * 1000;
/** What a failed read already got is kept this long, to resume from. */
export const INVENTORY_RESUME_MS = 10 * 60 * 1000;
/** The candidate flips' buyers asked for their networth, at most (the first by profit). */
export const NETWORTH_CANDIDATES_MAX = 12;

/** The policy as kept between visits: {byCategory: boolean, empty: {category: seenEmptyAt}}. */
export function inventoryPolicyClean(stored) {
    const empty = {};
    const raw = stored && typeof stored === 'object' && stored.empty && typeof stored.empty === 'object' ? stored.empty : {};
    for (const [cat, at] of Object.entries(raw)) if (Number(at) > 0) empty[cat] = Number(at);
    return { byCategory: Boolean(stored && stored.byCategory), empty };
}

/**
 * How the next read goes: with or without categories, and which categories to leave out.
 * @returns {{byCategory: boolean, skip: Set<string>}}
 */
export function inventoryPlan(policy, now) {
    const p = inventoryPolicyClean(policy);
    const skip = new Set();
    for (const [cat, at] of Object.entries(p.empty)) if (now - at < INVENTORY_EMPTY_RECHECK_MS) skip.add(cat);
    return { byCategory: p.byCategory, skip };
}

/**
 * What a read taught: that the no-category read is refused, or that a category held something / nothing.
 * @param {{byCategory?: boolean, cat?: string, count?: number}} event
 */
export function inventoryLearn(policy, event, now) {
    const p = inventoryPolicyClean(policy);
    if (event.byCategory) p.byCategory = true;
    if (event.cat) {
        if (event.count > 0) delete p.empty[event.cat];
        else p.empty[event.cat] = now;
    }
    return p;
}

/**
 * Should the inventory be read now? On the hour (Torn's own cache), or sooner when something that can have changed
 * it happened - and then not sooner than INVENTORY_DIRTY_GAP_MS after the last read.
 * @param {object} o
 * @param {number|null} o.inventoryAt - when it was last read
 * @param {number} [o.retryAt] - a failed read waits until
 * @param {boolean} [o.keyDead]
 * @param {boolean} [o.dirty] - a buy, a finished trade, Refresh or the tab back since the last read
 * @param {number} o.now
 */
export function inventoryDue({ inventoryAt, retryAt = 0, keyDead = false, dirty = false, now, refreshMs = INVENTORY_TTL_MS }) {
    if (keyDead || now < (Number(retryAt) || 0)) return false;
    const age = now - (Number(inventoryAt) || 0);
    if (age >= refreshMs) return true;
    return Boolean(dirty) && age >= INVENTORY_DIRTY_GAP_MS;
}

/** What a failed read got so far, while it is still worth resuming from: {rows, done: string[], at}. */
export function inventoryResume(kept, now) {
    return kept && kept.at > 0 && now - kept.at < INVENTORY_RESUME_MS && Array.isArray(kept.rows) && Array.isArray(kept.done) ? kept : null;
}

/**
 * The buyers whose networth is asked for: the ones in view first (the strip's flips, the desk's top buyers, the trader
 * pressed), then the candidate flips' buyers, the first NETWORTH_CANDIDATES_MAX of them.
 * @param {object} o
 * @param {string[]} o.view - ids in view, in order
 * @param {string[]} o.candidates - the candidate flips' buyer ids, the biggest first
 */
export function networthWanted({ view = [], candidates = [], max = NETWORTH_CANDIDATES_MAX }) {
    return [...new Set([...view, ...candidates.slice(0, max)].filter(Boolean).map(String))];
}
