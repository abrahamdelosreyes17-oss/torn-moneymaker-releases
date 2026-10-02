/*
 * How much of a player's bazaar is in the page, read only.
 *
 * Markup read on real bazaars with the owner, 2026-10-02 (a bazaar of 17
 * listings, and one of 250), nothing touched:
 *
 *   div[data-testid="bazaar-items"]         style="position: relative; width: 100%; height: 6720px"
 *     div[data-testid="bazaar-items-row"]   style="position: absolute; ...; height: 80px; transform: translateY(1360px)"
 *       div[data-testid="row-items"]
 *         div[data-testid="item"] x3        (the cards: sources/dom/detect.js)
 *
 * The list is as tall as every row together; only the rows near the screen
 * are in the page (18 of 84 at the top of the big one), each placed by its
 * offset, and the rows scrolled away from are taken out again. A row's
 * offset says which row it is; the list's height says how many there are.
 *
 * Anything not laid out this way reads as null, and the caller carries on as
 * it did before it knew any of this.
 */

import { itemIdFromImage, ITEM_IMAGE_SELECTOR } from './detect.js';

export const BAZAAR_LIST_SELECTOR = '[data-testid="bazaar-items"]';
export const BAZAAR_ROW_SELECTOR = '[data-testid="bazaar-items-row"]';

const HEIGHT_RE = /(?:^|;)\s*height:\s*([\d.]+)px/i;
const OFFSET_RE = /translateY\(\s*(-?[\d.]+)px\s*\)/i;

function styleNumber(el, re) {
    const m = String((el && el.getAttribute && el.getAttribute('style')) || '').match(re);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? n : null;
}

/** How far up from the list the bazaar's own search box is looked for. */
const SEARCH_CLIMB = 6;

/**
 * Is the bazaar's own search box in use? The nearest box around the list
 * that calls itself a search (Torn's reads "search..."); the site's search in
 * the page header is further out and is never reached when the bazaar has
 * its own. No such box: not in use.
 */
export function bazaarSearchInUse(list) {
    let node = list ? list.parentElement : null;
    for (let depth = 0; depth < SEARCH_CLIMB && node; depth += 1, node = node.parentElement) {
        const boxes = [...node.querySelectorAll('input')].filter((i) => {
            if (i.type === 'hidden' || i.type === 'checkbox' || i.type === 'radio') return false;
            if (list.contains(i)) return false;
            return /search/i.test([i.getAttribute('placeholder'), i.getAttribute('aria-label'), i.getAttribute('name'), i.getAttribute('class'), i.getAttribute('type')].join(' '));
        });
        if (boxes.length) return boxes.some((i) => String(i.value || '').trim() !== '');
    }
    return false;
}

/**
 * What the page shows of the bazaar's list now.
 *
 * @param {Document|Element} root
 * @returns {null|{rowsTotal: number, perRow: number, rows: Array<{index: number, ids: string[], el: Element}>, searching: boolean}}
 */
export function readBazaarList(root) {
    const list = root && root.querySelector ? root.querySelector(BAZAAR_LIST_SELECTOR) : null;
    if (!list) return null;
    const els = [...list.querySelectorAll(BAZAAR_ROW_SELECTOR)];
    if (!els.length) return null;
    const rowHeight = styleNumber(els[0], HEIGHT_RE);
    const listHeight = styleNumber(list, HEIGHT_RE);
    if (!(rowHeight > 0) || !(listHeight > 0)) return null;
    const rows = [];
    for (const el of els) {
        const y = styleNumber(el, OFFSET_RE);
        // A row not placed by its offset: not the list read above.
        if (y === null || y < 0) return null;
        const ids = [...el.querySelectorAll(ITEM_IMAGE_SELECTOR)].map(itemIdFromImage).filter(Boolean).map(String);
        rows.push({ index: Math.round(y / rowHeight), ids, el });
    }
    const rowsTotal = Math.round(listHeight / rowHeight);
    if (!(rowsTotal > 0)) return null;
    return { rowsTotal, perRow: rows.reduce((a, r) => Math.max(a, r.ids.length), 0), rows, searching: bazaarSearchInUse(list) };
}

/** Which row of the list a card is in (its index), or null. */
export function bazaarRowOf(read, el) {
    if (!read || !el) return null;
    const row = read.rows.find((r) => r.el === el || r.el.contains(el));
    return row ? row.index : null;
}
