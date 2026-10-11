// A key Torn has rejected (core/key-dead.js; plan part 1b, the friend's zip of 2026-10-08).
// His overlay went dark for two days on a key that was fine: the script had marked it "rejected"
// with Torn never having said so, for ever, and quietly. The rules, one test each:
// only Torn's own answer rejects a key; a rejected key is tried again by itself; and the words say
// which of Torn's three reasons it was.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TornApiClient, TornApiError } from '../src/api/client.js';
import { keyRejectedCode, keyDeadRead, keyDeadMark, keyDeadUnanswered, keyDeadDue, keyDeadWords, keyReport, keyDeadRetry, KEY_RETRY_MS, KEY_RETRY_SOON_MS } from '../src/core/key-dead.js';

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const MIN = 60000;

/** A client whose Torn answers with `reply` (or throws what `reply` throws). */
function clientFor(reply, key = 'ABCDEFGH12345678') {
    return new TornApiClient({
        getKey: () => key,
        maxRetries: 0,
        fetchImpl: async () => {
            const body = typeof reply === 'function' ? reply() : reply;
            return { ok: true, status: 200, json: async () => body };
        },
    });
}
const failure = async (client) => {
    try {
        await client.get('key', { selections: 'info' });
    } catch (error) {
        return error;
    }
    throw new Error('it did not fail');
};

test('only Torn can reject a key: its own answer with error 2, 13 or 18 - in either shape Torn sends it', async () => {
    for (const code of [2, 13, 18]) {
        assert.equal(keyRejectedCode(await failure(clientFor({ error: { code, error: 'Incorrect key' } }))), code);
        assert.equal(keyRejectedCode(await failure(clientFor({ code, error: 'Incorrect key' }))), code);
    }
    // Torn's other answers are not about the key being dead.
    for (const code of [5, 8, 16, 17]) assert.equal(keyRejectedCode(await failure(clientFor({ error: { code, error: 'x' } }))), null);
});

test('never the browser, never the script itself: what marked his good key rejected for two days', async () => {
    // (a) A browser error thrown while a page is read carries a number too: SecurityError is 18, InvalidModificationError 13.
    assert.equal(keyRejectedCode(new DOMException('The operation is insecure.', 'SecurityError')), null);
    assert.equal(new DOMException('x', 'SecurityError').code, 18);
    assert.equal(keyRejectedCode(new DOMException('x', 'InvalidModificationError')), null);
    assert.equal(keyRejectedCode({ code: 2, message: 'anything with a 2 on it' }), null);
    // (b) The stored key read back empty for a moment: the client says "No API key set" with Torn's number 2, and sent nothing.
    const sent = [];
    const empty = new TornApiClient({ getKey: () => '', maxRetries: 0, fetchImpl: async (u) => { sent.push(u); return { ok: true, status: 200, json: async () => ({}) }; } });
    const error = await failure(empty);
    assert.equal(error.code, 2);
    assert.equal(sent.length, 0);
    assert.equal(keyRejectedCode(error), null);
    // A network failure, a bad page, an HTTP error: Torn said nothing about the key.
    assert.equal(keyRejectedCode(await failure(new TornApiClient({ getKey: () => 'ABCDEFGH12345678', maxRetries: 0, fetchImpl: async () => { throw new Error('offline'); } }))), null);
    assert.equal(keyRejectedCode(await failure(new TornApiClient({ getKey: () => 'ABCDEFGH12345678', maxRetries: 0, fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }) }))), null);
    // An error of ours made to look like Torn's is not Torn's.
    assert.equal(keyRejectedCode(new TornApiError('Paused', { code: 18, paused: true })), null);
    assert.equal(keyRejectedCode(null), null);
});

