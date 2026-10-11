/*
 * Part 1 of the plan (the friend's zip, 2026-10-06): TornW3B refuses a BURST, not a minute's count.
 * Minute after minute a dozen requests left back to back, the 12th or so was a 429, we paused a
 * minute, and the same dozen left again - our own loop.
 *
 * A pretend TornW3B that refuses more than N requests in any 10 seconds, two tabs that both want to
 * read all the time (as the overlay and Torn Bids do), and a clock that moves only when someone
 * sleeps. Without the pace the tabs are refused every minute, for ever; with it they settle.
 *
 * 3.26.0: that reading was wrong for the sellers list (it has a limit of its own, test/w3b-routes.test.js).
 * The pace stays for every other request, so these ask for a price list - a request with no limit of its own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { W3bClient, W3B_GAP_MIN_MS, W3B_GAP_START_MS, W3B_GAP_MAX_MS, W3B_COOLDOWN_MS } from '../src/api/w3b.js';

const T0 = 1_700_000_000_000;
const MINUTE = 60000;

/**
 * @param {object} o
 * @param {number} o.tabs - how many tabs ask
 * @param {number} o.burst - TornW3B refuses a request when this many were already answered in the last 10 s
 * @param {boolean} o.pace - the new pacing on or off (off = 3.24.1)
 */
function world({ tabs = 2, burst = 8, pace = true, down = null } = {}) {
    let t = T0;
    const store = new Map();
    const served = [];
    const refused = [];
    const sent = [];
    const failed = [];
    const answers = [];
    const paces = [];
    const clients = [];
    for (let i = 0; i < tabs; i++) {
        clients.push(new W3bClient({
            pace,
            now: () => t,
            sleep: async (ms) => { t += ms; },
            loadShared: () => (store.has('s') ? JSON.parse(store.get('s')) : null),
            saveShared: (s) => store.set('s', JSON.stringify(s)),
            onSent: (x) => sent.push({ tab: i, at: x.at ?? t, path: x.path }),
            onFailed: (x) => failed.push({ tab: i, at: t, error: x.error }),
            onAnswered: (x) => answers.push({ tab: i, at: t, ...x }),
            onPace: (x) => paces.push({ tab: i, at: t, ...x }),
            fetchImpl: async () => {
                const lately = served.filter((at) => t - at < 10000).length;
                // The answer takes a moment, as a real one does.
                t += 120;
                // `down`: TornW3B refuses everything for a while, whatever the pace.
                if (lately >= burst || (down && t >= down[0] && t < down[1])) {
                    refused.push(t);
                    return { ok: false, status: 429, json: async () => ({}) };
                }
                served.push(t);
                return { ok: true, status: 200, json: async () => ({ items: [] }) };
            },
        }));
    }
    /** Every tab wants a read whenever it may ask, as the app's 3 s ticks do; `ms` of it. */
    const run = async (ms) => {
        const end = t + ms;
        while (t < end) {
            let asked = false;
            for (const c of clients) {
                // Paused means silent: a caller looks first and does not ask.
                if (c.stats().coolingDown) continue;
                asked = true;
                try {
                    await c.get('pricelist/206', { tag: 'w.flips' });
                } catch {
                    // The app goes on to its next tick.
                }
            }
            // A tick of the app when nobody could ask.
            if (!asked) t += 3000;
        }
    };
    return { clients, served, refused, sent, failed, answers, paces, run, store, clock: { get t() { return t; }, set t(v) { t = v; } } };
}

const within = (list, from, to) => list.filter((at) => at >= from && at < to).length;

test('3.24.1 as it was: a dozen requests back to back, refused, a minute\'s pause, and the same again - every minute', async () => {
    const w = world({ pace: false });
    await w.run(10 * MINUTE);
    // This is the loop of the zip: it never settles.
    assert.ok(w.refused.length >= 8, `refused only ${w.refused.length} times in 10 minutes`);
    assert.ok(within(w.refused, T0 + 5 * MINUTE, T0 + 10 * MINUTE) >= 4, 'still refused in the second half');
});

