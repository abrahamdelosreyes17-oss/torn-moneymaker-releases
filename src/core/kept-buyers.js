/*
 * Each item's buyers, kept between Torn Bids' redraws (3.18.0; PLAN-speed.md
 * Part 3 B, step 11).
 *
 * The friend's speed log (2026-10-03, 3.17.1 on his laptop): Torn Bids redrew
 * 271 times in 42 minutes at 788 ms each, the page rebuild only 7.7 ms of it.
 * A profile of the bench says where the rest goes: buyersForItem, run anew
 * for every item on every redraw - though a redraw follows one answer (a
 * bazaar read, a status, one trader's list) and nearly every item's buyers
 * are what they were.
 *
 * Kept here: an item's rows are handed back as they were while everything
 * buyersForItem would read for that item is what it read last time. Nothing
 * is told to this file when something changes - each redraw it LOOKS: the
 * item's own sources are compared value by value (TornExchange's top three,
 * its full list, your traders' own lists, TornW3B's buyers of it, the lists
 * index), and what items share - each trader's votes, name and rating - is
 * compared once a redraw, trader by trader: an item is worked out again when
 * a trader in its rows or its TornW3B list changed, and only then (a list
 * read brings one trader's rating; it must not throw every item away).
 * Anything different: worked out again. So no place that changes a list can
 * be forgotten.
 *
 * Proof (test/kept-buyers.test.js): a long made-up session - lists read,
 * traders learned and dropped, ratings and votes moving, lists ageing out -
 * with the kept rows compared with a fresh buyersForItem for every item at
 * every step. And in use, about one kept item in KEPT_CHECK_ONE_IN each
 * redraw (never fewer than one) is worked out again and compared: should
 * they ever differ, it is written in the problem log, everything kept is
 * dropped, the rest of that redraw is worked out fresh, and keeping begins
 * again with the next. And no item's kept rows stand for longer than about
 * KEPT_MAX_AGE_MS (core/kept.js): whatever the keeping should fail to look
 * at, what is shown is never further behind than that.
 *
 * 3.29.0 (the owner's page, measured 2026-10-12): until now one difference
 * switched keeping off until the page was reloaded, and every redraw then
 * worked out all 1,361 items (61,773 trader rows) for the rest of the day.
 * And one kept item a redraw was checked, so a wrong row could have stood
 * for 1,361 redraws before its turn came.
 *
 * Pure: no DOM, no storage, no clock of its own (begin() is handed the redraw's).
 */

import { buyersForItem } from './traders.js';
import { keptDiffWords, keptCheckTurn, keptAgeLimit } from './kept.js';

const KEPT_NO_ROWS = [];

/** The same keys with the same values (b may be null: no entries). */
function keptSameMap(a, b) {
    const size = b ? b.size : 0;
    if (a.size !== size) return false;
    if (!size) return true;
    for (const [k, v] of b) {
        const was = a.get(k);
        if (!Object.is(was, v) || (was === undefined && !a.has(k))) return false;
    }
    return true;
}

/**
 * @param {object} [o]
 * @param {function} [o.compute] - buyersForItem (a test may count its calls)
 * @param {function} [o.onDiffer] - (itemId, where) => void: a kept item differed from a fresh one (everything kept is dropped; the rest of the redraw is worked out fresh); `where`: keptDiffWords
 * @param {boolean} [o.freeze] - freeze what is handed out (tests: a caller writing into kept rows fails loudly)
 */
