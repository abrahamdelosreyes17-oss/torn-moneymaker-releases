/*
 * Selectors, derived from Torn's ACTUAL markup (captured 2026-09-23) rather
 * than guessed at.
 *
 * The earlier version of this file invented names like `sellerRow___` and
 * `itemsList` from a description of the page. None of them existed, so the
 * scanner matched nothing and reported "no opportunities" on pages full of
 * them. Everything here is now taken from a real page dump.
 *
 * Two Item Market layouts were observed:
 *
 *   1. Aggregate list  - <div class="itemDescription___TknAN"
 *                             data-testid="item-description">
 *                        text: "Xanax $839,700 1% ( 5,931 in stock)"
 *                        buy control: aria-label="Buy: Xanax"
 *
 *   2. Seller listings - <div class="itemTile___gJeSo">
 *                        buy control:
 *                          aria-label="Buy item Hammer, $100, 1 in total."
 *
 * The hashed suffixes (`___gJeSo`) change whenever Torn rebuilds its
 * frontend, so nothing here matches on them exactly - only on the stable
 * prefix, on `data-testid`, or on ARIA, in that order of preference. ARIA and
 * test ids are semantic: Torn changes them far less often than class hashes,
 * and they are the reason this parser should survive a redesign.
 */

/** Every item image carries its item id in the path: /images/items/206/... */
export const ITEM_IMAGE_SELECTOR =
    'img[src*="/images/items/"], img[srcset*="/images/items/"]';

export const ITEM_IMAGE_ID_RE = /\/images\/items\/(\d+)\//;

/**
 * Torn's own buy control. Both observed phrasings:
 *   "Buy item Hammer, $100, 1 in total."
 *   "Buy: Xanax"
 */
export const BUY_CONTROL_SELECTOR =
    '[aria-label^="Buy item"], [aria-label^="Buy:"]';

/** The rich form, which carries name, price and quantity together. */
export const BUY_LABEL_FULL_RE =
    /^buy item\s+(.+?),\s*\$([\d,]+(?:\.\d+)?),\s*([\d,]+)\s*in total/i;

/** The bare form, which carries only the name. */
export const BUY_LABEL_NAME_RE = /^buy(?:\s+item)?:?\s+(.+?)\.?$/i;

/**
 * Candidate card containers, tightest first. Used to snap from an item image
 * up to the element that represents one listing.
 */
export const CARD_SELECTOR = [
    '[class*="itemTile"]',
    '[data-testid="item-description"]',
    '[class*="itemDescription"]',
    '[class*="sellerRow"]',
    '[class*="listItem"]',
    'li',
].join(', ');

export const DEFAULT_SELECTORS = {
    card: CARD_SELECTOR,
    itemImage: ITEM_IMAGE_SELECTOR,
    buyControl: BUY_CONTROL_SELECTOR,

    /* Fallbacks, only consulted when the ARIA label is absent. */
    price: ['[class*="price"]', '[class*="cost"]'],
    qty: ['[class*="quantity"]', '[class*="stock"]', '[class*="qty"]'],
};

/**
 * Merge user overrides over the defaults.
 *
 * Overrides are still supported so a Torn change can be worked around from
 * the settings panel without waiting for a new release.
 */
export function resolveSelectors(pageType, overrides) {
    const override = (overrides && (overrides[pageType] || overrides.all)) || {};

    return { ...DEFAULT_SELECTORS, ...override };
}
