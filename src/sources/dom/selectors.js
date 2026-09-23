/*
 * Row selectors for each page type.
 *
 * IMPORTANT: Torn's current UI ships hashed CSS module class names
 * (`sellerRow___a1B2c`), and those hashes change whenever Torn rebuilds its
 * frontend. Nothing here can be assumed stable, so:
 *
 *   - Selectors are substring matches on class names, not exact matches.
 *   - Each page type carries a LIST of candidate row selectors, tried in
 *     order; the first that yields usable rows wins.
 *   - The user can override the whole set from the panel's gear menu without
 *     editing the script, and `diagnose()` reports what matched so a broken
 *     selector is visible instead of silently returning zero opportunities.
 *
 * These lists are the part of the codebase most likely to need a one-line fix
 * after a Torn frontend update. That is by design - the fix should never need
 * to touch anything else.
 */

export const DEFAULT_SELECTORS = {
    bazaar: {
        rowSets: [
            'ul[class*="itemsList"] > li',
            'ul[class*="ItemList"] > li',
            'div[class*="bazaarItem"]',
            'li[class*="item___"]',
            '.bazaar-list > li',
            'ul.items-list > li',
        ],
        name: [
            '[class*="itemName"]',
            '[class*="name___"]',
            '.name',
            'img[alt]',
        ],
        price: [
            '[class*="price___"]',
            '[class*="itemPrice"]',
            '.price',
        ],
        qty: [
            '[class*="qty___"]',
            '[class*="quantity"]',
            '[class*="amount"]',
            '.qty',
        ],
    },

    itemmarket: {
        rowSets: [
            'div[class*="sellerRow"]',
            'ul[class*="sellerList"] > li',
            'div[class*="itemRow"]',
            'li[class*="item___"]',
        ],
        name: [
            '[class*="itemName"]',
            '[class*="name___"]',
            'img[alt]',
        ],
        price: [
            '[class*="price___"]',
            '[class*="cost"]',
            '.price',
        ],
        qty: [
            '[class*="available"]',
            '[class*="qty___"]',
            '[class*="quantity"]',
            '[class*="amount"]',
        ],
    },
};

/**
 * Merge user overrides over the defaults. An override supplies whole lists,
 * not entries, so a user can replace a broken selector set outright.
 */
export function resolveSelectors(pageType, overrides) {
    const base = DEFAULT_SELECTORS[pageType];
    if (!base) return null;

    const override = (overrides && overrides[pageType]) || {};

    return {
        rowSets: override.rowSets || base.rowSets,
        name: override.name || base.name,
        price: override.price || base.price,
        qty: override.qty || base.qty,
    };
}
