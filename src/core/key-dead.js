/*
 * A key Torn has rejected (3.25.0; the friend's zip of 2026-10-08, "Doesn't
 * highlight flips").
 *
 * His overlay read no Torn page for two days. Its key was fine: the script had
 * marked it rejected itself - any error carrying the number 2, 13 or 18 counted,
 * and a browser's SecurityError carries 18, the script's own "No API key set"
 * carries 2 - and a key once marked stayed so until he pasted one again, with
 * nothing in the log.
 *
 * The rules here, for the overlay's key, Torn Bids' and the Ledger's alike:
 *   - only Torn's own answer rejects a key (an error made from Torn's reply);
 *   - a rejected key is tried again by itself - when a page loads, then at most
 *     once an hour - and comes back the moment Torn takes it;
 *   - what is kept is Torn's number and when, so the words and the report can
 *     say which of the three it was.
 *
 * Pure: no storage, no network.
 */

/** A rejected key is asked about again this often, at most. */
export const KEY_RETRY_MS = 60 * 60 * 1000;
/** ...and this soon when the try itself got no answer from Torn (offline, Torn down). */
export const KEY_RETRY_SOON_MS = 5 * 60 * 1000;

/* Torn's three ways of saying a key is no good: wrong, owner inactive, paused by its owner. */
const KEY_REJECT_WORDS = {
    2: 'Torn says this key is wrong',
    13: 'Torn has switched this key off because its owner was away too long',
    18: 'This key is paused in Torn\'s settings',
};
/* ...and, for the Ledger only (it needs a Full key), Torn says "access level not high enough". */
const KEY_TOO_LOW = 16;
const KEY_KEPT_WORDS = { ...KEY_REJECT_WORDS, [KEY_TOO_LOW]: 'Torn says this key\'s access is too low for this' };

/**
 * Torn's number, when this error is Torn itself rejecting the key; else null.
 * `fromTorn` is set by the API client on an error it built from Torn's reply,
 * and by nothing else.
 */
export function keyRejectedCode(error, { tooLow = false } = {}) {
    if (!error || error.fromTorn !== true) return null;
    const code = Number(error.code);
    return KEY_REJECT_WORDS[code] || (tooLow && code === KEY_TOO_LOW) ? code : null;
}

/**
 * The stored rejection: {code, at, tried}, or null when there is none.
 * What 3.24.1 and before stored (`true`, or the Ledger's words) has no number
 * and no time: read as "tried never", so it is tried again at once.
 */
export function keyDeadRead(stored) {
    if (!stored) return null;
    const s = typeof stored === 'object' ? stored : {};
    const time = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);
    return { code: KEY_KEPT_WORDS[Number(s.code)] ? Number(s.code) : null, at: time(s.at), tried: time(s.tried) };
}

/** Torn rejected it (first, or again on a try): `at` stays while the reason is the same. */
export function keyDeadMark(was, code, now) {
    const prev = keyDeadRead(was);
    const n = KEY_KEPT_WORDS[Number(code)] ? Number(code) : null;
    return { code: n, at: prev && prev.at && prev.code === n ? prev.at : now, tried: now };
}

/** A try that Torn never answered: nothing learned, asked again soon. */
export function keyDeadUnanswered(was, now) {
    const prev = keyDeadRead(was) || { code: null, at: 0, tried: 0 };
    return { ...prev, tried: now - KEY_RETRY_MS + KEY_RETRY_SOON_MS };
}

/** Time to ask Torn about it again? */
export function keyDeadDue(was, now) {
    const state = keyDeadRead(was);
    if (!state) return false;
    return now - state.tried >= KEY_RETRY_MS || state.tried > now;
}

/**
 * What the screen says. `kind`: the key to paste ("Public", "Limited", "Full").
 * null when the key is not rejected.
 */
export function keyDeadWords(was, kind, now) {
    const state = keyDeadRead(was);
    if (!state) return null;
    const why = state.code ? KEY_KEPT_WORDS[state.code] + ' (error ' + state.code + ')' : 'An earlier version marked this key as rejected';
    const left = keyDeadDue(state, now) ? 0 : Math.ceil((state.tried + KEY_RETRY_MS - now) / 60000);
    return why + '. ' + (left > 0 ? 'It is tried again in ' + left + ' min by itself' : 'It is being tried again now') + ' - or paste a new ' + kind + ' key.';
}

/** For the report's state.json: stored, working or rejected - never the key itself. */
export function keyReport(key, dead, now) {
    if (!key) return { stored: false, state: 'none' };
    const state = keyDeadRead(dead);
    if (!state) return { stored: true, state: 'working' };
    const minutes = (t) => (t ? Math.max(0, Math.round((now - t) / 60000)) : null);
    return { stored: true, state: 'rejected', error: state.code, sinceMinutes: minutes(state.at), triedMinutesAgo: minutes(state.tried) };
}

/**
 * Ask Torn about a rejected key again - one request, only when it is due.
 *
 * @param {object} o
 * @param {function} o.load - () => the stored rejection
 * @param {function} o.save - (state) => void
 * @param {function} o.clear - () => void, the key is good again
 * @param {function} o.ask - () => Promise, any request made with the key; it throws what Torn answered
 * @param {boolean} [o.tooLow] - the Ledger: error 16 keeps it rejected too
 * @returns {Promise<'not-due'|'back'|'rejected'|'unanswered'>}
 */
export async function keyDeadRetry({ load, save, clear, ask, now = Date.now, tooLow = false }) {
    const was = keyDeadRead(load());
    if (!was || !keyDeadDue(was, now())) return 'not-due';
    // Written down before the request leaves: another tab does not ask too.
    save({ ...was, tried: now() });
    try {
        await ask();
    } catch (error) {
        const code = keyRejectedCode(error, { tooLow });
        if (code === null) {
            save(keyDeadUnanswered(was, now()));
            return 'unanswered';
        }
        save(keyDeadMark(was, code, now()));
        return 'rejected';
    }
    clear();
    return 'back';
}
