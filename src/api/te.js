/*
 * TornExchange (tornexchange.com) - traders' published buy prices.
 *
 * TornExchange is where traders post "I buy X at $Y". Its API wants `?key=`
 * equal to the Torn API key the user last logged into TornExchange with
 * (main/api.py, require_api_key). So this client carries a key - but NEVER
 * the main one:
 *
 *   1. It is given its own key (Settings -> TornExchange). It may equal the
 *      Limited key (TornExchange already has the key you log in there with),
 *      but main.js refuses the Ledger's Full key, and a key Torn says has
 *      Full access. The Torn client and this one share nothing.
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
    constructor(message, { http = null, retryAfterMs = 0, badKey = false, tooSoon = false, reason = null, said = null } = {}) {
        super(message);
        /** Why a call failed, for the pill's hover: 'no connection', 'no answer in 30 s'. */
        this.reason = reason;
        /** What TornExchange itself said, when it answered with an error. */
        this.said = said;
        this.name = 'TeError';
        this.http = http;
        this.retryAfterMs = retryAfterMs;
        this.badKey = badKey;
        /** Refused by this client for pacing, never sent: ask again later. */
        this.tooSoon = tooSoon;
    }
}

/**
 * The TornExchange pill's hover after a failed call (3.14.3): what went wrong,
 * so a failure can be told apart - theirs (down, slow, an HTTP error) or a
 * call of ours they refused. 3.14.2 said "did not answer" for all of them.
 * Never the key: a Torn key's 16 letters are blanked out of anything they said.
 */
