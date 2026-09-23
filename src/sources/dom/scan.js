/*
 * Reading listings out of the page the user is currently viewing.
 *
 * The strategy changed once real markup was in hand. Instead of guessing a
 * row selector and then digging for the name, price and quantity inside it,
 * the scanner now works from two things Torn states explicitly:
 *
 *   - the item image, whose path carries the item id (/images/items/206/)
 *   - the buy control's ARIA label, which carries the name, the price and the
 *     quantity in one structured string
 *
 * That removes every guess that made the previous version fail: no name
 * matching, no "first $ in the row", no distinguishing a unit price from a
 * line total, no deciding whether "in stock" or "available" is the magic
 * word. Where Torn tells us, we read; where it does not, we say so.
 *
 * Rules this module obeys:
 *   - Only the current page. Nothing here fetches a Torn page, ever.
 *   - No guessing. An unreadable row is counted in the diagnostics, not
 *     reported as a confident wrong number.
 */

import { parseMoney, parseQuantity } from '../../core/parse.js';
import { findItemById, findItemByName } from '../../core/items.js';
import {
    resolveSelectors,
    ITEM_IMAGE_ID_RE,
    BUY_LABEL_FULL_RE,
    BUY_LABEL_NAME_RE,
} from './selectors.js';

/** A leaf whose entire text is a price, e.g. "$2,896". */
const SCAN_PRICE_ONLY = /^\$\s*[\d,]+(?:\.\d+)?$/;

/** "( 5,931 in stock)" - the aggregate Item Market list view. */
const SCAN_IN_STOCK_RE = /\(?\s*([\d,]+)\s*in\s+stock/i;

/** How far up from an item image a listing container may sit. */
const SCAN_MAX_CLIMB = 8;

function scanText(node) {
    if (!node) return '';
    return (node.textContent || '').trim();
}

/**
 * The item id from an image path.
 *
 * `/images/items/206/large.png` -> "206". This is the single most reliable
 * identifier on the page: it does not depend on spelling, casing, pluralisation
 * or Torn's display formatting, and it cannot be confused with another item.
 */
export function itemIdFromImage(img) {
    if (!img) return null;

    const src =
        img.getAttribute('src') || img.getAttribute('srcset') || '';

    const match = src.match(ITEM_IMAGE_ID_RE);
    return match ? match[1] : null;
}

/**
 * Parse Torn's buy-control ARIA label.
 *
 * Two observed forms:
 *   "Buy item Hammer, $100, 1 in total."  -> name, price and quantity
 *   "Buy: Xanax"                          -> name only
 *
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
    if (bare) {
        return { name: bare[1].trim(), price: null, qty: null };
    }

    return null;
}

/**
 * Snap from an item image up to the element representing ONE listing.
 *
 * The guard that matters: as soon as a candidate ancestor contains more than
 * one item image we have climbed into a container holding several listings,
 * and must stop. Without that guard this is exactly the V1 bug where a parent
 * holding eight cards got paired with one price.
 */
export function findCard(img, cfg) {
    const preferred = img.closest(cfg.card);
    if (
        preferred &&
        preferred.querySelectorAll(cfg.itemImage).length === 1
    ) {
        return preferred;
    }

    let node = img.parentElement;
    let best = null;

    for (let depth = 0; depth < SCAN_MAX_CLIMB && node; depth += 1) {
        if (node.querySelectorAll(cfg.itemImage).length > 1) break;

        best = node;

        const hasBuy = node.querySelector(cfg.buyControl);
        const hasPrice = /\$\s*[\d,]/.test(node.textContent || '');

        if (hasBuy || hasPrice) return node;

        node = node.parentElement;
    }

    return best;
}

/** Fallback price: a leaf cell that is nothing but a price. */
function fallbackPrice(card, cfg) {
    for (const selector of cfg.price || []) {
        let node;
        try {
            node = card.querySelector(selector);
        } catch {
            continue;
        }
        if (!node) continue;

        const value = parseMoney(scanText(node));
        if (Number.isFinite(value) && value > 0) {
            return { price: value, assumed: false };
        }
    }

    const cells = [];
    for (const node of card.querySelectorAll('*')) {
        if (node.children.length > 0) continue;

        const text = scanText(node);
        if (!SCAN_PRICE_ONLY.test(text)) continue;

        const value = parseMoney(text);
        if (Number.isFinite(value) && value > 0) cells.push(value);
    }

    if (cells.length === 0) return { price: null, assumed: false };
    if (cells.length === 1) return { price: cells[0], assumed: false };

    // Several prices and nothing to disambiguate them: the lowest is the only
    // one that cannot be a line total, but flag it as inferred.
    return { price: Math.min(...cells), assumed: true };
}

/** Fallback quantity: "( 5,931 in stock)". */
function fallbackQty(card) {
    const match = (card.textContent || '').match(SCAN_IN_STOCK_RE);
    if (match) {
        const qty = parseQuantity(match[1]);
        if (Number.isFinite(qty) && qty > 0) return { qty, assumed: false };
    }

    return { qty: 1, assumed: true };
}

/** Resolve the catalogue entry for a card, by id first and name only after. */
function resolveItem(card, img, index, buy) {
    const id = itemIdFromImage(img);
    if (id) {
        const byId = findItemById(index, id);
        if (byId) return byId;
    }

    const name =
        (buy && buy.name) || (img && img.getAttribute('alt')) || '';

    return findItemByName(index, name);
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
export function scanDom(pageType, root, { index, selectorOverrides } = {}) {
    const cfg = resolveSelectors(pageType, selectorOverrides);

    const diagnostics = {
        pageType,
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

    let images;
    try {
        images = Array.from(root.querySelectorAll(cfg.itemImage));
    } catch {
        return { listings: [], diagnostics };
    }

    diagnostics.images = images.length;

    const listings = [];
    const seen = new Set();

    for (const img of images) {
        const card = findCard(img, cfg);
        if (!card || seen.has(card)) continue;

        seen.add(card);
        diagnostics.cards += 1;

        const buyNode = card.querySelector(cfg.buyControl);
        const buy = buyNode
            ? parseBuyLabel(buyNode.getAttribute('aria-label'))
            : null;

        const item = resolveItem(card, img, index, buy);
        if (!item) {
            diagnostics.noItem += 1;
            continue;
        }

        let price = buy && buy.price;
        let priceAssumed = false;

        if (!Number.isFinite(price) || price <= 0) {
            const fallback = fallbackPrice(card, cfg);
            price = fallback.price;
            priceAssumed = fallback.assumed;
        }

        if (!Number.isFinite(price) || price <= 0) {
            diagnostics.noPrice += 1;
            continue;
        }

        let qty = buy && buy.qty;
        let qtyAssumed = false;

        if (!Number.isFinite(qty) || qty <= 0) {
            const fallback = fallbackQty(card);
            qty = fallback.qty;
            qtyAssumed = fallback.assumed;
        }

        if (buy && buy.price && buy.qty) diagnostics.fromAria += 1;
        if (priceAssumed) diagnostics.priceAssumed += 1;
        if (qtyAssumed) diagnostics.qtyAssumed += 1;

        listings.push({
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
        });
    }

    diagnostics.listings = listings.length;

    return { listings, diagnostics };
}
