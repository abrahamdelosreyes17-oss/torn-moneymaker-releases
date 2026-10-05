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
 *      getKey, and the only query it ever sends is `comment` and, since
 *      3.23.0, the whole numbers of W3B_QUERY (one: a count of hours) - a
 *      name not in that list, or a value that is not a whole number within
 *      its range, is dropped. The Torn client and this one share nothing.
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

/**
 * Every tab together (the feed's Torn tab, Torn Bids, Fill in other tabs):
 * each client's own ceiling only limits itself, so two of them made 84/min
 * against TornW3B's 100 per IP before TornTools asked for anything.
 */
export const W3B_SHARED_PER_MINUTE = 80;

/** After a 429 or a challenge page, stop asking for this long. */
export const W3B_COOLDOWN_MS = 60000;

/*
 * Torn Bids first (3.20.5, the owner: "when we're in Torn Bids, we prioritize
 * Torn Bids, not the NPC arbitrage"). The overlay on Torn's pages took up to
 * 59 of every tab's 80 reads a minute (the friend's zip); back on Torn Bids,
 * its flips had what was left of that minute. While Torn Bids is in use - in view now, or within the last
 * 5 minutes: a buying run goes back and forth - the overlay takes what
 * Torn Bids' 60 leave of the 80.
 */
export const W3B_BESIDE_BIDS_PER_MINUTE = W3B_SHARED_PER_MINUTE - W3B_MAX_PER_MINUTE;
export const W3B_BIDS_IN_USE_MS = 5 * 60 * 1000;

/**
 * The overlay's reads a minute, given when Torn Bids was last in view.
 * A time "from the future" (the clock was changed) is not believed.
 */
export function overlayPerMinute(bidsSeenAt, now = Date.now()) {
    const at = Number(bidsSeenAt) || 0;
    return at > 0 && at <= now + 60000 && now - at < W3B_BIDS_IN_USE_MS ? W3B_BESIDE_BIDS_PER_MINUTE : W3B_MAX_PER_MINUTE;
}

/*
 * What may ride in a query besides `comment` (3.23.0): an option of TornW3B's
 * own API, a whole number within the range the service takes. Checked on the
 * way out (buildUrl): nothing else can be put in, whoever calls.
 *
 *   tradedWithinHours  /marketplace/{id}/traders: only buyers who traded in
 *                      the last N hours (1-168)
 *
 * `maxPrice` on /marketplace/{id} (only the listings at or under a price) was
 * tried for 3.23.0 and is NOT sent. Measured on the bench (the scene "400
 * items read in turn", with their dearer rows and without): about 12 ms of a
 * 100-140 ms redraw with the processor slowed four times, less than two runs
 * of the same thing differ by - a read "in turn" already keeps only its 10
 * cheapest rows, and the redraw's time is the page, not the rows. And an item
 * with nothing under the trader's price would lose its lowest bazaar price.
 */
const W3B_QUERY = { tradedWithinHours: [1, 168] };

