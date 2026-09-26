/*
 * The Torn Ledger's API client: a Full key, used for nothing but your own
 * log and trades.
 *
 * The Full key can read everything on the account, so this client is walled
 * in by code, not by care: its URL check allows only these api.torn.com
 * paths, and any other is refused before the key is attached - a bug
 * elsewhere cannot spend it on anything else.
 *
 *   /v2/key/info          - to check the key is Full, and whose it is
 *   /v2/user/log          - bazaar and Item Market buys and sells
 *   /v2/user/trades       - your finished trades
 *   /v2/user/{id}/trade   - one trade's items and money
 *
 * It shares the one request window (70 a minute across every tab) with the
 * other clients. Only Torn Bids makes one; the panel on torn.com never reads
 * the Ledger's key.
 */

import { TornApiClient, TornApiError, TORN_API_BASE } from './client.js';
import { LEDGER_LOG_TYPES } from '../core/ledger.js';

/** The only paths the Ledger's key is ever sent to. */
export const LEDGER_PATHS = [/^\/v2\/key\/info$/, /^\/v2\/user\/log$/, /^\/v2\/user\/trades$/, /^\/v2\/user\/\d+\/trade$/];

/** The only query parameters each path may carry (the key and comment are added by the client). */
export const LEDGER_PARAMS = [
    [/^\/v2\/key\/info$/, []],
    [/^\/v2\/user\/log$/, ['log', 'from', 'to', 'limit']],
    [/^\/v2\/user\/trades$/, ['cat', 'from', 'limit', 'sort']],
    [/^\/v2\/user\/\d+\/trade$/, []],
];

export function ledgerParamsAllowed(path, params = {}) {
    let pathname;
    try {
        pathname = new URL(String(path).replace(/^\/+/, ''), TORN_API_BASE).pathname;
    } catch {
        return false;
    }
    const rule = LEDGER_PARAMS.find(([re]) => re.test(pathname));
    if (!rule) return false;
    return Object.keys(params || {}).every((k) => rule[1].includes(k));
}

export function ledgerPathAllowed(path) {
    // A path carries no query or fragment of its own: parameters go through params, which are checked.
    if (/[?#]/.test(String(path))) return false;
    try {
        const clean = String(path).replace(/^\/+/, '');
        const url = new URL(clean, TORN_API_BASE);
        return url.hostname === 'api.torn.com' && LEDGER_PATHS.some((re) => re.test(url.pathname));
    } catch {
        return false;
    }
}

export class LedgerClient extends TornApiClient {
    async requestOnce(path, params, key) {
        if (!ledgerPathAllowed(path) || !ledgerParamsAllowed(path, params)) {
            throw new TornApiError('The Ledger key is only for your log and trades; refused ' + String(path).split('?')[0] + '.');
        }
        return super.requestOnce(path, params, key);
    }
}

/**
 * Whose key it is and what it may read (v2 key/info).
 * @returns {{level: number|null, type: string|null, userId: string|null}}
 */
export async function fetchLedgerKeyInfo(client) {
    const data = await client.get('v2/key/info');
    const info = (data && data.info) || {};
    const access = info.access || {};
    const level = Number(access.level);
    return {
        level: Number.isFinite(level) ? level : null,
        type: typeof access.type === 'string' ? access.type : null,
        userId: info.user && info.user.id ? String(info.user.id) : null,
    };
}

/** A Full key: level 4, or Torn's own words for it. */
export function isFullKey(info) {
    return Boolean(info && (info.level === 4 || /^full/i.test(String(info.type || ''))));
}

/**
 * One page of your log (newest first, at most 100): the four trade types.
 * `from` / `to` are Torn timestamps (seconds), both inclusive.
 */
export async function fetchLogPage(client, { from = null, to = null } = {}) {
    const params = { log: LEDGER_LOG_TYPES.join(','), limit: 100 };
    if (from) params.from = from;
    if (to) params.to = to;
    const data = await client.get('v2/user/log', params);
    return Array.isArray(data && data.log) ? data.log : [];
}

/** Your finished trades since `from` (seconds), oldest first, at most 100. */
export async function fetchTradesPage(client, { from = null } = {}) {
    const params = { cat: 'finished', limit: 100, sort: 'ASC' };
    if (from) params.from = from;
    const data = await client.get('v2/user/trades', params);
    return Array.isArray(data && data.trades) ? data.trades : [];
}

/** One trade: both sides' items and money. */
export async function fetchTrade(client, tradeId) {
    const id = String(tradeId).replace(/\D/g, '');
    if (!id) return null;
    const data = await client.get('v2/user/' + id + '/trade');
    return (data && data.trade) || null;
}
