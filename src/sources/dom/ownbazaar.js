/*
 * Reading the rows of YOUR OWN bazaar's add-listings and manage-listings
 * pages. Selectors come from a working 2026 price-filler script for these
 * pages (the real markup has not been captured here, so the Tampermonkey
 * menu has a diagnostics readout saying what was found):
 *
 *   #/add     ul.items-cont li.clearfix, name in div.title-wrap div.name-wrap
 *   #/manage  div[data-testid="sortable-item"] or div[class*="row___"]
 *             (a virtualised list: rows mount and unmount as you scroll)
 *
 * The item id comes from the item image path (/images/items/{id}/), as the
 * market scanner does. Only the page you are viewing is read; nothing is
 * clicked, filled in or listed for you.
 */

import { itemIdFromImage, ITEM_IMAGE_SELECTOR } from './detect.js';
import { findItemById, findItemByName } from '../../core/items.js';

export const OWN_BAZAAR_ROW_SELECTORS = {
    add: 'ul.items-cont li.clearfix',
    manage: 'div[data-testid="sortable-item"], div[class*="row___"]',
};

export const OWN_BAZAAR_NAME_SELECTORS = {
    add: 'div.title-wrap div.name-wrap',
    manage: 'div[class*="item___"] div[class*="desc___"], div[class*="name___"], div[class*="title___"]',
};

/** Where the price tag goes in a row: after the name. */
export const OWN_BAZAAR_TAG_CLASS = 'ttv2-bztag';

function cleanText(node) {
    return ((node && node.textContent) || '').replace(/\s+/g, ' ').trim();
}

/**
 * Read every row on the page.
 *
 * @param {'add'|'manage'} which
 * @param {Document|Element} root
 * @param {object} index - item index
 * @returns {{rows: Array<{el, nameEl, itemId, name, item}>, diagnostics: object}}
 */
export function scanOwnBazaar(which, root, index) {
    const diagnostics = { page: which, rows: 0, withImage: 0, identified: 0, noItem: 0 };
    const rows = [];
    if (!root || !index || !OWN_BAZAAR_ROW_SELECTORS[which]) return { rows, diagnostics };

    const seen = new Set();
    for (const el of root.querySelectorAll(OWN_BAZAAR_ROW_SELECTORS[which])) {
        // The manage selectors can both match the same row.
        if (seen.has(el) || (el.closest && el.closest('#ttv2-host'))) continue;
        seen.add(el);
        diagnostics.rows += 1;

        const img = el.querySelector(ITEM_IMAGE_SELECTOR) || el.querySelector('img');
        const id = img ? itemIdFromImage(img) : null;
        if (id) diagnostics.withImage += 1;

        const nameEl = el.querySelector(OWN_BAZAAR_NAME_SELECTORS[which]);
        const nameText = cleanText(nameEl).replace(/\s*(x|×)\s*\d[\d,]*\s*$/i, '');
        const alt = img ? (img.getAttribute('alt') || '').trim() : '';

        const item =
            (id && findItemById(index, id)) ||
            findItemByName(index, nameText) ||
            findItemByName(index, alt) ||
            null;

        if (!item) {
            diagnostics.noItem += 1;
            continue;
        }

        diagnostics.identified += 1;
        rows.push({ el, nameEl: nameEl || el, itemId: item.id, name: item.name, item });
    }

    return { rows, diagnostics };
}

/**
 * The tag element in a row, created if missing. Text is set by the caller.
 * Paint-only: a span AFTER the name element (never inside it, so the name
 * still reads as the name on the next scan); never a form field, never a
 * click on Torn's controls. The row's item id is kept on the tag, so a
 * click reads the item of the row as it is NOW: #/manage is a virtualised
 * list whose row elements are reused for other items as you scroll.
 */
export function ensureRowTag(row, doc = document) {
    let tag = row.el.querySelector('.' + OWN_BAZAAR_TAG_CLASS);
    if (!tag) {
        tag = doc.createElement('span');
        tag.className = OWN_BAZAAR_TAG_CLASS;
        const nameEl = row.nameEl && row.nameEl !== row.el ? row.nameEl : null;
        if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(tag, nameEl.nextSibling);
        else row.el.appendChild(tag);
    }
    if (tag.dataset.itemId !== String(row.itemId)) tag.dataset.itemId = String(row.itemId);
    return tag;
}

export function removeRowTags(root = document) {
    for (const t of root.querySelectorAll('.' + OWN_BAZAAR_TAG_CLASS)) t.remove();
}
