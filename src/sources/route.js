/*
 * Which Torn page are we on? Pure string work, so it is testable.
 *
 * V1 ran both scanners on every page under `@match .../*`, which is why it
 * lit up on the Items page and in city shops. Here exactly one scanner runs,
 * and on an unrecognised page nothing runs at all.
 */

export const PAGE_BAZAAR = 'bazaar';
export const PAGE_ITEM_MARKET = 'itemmarket';
export const PAGE_NONE = null;

/**
 * @param {string} href - normally location.href
 * @returns {'bazaar'|'itemmarket'|null}
 */
export function detectPage(href) {
    if (typeof href !== 'string' || !href) return PAGE_NONE;

    const url = href.toLowerCase();

    // Item Market 2.0 lives behind page.php?sid=ItemMarket; imarket.php is
    // the older path and still redirects for some users.
    if (url.includes('sid=itemmarket') || url.includes('/imarket.php')) {
        return PAGE_ITEM_MARKET;
    }

    // Own bazaar and other players' bazaars, new path and legacy query form.
    if (url.includes('/bazaar.php') || url.includes('page=bazaar')) {
        return PAGE_BAZAAR;
    }

    return PAGE_NONE;
}

/**
 * Deep link to an item's Item Market page.
 *
 * Used by the panel's navigate button. One click, one navigation - the script
 * never buys anything and never chains a second request off the same click.
 */
export function itemMarketUrl(itemId, itemName) {
    const params = new URLSearchParams({
        itemID: String(itemId),
        itemName: String(itemName || ''),
    });

    return (
        'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&' +
        params.toString()
    );
}
