// Beside Torn Archive (src/core/beside.js): Torn Bids' half of the agreement, alone and held against
// Torn Archive's own half (its src/core/turns.js), so the two never pass one limit together.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    besideMark, besideStep, besideBehind, besideRoom, besideBehindText, besideDue, besideLine, besideArchiveInFront,
    BESIDE_FRONT_MARK, BESIDE_BEHIND_MARK, BESIDE_TORN_PER_MINUTE, BESIDE_W3B_PER_MINUTE, BESIDE_FRESH_MS, BESIDE_UP_MS, BESIDE_RENEW_MS, BESIDE_LOOK_EVERY_MS,
} from '../src/core/beside.js';
import { W3bClient } from '../src/api/w3b.js';

const T0 = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const front = (app, at) => ({ app, at });

test('the marks are read strictly: ours or nothing', () => {
    assert.deepEqual(besideMark('{"app":"archive","at":5}'), { app: 'archive', at: 5 });
    assert.deepEqual(besideMark('{"app":"trading","at":5,"torn":15,"w3b":15}'), { app: 'trading', at: 5 });
    for (const odd of [null, '', 'x', '{}', '[]', '{"app":"other","at":5}', '{"app":"archive"}', '{"app":"archive","at":-1}', '{"app":"archive","at":"soon"}', '{"app":"archive","at":5,"x":"' + 'y'.repeat(400) + '"}']) {
        assert.equal(besideMark(odd), null);
    }
});

test('Torn Archive looked at last: behind at once. Torn Bids looked at: the whole limit a minute later', () => {
    let s = besideStep(null, { front: null, now: T0 });
    assert.equal(s.behind, false);
    s = besideStep(s, { front: front('trading', T0), now: T0 + SEC });
    assert.equal(s.behind, false);

    s = besideStep(s, { front: front('archive', T0 + 10 * SEC), now: T0 + 10 * SEC });
    assert.deepEqual(s, { behind: true, leftAt: 0, at: T0 + 10 * SEC });
    assert.equal(besideBehind(s, T0 + 10 * SEC), true);
    assert.match(besideLine(s, T0 + 10 * SEC), /keeps to 15 Torn and 15 TornW3B requests a minute/);

    // He comes back to Torn Bids: still the smaller share for a minute, then up.
    const back = T0 + 100 * SEC;
    s = besideStep(s, { front: front('trading', back), now: back });
    assert.deepEqual(s, { behind: true, leftAt: back, at: back });
    s = besideStep(s, { front: front('trading', back), now: back + BESIDE_UP_MS - SEC });
    assert.equal(s.behind, true);
    assert.equal(s.leftAt, back);
    s = besideStep(s, { front: front('trading', back), now: back + BESIDE_UP_MS });
    assert.deepEqual(s, { behind: false, leftAt: 0, at: back + BESIDE_UP_MS });
    assert.equal(besideLine(s, back + BESIDE_UP_MS), null);

    // Back to the Archive within that minute: behind again, and the minute starts afresh the next time.
    let again = besideStep({ behind: true, leftAt: back, at: back }, { front: front('archive', back + 20 * SEC), now: back + 20 * SEC });
    assert.equal(again.leftAt, 0);
    again = besideStep(again, { front: front('trading', back + 30 * SEC), now: back + 30 * SEC });
    assert.equal(again.leftAt, back + 30 * SEC);
});

test('Torn Archive closed: its mark goes stale and Torn Bids is not held back for good', () => {
    const looked = T0;
    // On another page, with Torn Archive still open (it says so once a minute): the last one looked at keeps it.
    const late = looked + 20 * MIN;
    assert.equal(besideArchiveInFront(front('archive', looked), front('archive', late - 50 * SEC), late), true);
    // No sign that it is open, and its page not looked at for 150 s: not in front any more.
    assert.equal(besideArchiveInFront(front('archive', looked), null, looked + BESIDE_FRESH_MS - SEC), true);
    assert.equal(besideArchiveInFront(front('archive', looked), null, looked + BESIDE_FRESH_MS), false);
    assert.equal(besideArchiveInFront(front('archive', looked), front('archive', late - BESIDE_FRESH_MS), late), false);
    // A mark from the future (the clock was changed) is not believed.
    assert.equal(besideArchiveInFront(front('archive', looked + 10 * MIN), null, looked), false);
    assert.equal(besideArchiveInFront(front('trading', looked), front('archive', looked), looked), false);

    let s = besideStep(null, { front: front('archive', looked), now: looked });
    s = besideStep(s, { front: front('archive', looked), now: looked + BESIDE_FRESH_MS });
    assert.equal(s.behind, true, 'up at once, with no minute between');
    s = besideStep(s, { front: front('archive', looked), now: looked + BESIDE_FRESH_MS + BESIDE_UP_MS });
    assert.equal(s.behind, false);
});