test('with the pace: a gap between any two requests, whichever tab asks - and it is never refused at a pace TornW3B takes', async () => {
    // A TornW3B that takes one a second (what the 60 a minute of before assumed) but not a dozen at once.
    const w = world({ burst: 12 });
    await w.run(10 * MINUTE);
    assert.equal(w.refused.length, 0, `refused ${w.refused.length} times`);
    // Never two requests closer than the smallest gap, across both tabs.
    const at = w.sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= W3B_GAP_MIN_MS, `requests ${at[i] - at[i - 1]} ms apart`);
    // Both tabs get their turn, and it is not slow: tens of reads a minute.
    assert.ok(w.sent.filter((s) => s.tab === 0).length > 100);
    assert.ok(w.sent.filter((s) => s.tab === 1).length > 100);
    // It starts carefully and speeds up to the floor as answers come.
    assert.ok(at[1] - at[0] >= W3B_GAP_START_MS - 200, 'the first two were ' + (at[1] - at[0]) + ' ms apart');
    assert.ok(within(at, T0 + 9 * MINUTE, T0 + 10 * MINUTE) > within(at, T0, T0 + MINUTE));
    assert.ok(within(at, T0 + 9 * MINUTE, T0 + 10 * MINUTE) <= 60, 'never over the 60 a minute of before');
});

test('a TornW3B that takes less than we thought: refused a few times, each time slower, then never again', async () => {
    const w = world({ burst: 4 });
    await w.run(30 * MINUTE);
    assert.ok(w.refused.length >= 1 && w.refused.length <= 6, `refused ${w.refused.length} times`);
    assert.equal(within(w.refused, T0 + 12 * MINUTE, T0 + 30 * MINUTE), 0, 'still refused after it should have settled');
    // And it still reads: it found the pace that is taken, it did not stop.
    assert.ok(within(w.served, T0 + 20 * MINUTE, T0 + 30 * MINUTE) >= 150, 'only ' + within(w.served, T0 + 20 * MINUTE, T0 + 30 * MINUTE) + ' answers in ten minutes');
});

test('after a pause the first request goes alone, and slowly from there - what waited during the pause is not replayed', async () => {
    const w = world({ burst: 3 });
    // Refused once.
    await w.run(30000);
    assert.ok(w.refused.length >= 1);
    const refusedAt = w.refused[w.refused.length - 1];
    // Twice the gap that was refused, to begin with (it comes back down to the new floor as answers come).
    const lastGap = w.sent[w.sent.length - 1].at - w.sent[w.sent.length - 2].at;
    assert.ok(w.clients[0].stats().gapMs >= Math.min(W3B_GAP_MAX_MS, 2 * lastGap) - 100, 'refused at ' + lastGap + ' ms apart, the gap is now ' + w.clients[0].stats().gapMs);
    // During the pause: asked anyway (a caller that did not look) - nothing is sent, nothing is queued, and the log stays quiet.
    const before = w.sent.length;
    const logged = w.failed.length;
    for (let i = 0; i < 20; i++) await assert.rejects(w.clients[i % 2].get('pricelist/206'), (e) => e.blocked === true && e.paused === true);
    assert.equal(w.sent.length, before);
    assert.equal(w.failed.length, logged, 'a paused request went to the problem log');
    // The one real 429 did.
    assert.equal(w.failed.filter((f) => f.error && f.error.http === 429).length, w.refused.length);
    // The pause over: both tabs ask at once, as they do.
    w.clock.t = refusedAt + W3B_COOLDOWN_MS + 10;
    await Promise.all([w.clients[0].get('pricelist/1'), w.clients[1].get('pricelist/2'), w.clients[0].get('pricelist/3')]);
    const after = w.sent.slice(before).map((s) => s.at);
    assert.equal(after.length, 3);
    // Slower than before the refusal, not the same dozen again.
    assert.ok(after[1] - after[0] >= W3B_GAP_START_MS, 'the second came ' + (after[1] - after[0]) + ' ms after the first');
    assert.ok(after[2] - after[1] >= W3B_GAP_START_MS);
});

