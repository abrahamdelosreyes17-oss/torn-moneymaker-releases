/*
 * Reading listings out of the page the user is currently viewing.
 *
 * Rules this module exists to obey:
 *
 *  - Only the current page. Nothing here fetches a Torn page, ever.
 *  - Row-scoped. Name, price and quantity are read from specific cells inside
 *    one row element. V1 regexed a whole element's text and took the first
 *    `$` it found, which cheerfully paired one listing's name with another
 *    listing's price.
 *  - No guessing. When a row is genuinely ambiguous it is skipped and counted
 *    in the diagnostics, rather than reported as a confident wrong number.
 */

import { parseMoney, parseQuantity } from '../../core/parse.js';
import { findItemByName, findItemById } from '../../core/items.js';
import { resolveSelectors } from './selectors.js';

/** A price cell on its own, e.g. "$2,896". */
const SCAN_PRICE_ONLY = /^\$\s*[\d,]+(?:\.\d+)?$/;

/** How many text candidates to try when resolving a row's item name. */
const SCAN_MAX_NAME_CANDIDATES = 12;

function scanText(node) {
    if (!node) return '';
    const text = node.textContent || '';
    return text.trim();
}

/** First non-empty text among a list of selectors, searched within `row`. */
function firstText(row, selectors) {
    for (const selector of selectors || []) {
        let node;
        try {
            node = row.querySelector(selector);
        } catch {
            continue; // A malformed user override should not kill the scan.
        }
        if (!node) continue;

        if (node.tagName === 'IMG') {
            const alt = (node.getAttribute('alt') || '').trim();
            if (alt) return alt;
            continue;
        }

        const text = scanText(node);
        if (text) return text;
    }

    return '';
}

/**
 * Resolve the row's item via the name index.
 *
 * Every lookup is a Map hit - the ~1,500-name array that V1 rebuilt and
 * re-sorted inside its per-element loop is gone entirely.
 */
function resolveRowItem(row, cfg, index) {
    const direct = firstText(row, cfg.name);
    if (direct) {
        const hit = findItemByName(index, direct);
        if (hit) return hit;
    }

    // Fall back to short text fragments inside the row. Bounded, and every
    // candidate is an exact Map lookup, so this stays cheap.
    const candidates = [];

    const alt = row.querySelector('img[alt]');
    if (alt) candidates.push((alt.getAttribute('alt') || '').trim());

    const title = row.querySelector('[title]');
    if (title) candidates.push((title.getAttribute('title') || '').trim());

    const lines = (row.textContent || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 1 && line.length < 60);

    for (const line of lines) {
        candidates.push(line);
        if (candidates.length >= SCAN_MAX_NAME_CANDIDATES) break;
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        const hit = findItemByName(index, candidate);
        if (hit) return hit;
    }

    return null;
}

/**
 * Find the UNIT price.
 *
 * A real Item Market row shows the unit price and the line total; a bazaar
 * card can show a price next to other money. So "more than one price in the
 * row" is the normal case, not an error, and refusing to pick would mean the
 * scanner finds nothing on exactly the pages it exists for.
 *
 * Order of preference:
 *   1. A cell the selectors identify as the price. Unambiguous, done.
 *   2. If the quantity is known, a pair where one value is the other times
 *      the quantity - that is unit price and line total, and the smaller of
 *      the pair is the unit price. Also unambiguous.
 *   3. Otherwise the smallest price in the row, flagged `assumed`, because a
 *      line total can never be smaller than its own unit price.
 *
 * Returns { price, assumed }. `assumed` is surfaced in the panel so a guess
 * is never presented as a fact - V1's actual sin was not guessing, it was
 * guessing silently.
 */
