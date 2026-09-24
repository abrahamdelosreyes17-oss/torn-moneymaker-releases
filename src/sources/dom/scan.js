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

/** "( 5,931 in stock)" - a market-wide total, NOT stock at this price. */
const IN_STOCK_RE = /\(?\s*([\d,]+)\s*in\s+stock/i;

/** "1,805 available" - one seller's stock, which IS at this price. */
const AVAILABLE_RE = /([\d,]+)\s*available/i;

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

/**
 * An element's OWN text: its direct text nodes, joined - never its
 * children's. This is a stricter form of "read leaves".
 *
 * A leaf-element rule misses a price that shares its element with a badge:
 * <p>$838,745<span>1%</span></p> has a child, so it is not a leaf, and its
 * full text "$838,7451%" reads as $8,387,451. Own text is "$838,745". It
 * also rejoins what React splits: {'$'}{price} renders two text nodes.
 */
export function ownText(node) {
    let out = '';
    for (const child of node.childNodes || []) {
        if (child.nodeType === 3) out += child.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
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

/*
 * A bazaar item the viewer cannot buy: Torn's $1 "Dollar Sale" lock. A $1
 * listing is open only to a random few percent of players (by ID); for
 * everyone else the card shows a red padlock, rendered as an element whose
 * class starts with isBlockedForBuying___. There is no seller-set lock, and
 * neither the Torn API nor TornW3B carries a lock flag - the page is the only
 * source, so the page is what is checked. Same selector TornTools uses for
 * its identical "cheaper than the NPC" highlight.
 *
 * Never inferred from a missing price: a card can lack a readable price for
 * other reasons, and that is reported as noPrice, not as locked.
 */
export const LOCKED_SELECTOR = '[class*="isBlockedForBuying"]';

/** Is this card (or the bazaar item tile around it) locked for the viewer? */
export function isLockedCard(card) {
    if (!card || typeof card.querySelector !== 'function') return false;
    if (card.matches && card.matches(LOCKED_SELECTOR)) return true;
    if (card.querySelector(LOCKED_SELECTOR)) return true;

    // The card found may be the description inside a bazaar tile, with the
    // padlock drawn elsewhere in the tile.
    const tile = card.closest && card.closest('[class*="item___"]');
    return Boolean(tile && tile !== card && tile.querySelector(LOCKED_SELECTOR));
}

/**
 * Read one card.
 * @returns {object|null}
 */
export function readCard(card, index, pageType) {
    // Locked first: never priced, never highlighted, whatever price it shows.
    if (isLockedCard(card)) return { skipped: 'locked' };

    const buyNode = card.querySelector(BUY_CONTROL_SELECTOR);
    const buy = buyNode
        ? parseBuyLabel(buyNode.getAttribute('aria-label'))
        : null;

    const item = resolveItem(card, index, buy);
    if (!item) return { skipped: 'noItem' };

    let marketTotal = null;

    const text = card.textContent || '';

    /*
     * Read LEAF elements, never the row's concatenated text.
     *
     * React emits no whitespace between sibling nodes, so a seller row's
     * textContent is "BCS605$6,9727 availableBUY". The price then parses as
     * $69,727 instead of $6,972 - wildly above any exit price, so the row is
     * judged unprofitable and never highlights, from a number that was never
     * on screen. Each leaf holds exactly one value, so reading leaves removes
     * the ambiguity instead of guessing at it.
     */
    const leaves = [];
    for (const node of card.querySelectorAll('*')) {
        const t = ownText(node);
        if (t) leaves.push(t);
    }

    const priceLeaf = leaves.find((t) => /^\$\s*[\d,]+(?:\.\d+)?$/.test(t));
    const qtyLeaf = leaves.find((t) => /^[\d,]+\s*available$/i.test(t));

    let price = buy && buy.price;
    let priceAssumed = false;

    if (!Number.isFinite(price) || price <= 0) {
        if (priceLeaf) {
            // A leaf that is nothing but a price is unambiguous.
            price = parseMoney(priceLeaf);
            priceAssumed = false;
        } else {
            /*
             * No dedicated price cell. Reading from text is only a guess when
             * there is more than one money figure to choose between; with
             * exactly one, it is the price.
             */
            const found = text.match(ALL_PRICES_RE) || [];

            price = found.length > 0 ? parseMoney(found[0]) : null;
            priceAssumed = found.length > 1;
        }
    }

    if (!Number.isFinite(price) || price <= 0) return { skipped: 'noPrice' };

    /*
     * Quantity, and crucially WHETHER IT IS AVAILABLE AT THIS PRICE.
     *
     * A category tile reports the market-wide total across every seller
     * ("694,057 in total", "5,931 in stock") while showing only the CHEAPEST
     * price. Multiplying the two is nonsense: of 694,057 Gasoline, only 1,805
     * are at $424 - the next seller wants $520. Doing that produced a
     * confident "+$3.58m" for a trade that does not exist.
     *
     * A seller row ("1,805 available") is the one case where the quantity
     * really is available at the stated price.
     */
    let qty = null;
    let qtyAtPrice = false;
    let qtyAssumed = false;

    if (qtyLeaf) {
        qty = parseQuantity(qtyLeaf);
        qtyAtPrice = Number.isFinite(qty) && qty > 0;
    } else {
        const available = text.match(AVAILABLE_RE);
        if (available) {
            qty = parseQuantity(available[1]);
            qtyAtPrice = Number.isFinite(qty) && qty > 0;
        }
    }

    /*
     * On a BAZAAR, "(390 in stock)" is this one seller's stock, all at the
     * one price shown - a bazaar has a single price per item. Only on the
     * Item Market's category tiles is "in stock" a market-wide total. Reading
     * it as a total everywhere left every bazaar row "qty unknown".
     */
    if (!qtyAtPrice && pageType === 'bazaar' && !(buy && buy.qty)) {
        const inStock = leaves
            .map((t) => t.match(IN_STOCK_RE))
            .find(Boolean) || text.match(IN_STOCK_RE);

        if (inStock) {
            qty = parseQuantity(inStock[1]);
            qtyAtPrice = Number.isFinite(qty) && qty > 0;
        }
    }

    if (!qtyAtPrice) {
        // Market-wide totals are context, never a multiplier.
        const total = buy && buy.qty ? buy.qty : null;
        const inStock = text.match(IN_STOCK_RE);

        marketTotal =
            total || (inStock ? parseQuantity(inStock[1]) : null) || null;

        qty = 1;
        qtyAssumed = true;
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
        qtyAtPrice,
        qtyAssumed,
        marketTotal,
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
        locked: 0,
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
            if (result && result.skipped === 'locked') diagnostics.locked += 1;
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
