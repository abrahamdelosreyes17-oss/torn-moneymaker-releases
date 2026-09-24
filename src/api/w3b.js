/*
 * TornW3B (weav3r.dev) - the crowd-sourced bazaar price feed.
 *
 * Torn's API has no per-listing bazaar prices a Public key can trust (the
 * `user -> bazaar` selection can be served days old on a Public key, and the
 * `market -> bazaar` selection is a directory with no prices). TornW3B polls
 * bazaars with keys their SELLERS donated, for their own bazaar only, and
 * publishes the result. TornTools, TornPDA and Weav3r's own script read it.
 *
 * Non-negotiables, enforced here rather than by convention:
 *
 *   1. This client NEVER sees a Torn API key. It has no key parameter, no
 *      getKey, and the only query it ever sends is `comment`. The Torn client
 *      and this one share nothing.
 *   2. weav3r.dev is the only destination - asserted on the resolved URL, not
 *      just implied by a constant, exactly as client.js does for api.torn.com.
 *   3. Its own sliding window, well under TornW3B's 100/min Cloudflare limit,
 *      and a hard cooldown on 429 or a non-JSON (Cloudflare challenge) body.
 *
 * Responses are cached server-side for 60s, so asking faster is pointless.
 */

import { gmFetch } from '../platform/gm.js';

export const W3B_API_BASE = 'https://weav3r.dev/api/';
export const W3B_HOST = 'weav3r.dev';
export const W3B_TERMS_URL = 'https://weav3r.dev/terms-of-service';
export const W3B_SITE_URL = 'https://weav3r.dev';

/** TornW3B enforces 100/min per IP; leave 40 for TornTools and friends. */
export const W3B_MAX_PER_MINUTE = 60;

/** After a 429 or a challenge page, stop asking for this long. */
export const W3B_COOLDOWN_MS = 60000;

export class W3bError extends Error {
    constructor(message, { http = null, blocked = false } = {}) {
        super(message);
        this.name = 'W3bError';
        this.http = http;
        this.blocked = blocked;
    }
}

function w3bSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class W3bClient {
    /**
     * @param {object} [options]
     * @param {function} [options.fetchImpl] - injectable for tests
     * @param {number} [options.maxPerMinute]
     * @param {function} [options.now]
     */
    constructor({
        fetchImpl = gmFetch,
        maxPerMinute = W3B_MAX_PER_MINUTE,
        now = () => Date.now(),
    } = {}) {
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.now = now;
        this.recent = [];
        this.chain = Promise.resolve();
        this.cooldownUntil = 0;
    }

    stats() {
        const t = this.now();
        const used = this.recent.filter((x) => t - x < 60000).length;
        return {
            usedLastMinute: used,
            remaining: Math.max(0, this.maxPerMinute - used),
            coolingDown: t < this.cooldownUntil,
        };
    }

    async waitForSlot() {
        for (;;) {
            const t = this.now();
            this.recent = this.recent.filter((x) => t - x < 60000);

            if (this.recent.length < this.maxPerMinute) {
                this.recent.push(t);
                return;
            }

            await w3bSleep(Math.max(50, 60000 - (t - this.recent[0]) + 25));
        }
    }

    /** Build and check a URL. Exposed for tests. */
    buildUrl(path) {
        const url = new URL(String(path).replace(/^\/+/, ''), W3B_API_BASE);

        if (url.hostname !== W3B_HOST) {
            throw new W3bError('Refusing to contact ' + url.hostname + '.');
        }

        // Nothing but an attribution comment ever goes in the query.
        url.search = '';
        url.searchParams.set('comment', 'TornTradingV2');

        return url;
    }

    /** GET one TornW3B path. Serialised, rate-limited, never keyed. */
    get(path) {
        const run = () => this.execute(path);
        const promise = this.chain.catch(() => {}).then(run);
        this.chain = promise.catch(() => {});
        return promise;
    }

    async execute(path) {
        if (this.now() < this.cooldownUntil) {
            throw new W3bError('TornW3B is rate limiting us; paused briefly.', {
                blocked: true,
            });
        }

        const url = this.buildUrl(path);
        await this.waitForSlot();

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new W3bError(
                'TornW3B network error: ' + ((error && error.message) || error),
            );
        }

        if (response.status === 429) {
            this.cooldownUntil = this.now() + W3B_COOLDOWN_MS;
            throw new W3bError('TornW3B rate limit (429).', {
                http: 429,
                blocked: true,
            });
        }

        if (!response.ok) {
            throw new W3bError('TornW3B HTTP ' + response.status, {
                http: response.status,
            });
        }

        try {
            return await response.json();
        } catch {
            // Cloudflare answers a challenge page with HTML, not JSON.
            this.cooldownUntil = this.now() + W3B_COOLDOWN_MS;
            throw new W3bError('TornW3B returned a non-JSON page (blocked?).', {
                blocked: true,
            });
        }
    }
}

/**
 * Cheapest bazaar price for every item, in one request.
 *
 * @returns {Promise<Array<{itemId: string, name: string, lowestPrice: number|null,
 *   marketPrice: number|null, bazaarAverage: number|null, totalBazaars: number}>>}
 */
export async function fetchW3bSummary(client) {
    const data = await client.get('marketplace');
    const items = data && Array.isArray(data.items) ? data.items : null;

    if (!items) throw new W3bError('TornW3B returned no item summary.');

    return items
        .filter((i) => i && Number.isFinite(Number(i.item_id)))
        .map((i) => ({
            itemId: String(i.item_id),
            name: i.item_name || '',
            lowestPrice: positiveOrNull(i.lowest_price),
            marketPrice: positiveOrNull(i.market_price),
            bazaarAverage: positiveOrNull(i.bazaar_average),
            totalBazaars: Number(i.total_bazaars) || 0,
        }));
}

/**
 * Every bazaar listing TornW3B knows for one item.
 *
 * Retries once when the payload says there are listings but sends none - a
 * known mid-scan glitch. `maxPrice` and friends are deliberately NOT sent:
 * they are not in TornW3B's spec, TornTools filters client-side anyway, and
 * trusting an ignored filter is how a list fills with rows that are not deals.
 *
 * @returns {Promise<{listings: Array, total: number}>} raw listing objects
 */
export async function fetchW3bListings(client, itemId) {
    const path = 'marketplace/' + encodeURIComponent(String(itemId));

    let data = await client.get(path);

    const empty = (d) =>
        d &&
        Number(d.total_listings) > 0 &&
        Array.isArray(d.listings) &&
        d.listings.length === 0;

    if (empty(data)) data = await client.get(path);

    return {
        listings: data && Array.isArray(data.listings) ? data.listings : [],
        total: Number(data && data.total_listings) || 0,
    };
}

function positiveOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}