function resolveRowPrice(row, cfg, qtyHint) {
    const labelled = firstText(row, cfg.price);
    if (labelled) {
        const price = parseMoney(labelled);
        if (Number.isFinite(price) && price > 0) {
            return { price, assumed: false };
        }
    }

    const priceCells = [];
    for (const node of row.querySelectorAll('*')) {
        if (node.children.length > 0) continue; // leaves only
        const text = scanText(node);
        if (!SCAN_PRICE_ONLY.test(text)) continue;

        const value = parseMoney(text);
        if (Number.isFinite(value) && value > 0) priceCells.push(value);
    }

    if (priceCells.length === 0) return { price: null, assumed: false };
    if (priceCells.length === 1) {
        return { price: priceCells[0], assumed: false };
    }

    if (Number.isFinite(qtyHint) && qtyHint > 1) {
        for (const unit of priceCells) {
            const expectedTotal = unit * qtyHint;
            const hasTotal = priceCells.some(
                (other) => Math.abs(other - expectedTotal) < 1,
            );
            if (hasTotal) return { price: unit, assumed: false };
        }
    }

    return { price: Math.min(...priceCells), assumed: true };
}

/** Quantity, plus whether we had to assume it. */
function resolveRowQty(row, cfg) {
    const labelled = firstText(row, cfg.qty);
    if (labelled) {
        const qty = parseQuantity(labelled);
        if (Number.isFinite(qty) && qty > 0) return { qty, assumed: false };
    }

    /*
     * Read LEAF elements, never the row's concatenated textContent.
     *
     * React emits no whitespace between sibling nodes, so a row's textContent
     * is "$2,89612 available" rather than "$2,896 12 available". Any regex
     * over that string is guessing: "2,89612" could be a price of 2,896 next
     * to a quantity of 12, or a quantity of 289,612, and nothing in the text
     * distinguishes them. Reading each leaf separately removes the ambiguity
     * instead of resolving it badly - which is the same mistake as V1's
     * whole-row price regex, just in a different column.
     */
    const patterns = [
        /(\d[\d,]*)\s*(?:available|in stock|left|remaining)/i,
        /(?:available|quantity|qty|amount|stock)\s*[:x]?\s*(\d[\d,]*)/i,
        /^\s*x\s*(\d[\d,]*)\s*$/i,
    ];

    for (const node of row.querySelectorAll('*')) {
        if (node.children.length > 0) continue; // leaves only

        const text = scanText(node);
        if (!text || text.length > 40) continue;

        // A leaf that is just a price is not a quantity.
        if (SCAN_PRICE_ONLY.test(text)) continue;

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (!match) continue;

            const qty = parseQuantity(match[1]);
            if (Number.isFinite(qty) && qty > 0) return { qty, assumed: false };
        }
    }

    return { qty: 1, assumed: true };
}

/** Drop candidates that contain another candidate: keep the innermost rows. */
function dropNestedRows(rows) {
    return rows.filter(
        (row) => !rows.some((other) => other !== row && row.contains(other)),
    );
}

/** Rows matching one selector, innermost only. */
export function collectRows(root, selector) {
    let found;
    try {
        found = Array.from(root.querySelectorAll(selector));
    } catch {
        return [];
    }

    return dropNestedRows(found);
}

/**
 * The item the WHOLE PAGE is about.
 *
 * The Item Market shows one item at a time: a header naming it, then seller
 * rows carrying only price, quantity and a Buy button. The item name is not
 * in the row, so a row-scoped name lookup finds nothing and every listing is
 * discarded. V1 got this right by reading the page heading; this restores it,
 * preferring the item id that is already sitting in the URL.
 *
 * @returns {object|null}
 */
export function resolvePageItem(root, index, href = '') {
    const byId = String(href).match(/itemID=(\d+)/i);
    if (byId) {
        const hit = findItemById(index, byId[1]);
        if (hit) return hit;
    }

    const headings = root.querySelectorAll(
        'h1, h2, h3, h4, [class*="title"], [class*="header"]',
    );

    for (const heading of headings) {
        const text = scanText(heading);
        if (!text || text.length > 80) continue;

        // Torn's heading reads "<item> Value"; try the bare text too.
        const candidates = [text.replace(/\s*value\s*$/i, ''), text];

        for (const candidate of candidates) {
            const hit = findItemByName(index, candidate);
            if (hit) return hit;
        }
    }

    return null;
}

