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
 * Item Market listings for one item (Item Market 2.0, API v2).
 *
 * Phase 1 does not call this - the panel is fed from the page you are
 * viewing. It is here because it is the Phase 2 data source and it belongs
 * next to its siblings.
 */
export async function fetchItemMarket(client, itemId, { offset = 0 } = {}) {
    const data = await client.get('v2/market/' + encodeURIComponent(itemId), {
        selections: 'itemmarket',
        offset,
    });

    const listings =
        (data && data.itemmarket && data.itemmarket.listings) || [];

    return listings.map((listing) => ({
        id: listing.id ?? null,
        price: Number(listing.price) || 0,
        quantity: Number(listing.amount ?? listing.quantity) || 0,
    }));
}
