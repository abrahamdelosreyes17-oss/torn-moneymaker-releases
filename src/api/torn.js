/*
 * Thin wrappers over the Torn endpoints this tool uses. Every one of these
 * works with a Public access key - that is the point.
 */

/** Torn's access levels, lowest first. Public is all this tool needs. */
export const ACCESS_PUBLIC = 1;

export const ACCESS_LEVEL_NAMES = {
    1: 'Public',
    2: 'Minimal',
    3: 'Limited',
    4: 'Full',
};

/** The full item database. Public key. */
export async function fetchItems(client) {
    const data = await client.get('torn', { selections: 'items' });

    if (!data || !data.items) {
        throw new Error('Torn API returned no item database.');
    }

    return data.items;
}

/**
 * City shop inventories, used to build the NPC-sellable allowlist.
 *
 * The selection is `cityshops` and the response key is `cityshops`. An
 * earlier version of this file asked for `shops` and read `data.shops`, which
 * meant the call silently produced nothing, every item came back unverified,
 * and the panel reported "no opportunities" on a page full of them.
 *
 * `shops` is still accepted as a fallback in case the payload is ever served
 * under that key, but a response with neither throws rather than degrading
 * quietly.
 */
export async function fetchShops(client) {
    const data = await client.get('torn', { selections: 'cityshops' });

    const shops = data && (data.cityshops || data.shops);

    if (!shops) {
        throw new Error(
            'Torn API returned no city shop data (expected "cityshops").',
        );
    }

    return shops;
}

/**
 * What the current key can actually do.
 *
 * Used only to warn the user when they have pasted in a key with more access
 * than this tool needs. Written so that an unexpected payload shape means
 * "cannot tell" rather than a false alarm or a crash.
 *
 * @returns {{level: number|null, name: string|null}}
 */
export async function fetchKeyAccess(client) {
    try {
        const data = await client.get('key', { selections: 'info' });

        const level = Number(data && data.access_level);
        const name =
            (data && data.access_type) ||
            ACCESS_LEVEL_NAMES[level] ||
            null;

        return {
            level: Number.isFinite(level) ? level : null,
            name,
        };
    } catch {
        // The check is advisory. If it fails, say nothing rather than
        // blocking a key that is probably fine.
        return { level: null, name: null };
    }
}

/**
 * Item Market listings for one item: GET /v2/market/{id}/itemmarket.
 *
 * Public key. "Globally cached selection" - Torn serves everyone the same
 * snapshot and refreshes it no faster than `cache_delay` seconds (30 in every
 * observed response), so asking again before cache_timestamp + cache_delay
 * returns the same rows and only spends quota. The caller uses `nextAt` to
 * avoid that.
 *
 * The response names no seller and no listing id: a row is a price and an
 * amount. So an Item Market hit links to the item, never to a seller.
 *
 * @returns {Promise<{listings: Array<{price: number, amount: number}>,
 *   averagePrice: number|null, cacheTimestamp: number|null, nextAt: number,
 *   total: number}>} cacheTimestamp and nextAt in ms
 */
export async function fetchItemMarket(
    client,
    itemId,
    { limit = 20, offset = 0, now = Date.now() } = {},
) {
    const data = await client.get(
        'v2/market/' + encodeURIComponent(String(itemId)) + '/itemmarket',
        { limit, offset },
    );

    const market = (data && data.itemmarket) || {};
    const raw = Array.isArray(market.listings) ? market.listings : [];

    const cacheTs = Number(market.cache_timestamp);
    const cacheDelay = Number(market.cache_delay);
    const cacheTimestamp = Number.isFinite(cacheTs) && cacheTs > 0
        ? cacheTs * 1000
        : null;
    const delayMs = (Number.isFinite(cacheDelay) && cacheDelay > 0
        ? cacheDelay
        : 30) * 1000;

    const average = Number(market.item && market.item.average_price);

    return {
        listings: raw
            .map((l) => ({
                price: Number(l && l.price) || 0,
                amount: Number(l && (l.amount ?? l.quantity)) || 0,
            }))
            .filter((l) => l.price > 0 && l.amount > 0),
        averagePrice: Number.isFinite(average) && average > 0 ? average : null,
        cacheTimestamp,
        nextAt: (cacheTimestamp || now) + delayMs,
        total: Number(data && data._metadata && data._metadata.total) || raw.length,
    };
}
