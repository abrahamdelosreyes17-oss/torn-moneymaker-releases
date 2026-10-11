// A wait a hidden tab keeps too (core/steady-sleep.js). A hidden tab's own timers fire late - after
// five minutes hidden, once a minute - so Torn Bids, behind your Torn tab, could only send its
// TornW3B reads back to back when one fired: the burst TornW3B refuses. The gap between two reads
// is waited out by a worker's timer there (those are not slowed), with the plain timer beside it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSteadySleep, STEADY_WORKER_SOURCE } from '../src/core/steady-sleep.js';

function rig({ hidden = true, worker = 'ok' } = {}) {
    const timers = [];
    const made = [];
    const state = { hidden };
    const sleep = makeSteadySleep({
        isHidden: () => state.hidden,
        setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; },
        clearTimer: (id) => { if (timers[id]) timers[id].cleared = true; },
        makeWorker: (source) => {
            if (worker === 'throws') { made.push(null); throw new Error('Refused by the page'); }
            const w = { source, posted: [], onmessage: null, onerror: null, postMessage(m) { this.posted.push(m); } };
            made.push(w);
            return w;
        },
    });
    return { sleep, timers, made, state };
}
const settled = async (p) => {
    let done = false;
    p.then(() => { done = true; });
    await new Promise((r) => setImmediate(r));
    return done;
};

test('in view: the plain timer, and no worker is ever made', async () => {
    const r = rig({ hidden: false });
    const p = r.sleep(1500);
    assert.equal(r.made.length, 0);
    assert.equal(r.timers[0].ms, 1500);
    assert.equal(await settled(p), false);
    r.timers[0].fn();
    assert.equal(await settled(p), true);
});

test('hidden: the worker ends the wait while the tab\'s own timer is still asleep - one worker for every wait', async () => {
    const r = rig();
    const a = r.sleep(1000);
    const b = r.sleep(1500);
    assert.equal(r.made.length, 1);
    assert.equal(r.made[0].source, STEADY_WORKER_SOURCE);
    assert.deepEqual(r.made[0].posted.map((m) => m[1]), [1000, 1500]);
    assert.equal(await settled(a), false);
    // The worker's timer for the first wait.
    r.made[0].onmessage({ data: r.made[0].posted[0][0] });
    assert.equal(await settled(a), true);
    assert.equal(await settled(b), false);
    // Its own timer is put away; the late one changes nothing, and neither does a message for a wait that is over.
    assert.equal(r.timers[0].cleared, true);
    r.timers[0].fn();
    r.made[0].onmessage({ data: r.made[0].posted[0][0] });
    r.made[0].onmessage({ data: 999 });
    r.made[0].onmessage({ data: r.made[0].posted[1][0] });
    assert.equal(await settled(b), true);
});

test('the page refuses a worker: the plain timer still ends every wait, and no second worker is tried', async () => {
    const r = rig({ worker: 'throws' });
    const a = r.sleep(1000);
    assert.equal(r.made.length, 1);
    r.timers[0].fn();
    assert.equal(await settled(a), true);
    const b = r.sleep(1000);
    assert.equal(r.made.length, 1, 'tried again');
    r.timers[1].fn();
    assert.equal(await settled(b), true);

    // Refused a moment later (an error event, as a page's policy does it): the same.
    const late = rig();
    const c = late.sleep(1000);
    late.made[0].onerror({});
    late.timers[0].fn();
    assert.equal(await settled(c), true);
    const d = late.sleep(1000);
    assert.equal(late.made.length, 1);
    late.timers[1].fn();
    assert.equal(await settled(d), true);
});

test('the worker itself: it answers with the number it was given, after the time it was given', () => {
    const posted = [];
    const timers = [];
    const scope = { postMessage: (m) => posted.push(m), setTimeout: (fn, ms) => timers.push({ fn, ms }) };
    new Function('self', 'postMessage', 'setTimeout', 'var onmessage;' + STEADY_WORKER_SOURCE + ';return onmessage;')(scope, scope.postMessage, scope.setTimeout)({ data: [7, 1200] });
    assert.deepEqual(timers.map((x) => x.ms), [1200]);
    assert.deepEqual(posted, []);
    timers[0].fn();
    assert.deepEqual(posted, [7]);
});

test('for the log: which timer a hidden tab is on - and a page that refuses the worker is told once', async () => {
    const said = [];
    const mk = (worker) => {
        const timers = [];
        const sleep = makeSteadySleep({
            isHidden: () => true,
            setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
            clearTimer: () => {},
            onRefused: () => said.push(worker),
            makeWorker: () => {
                if (worker === 'throws') throw new Error('Refused by the page');
                return { posted: [], postMessage(m) { this.posted.push(m); } };
            },
        });
        return { sleep, timers };
    };
    const ok = mk('ok');
    assert.equal(ok.sleep.state(), 'not needed yet');
    ok.sleep(1000);
    assert.equal(ok.sleep.state(), 'worker');
    assert.deepEqual(said, []);
    const no = mk('throws');
    no.sleep(1000);
    no.sleep(1000);
    no.sleep(1000);
    assert.equal(no.sleep.state(), 'refused');
    assert.deepEqual(said, ['throws'], 'said once, not at every wait');
});