test('Torn Bids\' page closed while behind: the other tabs keep the smaller share until Torn Archive has stopped believing, and a minute more', () => {
    const s = { behind: true, leftAt: 0, at: T0 };
    assert.equal(besideBehind(s, T0 + BESIDE_FRESH_MS), true);
    assert.equal(besideBehind(s, T0 + BESIDE_FRESH_MS + BESIDE_UP_MS - SEC), true);
    assert.equal(besideBehind(s, T0 + BESIDE_FRESH_MS + BESIDE_UP_MS), false);
    for (const odd of [null, {}, 'x', { behind: 'yes', at: T0 }, { behind: true }, { behind: true, at: T0 + 10 * MIN }, { behind: false, at: T0 }]) assert.equal(besideBehind(odd, T0), false);
});

test('behind: 15 a minute for every tab together; otherwise this rule holds nothing back', () => {
    const behind = { behind: true, leftAt: 0, at: T0 };
    const made = (n) => Array.from({ length: n }, (_, i) => T0 - i * SEC);
    assert.equal(besideRoom(behind, made(14), T0, BESIDE_TORN_PER_MINUTE), true);
    assert.equal(besideRoom(behind, made(15), T0, BESIDE_TORN_PER_MINUTE), false);
    assert.equal(besideRoom(behind, [...made(14), T0 - 61 * SEC, T0 - 90 * SEC], T0, BESIDE_TORN_PER_MINUTE), true, 'requests older than a minute were counted');
    assert.equal(besideRoom(null, made(99), T0, BESIDE_TORN_PER_MINUTE), true);
    assert.equal(besideRoom({ behind: false, at: T0 }, made(99), T0, BESIDE_TORN_PER_MINUTE), true);
});

test('what is written, and how often', () => {
    assert.deepEqual(JSON.parse(besideBehindText(T0)), { app: 'trading', at: T0, torn: 15, w3b: 15 });
    const behind = { behind: true, leftAt: 0, at: T0 };
    assert.equal(besideDue(null, { behind: false, leftAt: 0, at: T0 }, T0), false, 'written with nothing to say');
    assert.equal(besideDue(null, behind, T0), true);
    assert.equal(besideDue(behind, { ...behind, at: T0 + BESIDE_RENEW_MS - SEC }, T0 + BESIDE_RENEW_MS - SEC), false);
    assert.equal(besideDue(behind, { ...behind, at: T0 + BESIDE_RENEW_MS }, T0 + BESIDE_RENEW_MS), true);
    assert.equal(besideDue(behind, { behind: true, leftAt: T0 + SEC, at: T0 + SEC }, T0 + SEC), true);
    assert.equal(besideDue(behind, { behind: false, leftAt: 0, at: T0 + SEC }, T0 + SEC), true);
    // A hidden tab's timers run about once a minute: the mark is then renewed every minute, and believed for 150 s.
    assert.ok(BESIDE_FRESH_MS >= 2 * MIN + BESIDE_RENEW_MS);
});

test('the TornW3B client: every tab together keeps to the ceiling it is given for a while', async () => {
    let t = T0;
    let ceiling = Infinity;
    const window_ = [];
    const calls = [];
    const client = new W3bClient({
        now: () => t,
        maxPerMinute: 60,
        sharedPerMinute: 80,
        sharedCeiling: () => ceiling,
        loadShared: () => ({ recent: window_.filter((x) => t - x < MIN), cooldownUntil: 0 }),
        saveShared: () => {},
        addShared: (at) => window_.push(at),
        sleep: async (ms) => { t += ms; },
        fetchImpl: async () => { calls.push(t); return { ok: true, status: 200, json: async () => ({}) }; },
    });
    // Another tab has made 14 in this minute.
    for (let i = 0; i < 14; i += 1) window_.push(T0 - i * SEC);
    ceiling = BESIDE_W3B_PER_MINUTE;
    await client.get('marketplace');
    assert.equal(calls[0], T0, 'the 15th of the minute was held');
    await client.get('marketplace');
    assert.ok(calls[1] >= T0 - 13 * SEC + MIN, 'the 16th went before the oldest had left the minute');
    // With no ceiling given the usual one stands.
    ceiling = Infinity;
    assert.equal(client.sharedNow(), 80);
    ceiling = 500;
    assert.equal(client.sharedNow(), 80);
    ceiling = 0;
    assert.equal(client.sharedNow(), 1);
});

// ---- the two halves together -------------------------------------------------------------------------

function archiveFile(rel) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const file = path.join(dir, 'archive', rel);
        if (fs.existsSync(file)) return pathToFileURL(file).href;
        const up = path.dirname(dir);
        if (up === dir) return null;
        dir = up;
    }
}

const turnsFile = archiveFile('src/core/turns.js');