export function makeBuyersKeeper({ compute = buyersForItem, onDiffer = null, freeze = false } = {}) {
    const kept = new Map();
    const stats = { kept: 0, redone: 0, checked: 0, differed: 0 };
    // What items share, as last seen. Votes, names and ratings: per trader (see `dependents`).
    // The two name lists: a number that moves when one changes (only an item with a full list reads them whole).
    let votes = new Map();
    let ids = new Map();
    let idsVer = 0;
    let dbIds = new Map();
    let dbIdsVer = 0;
    const people = new Map();
    // Trader id -> the items whose kept rows read that trader's votes, name or rating.
    // (An item stays listed after it is worked out again without them: it is then only looked at once too often.)
    const dependents = new Map();
    const changedTrader = (id) => {
        const items = dependents.get(id);
        if (!items) return;
        for (const itemId of items) kept.delete(itemId);
        items.clear();
    };
    let off = false;
    let clock = 0;
    // Some kept items a redraw are worked out again and compared: which ones moves on each redraw.
    let hits = 0;
    const turn = keptCheckTurn();
    // What this redraw's begin() was handed, and whether it is still what was looked at (see `unsettled`).
    let shared = {};
    let settled = true;

    /**
     * Once a redraw, before any buyers(): what every item shares is looked at.
     * @param {number} [now] - the redraw's clock: with it, keeping that went off begins again here, and kept rows age (none handed: neither)
     */
    function begin(given = {}, now = 0) {
        turn.begin(hits);
        hits = 0;
        clock = Number(now) || 0;
        if (off && clock > 0) off = false;
        shared = given || {};
        settled = true;
        look(shared);
    }

    /**
     * What every item shares, against what was last seen: a trader whose
     * votes, name or rating moved sends the items that read them back to be
     * worked out; a name list that moved changes the items that read it whole.
     */
    function look({ idsByName = null, dbIdsByName = null, votesById = null, db = null } = {}) {
        if (!keptSameMap(votes, votesById)) {
            const now = votesById || new Map();
            for (const [id, v] of now) if (!Object.is(votes.get(id), v) || !votes.has(id)) changedTrader(id);
            for (const id of votes.keys()) if (!now.has(id)) changedTrader(id);
            votes = new Map(now);
        }
        if (!keptSameMap(ids, idsByName)) {
            ids = new Map(idsByName || []);
            idsVer += 1;
        }
        if (!keptSameMap(dbIds, dbIdsByName)) {
            dbIds = new Map(dbIdsByName || []);
            dbIdsVer += 1;
        }
        // The traders' names and ratings, as buyersForItem reads them: one
        // learned, dropped or changed sends the items that read them back to be worked out.
        const traders = (db && db.traders) || {};
        let seen = 0;
        for (const id in traders) {
            if (!Object.prototype.hasOwnProperty.call(traders, id)) continue;
            seen += 1;
            const t = traders[id];
            const name = t ? t.name : undefined;
            const rating = (t && t.rating) || null;
            const up = rating ? rating.up : null;
            const down = rating ? rating.down : null;
            const p = people.get(id);
            if (!p) {
                people.set(id, { there: Boolean(t), name, rating, up, down });
                changedTrader(id);
            } else if (p.there !== Boolean(t) || p.name !== name || p.rating !== rating || !Object.is(p.up, up) || !Object.is(p.down, down)) {
                // (`rating`: the rating itself, not only its numbers - the rows hold it, with when it was
                // read. 3.29.0: two sources that disagreed on a trader's votes, both heard between two
                // redraws - 523, then 524, then 523 - left the numbers as they were and the rating another
                // one; the kept rows then differed from fresh ones, and that switched keeping off.)
                p.there = Boolean(t);
                p.name = name;
                p.rating = rating;
                p.up = up;
                p.down = down;
                changedTrader(id);
            }
        }
        if (people.size !== seen) {
            for (const id of [...people.keys()]) {
                if (Object.prototype.hasOwnProperty.call(traders, id)) continue;
                people.delete(id);
                changedTrader(id);
            }
        }
    }

    /** Everything buyersForItem reads for this item but the lists index: one flat row of values. */
    function tokensOf(src) {
        const tk = [Boolean(src.db), Boolean(src.votesById)];
        const idsByName = src.idsByName || null;
        const dbIdsByName = src.dbIdsByName || null;
        const teBest = src.teBest || KEPT_NO_ROWS;
        tk.push(teBest.length);
        for (const t of teBest) {
            if (!t) {
                tk.push(null);
                continue;
            }
            tk.push(t.name, t.price, t.score, t.id);
            // Who that name is: asked of the two name lists for this name only (a trader learned elsewhere changes no other item).
            if (t.name) {
                const lower = String(t.name).toLowerCase();
                tk.push(idsByName ? idsByName.get(lower) : undefined, dbIdsByName ? dbIdsByName.get(lower) : undefined);
            }
        }
        // A full list looks every name up, and whether the active traders are known at all.
        if (Array.isArray(src.teFull)) {
            tk.push('full', idsVer, dbIdsVer, src.teFull.length);
            for (const t of src.teFull) tk.push(t ? t.name : null, t ? t.price : null);
        } else {
            tk.push('nofull');
        }
        const own = src.teOwn || KEPT_NO_ROWS;
        tk.push(own.length);
        for (const t of own) tk.push(t ? t.id : null, t ? t.name : null, t ? t.price : null, t ? t.lastPaid : null);
        const item = src.w3bItem || KEPT_NO_ROWS;
        tk.push(item.length);
        for (const t of item) tk.push(t ? t.id : null, t ? t.name : null, t ? t.price : null, t ? t.up : null, t ? t.down : null);
        return tk;
    }

    function sameTokens(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
        return true;
    }

    /** The item's TornW3B list in the index: the same list, or one that says the same (the index is rebuilt each minute). */
    function sameW3b(was, list) {
        if (was.w3b === list) return true;
        const old = was.w3b;
        if (old.length !== list.length) return false;
        for (let i = 0; i < list.length; i += 1) {
            const a = old[i];
            const b = list[i];
            if (a !== b && (!a || !b || a.id !== b.id || !Object.is(a.price, b.price))) return false;
        }
        was.w3b = list;
        return true;
    }

    /**
     * buyersForItem(itemId, src), or the rows it gave last time when it would
     * give the same again. `src` is what buyersForItem takes.
     */
    function buyers(itemId, src = {}) {
        const id = String(itemId);
        if (off) {
            // Counted as worked out again (3.28.1): the speed log then shows what switching off costs.
            stats.redone += 1;
            return compute(id, src);
        }
        // The page was free since the last look: what items share is looked at again first, so what is worked
        // out now is kept against what it read (and nothing kept outlives a change that went and came back).
        if (!settled) {
            settled = true;
            look(shared);
        }
        const list = (src.w3bByItem && src.w3bByItem.get(id)) || KEPT_NO_ROWS;
        const tk = tokensOf(src);
        const was = kept.get(id);
        if (was && sameTokens(was.tk, tk) && sameW3b(was, list)) {
            // Stood long enough: worked out again (and counted so) - and it should say what was kept.
            const aged = clock > 0 && clock - was.at >= keptAgeLimit(id);
            if (!aged) {
                stats.kept += 1;
                hits += 1;
                if (!turn.due(hits - 1)) return was.out;
            } else {
                stats.redone += 1;
            }
            // This redraw's check: the kept rows against fresh ones.
            const fresh = compute(id, src);
            stats.checked += 1;
            if (JSON.stringify(fresh) === JSON.stringify(was.out)) {
                // The very rows that were kept are handed out again: what is kept against them (core/shown-buyers.js) holds.
                was.at = clock;
                return was.out;
            }
            stats.differed += 1;
            off = true;
            kept.clear();
            if (onDiffer) onDiffer(id, keptDiffWords(fresh, was.out));
            return fresh;
        }
        const out = compute(id, src);
        stats.redone += 1;
        // Whose votes, name or rating these rows read: every trader of the item's TornW3B list (the name), every row (votes, rating).
        const depend = (traderId) => {
            if (!traderId) return;
            const key = String(traderId);
            let items = dependents.get(key);
            if (!items) dependents.set(key, (items = new Set()));
            items.add(id);
        };
        for (let i = 0; i < list.length; i += 1) depend(list[i] && list[i].id);
        for (const r of out) depend(r.id);
        if (freeze) {
            for (const r of out) {
                if (r.trust) Object.freeze(r.trust);
                if (r.itemRating) Object.freeze(r.itemRating);
                Object.freeze(r);
            }
            Object.freeze(out);
        }
        kept.set(id, { tk, w3b: list, out, at: clock });
        return out;
    }

    return {
        begin,
        buyers,
        stats,
        /** Whether keeping is on (off for the rest of a redraw in which a kept item differed). */
        on: () => !off,
        /**
         * The page was free since begin() (a redraw worked out in pieces,
         * 3.19.0): what items share may have moved, so the next buyers()
         * looks at it again before anything is handed out or kept.
         */
        unsettled: () => {
            settled = false;
        },
        clear: () => kept.clear(),
    };
}