test('the pace is one for every tab, never under its floor or over its ceiling, and a client without it works as before', async () => {
    const w = world({ burst: 2 });
    await w.run(40 * MINUTE);
    const pace = JSON.parse(w.store.get('s')).pace;
    assert.ok(pace.gap >= W3B_GAP_MIN_MS && pace.gap <= W3B_GAP_MAX_MS, JSON.stringify(pace));
    // The other tab goes by the same number.
    assert.equal(w.clients[0].stats().gapMs, w.clients[1].stats().gapMs);
    // No pace asked for (the tests of other parts, and nothing else): no gap at all.
    const plain = world({ pace: false, burst: 1000 });
    await plain.run(5000);
    // Five seconds at 120 ms an answer: one after the other, nothing between them.
    assert.ok(plain.sent.length >= 35, 'only ' + plain.sent.length);
    assert.equal(plain.clients[0].stats().gapMs, null);
});

test('TornW3B down for a quarter of an hour: a request that went alone and was refused says nothing about the pace', async () => {
    const w = world({ burst: 12, down: [T0 + 5 * MINUTE, T0 + 20 * MINUTE] });
    await w.run(4.5 * MINUTE);
    const before = w.clients[0].stats().gapMs;
    assert.equal(before, W3B_GAP_MIN_MS);
    await w.run(16.5 * MINUTE);
    // Refused about once a minute while it was down (one request, then the minute's wait) ...
    assert.ok(w.refused.length >= 10 && w.refused.length <= 18, 'refused ' + w.refused.length + ' times');
    // ... and back up, we are not at a crawl for the next two hours: at most the one step the first refusal cost.
    assert.ok(w.clients[0].stats().gapMs <= W3B_GAP_START_MS * 2, 'the gap is now ' + w.clients[0].stats().gapMs);
    const from = w.clock.t;
    await w.run(5 * MINUTE);
    assert.ok(within(w.served, from, from + 5 * MINUTE) >= 100, 'only ' + within(w.served, from, from + 5 * MINUTE) + ' answers in five minutes');
});

test('each answer is counted as taken or refused, the request that was never sent as neither', async () => {
    const w = world({ burst: 3 });
    await w.run(30000);
    assert.ok(w.refused.length >= 1);
    assert.equal(w.answers.filter((a) => a.refused).length, w.refused.length);
    assert.equal(w.answers.filter((a) => !a.refused).length, w.served.length);
    assert.equal(w.answers.length, w.sent.length);
    assert.deepEqual(Object.keys(w.answers[0]).sort(), ['at', 'path', 'refused', 'tab', 'tag']);
    const n = w.answers.length;
    await assert.rejects(w.clients[0].get('pricelist/206'), (e) => e.paused === true);
    assert.equal(w.answers.length, n);
});

test('for the log: a refusal that changes the pace says what it was and what it is now - one that went alone says nothing', async () => {
    // Eight in any ten seconds: one every 1250 ms is taken, and the pace shortens until it is refused once.
    const w = world({ burst: 8 });
    await w.run(10 * MINUTE);
    assert.ok(w.refused.length >= 1, 'the pace is found by being refused once');
    assert.equal(w.paces.length, w.refused.length, 'each refusal that slowed it is said, once');
    const p = w.paces[0];
    assert.ok(p.was >= W3B_GAP_MIN_MS && p.was < p.gap, 'slower than it was: ' + JSON.stringify(p));
    assert.ok(p.floor > p.was && p.floor <= p.gap, 'and never again as fast as the pace that was refused');
    assert.equal(Number.isInteger(p.was) && Number.isInteger(p.gap) && Number.isInteger(p.floor), true, 'whole milliseconds, to read in a log');
    // TornW3B down for a quarter of an hour: the first refusal slows it (it cannot know yet); every try after a
    // pause goes alone - slower would not have helped, so the pace stays and nothing more is said.
    const d = world({ burst: 1000, down: [T0 + 5 * MINUTE, T0 + 20 * MINUTE] });
    await d.run(21 * MINUTE);
    assert.ok(d.refused.length >= 5, 'refused at every try while it was down: ' + d.refused.length);
    assert.equal(d.paces.length, 1);
});