test('a rejection is kept with Torn\'s number and when; one stored by an older version (just "true") is tried again at once', () => {
    assert.equal(keyDeadRead(null), null);
    assert.equal(keyDeadRead(false), null);
    assert.equal(keyDeadRead(undefined), null);
    // 3.24.1 and before: `true` (the overlay, Torn Bids) or the words shown (the Ledger). No number, no time.
    for (const old of [true, 'Torn says this key is wrong. Paste your Full key again.']) {
        const state = keyDeadRead(old);
        assert.deepEqual(state, { code: null, at: 0, tried: 0 });
        assert.equal(keyDeadDue(state, NOW), true);
    }
    const state = keyDeadMark(null, 18, NOW);
    assert.deepEqual(state, { code: 18, at: NOW, tried: NOW });
    assert.deepEqual(keyDeadRead(JSON.parse(JSON.stringify(state))), state);
    // Junk in storage is a rejection of unknown kind, never "fine" and never a crash.
    assert.deepEqual(keyDeadRead({ code: 'x', at: 'y' }), { code: null, at: 0, tried: 0 });
    assert.deepEqual(keyDeadRead({ code: 7, at: NOW, tried: NOW }), { code: null, at: NOW, tried: NOW });
});

test('it is tried again by itself: at most once an hour, sooner when Torn never answered the try', () => {
    let state = keyDeadMark(null, 2, NOW);
    assert.equal(keyDeadDue(state, NOW), false);
    assert.equal(keyDeadDue(state, NOW + KEY_RETRY_MS - 1), false);
    assert.equal(keyDeadDue(state, NOW + KEY_RETRY_MS), true);
    // Tried and rejected again, for the same reason: "since" stays, the hour starts again.
    state = keyDeadMark(state, 2, NOW + KEY_RETRY_MS);
    assert.deepEqual(state, { code: 2, at: NOW, tried: NOW + KEY_RETRY_MS });
    assert.equal(keyDeadDue(state, NOW + KEY_RETRY_MS + 59 * MIN), false);
    // Another reason now: it is a new rejection.
    assert.deepEqual(keyDeadMark(state, 18, NOW + 2 * KEY_RETRY_MS), { code: 18, at: NOW + 2 * KEY_RETRY_MS, tried: NOW + 2 * KEY_RETRY_MS });
    // The try got no answer from Torn (offline, Torn down): still rejected, and tried again in five minutes, not an hour.
    const waiting = keyDeadUnanswered(state, NOW + 2 * KEY_RETRY_MS);
    assert.equal(waiting.code, 2);
    assert.equal(waiting.at, NOW);
    assert.equal(keyDeadDue(waiting, NOW + 2 * KEY_RETRY_MS + KEY_RETRY_SOON_MS - 1), false);
    assert.equal(keyDeadDue(waiting, NOW + 2 * KEY_RETRY_MS + KEY_RETRY_SOON_MS), true);
    // A clock set back does not leave it waiting for ever.
    assert.equal(keyDeadDue({ code: 2, at: NOW, tried: NOW + 10 * KEY_RETRY_MS }, NOW), true);
    assert.equal(keyDeadDue(null, NOW), false);
});

test('each of Torn\'s three reasons has its own words, with the number, when it is tried again, and what else to do', () => {
    const words = (code, later = 0) => keyDeadWords(keyDeadMark(null, code, NOW), 'Public', NOW + later);
    assert.equal(words(2), 'Torn says this key is wrong (error 2). It is tried again in 60 min by itself - or paste a new Public key.');
    assert.equal(words(13, 18 * MIN), 'Torn has switched this key off because its owner was away too long (error 13). It is tried again in 42 min by itself - or paste a new Public key.');
    assert.equal(words(18, 59.5 * MIN), 'This key is paused in Torn\'s settings (error 18). It is tried again in 1 min by itself - or paste a new Public key.');
    assert.equal(keyDeadWords(keyDeadMark(null, 18, NOW), 'Limited', NOW + KEY_RETRY_MS), 'This key is paused in Torn\'s settings (error 18). It is being tried again now - or paste a new Limited key.');
    // Marked by an older version: said as it is, with no reason made up.
    assert.equal(keyDeadWords(keyDeadRead(true), 'Public', NOW), 'An earlier version marked this key as rejected. It is being tried again now - or paste a new Public key.');
    assert.equal(keyDeadWords(null, 'Public', NOW), null);
    // No key and no secret in any of it.
    for (const code of [2, 13, 18]) assert.doesNotMatch(words(code), /[A-Za-z0-9]{16}/);
});

