/*
 * TornExchange (tornexchange.com) - traders' published buy prices.
 *
 * TornExchange is where traders post "I buy X at $Y". Its API wants `?key=`
 * equal to the Torn API key the user last logged into TornExchange with
 * (main/api.py, require_api_key). So this client carries a key - but NEVER
 * the main one:
 *
 *   1. It is given its own key (Settings -> TornExchange), which main.js
 *      refuses to accept if it equals the main Torn key. The Torn client and
 *      this one share nothing.
 *   2. www.tornexchange.com is the only destination - asserted on the
 *      resolved URL, as client.js does for api.torn.com.
 *   3. Its rate limit is harsh: 10 requests a minute PER IP across the whole
 *      API, and every request over it doubles a penalty that can reach 48
 *      hours (rate_limit_exponential in main/api.py). So this client makes
 *      at most TE_MIN_GAP_MS between requests, never retries on its own, and
 *      after a 429 waits out the server's `retry_after` before asking again.
 *
 * One call, /api/all_best_listings, returns the top three buyers for EVERY
 * item (active traders with a non-negative score only). The server caches it
 * for 5 minutes; we ask every 30. /api/listings?item_id= lists every buyer
 * of one item (names and prices only, 20 a page), fetched only when the user
 * opens that item and kept for 30 minutes.
 */

import { gmFetch } from '../platform/gm.js';

export const TE_API_BASE = 'https://www.tornexchange.com/api/';
export const TE_HOST = 'www.tornexchange.com';
export const TE_SITE_URL = 'https://www.tornexchange.com';

/** A trader's public price list on TornExchange (accepts id or name). */
export function tePriceListUrl(traderId) {
    return TE_SITE_URL + '/prices/' + encodeURIComponent(String(traderId)) + '/';
}

/**
 * Never two requests closer than this, from any code path: at most 6 a
 * minute against TornExchange's 10, leaving room for its own site.
 */
export const TE_MIN_GAP_MS = 10000;

export class TeError extends Error {
    constructor(message, { http = null, retryAfterMs = 0, badKey = false, tooSoon = false } = {}) {
        super(message);
        this.name = 'TeError';
        this.http = http;
        this.retryAfterMs = retryAfterMs;
        this.badKey = badKey;
        /** Refused by this client for pacing, never sent: ask again later. */
        this.tooSoon = tooSoon;
    }
}

export class TeClient {
    /**
     * @param {object} options
     * @param {function} options.getKey      - () => the TornExchange key ('' = none)
     * @param {function} [options.fetchImpl] - injectable for tests
     * @param {function} [options.now]
     * @param {function} [options.loadState] - () => { lastRequestAt, blockedUntil }
     *   shared by every tab, so a reload or a second selling tab keeps the
     *   same pace and the same penalty wait as this one.
     * @param {function} [options.saveState] - (state) => void
     */
    constructor({ getKey, fetchImpl = gmFetch, now = () => Date.now(), loadState = null, saveState = null } = {}) {
        this.getKey = getKey || (() => '');
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.loadState = loadState;
        this.saveState = saveState;
        this.lastRequestAt = 0;
        this.blockedUntil = 0;
    }

    /** Adopt the shared state: the later of what this tab and storage know. */
    syncState() {
        if (!this.loadState) return;
        let shared;
        try {
            shared = this.loadState();
        } catch {
            return;
        }
        if (!shared || typeof shared !== 'object') return;
        const last = Number(shared.lastRequestAt);
        const blocked = Number(shared.blockedUntil);
        if (Number.isFinite(last) && last > this.lastRequestAt) this.lastRequestAt = last;
        if (Number.isFinite(blocked) && blocked > this.blockedUntil) this.blockedUntil = blocked;
    }

    persistState() {
        if (!this.saveState) return;
        try {
            this.saveState({ lastRequestAt: this.lastRequestAt, blockedUntil: this.blockedUntil });
        } catch {
            // Sharing is best-effort; this tab still paces itself.
        }
    }