test('Torn Bids and Torn Archive, each by its own rules: never over one limit together, and the one looked at gets the larger share', { skip: turnsFile ? false : 'Torn Archive\'s folder is not beside this one' }, async () => {
    const turns = await import(turnsFile);
    assert.equal(turns.FRONT_MARK, BESIDE_FRONT_MARK);
    assert.equal(turns.BEHIND_MARK, BESIDE_BEHIND_MARK);
    assert.equal(turns.BEHIND_FRESH_MS, BESIDE_FRESH_MS);
    assert.equal(turns.RAMP_MS, BESIDE_UP_MS);

    // What he does, second by second: which page is in view with the keyboard.
    //   0-2 min Torn Bids, 2-7 the Archive, 7-10 Torn Bids, 10-14 the Archive, 14-17 a Torn page (the Archive keeps it),
    //   at 15:00 Torn Bids' own page is closed (its panel on Torn's pages goes on), 17-22 the Archive, 22-24 a Torn page.
    const looking = (s) => (s < 120 ? 'trading' : s < 420 ? 'archive' : s < 600 ? 'trading' : s < 840 ? 'archive' : s < 1020 ? 'torn' : s < 1320 ? 'archive' : 'torn');
    const bidsPageOpen = (s) => s < 900;

    const page = new Map(); // the site's own page storage
    let stored = null; // Torn Bids' answer for all its tabs
    let archiveViewAt = 0;
    let tradingViewAt = 0;
    let frontSince = 0;
    const made = { bids: { torn: [], w3b: [] }, archive: { torn: [], w3b: [] } };
    const recent = (list, now) => list.filter((x) => now - x < MIN);
    const peak = { torn: 0, w3b: 0, archiveTorn: 0, bidsTorn: 0, bidsBehindTorn: 0 };
    const LIMIT = { torn: 100, w3b: 100 };
    // Torn Bids' own ceilings with the whole limit (what Torn Archive's rules take it to be).
    const BIDS = { torn: turns.TORN_PER_MINUTE_ALONE, w3b: turns.W3B_PER_MINUTE_ALONE };

    for (let s = 0; s < 1440; s += 1) {
        const now = T0 + s * SEC;
        const at = looking(s);
        // Torn Archive's script writes `front` for both pages, every 5 s while one is looked at.
        if (s % 5 === 0 && at === 'archive') { archiveViewAt = now; page.set(turns.FRONT_MARK, turns.markText({ app: 'archive', at: now })); }
        if (s % 5 === 0 && at === 'trading' && bidsPageOpen(s)) { tradingViewAt = now; page.set(turns.FRONT_MARK, turns.markText({ app: 'trading', at: now })); }

        // Torn Bids' page looks every 5 s while it is open (as src/main.js does).
        if (bidsPageOpen(s) && s % (BESIDE_LOOK_EVERY_MS / SEC) === 0) {
            const next = besideStep(stored, { front: besideMark(page.get(BESIDE_FRONT_MARK) ?? null), alive: null, now });
            if (besideDue(stored, next, now)) {
                stored = next;
                if (next.behind) page.set(BESIDE_BEHIND_MARK, besideBehindText(now));
            }
        }

        // Torn Archive's share (as its main.js applies turns.js); Torn Bids is seen running all along.
        const inFront = turns.archiveInFront(archiveViewAt, tradingViewAt);
        if (!inFront) frontSince = 0; else if (!frontSince) frontSince = now;
        const share = turns.shareNow({ now, tradingSeenAt: now, tradingViewAt, archiveViewAt, behind: turns.readMark(page.get(turns.BEHIND_MARK) ?? null), frontSince });

        // Both ask as much as their own rules allow.
        for (const kind of ['torn', 'w3b']) {
            const bids = recent(made.bids[kind], now);
            const mine = besideBehind(stored, now) ? (kind === 'torn' ? BESIDE_TORN_PER_MINUTE : BESIDE_W3B_PER_MINUTE) : BIDS[kind];
            for (let i = 0; i < 3 && bids.length < mine && besideRoom(stored, bids, now, kind === 'torn' ? BESIDE_TORN_PER_MINUTE : BESIDE_W3B_PER_MINUTE); i += 1) { bids.push(now); made.bids[kind].push(now); }
            const theirs = recent(made.archive[kind], now);
            for (let i = 0; i < 3 && theirs.length < share[kind]; i += 1) { theirs.push(now); made.archive[kind].push(now); }
            const together = bids.length + theirs.length;
            assert.ok(together <= LIMIT[kind], `${kind}: ${together} in one minute at ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} (Torn Bids ${bids.length}, Torn Archive ${theirs.length})`);
            peak[kind] = Math.max(peak[kind], together);
            if (kind === 'torn') {
                peak.archiveTorn = Math.max(peak.archiveTorn, theirs.length);
                if (at === 'trading' && s > 500) peak.bidsTorn = Math.max(peak.bidsTorn, bids.length);
                // Three minutes into looking at the Archive: Torn Bids is down to its smaller share.
                if (s > 300 && s < 420) peak.bidsBehindTorn = Math.max(peak.bidsBehindTorn, bids.length);
            }
        }
    }
    assert.equal(peak.archiveTorn, turns.SHARES.front.torn, 'Torn Archive never got the larger share while it was looked at');
    assert.equal(peak.bidsTorn, BIDS.torn, 'Torn Bids never got its whole limit back');
    assert.equal(peak.bidsBehindTorn, BESIDE_TORN_PER_MINUTE);
});
