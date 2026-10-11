/*
 * Scene key-rejected (3.25.0, plan part 1b; the friend's zip of 2026-10-08, "Doesn't highlight flips").
 *
 * Loaded by test/harness-live.html when the address has &scene=key-rejected, before the script.
 * The overlay's Public key is stored and marked rejected, and the item list in storage is two days
 * old - his PC as 3.24.1 left it, where the overlay then read no Torn page at all.
 *
 *   (nothing more)    the mark is the bare "true" 3.24.1 stored, and Torn takes the key:
 *                     it is tried at once and comes back by itself.
 *   &torn=18          Torn answers that key with error 18 (paused by its owner): one try, still
 *                     rejected, the page is read and marked from the stored list all the same.
 *   &keydead=fresh    rejected a minute ago (error 18), so no try is due: no request at all may
 *                     leave with that key.
 *
 * window.__withRejectedKey: every request that carried the overlay's key.
 */
(() => {
    const q = new URLSearchParams(location.search);
    const now = Date.now();
    _store[NS + 'keyDead'] = JSON.stringify(q.get('keydead') === 'fresh' ? { code: 18, at: now - 60000, tried: now - 60000 } : true);
    _store[NS + 'itemsCache'] = JSON.stringify({ version: 'items-v5', fetchedAt: now - 2 * 24 * 3600 * 1000, items: { ...ITEMS, ...BZW_ITEMS } });

    const answer = respond;
    window.__withRejectedKey = [];
    // eslint-disable-next-line no-global-assign
    respond = (url) => {
        const u = new URL(url);
        if (u.hostname === 'api.torn.com' && u.searchParams.get('key') === KEY) {
            window.__withRejectedKey.push(u.pathname + u.search.replace(KEY, '<KEY>'));
            if (q.get('torn') === '18') return { error: { code: 18, error: 'API key has been paused by the owner' } };
        }
        return answer(url);
    };
})();