    /** Build and check a URL. The key is attached here and nowhere else. */
    buildUrl(path, key) {
        const url = new URL(String(path).replace(/^\/+/, ''), TE_API_BASE);

        if (url.hostname !== TE_HOST) {
            throw new TeError('Refusing to contact ' + url.hostname + '.');
        }

        url.search = '';
        url.searchParams.set('key', key);
        return url;
    }

    /** When the next request may go, given the gap and any 429 wait. */
    nextAllowedAt() {
        this.syncState();
        return Math.max(this.blockedUntil, this.lastRequestAt + TE_MIN_GAP_MS);
    }

    async get(path, params = {}) {
        const key = String(this.getKey() || '').trim();
        if (!key) throw new TeError('No TornExchange key.', { badKey: true });

        this.syncState();
        const t = this.now();
        if (t < this.blockedUntil) {
            throw new TeError('TornExchange asked us to wait.', {
                http: 429,
                retryAfterMs: this.blockedUntil - t,
            });
        }
        if (t - this.lastRequestAt < TE_MIN_GAP_MS) {
            throw new TeError('Too soon to ask TornExchange again.', {
                retryAfterMs: TE_MIN_GAP_MS - (t - this.lastRequestAt),
                tooSoon: true,
            });
        }

        const url = this.buildUrl(path, key);
        for (const [name, value] of Object.entries(params || {})) {
            if (value !== undefined && value !== null && name !== 'key') {
                url.searchParams.set(name, String(value));
            }
        }
        this.lastRequestAt = t;
        this.persistState();

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            // The message never carries the URL, so never the key.
            throw new TeError('TornExchange network error.');
        }

        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (response.status === 429) {
            const seconds = Number(body && body.retry_after);
            const wait = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
            this.blockedUntil = this.now() + wait;
            this.persistState();
            throw new TeError('TornExchange rate limit - waiting ' + Math.ceil(wait / 1000) + 's.', {
                http: 429,
                retryAfterMs: wait,
            });
        }

        if (response.status === 401) {
            throw new TeError(
                'TornExchange did not accept the key. Log in at tornexchange.com ' +
                    'with this same key, then save it again.',
                { http: 401, badKey: true },
            );
        }

        if (!response.ok || !body) {
            throw new TeError('TornExchange HTTP ' + response.status + '.', {
                http: response.status,
            });
        }

        if (body.status && body.status !== 'success') {
            throw new TeError('TornExchange: ' + String(body.message || 'error') + '.');
        }

        return body;
    }
}

/**
 * The top three buyers for every item, highest price first.
 *
 * @returns {Promise<Map<string, Array<{name: string, id: string, price: number, score: number}>>>}
 */
export async function fetchTeBestListings(client) {
    return parseTeBestListings(await client.get('all_best_listings'));
}

/** Exposed for tests. Bad rows are dropped, never guessed. */
export function parseTeBestListings(body) {
    const data = body && body.data;
    if (!data || typeof data !== 'object') {
        throw new TeError('TornExchange returned no trader prices.');
    }

    const out = new Map();

    for (const [itemId, entry] of Object.entries(data)) {
        if (!/^\d+$/.test(itemId) || !entry || !Array.isArray(entry.traders)) continue;

        const traders = [];
        for (const t of entry.traders) {
            const id = String((t && t.trader_id) || '').replace(/\D/g, '');
            const price = Number(t && t.price);
            if (!id || !Number.isFinite(price) || price <= 0) continue;

            traders.push({
                name: typeof t.trader === 'string' && t.trader ? t.trader : 'Trader ' + id,
                id,
                price,
                score: Number(t.vote_score) || 0,
            });
        }

        if (traders.length) {
            traders.sort((a, b) => b.price - a.price);
            out.set(itemId, traders);
        }
    }

    return out;
}

/**
 * Every buyer of one item, highest price first: /api/listings?item_id=.
 * Names and prices only - the endpoint carries no trader id - and 20 a page;
 * up to `maxPages` pages are read. Each page is its own request, handed to
 * `schedule` (a TeQueue's enqueue) so pages go one per slot: asked directly,
 * page 2 would follow page 1 inside the gap and be refused.
 *
 * @returns {Promise<{traders: Array<{name: string, price: number}>, total: number, complete: boolean}>}
 */