/** Read every listing under one candidate selector. */
function extractListings(rows, cfg, index, pageType, pageItem) {
    const diagnostics = {
        rowsSeen: rows.length,
        noItem: 0,
        noPrice: 0,
        priceAssumed: 0,
        qtyAssumed: 0,
    };

    const listings = [];

    for (const row of rows) {
        // Row name first; fall back to the page's item where the layout puts
        // the name outside the row.
        const item = resolveRowItem(row, cfg, index) || pageItem;
        if (!item) {
            diagnostics.noItem += 1;
            continue;
        }

        // Quantity first: it is what lets the price resolver tell a unit
        // price from a line total.
        const { qty, assumed: qtyAssumed } = resolveRowQty(row, cfg);
        if (qtyAssumed) diagnostics.qtyAssumed += 1;

        const { price, assumed: priceAssumed } = resolveRowPrice(row, cfg, qty);
        if (!Number.isFinite(price) || price <= 0) {
            diagnostics.noPrice += 1;
            continue;
        }
        if (priceAssumed) diagnostics.priceAssumed += 1;

        listings.push({
            el: row,
            itemId: item.id,
            name: item.name,
            item,
            listingPrice: price,
            priceAssumed,
            qty,
            qtyAssumed,
            source: pageType,
        });
    }

    return { listings, diagnostics };
}

/**
 * Read every listing on the current page.
 *
 * @param {string} pageType - from detectPage()
 * @param {Document|Element} root
 * @param {object} ctx
 * @param {object} ctx.index - item index from buildItemIndex()
 * @param {object} [ctx.selectorOverrides]
 * @returns {{listings: Array, diagnostics: object}}
 */
export function scanDom(pageType, root, { index, selectorOverrides, href } = {}) {
    const cfg = resolveSelectors(pageType, selectorOverrides);

    const empty = {
        pageType,
        usedSelector: null,
        pageItem: null,
        rowsSeen: 0,
        noItem: 0,
        noPrice: 0,
        priceAssumed: 0,
        qtyAssumed: 0,
        listings: 0,
        candidates: [],
    };

    if (!cfg || !root || !index) return { listings: [], diagnostics: empty };

    const pageItem =
        pageType === 'itemmarket'
            ? resolvePageItem(root, index, href || '')
            : null;

    /*
     * Try every candidate selector and keep the one that PARSES the most
     * rows, not the first one that matches something.
     *
     * First-match-wins was a trap: a loose selector like `li[class*="item"]`
     * matches Torn's sidebar on most pages, so the search would stop there
     * and every "row" would fail to yield an item. Scoring by parsed rows
     * makes a wrong guess cost nothing.
     */
    let best = null;
    const candidates = [];

    for (const selector of cfg.rowSets || []) {
        const rows = collectRows(root, selector);
        if (rows.length === 0) continue;

        const { listings, diagnostics } = extractListings(
            rows,
            cfg,
            index,
            pageType,
            pageItem,
        );

        candidates.push({
            selector,
            rows: rows.length,
            parsed: listings.length,
        });

        if (!best || listings.length > best.listings.length) {
            best = { selector, listings, diagnostics };
        }
    }

    if (!best) {
        return {
            listings: [],
            diagnostics: { ...empty, pageItem: pageItem && pageItem.name },
        };
    }

    return {
        listings: best.listings,
        diagnostics: {
            ...empty,
            ...best.diagnostics,
            pageType,
            usedSelector: best.selector,
            pageItem: pageItem && pageItem.name,
            listings: best.listings.length,
            candidates,
        },
    };
}
