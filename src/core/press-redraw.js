/*
 * A press drawn on the working out before (3.33.0; the owner, 2026-10-16: "i click everything they buy, and its
 * SO laggy"). A Torn Bids redraw is two parts. Stages 1-4 work the market out - who buys what, your buys and the
 * prices in force, the possible flips, every item's row - and were nine tenths of a redraw on his page (one hour:
 * 61.7 s of 70 s). Then the list's order and filters, the cards, Your traders, the desk, the counts and the page.
 * A press moves the second part; the first only where it changes what that part reads.
 *
 * So a redraw asked for by a press may be drawn on the last full working out, when:
 *   - nothing but presses asked for a redraw since (data that arrives always asks, and is worked out in full);
 *   - the word of everything else stages 1-4 read is the very word it was (main.js sellDataWord);
 *   - that working out is under PRESS_KEPT_MS old (what turns stale by the clock alone, does so by then).
 * The rows of the items whose place in the trade on show moved (picked, or in or out of it) are worked out
 * again (rowsAgain): their flip plan reads it.
 *
 * Pure: no page, no clock.
 */

export const PRESS_KEPT_MS = 10 * 1000;

/**
 * May this press be drawn on the kept working out? `why` says what asked for it in full (for the speed log).
 * @param {object} o
 * @param {{word: string, at: number}|null} o.kept - the last full working out
 * @param {number} o.now
 * @param {boolean} o.asked - since it, a redraw was asked for by something that is not a press (or one is under way)
 * @param {function(): string} o.word - the word now (asked last: it reads the stores)
 * @param {number} [o.maxAge]
 * @returns {{ok: boolean, why: null|'old'|'data'|'changed'}}
 */
export function pressReuse({ kept, now, asked, word, maxAge = PRESS_KEPT_MS }) {
    if (!kept || !(now >= kept.at) || !(now - kept.at < maxAge)) return { ok: false, why: 'old' };
    if (asked) return { ok: false, why: 'data' };
    if (typeof word !== 'function' || word() !== kept.word) return { ok: false, why: 'changed' };
    return { ok: true, why: null };
}

/** The ids in one set and not the other, each once (as strings). */
export function idsMoved(was, now) {
    const a = new Set([...(was || [])].map(String));
    const b = new Set([...(now || [])].map(String));
    return [...[...a].filter((id) => !b.has(id)), ...[...b].filter((id) => !a.has(id))];
}

/**
 * The kept rows, with those of `moved` worked out again by `rowFor` (null: not in the list). A new array when
 * one changed; the very array when none of them is in it.
 * @param {Array<{row: {itemId: *}}>} entries - one an item, in the list's order
 * @param {string[]} moved
 * @param {function(*): ({row: object}|null)} rowFor - handed the item's id as the list has it
 */
export function rowsAgain(entries, moved, rowFor) {
    const ids = new Set((moved || []).map(String));
    if (!ids.size) return entries;
    let out = null;
    for (let i = 0; i < entries.length; i += 1) {
        const id = entries[i].row.itemId;
        if (!ids.has(String(id))) continue;
        if (!out) out = entries.slice();
        out[i] = rowFor(id);
    }
    return out ? out.filter(Boolean) : entries;
}

/** The list's rows, the possible flips waiting for a check and the flips shown - in the items' order. */
export function rowsOfEntries(entries) {
    const rows = [];
    const waiting = [];
    const shownFlips = [];
    for (const e of entries || []) {
        rows.push(e.row);
        if (e.wait) waiting.push(e.wait);
        if (e.flip) shownFlips.push(e.flip);
    }
    return { rows, waiting, shownFlips };
}
