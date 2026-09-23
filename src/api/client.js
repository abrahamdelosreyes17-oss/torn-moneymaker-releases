/*
 * The one place that talks to the network.
 *
 * Non-negotiables enforced here rather than by convention:
 *
 *   1. api.torn.com is the ONLY destination. The base URL is a constant and
 *      callers pass a path, never a URL. No third party ever receives a Torn
 *      key, because no third party can be addressed from this client.
 *   2. The key is never logged. Errors are redacted before they are thrown,
 *      so a stack trace pasted into Discord cannot leak it.
 *   3. Every call goes through one rate-limited queue (<=70/min against
 *      Torn's ~100/min ceiling) with request dedup and exponential backoff.
 *      A key that trips abuse detection is a worse outcome than a slow panel.
 */

export const TORN_API_BASE = 'https://api.torn.com/';

/** Torn error codes worth reacting to specifically. */
export const TORN_ERROR_KEY_INVALID = 2;
export const TORN_ERROR_RATE_LIMIT = 5;
export const TORN_ERROR_IP_BLOCK = 8;
export const TORN_ERROR_UNAVAILABLE = 9;

export class TornApiError extends Error {
    constructor(message, { code = null, http = null } = {}) {
        super(message);
        this.name = 'TornApiError';
        this.code = code;
        this.http = http;
    }
}

function apiSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip anything that looks like an API key out of a string before it can
 * reach a console, an alert, or the panel.
 */
export function redactKey(text, key) {
    let out = String(text === null || text === undefined ? '' : text);

    if (key) out = out.split(key).join('<redacted>');

    // Belt and braces: catch a key that arrived from somewhere else.
    return out.replace(/key=[A-Za-z0-9]{8,}/g, 'key=<redacted>');
}

export class TornApiClient {
    /**
     * @param {object} options
     * @param {function(): string} options.getKey - returns the current API key
     * @param {function} [options.fetchImpl]      - injectable for tests
     * @param {number} [options.maxPerMinute]     - request ceiling
     * @param {number} [options.dedupTtlMs]       - reuse identical responses
     * @param {number} [options.maxRetries]
     */
    constructor({
        getKey,
        fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
        maxPerMinute = 70,
        dedupTtlMs = 5000,
        maxRetries = 3,
    } = {}) {
        this.getKey = getKey;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.dedupTtlMs = dedupTtlMs;
        this.maxRetries = maxRetries;

        /** Timestamps of recent requests, for the sliding window. */
        this.recent = [];
        /** Serialises the queue so the window check cannot race. */
        this.chain = Promise.resolve();
        /** In-flight and recently-completed requests, keyed without the key. */
        this.inflight = new Map();
        this.cache = new Map();
    }

    /** Requests made in the last 60s, and room remaining. */
    stats(now = Date.now()) {
        const window = this.recent.filter((t) => now - t < 60000);
        return {
            usedLastMinute: window.length,
            remaining: Math.max(0, this.maxPerMinute - window.length),
        };
    }

    /** Block until the sliding window has room for one more request. */
    async waitForSlot() {
        for (;;) {
            const now = Date.now();
            this.recent = this.recent.filter((t) => now - t < 60000);

            if (this.recent.length < this.maxPerMinute) {
                this.recent.push(now);
                return;
            }

            const oldest = this.recent[0];
            await apiSleep(Math.max(50, 60000 - (now - oldest) + 25));
        }
    }

    /**
     * GET a Torn API path.
     *
     * @param {string} path - e.g. "torn" or "user" or "market/123"
     * @param {object} params - query params; `key` is added here and only here
     */
    async get(path, params = {}) {
        const cacheKey = path + '?' + new URLSearchParams(params).toString();

        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.at < this.dedupTtlMs) {
            return cached.data;
        }

        const existing = this.inflight.get(cacheKey);
        if (existing) return existing;

        // Queue behind whatever is already scheduled, then take a slot.
        const promise = this.chain
            .catch(() => {})
            .then(() => this.execute(path, params, cacheKey));

        this.chain = promise.catch(() => {});
        this.inflight.set(cacheKey, promise);

        try {
            const data = await promise;
            this.cache.set(cacheKey, { at: Date.now(), data });
            return data;
        } finally {
            this.inflight.delete(cacheKey);
        }
    }

    async execute(path, params, cacheKey) {
        if (!this.fetchImpl) {
            throw new TornApiError('No fetch implementation available.');
        }

        const key = this.getKey ? this.getKey() : '';
        if (!key) {
            throw new TornApiError('No API key set.', {
                code: TORN_ERROR_KEY_INVALID,
            });
        }

        let attempt = 0;
        let lastError = null;

        while (attempt <= this.maxRetries) {
            await this.waitForSlot();

            try {
                return await this.requestOnce(path, params, key);
            } catch (error) {
                lastError = error;

                if (!this.isRetryable(error) || attempt === this.maxRetries) {
                    throw error;
                }

                // Exponential backoff, not a retry loop. 1s, 2s, 4s.
                await apiSleep(1000 * Math.pow(2, attempt));
                attempt += 1;
            }
        }

        throw lastError;
    }

    isRetryable(error) {
        if (!(error instanceof TornApiError)) return true;

        if (error.code === TORN_ERROR_RATE_LIMIT) return true;
        if (error.code === TORN_ERROR_UNAVAILABLE) return true;
        if (error.http && error.http >= 500) return true;
        if (error.http === 429) return true;

        // A bad key or an IP block will not fix itself by asking again.
        return false;
    }

    async requestOnce(path, params, key) {
        const url = new URL(String(path).replace(/^\/+/, '') + '/', TORN_API_BASE);

        /*
         * A relative path resolves under the base, but an ABSOLUTE one
         * ("https://elsewhere/steal") overrides it entirely — and the key is
         * attached below. The base being a constant is therefore not enough
         * on its own; this is the assertion that actually enforces "one
         * destination".
         */
        if (url.hostname !== 'api.torn.com') {
            throw new TornApiError(
                'Refusing to send the API key to ' + url.hostname + '.',
            );
        }

        for (const [name, value] of Object.entries(params || {})) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(name, String(value));
        }
        url.searchParams.set('key', key);
        url.searchParams.set('comment', 'TornTradingV2');

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new TornApiError(
                'Network error: ' + redactKey(error && error.message, key),
            );
        }

        if (!response.ok) {
            throw new TornApiError('HTTP ' + response.status, {
                http: response.status,
            });
        }

        let data;
        try {
            data = await response.json();
        } catch {
            throw new TornApiError('Torn API returned invalid JSON.');
        }

        if (data && data.error) {
            throw new TornApiError(
                'Torn API ' +
                    data.error.code +
                    ': ' +
                    redactKey(data.error.error, key),
                { code: data.error.code },
            );
        }

        return data;
    }
}