test('the report says of each key whether it is stored, working or rejected - never the key', () => {
    assert.deepEqual(keyReport('', null, NOW), { stored: false, state: 'none' });
    assert.deepEqual(keyReport('ABCDEFGH12345678', null, NOW), { stored: true, state: 'working' });
    assert.deepEqual(keyReport('ABCDEFGH12345678', keyDeadMark(null, 18, NOW - 90 * MIN), NOW), { stored: true, state: 'rejected', error: 18, sinceMinutes: 90, triedMinutesAgo: 90 });
    assert.deepEqual(keyReport('ABCDEFGH12345678', true, NOW), { stored: true, state: 'rejected', error: null, sinceMinutes: null, triedMinutesAgo: null });
    // A rejection left behind with no key stored is not reported as one.
    assert.deepEqual(keyReport('', true, NOW), { stored: false, state: 'none' });
    assert.doesNotMatch(JSON.stringify(keyReport('ABCDEFGH12345678', true, NOW)), /ABCDEFGH/);
});

test('the try itself: one request when it is due, written down before it leaves, and the key is back the moment Torn takes it', async () => {
    const rig = (stored, answer) => {
        const r = { stored, asked: 0, writes: [], t: NOW };
        r.run = () => keyDeadRetry({
            load: () => r.stored,
            save: (s) => { r.stored = s; r.writes.push(s); },
            clear: () => { r.stored = null; r.writes.push(null); },
            ask: async () => {
                r.asked += 1;
                // Another tab looking now sees it was just tried.
                assert.equal(keyDeadDue(r.stored, r.t), false, 'not written down before asking');
                return answer(r);
            },
            now: () => r.t,
        });
        return r;
    };
    const tornSays = (code) => () => { throw new TornApiError('Torn API ' + code, { code, fromTorn: true }); };

    // What 3.24.1 left behind on his PC: tried at once, Torn takes the key, the mark is gone.
    const his = rig(true, () => ({ access_level: 1 }));
    assert.equal(await his.run(), 'back');
    assert.equal(his.asked, 1);
    assert.equal(his.stored, null);
    assert.equal(await his.run(), 'not-due');
    assert.equal(his.asked, 1);

    // Not due: nothing is asked and nothing written.
    const fresh = rig(keyDeadMark(null, 18, NOW), tornSays(18));
    assert.equal(await fresh.run(), 'not-due');
    assert.equal(fresh.asked, 0);
    assert.deepEqual(fresh.writes, []);
    // An hour on: asked once, still paused - the hour starts again, "since" stays.
    fresh.t = NOW + KEY_RETRY_MS;
    assert.equal(await fresh.run(), 'rejected');
    assert.deepEqual(fresh.stored, { code: 18, at: NOW, tried: NOW + KEY_RETRY_MS });
    assert.equal(await fresh.run(), 'not-due');
    assert.equal(fresh.asked, 1);
    // The owner un-pauses it in Torn: back by itself at the next try.
    const unpaused = rig(fresh.stored, () => ({}));
    unpaused.t = NOW + 2 * KEY_RETRY_MS;
    assert.equal(await unpaused.run(), 'back');
    assert.equal(unpaused.stored, null);

    // Offline at the try: still rejected, asked again in five minutes.
    const offline = rig(keyDeadMark(null, 2, NOW - KEY_RETRY_MS), () => { throw new Error('Network error'); });
    assert.equal(await offline.run(), 'unanswered');
    assert.equal(offline.stored.code, 2);
    assert.equal(keyDeadDue(offline.stored, NOW + KEY_RETRY_SOON_MS - 1), false);
    assert.equal(keyDeadDue(offline.stored, NOW + KEY_RETRY_SOON_MS), true);
    // No rejection stored at all: nothing to do.
    assert.equal(await rig(null, () => ({})).run(), 'not-due');
});

test('the Ledger only: a key whose access is too low (error 16) is kept the same way - for the other keys 16 is not a rejection', () => {
    const tooLow = new TornApiError('Torn API 16', { code: 16, fromTorn: true });
    assert.equal(keyRejectedCode(tooLow), null);
    assert.equal(keyRejectedCode(tooLow, { tooLow: true }), 16);
    assert.equal(keyRejectedCode({ code: 16 }, { tooLow: true }), null);
    const state = keyDeadMark(null, 16, NOW);
    assert.deepEqual(keyDeadRead(state), { code: 16, at: NOW, tried: NOW });
    assert.equal(keyDeadWords(state, 'Full', NOW), 'Torn says this key\'s access is too low for this (error 16). It is tried again in 60 min by itself - or paste a new Full key.');
});