/** A whole number within [min, max], or null. */
function w3bWhole(value, min, max) {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

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
     * @param {function} [options.perMinute] - () => number: the ceiling right
     *   now, when it is lower than maxPerMinute (the overlay beside Torn Bids)
     * @param {function} [options.now]
     * @param {function} [options.loadShared] - () => {recent: number[], cooldownUntil}
     *   stored for every tab: one window across all of them, and a 429 seen
     *   by one tab stops them all.
     * @param {function} [options.saveShared] - (state) => void
     * @param {function} [options.addShared] - (at) => void: record one slot of
     *   THIS tab only (platform/tab-window.js), so tabs never overwrite each
     *   other's; without it the whole window is written back through saveShared
     * @param {number} [options.sharedPerMinute]
     * @param {function} [options.sleep] - (ms) => Promise; injectable for tests
     * @param {function} [options.isVisible] - () => boolean; nothing is sent
     *   from a hidden tab, even a request queued while it was visible
     */
    constructor({
        fetchImpl = gmFetch,
        maxPerMinute = W3B_MAX_PER_MINUTE,
        now = () => Date.now(),
        loadShared = null,
        saveShared = null,
        sharedPerMinute = W3B_SHARED_PER_MINUTE,
        sleep = w3bSleep,
        isVisible = () => true,
        addShared = null,
        onSent = null,
        onFailed = null,
        perMinute = null,
        onOver = null,
    } = {}) {
        this.perMinute = perMinute;
        /**
         * ({count, limit, own}) => void (3.23.0): the minute every tab shares was found OVER
         * sharedPerMinute - tabs learn of each other's requests late, so two can take the same
         * last slot. This tab waits, as always; the report is for the problem log.
         */
        this.onOver = onOver;
        /** ({path, tag}) => void, each request that leaves: the usage record (3.15). */
        this.onSent = onSent;
        /** ({path, tag, error}) => void, a request that failed: the problem log (3.15). */
        this.onFailed = onFailed;
        this.addShared = addShared;
        this.sleep = sleep;
        this.isVisible = isVisible;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.now = now;
        this.loadShared = loadShared;
        this.saveShared = saveShared;
        this.sharedPerMinute = sharedPerMinute;
        this.recent = [];
        this.chain = Promise.resolve();
        this.cooldownUntil = 0;
    }

    /** What every tab has used, and any wait one of them was told to make. */
    readShared(t) {
        const out = { recent: [], cooldownUntil: 0 };
        if (!this.loadShared) return out;
        let s;
        try {
            s = this.loadShared();
        } catch {
            return out;
        }
        if (!s || typeof s !== 'object') return out;
        if (Array.isArray(s.recent)) out.recent = s.recent.filter((x) => Number.isFinite(x) && t - x < 60000).sort((a, b) => a - b);
        if (Number.isFinite(Number(s.cooldownUntil))) out.cooldownUntil = Number(s.cooldownUntil);
        return out;
    }

    writeShared(state) {
        if (!this.saveShared) return;
        try {
            this.saveShared(state);
        } catch {
            // Sharing is best-effort; this tab still limits itself.
        }
    }

    /** The later of this tab's wait and any other tab's. */
    blockedUntil(t = this.now()) {
        return Math.max(this.cooldownUntil, this.readShared(t).cooldownUntil);
    }

    /** This tab's ceiling now: maxPerMinute, or less while perMinute() says so. Never under 1. */
    limit() {
        if (!this.perMinute) return this.maxPerMinute;
        let n;
        try {
            n = Number(this.perMinute());
        } catch {
            return this.maxPerMinute;
        }
        return Number.isFinite(n) ? Math.max(1, Math.min(this.maxPerMinute, Math.floor(n))) : this.maxPerMinute;
    }

    stats() {
        const t = this.now();
        const used = this.recent.filter((x) => t - x < 60000).length;
        return {
            usedLastMinute: used,
            remaining: Math.max(0, this.limit() - used),
            coolingDown: t < this.blockedUntil(t),
            sharedLastMinute: this.loadShared ? this.readShared(t).recent.length : used,
        };
    }

    async waitForSlot() {
        for (;;) {
            // Hidden: take no slot and send nothing until the tab is back.
            if (!this.isVisible()) {
                await this.sleep(1000);
                continue;
            }
            const t = this.now();
            this.recent = this.recent.filter((x) => t - x < 60000);
            const shared = this.readShared(t);
            const sharedFull = this.loadShared && shared.recent.length >= this.sharedPerMinute;
            const limit = this.limit();
            if (this.onOver && this.loadShared && shared.recent.length > this.sharedPerMinute) {
                try {
                    this.onOver({ count: shared.recent.length, limit: this.sharedPerMinute, own: this.recent.length });
                } catch {
                    // The report is best-effort.
                }
            }

            if (this.recent.length < limit && !sharedFull) {
                this.recent.push(t);
                if (this.addShared) {
                    try {
                        this.addShared(t);
                    } catch {
                        // Best-effort; this tab still limits itself.
                    }
                } else if (this.loadShared) {
                    this.writeShared({ ...shared, recent: [...shared.recent, t] });
                }
                return;
            }

            // Wait until every full window has a slot again.
            const frees = [];
            if (this.recent.length >= limit) frees.push(this.recent[this.recent.length - limit]);
            if (sharedFull) frees.push(shared.recent[shared.recent.length - this.sharedPerMinute]);
            await this.sleep(Math.max(50, 60000 - (t - Math.max(...frees)) + 25));
        }
    }

    /** Stop asking - this tab and, through storage, every other. */
    coolDown() {
        const t = this.now();
        this.cooldownUntil = t + W3B_COOLDOWN_MS;
        if (this.loadShared) this.writeShared({ ...this.readShared(t), cooldownUntil: this.cooldownUntil });
    }

    /** Build and check a URL. Exposed for tests. `query`: W3B_QUERY's options only. */
    buildUrl(path, query = null) {
        const url = new URL(String(path).replace(/^\/+/, ''), W3B_API_BASE);

        if (url.hostname !== W3B_HOST) {
            throw new W3bError('Refusing to contact ' + url.hostname + '.');
        }

        // Nothing but an attribution comment ever goes in the query - and the whole number of W3B_QUERY.
        url.search = '';
        url.searchParams.set('comment', 'TornTradingV2');
        for (const [name, [min, max]] of Object.entries(W3B_QUERY)) {
            const n = query && Object.prototype.hasOwnProperty.call(query, name) ? w3bWhole(query[name], min, max) : null;
            if (n !== null) url.searchParams.set(name, String(n));
        }

        return url;
    }

    /** GET one TornW3B path. Serialised, rate-limited, never keyed. `tag`: what it is for (the usage record). */
    get(path, { tag = null, query = null } = {}) {
        const run = () => this.execute(path, tag, query).catch((error) => {
            if (this.onFailed) {
                try {
                    this.onFailed({ path, tag, error });
                } catch {
                    // The log is best-effort.
                }
            }
            throw error;
        });
        const promise = this.chain.catch(() => {}).then(run);
        this.chain = promise.catch(() => {});
        return promise;
    }

    async execute(path, tag = null, query = null) {
        if (this.now() < this.blockedUntil()) {
            throw new W3bError('TornW3B is rate limiting us; paused briefly.', {
                blocked: true,
            });
        }

        const url = this.buildUrl(path, query);
        await this.waitForSlot();
        // Another tab may have been blocked while this one waited for a slot.
        if (this.now() < this.blockedUntil()) {
            throw new W3bError('TornW3B is rate limiting us; paused briefly.', {
                blocked: true,
            });
        }

        if (this.onSent) {
            try {
                this.onSent({ path, tag });
            } catch {
                // The usage record is best-effort.
            }
        }

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new W3bError(
                'TornW3B network error: ' + ((error && error.message) || error),
            );
        }

        if (response.status === 429) {
            this.coolDown();
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
            this.coolDown();
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
export async function fetchW3bSummary(client, { tag = 'w.summary' } = {}) {
    const data = await client.get('marketplace', { tag });
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
 * known mid-scan glitch. `maxPrice` is deliberately NOT sent (see W3B_QUERY:
 * measured for 3.23.0, it did not help) - every listing is asked for.
 *
 * @returns {Promise<{listings: Array, total: number}>} raw listing objects
 */
export async function fetchW3bListings(client, itemId, { tag = null } = {}) {
    const path = 'marketplace/' + encodeURIComponent(String(itemId));

    let data = await client.get(path, { tag });

    const empty = (d) =>
        d &&
        Number(d.total_listings) > 0 &&
        Array.isArray(d.listings) &&
        d.listings.length === 0;

    if (empty(data)) data = await client.get(path, { tag });

    return {
        listings: data && Array.isArray(data.listings) ? data.listings : [],
        total: Number(data && data.total_listings) || 0,
    };
}

/**
 * Every TornW3B buyer of one item (3.15): GET /api/marketplace/{id}/traders,
 * highest price first, at most 100 (`total_count` says how many there are:
 * 412 for Xanax on 2026-09-29, against ~290 lists we had read). Each comes
 * with their rating and when they were last active - free, where a Torn
 * profile call per trader cost the shared 70/min.
 *
 * `withinHours` (3.23.0): only those who traded in the last N hours are
 * asked for (`tradedWithinHours`) - the 100 of the answer are then not spent
 * on lists nobody trades on. `withinHours` in the answer says what was asked.
 *
 * @returns {Promise<{total: number, withinHours: number|null, traders: Array<{id, name, price, up, down, lastAction, lastTrade, listAt}>}>}
 */
export async function fetchW3bItemTraders(client, itemId, { tag = 'w.buyers', withinHours = null } = {}) {
    const hours = w3bWhole(withinHours, ...W3B_QUERY.tradedWithinHours);
    const data = await client.get('marketplace/' + encodeURIComponent(String(itemId)) + '/traders', { tag, query: hours ? { tradedWithinHours: hours } : null });
    const rows = data && Array.isArray(data.traders) ? data.traders : [];
    const sec = (x) => (Number(x) > 0 ? Number(x) * 1000 : null);
    return {
        total: Number(data && data.total_count) || rows.length,
        withinHours: hours,
        traders: rows
            .filter((t) => t && Number(t.player_id) > 0 && Number(t.price) > 0)
            .map((t) => ({
                id: String(t.player_id),
                name: t.player_name ? String(t.player_name) : null,
                price: Number(t.price),
                up: t.rating && Number.isFinite(Number(t.rating.upvotes)) ? Number(t.rating.upvotes) : null,
                down: t.rating && Number.isFinite(Number(t.rating.downvotes)) ? Number(t.rating.downvotes) : null,
                lastAction: sec(t.last_action),
                lastTrade: sec(t.last_trade),
                listAt: sec(t.pricelist_updated),
            })),
    };
}

/** A trader's price list, as a person sees it on TornW3B. */
export function w3bPriceListUrl(traderId) {
    return W3B_SITE_URL + '/pricelist/' + encodeURIComponent(String(traderId));
}

/**
 * One trader's TornW3B price list: GET /api/pricelist/{tornId}, which returns
 * [{itemId, name, buyPrice, ...}] (buyPrice 0 = not buying). A player with no
 * list gets [] or a 404; both come back as an empty body, not an error.
 *
 * @returns {Promise<Array>} the raw rows (see parseW3bPriceList)
 */
export async function fetchW3bPriceList(client, traderId) {
    const id = String(traderId).replace(/\D/g, '');
    if (!id) throw new W3bError('No trader id.');
    try {
        const body = await client.get('pricelist/' + id);
        return Array.isArray(body) ? body : [];
    } catch (error) {
        if (error && error.http === 404) return [];
        throw error;
    }
}

function positiveOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}
