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

function queryOf(href) {
    try {
        return new URL(href).searchParams;
    } catch {
        return new URLSearchParams();
    }
}

/**
 * Whose bazaar is this? `bazaar.php?userId=123`. Null for your own bazaar
 * (no userId) or anything unparseable - a sighting with no seller is simply
 * remembered without one.
 */
export function bazaarOwnerId(href) {
    if (detectPage(href) !== PAGE_BAZAAR) return null;

    const id = queryOf(href).get('userId') || queryOf(href).get('userid');
    return id && /^\d+$/.test(id) ? id : null;
}

/**
 * The listing a feed link asked us to point at: `ttItem` / `ttPrice`, which
 * bazaarUrl() in core/feed.js writes. Highlighting it is reading and marking
 * the page the user opened, which is allowed; nothing is clicked or filled.
 */
export function bazaarTarget(href) {
    if (detectPage(href) !== PAGE_BAZAAR) return null;

    const q = queryOf(href);
    const itemId = q.get('ttItem');
    const price = Number(q.get('ttPrice'));

    if (!itemId || !/^\d+$/.test(itemId)) return null;

    return {
        itemId,
        price: Number.isFinite(price) && price > 0 ? price : null,
    };
}

/**
 * Your OWN bazaar's add-listings (#/add) and manage-listings (#/manage)
 * pages: bazaar.php with no userId, and that hash. Anything else - another
 * player's bazaar, your own storefront - is null. The hash changes without a
 * page load, so callers re-check on hashchange.
 *
 * @returns {'add'|'manage'|null}
 */
export function ownBazaarPage(href) {
    if (typeof href !== 'string' || !href) return null;
    if (detectPage(href) !== PAGE_BAZAAR) return null;
    if (bazaarOwnerId(href)) return null;

    const hash = (href.split('#')[1] || '').toLowerCase().replace(/^\/+/, '').split(/[?&]/)[0];
    if (hash === 'add' || hash.startsWith('add/')) return 'add';
    if (hash === 'manage' || hash.startsWith('manage/')) return 'manage';
    return null;
}

/*
 * The selling page (Traders) in its own tab: Torn's home page with a marker the script
 * recognises, and covers with the page. The page itself is one the user
 * opened; the script draws over it and reads only the API.
 */
export const TRADERS_PAGE_PARAM = 'ttv2';
export const TRADERS_PAGE_VALUE = 'traders';

export function tradersPageUrl() {
    return 'https://www.torn.com/index.php?' + TRADERS_PAGE_PARAM + '=' + TRADERS_PAGE_VALUE;
}

export function isTradersPageUrl(href) {
    return queryOf(href).get(TRADERS_PAGE_PARAM) === TRADERS_PAGE_VALUE;
}