export function teFailText(error) {
    const e = error || {};
    if (e.said) {
        const said = String(e.said).replace(/[A-Za-z0-9]{16}/g, '****').slice(0, 80);
        return 'TornExchange answered with an error: "' + said + '". Trying again soon.';
    }
    const why = e.reason || (e.http ? 'HTTP ' + e.http : null);
    return 'TornExchange did not answer' + (why ? ' (' + why + ')' : '') + '. Trying again soon.';
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
    constructor({ getKey, fetchImpl = gmFetch, now = () => Date.now(), loadState = null, saveState = null, onSent = null, onFailed = null } = {}) {
        /** ({path, tag, error}) => void, a request that failed (not "too soon"): the problem log (3.15). */
        this.onFailed = onFailed;
        /** ({path, tag}) => void, each request that leaves: the usage record (3.15). */
        this.onSent = onSent;
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
        if (key) url.searchParams.set('key', key);
        return url;
    }

    /** When the next request may go, given the gap and any 429 wait. */
    nextAllowedAt() {
        this.syncState();
        return Math.max(this.blockedUntil, this.lastRequestAt + TE_MIN_GAP_MS);
    }

    /**
     * @param {string} path
     * @param {object} [params]
     * @param {object} [options]
     * @param {boolean} [options.keyless] - an endpoint that needs no key
     *   (best_listing): sent without one, on the same shared pace.
     */
    async get(path, params = {}, options = {}) {
        try {
            return await this.request(path, params, options);
        } catch (error) {
            if (this.onFailed && !(error && error.tooSoon)) {
                try {
                    this.onFailed({ path, tag: options.tag || null, error });
                } catch {
                    // The log is best-effort.
                }
            }
            throw error;
        }
    }

    async request(path, params = {}, { keyless = false, tag = null } = {}) {
        const key = keyless ? '' : String(this.getKey() || '').trim();
        if (!key && !keyless) throw new TeError('No TornExchange key.', { badKey: true });

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
            // The message never carries the URL, so never the key.
            const timedOut = /timed out/i.test(String((error && error.message) || ''));
            throw new TeError(timedOut ? 'TornExchange timed out.' : 'TornExchange network error.', { reason: timedOut ? 'no answer in 30 s' : 'no connection' });
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
            // TornExchange says which: "Missing API key" or "Invalid API key"
            // (a key other than the one you last logged in there with).
            // Never a key on the page, even one TornExchange repeats back (review L12).
            const said = body && typeof body.message === 'string' ? body.message.replace(/[A-Za-z0-9]{16}/g, '****').slice(0, 60) : 'Invalid API key';
            throw new TeError(
                'TornExchange says "' + said + '". It only knows the key you last logged in there with: ' +
                    'log out of tornexchange.com, log in with this key, then Try again.',
                { http: 401, badKey: true },
            );
        }

        if (!response.ok || !body) {
            throw new TeError('TornExchange HTTP ' + response.status + '.', {
                http: response.status,
            });
        }

        if (body.status && body.status !== 'success') {
            throw new TeError('TornExchange: ' + String(body.message || 'error') + '.', { said: String(body.message || 'error') });
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
 * The best TornExchange buyer of one item, with no key: /api/best_listing.
 * TornExchange answers 400 "No listings found" for an item nobody buys; that
 * is null, not an error.
 *
 * @returns {Promise<{name: string, id: string, price: number}|null>}
 */
export async function fetchTeBestListing(client, itemId) {
    let body;
    try {
        body = await client.get('best_listing', { item_id: String(itemId) }, { keyless: true });
    } catch (error) {
        if (error && error.http === 400) return null;
        throw error;
    }
    return parseTeBestListing(body);
}

/** Exposed for tests. */
export function parseTeBestListing(body) {
    const d = body && body.data;
    const id = String((d && d.trader_id) || '').replace(/\D/g, '');
    const price = Number(d && d.price);
    if (!d || !id || !Number.isFinite(price) || price <= 0) return null;
    const out = { name: typeof d.trader === 'string' && d.trader ? d.trader : 'Trader ' + id, id, price };
    if (Number.isFinite(Number(d.vote)) && d.vote !== null) out.score = Number(d.vote);
    return out;
}

/**
 * One trader's WHOLE buy list: /api/prices/{torn id or name} (3.14.3, for
 * scanning your own traders - the top three per item miss most of it). The
 * key is the one you log into TornExchange with, as for every keyed call.
 * No list there (404 / 400): an empty list, not an error.
 *
 * @returns {Promise<{name: string|null, prices: Array<{itemId: string, price: number}>}>}
 */
export async function fetchTeTraderPrices(client, trader) {
    const who = String(trader || '').trim();
    if (!who || !/^[A-Za-z0-9_-]+$/.test(who)) throw new TeError('No trader to ask TornExchange about.');
    let body;
    try {
        body = await client.get('prices/' + encodeURIComponent(who));
    } catch (error) {
        // "Not found" in any form (a 404, a 400, or a normal answer saying so): no list, not a failure.
        if (error && (error.http === 404 || error.http === 400 || /not found|no (listings|prices|price list)|does not exist|unknown trader/i.test(String(error.said || '')))) return { name: null, prices: [] };
        throw error;
    }
    return parseTeTraderPrices(body);
}

/** Exposed for tests. Rows without an item id or a price are dropped, never guessed. */
export function parseTeTraderPrices(body) {
    const data = body && body.data;
    const items = data && Array.isArray(data.items) ? data.items : [];
    const prices = [];
    for (const it of items) {
        const itemId = String((it && it.item_id) || '').replace(/\D/g, '');
        const price = Number(it && it.price);
        if (!itemId || !Number.isFinite(price) || price <= 0) continue;
        prices.push({ itemId, price });
    }
    const meta = (body && body.meta) || (data && data.meta) || {};
    return { name: typeof meta.trader === 'string' && meta.trader ? meta.trader : null, prices };
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
export async function fetchTeListings(client, itemId, { maxPages = 3, schedule = (fn) => fn(), keepGoing = () => true } = {}) {
    const traders = [];
    let total = 0;
    let pages = 1;
    let read = 0;

    for (let page = 1; page <= maxPages && page <= pages; page += 1) {
        // 3.15: a later page is not asked for an item you have left, and one
        // that fails keeps the pages already read (they were thrown away).
        if (page > 1 && !keepGoing()) break;
        let body;
        try {
            body = await schedule(() =>
                client.get('listings', {
                    item_id: String(itemId),
                    sort_by: 'price',
                    order: 'desc',
                    page,
                }),
            );
        } catch (error) {
            if (page === 1) throw error;
            break;
        }
        const parsed = parseTeListings(body);
        traders.push(...parsed.traders);
        total = parsed.total;
        pages = parsed.pages;
        read = page;
    }

    traders.sort((a, b) => b.price - a.price);
    return { traders, total, complete: read >= pages };
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

    /** Nothing waiting and nothing on its way: room for a background read (3.15). */
    get idle() {
        return !this.jobs.length && !this.running;
    }

    /**
     * @param {function} fn
     * @param {{urgent?: boolean}} [opts] - urgent (the item you opened, 3.15): ahead of
     *   everything not urgent, instead of behind background reads
     * @returns {Promise} what `fn` returns, once its slot has come.
     */
    enqueue(fn, { urgent = false } = {}) {
        return new Promise((resolve, reject) => {
            const job = { fn, resolve, reject, urgent };
            if (urgent) {
                const at = this.jobs.findIndex((j) => !j.urgent);
                if (at < 0) this.jobs.push(job);
                else this.jobs.splice(at, 0, job);
            } else {
                this.jobs.push(job);
            }
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
        this.running = true;
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
        } finally {
            this.running = false;
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
    const out = new Map();
    for (const t of parseTeActiveTraderList(body)) out.set(t.name.toLowerCase(), t.id);
    return out;
}

/** Every active trader as {id, name}, the name as they wrote it. */
export function parseTeActiveTraderList(body) {
    const verbose = body && body.data && body.data.verbose;
    const out = [];
    if (!verbose || typeof verbose !== 'object') return out;
    for (const t of Object.values(verbose)) {
        const id = String((t && t.torn_id) || '').replace(/\D/g, '');
        if (t && typeof t.name === 'string' && t.name && id) out.push({ id, name: t.name, source: 'te' });
    }
    return out;
}

/** Both forms from one call: {byName: lowercase name -> id, list: [{id, name}]}. */
export async function fetchTeActiveTraderList(client) {
    const body = await client.get('active_traders');
    return { byName: parseTeActiveTraders(body), list: parseTeActiveTraderList(body) };
}