export async function fetchTeListings(client, itemId, { maxPages = 3, schedule = (fn) => fn() } = {}) {
    const traders = [];
    let total = 0;
    let pages = 1;

    for (let page = 1; page <= maxPages && page <= pages; page += 1) {
        const body = await schedule(() =>
            client.get('listings', {
                item_id: String(itemId),
                sort_by: 'price',
                order: 'desc',
                page,
            }),
        );
        const parsed = parseTeListings(body);
        traders.push(...parsed.traders);
        total = parsed.total;
        pages = parsed.pages;
    }

    traders.sort((a, b) => b.price - a.price);
    return { traders, total, complete: pages <= maxPages };
}

/**
 * TornExchange calls one at a time, each in its own slot: the next runs no
 * sooner than the client's nextAllowedAt(), which includes the shared pace
 * and any 429 wait. A call the client refuses as too soon goes back to the
 * front of the line; anything else fails that call only. Nothing runs while
 * the tab is hidden.
 */
export class TeQueue {
    /**
     * @param {object} options
     * @param {TeClient} options.client
     * @param {function} [options.now]
     * @param {function} [options.setTimer]  - (fn, ms) => void; injectable for tests
     * @param {function} [options.isVisible] - () => boolean
     * @param {function} [options.onSettled] - (error|null) after every call
     */
    constructor({ client, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), isVisible = () => true, onSettled = () => {} }) {
        this.client = client;
        this.now = now;
        this.setTimer = setTimer;
        this.isVisible = isVisible;
        this.onSettled = onSettled;
        this.jobs = [];
        this.waiting = false;
    }

    get length() {
        return this.jobs.length;
    }

    /** @returns {Promise} what `fn` returns, once its slot has come. */
    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this.jobs.push({ fn, resolve, reject });
            this.run();
        });
    }

    run() {
        if (this.waiting || !this.jobs.length) return;
        this.waiting = true;
        const wait = Math.max(0, this.client.nextAllowedAt() - this.now());
        this.setTimer(() => this.step(), wait);
    }

    async step() {
        this.waiting = false;
        if (!this.isVisible()) {
            this.waiting = true;
            this.setTimer(() => {
                this.waiting = false;
                this.run();
            }, 5000);
            return;
        }
        // Another tab may have used the slot since the timer was set.
        if (this.client.nextAllowedAt() > this.now()) {
            this.run();
            return;
        }
        const job = this.jobs.shift();
        if (!job) return;
        try {
            const result = await job.fn();
            job.resolve(result);
            this.onSettled(null);
        } catch (error) {
            if (error && error.tooSoon) {
                this.jobs.unshift(job);
            } else {
                job.reject(error);
                this.onSettled(error);
            }
        }
        this.run();
    }
}

/** Exposed for tests. */
export function parseTeListings(body) {
    const data = body && body.data;
    if (!data || !Array.isArray(data.listings)) {
        throw new TeError('TornExchange returned no buyer list.');
    }

    const traders = [];
    for (const l of data.listings) {
        const price = Number(l && l.price);
        if (!l || typeof l.trader !== 'string' || !l.trader || !Number.isFinite(price) || price <= 0) continue;
        traders.push({ name: l.trader, price });
    }
    traders.sort((a, b) => b.price - a.price);

    const meta = data.meta || {};
    return {
        traders,
        total: Number(meta.total_listings) || traders.length,
        pages: Number(meta.total_pages) || 1,
    };
}

/**
 * Every active trader's name and Torn id: /api/active_traders. Used to give
 * a name from a buyer list its id (for the profile link and online status).
 * @returns {Promise<Map<string, string>>} lowercase name -> torn id
 */
export async function fetchTeActiveTraders(client) {
    return parseTeActiveTraders(await client.get('active_traders'));
}

export function parseTeActiveTraders(body) {
    const verbose = body && body.data && body.data.verbose;
    const out = new Map();
    if (!verbose || typeof verbose !== 'object') return out;
    for (const t of Object.values(verbose)) {
        const id = String((t && t.torn_id) || '').replace(/\D/g, '');
        if (t && typeof t.name === 'string' && t.name && id) out.set(t.name.toLowerCase(), id);
    }
    return out;
}
