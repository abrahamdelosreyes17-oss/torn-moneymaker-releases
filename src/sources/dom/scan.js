/*
 * Reading one listing card into numbers.
 *
 * Extraction order, most reliable first:
 *
 *   1. Torn's own buy-control ARIA label, which states everything outright:
 *        "Buy item Hammer, $100, 1 in total."
 *   2. The item image path, which carries the item id: /images/items/1/
 *   3. Text parsing, as a fallback: the first price, and "( N in stock)".
 *
 * Steps 1 and 2 were read off live Torn markup, so where they apply there is
 * no guessing at all. Step 3 exists because a layout that lacks both still
 * needs to work, and it is the approach already proven on live pages.
 */

import { parseMoney, parseQuantity } from '../../core/parse.js';
import { findItemById, findItemByName } from '../../core/items.js';
import { findCards, itemIdFromImage, ITEM_IMAGE_SELECTOR } from './detect.js';

/** "Buy item Hammer, $100, 1 in total." */
export const BUY_LABEL_FULL_RE =
    /^buy item\s+(.+?),\s*\$([\d,]+(?:\.\d+)?),\s*([\d,]+)\s*in total/i;

/** "Buy: Xanax" */
export const BUY_LABEL_NAME_RE = /^buy(?:\s+item)?:?\s+(.+?)\.?$/i;

export const BUY_CONTROL_SELECTOR =
    '[aria-label^="Buy item"], [aria-label^="Buy:"]';

/** "( 5,931 in stock)" */
const IN_STOCK_RE = /\(?\s*([\d,]+)\s*in\s+stock/i;

/** Every money figure in a block of text, in order. */
const ALL_PRICES_RE = /\$\s*[\d,]+(?:\.\d+)?/g;

/** Name cells, when the image alt is missing. */
const NAME_SELECTOR = '[class*="name___"], [class*="itemName"], .name';

/**
 * Parse Torn's buy-control ARIA label.
 * @returns {{name: string, price: number|null, qty: number|null}|null}
 */
export function parseBuyLabel(label) {
    if (typeof label !== 'string' || !label.trim()) return null;

    const text = label.trim();

    const full = text.match(BUY_LABEL_FULL_RE);
    if (full) {
        const price = parseMoney(full[2]);
        const qty = parseQuantity(full[3]);

        return {
            name: full[1].trim(),
            price: Number.isFinite(price) && price > 0 ? price : null,
            qty: Number.isFinite(qty) && qty > 0 ? qty : null,
        };
    }

    const bare = text.match(BUY_LABEL_NAME_RE);
    if (bare) return { name: bare[1].trim(), price: null, qty: null };

    return null;
}

function textOf(node) {
    if (!node) return '';
    return (node.textContent || '').trim();
}

/** The item name Torn shows on this card. */
function nameFromCard(card) {
    const img = card.querySelector('img[alt]');
    const alt = img ? (img.getAttribute('alt') || '').trim() : '';
    if (alt) return alt;

    const named = card.querySelector(NAME_SELECTOR);
    const text = textOf(named);

    return text && text.length < 80 ? text : '';
}

/** Catalogue lookup: by id where possible, by name only as a fallback. */
function resolveItem(card, index, buy) {
    const img = card.querySelector(ITEM_IMAGE_SELECTOR);
    const id = itemIdFromImage(img);

    if (id) {
        const byId = findItemById(index, id);
        if (byId) return byId;
    }

    const name = (buy && buy.name) || nameFromCard(card);
    return findItemByName(index, name);
}

/**
 * Read one card.
 * @returns {object|null}
 */
export function readCard(card, index, pageType) {
    const buyNode = card.querySelector(BUY_CONTROL_SELECTOR);
    const buy = buyNode
        ? parseBuyLabel(buyNode.getAttribute('aria-label'))
        : null;

    const item = resolveItem(card, index, buy);
    if (!item) return { skipped: 'noItem' };

    const text = card.textContent || '';

    let price = buy && buy.price;
    let priceAssumed = false;

    if (!Number.isFinite(price) || price <= 0) {
        /*
         * Reading the price from text is only a guess when there is more than
         * one money figure to choose between. With exactly one, it is the
         * price - and treating that as "assumed" meant the aggregate Item
         * Market view (which never carries a price in its ARIA label) had
         * every row filtered out of the ranking.
         */
        const found = text.match(ALL_PRICES_RE) || [];

        price = found.length > 0 ? parseMoney(found[0]) : null;
        priceAssumed = found.length > 1;
    }

    if (!Number.isFinite(price) || price <= 0) return { skipped: 'noPrice' };

    let qty = buy && buy.qty;
    let qtyAssumed = false;

    if (!Number.isFinite(qty) || qty <= 0) {
        const match = text.match(IN_STOCK_RE);
        qty = match ? parseQuantity(match[1]) : null;

        if (!Number.isFinite(qty) || qty <= 0) {
            qty = 1;
            qtyAssumed = true;
        }
    }

    return {
        el: card,
        buyEl: buyNode || null,
        itemId: item.id,
        name: item.name,
        item,
        listingPrice: price,
        priceAssumed,
        qty,
        qtyAssumed,
        source: pageType,
    };
}

/**
 * Read every listing on the current page.
 *
 * @param {string} pageType - from detectPage()
 * @param {Document|Element} root
 * @param {object} ctx
 * @param {object} ctx.index - item index from buildItemIndex()
 * @returns {{listings: Array, diagnostics: object}}
 */
export function scanDom(pageType, root, { index } = {}) {
    const diagnostics = {
        pageType,
        strategy: 'none',
        images: 0,
        cards: 0,
        fromAria: 0,
        noItem: 0,
        noPrice: 0,
        priceAssumed: 0,
        qtyAssumed: 0,
        listings: 0,
    };

    if (!root || !index) return { listings: [], diagnostics };

    const found = findCards(root);

    diagnostics.strategy = found.strategy;
    diagnostics.images = found.images;
    diagnostics.cards = found.cards.length;

    const listings = [];

    for (const card of found.cards) {
        const result = readCard(card, index, pageType);

        if (!result || result.skipped) {
            if (result && result.skipped === 'noItem') diagnostics.noItem += 1;
            if (result && result.skipped === 'noPrice') diagnostics.noPrice += 1;
            continue;
        }

        if (!result.priceAssumed && !result.qtyAssumed) {
            diagnostics.fromAria += 1;
        }
        if (result.priceAssumed) diagnostics.priceAssumed += 1;
        if (result.qtyAssumed) diagnostics.qtyAssumed += 1;

        listings.push(result);
    }

    diagnostics.listings = listings.length;

    return { listings, diagnostics };
}
