// The requests go to where he is (core/front.js; plan part 1c, the owner 2026-10-09: "just throttle
// depending on usage/page he is viewing ... on the overlay/torn page, we can throttle the api calls
// from tornbids as he is already actively buying, when hes in tornbids, throttle the overlay so
// tornbids gets it all"). No switch: each side says when it was last in view and last came to the
// front, and every tab works out from those four numbers who may ask for what.

import test from 'node:test';
import assert from 'node:assert/strict';
import { frontSide, frontMayAsk, frontWords, frontBeat, FRONT_BEAT_MS, FRONT_ALIVE_MS, FRONT_KEEP_MS } from '../src/core/front.js';
import { W3bClient, W3B_GAP_MIN_MS } from '../src/api/w3b.js';

const T0 = 1_700_000_000_000;
const S = 1000;

test('who is in front: the side in view; both in view (two windows), the one he came to last; neither, nobody', () => {
    const now = T0;
    assert.equal(frontSide({ bids: null, page: null }, now), 'none');
    assert.equal(frontSide({ bids: { seen: now - 5 * S, front: now - 60 * S }, page: null }, now), 'bids');
    assert.equal(frontSide({ bids: null, page: { seen: now - 5 * S, front: now - 60 * S } }, now), 'page');
    // He went from Torn Bids to a Torn page three seconds ago: Torn Bids' last sign of life is still recent.
    assert.equal(frontSide({ bids: { seen: now - 8 * S, front: now - 300 * S }, page: { seen: now - 3 * S, front: now - 3 * S } }, now), 'page');
    // And back.
    assert.equal(frontSide({ bids: { seen: now, front: now }, page: { seen: now - 4 * S, front: now - 30 * S } }, now), 'bids');
    // Both windows in view for minutes: where he clicked last.
    assert.equal(frontSide({ bids: { seen: now - 2 * S, front: now - 500 * S }, page: { seen: now - 2 * S, front: now - 100 * S } }, now), 'page');
    // A side not seen for a while is not in view, however lately it was in front.
    assert.equal(frontSide({ bids: { seen: now - FRONT_ALIVE_MS, front: now - FRONT_ALIVE_MS }, page: { seen: now - 1 * S, front: now - 900 * S } }, now), 'page');
    assert.equal(frontSide({ bids: { seen: now - FRONT_ALIVE_MS, front: now }, page: { seen: now - FRONT_ALIVE_MS - 1, front: now } }, now), 'none');
    // A time from the future (the clock was changed) and junk are not believed.
    assert.equal(frontSide({ bids: { seen: now + 3600 * S, front: now + 3600 * S }, page: { seen: now, front: now - 10 * S } }, now), 'page');
    assert.equal(frontSide({ bids: { seen: 'x', front: {} }, page: 7 }, now), 'none');
    // The sign of life comes every ten seconds, so "in view" outlasts two missed ones.
    assert.ok(FRONT_ALIVE_MS > 2 * FRONT_BEAT_MS);
});

test('a Torn page in front: the page asks; Torn Bids keeps its turn a short while, then asks only for a trade', () => {
    const left = T0;
    // He leaves Torn Bids for a Torn page at `left` (same window: Torn Bids is hidden from then on).
    const sides = (now) => ({ bids: { seen: left - 4 * S, front: left - 600 * S }, page: { seen: now, front: left } });
    assert.equal(frontMayAsk('page', sides(left + 1 * S), left + 1 * S), true);
    // Back and forth in a buying run must not flip it every few seconds.
    assert.equal(frontMayAsk('bids', sides(left + 1 * S), left + 1 * S), true);
    assert.equal(frontMayAsk('bids', sides(left + FRONT_KEEP_MS - 1), left + FRONT_KEEP_MS - 1), true);
    assert.equal(frontMayAsk('bids', sides(left + FRONT_KEEP_MS), left + FRONT_KEEP_MS), false);
    assert.equal(frontMayAsk('bids', sides(left + 600 * S), left + 600 * S), false);
    // Two windows, Torn Bids still in view but he is clicking in Torn: the same, counted from when he went there.
    const two = (now) => ({ bids: { seen: now - 2 * S, front: left - 600 * S }, page: { seen: now - 1 * S, front: left } });
    assert.equal(frontMayAsk('bids', two(left + 10 * S), left + 10 * S), true);
    assert.equal(frontMayAsk('bids', two(left + FRONT_KEEP_MS + 1 * S), left + FRONT_KEEP_MS + 1 * S), false);
    assert.equal(frontMayAsk('page', two(left + FRONT_KEEP_MS + 1 * S), left + FRONT_KEEP_MS + 1 * S), true);
});

test('Torn Bids in front: it has the reads, and the panel on a Torn page asks nothing of its own - at once', () => {
    const now = T0;
    const sides = { bids: { seen: now, front: now - 1 * S }, page: { seen: now - 2 * S, front: now - 400 * S } };
    assert.equal(frontMayAsk('bids', sides, now), true);
    assert.equal(frontMayAsk('page', sides, now), false);
});

test('nothing of ours in view: nothing of its own is asked by either side, once Torn Bids\' short turn is over', () => {
    const left = T0;
    const sides = { bids: { seen: left, front: left - 900 * S }, page: { seen: left - 500 * S, front: left - 900 * S } };
    assert.equal(frontSide(sides, left + FRONT_ALIVE_MS + 1), 'none');
    assert.equal(frontMayAsk('page', sides, left + FRONT_ALIVE_MS + 1), false);
    assert.equal(frontMayAsk('bids', sides, left + FRONT_KEEP_MS - 1), true);
    assert.equal(frontMayAsk('bids', sides, left + FRONT_KEEP_MS), false);
    // Never opened at all.
    assert.equal(frontMayAsk('bids', { bids: null, page: null }, left), false);
});

test('the sign of life: written every ten seconds while in view, at once when he comes to it, never from a hidden tab', () => {
    const now = T0;
    // Nothing stored yet, in view and focused: both numbers.
    assert.deepEqual(frontBeat({ seen: 0, front: 0 }, { visible: true, came: true, now }), { seen: now, front: now });
    // In view, nothing new: only when the last one is ten seconds old.
    assert.equal(frontBeat({ seen: now - FRONT_BEAT_MS + 1, front: now - 50 * S }, { visible: true, came: false, now }), null);
    assert.deepEqual(frontBeat({ seen: now - FRONT_BEAT_MS, front: now - 50 * S }, { visible: true, came: false, now }), { seen: now, front: now - 50 * S });
    // He comes to it (the tab is shown, or its window gets the focus): at once, whatever the last one's age.
    assert.deepEqual(frontBeat({ seen: now - 1 * S, front: now - 50 * S }, { visible: true, came: true, now }), { seen: now, front: now });
    // Hidden: nothing is written, and what is stored is left to grow old.
    assert.equal(frontBeat({ seen: now - 60 * S, front: now - 90 * S }, { visible: false, came: true, now }), null);
    // In view from the start with no "came" seen (a page that loaded in view without the focus): it is in view, and in front from now only if it never was.
    assert.deepEqual(frontBeat(null, { visible: true, came: false, now }), { seen: now, front: now });
});

test('what the panel says, by where he is - the three lines of the drawing', () => {
    assert.equal(frontWords('page'), 'Reading for this page. Torn Bids in another tab asks only for a trade you accepted.');
    assert.equal(frontWords('bids'), 'Torn Bids has the reads. This panel asks nothing of its own.');
    assert.equal(frontWords('none'), 'Nothing is being read.');
});

/*
 * The plan's test for 1c: a pretend TornW3B that refuses a burst, and two pretend tabs that go by the
 * rules above - a Torn page in view, then Torn Bids, then back and forth every ten seconds. Each tab
 * wants a read of its own whenever it may ask; Torn Bids also has an accepted trade whose item it
 * reads every 20 s whoever is in front.
 */
function rig({ burst = 12 } = {}) {
    let t = T0;
    const store = new Map();
    const served = [];
    const refused = [];
    const sent = [];
    const sides = { bids: { seen: 0, front: 0 }, page: { seen: 0, front: 0 } };
    let inView = null;
    const client = (side) => new W3bClient({
        pace: true,
        now: () => t,
        sleep: async (ms) => { t += ms; },
        loadShared: () => (store.has('s') ? JSON.parse(store.get('s')) : null),
        saveShared: (s) => store.set('s', JSON.stringify(s)),
        onSent: (x) => sent.push({ side, at: x.at ?? t, tag: x.tag }),
        fetchImpl: async () => {
            const lately = served.filter((at) => t - at < 10000).length;
            t += 120;
            if (lately >= burst) {
                refused.push(t);
                return { ok: false, status: 429, json: async () => ({}) };
            }
            served.push(t);
            return { ok: true, status: 200, json: async () => ({ listings: [] }) };
        },
    });
    const tabs = { bids: client('bids'), page: client('page') };
    let tradeReadAt = 0;
    const beat = () => {
        for (const side of ['bids', 'page']) {
            const next = frontBeat(sides[side], { visible: inView === side, came: false, now: t });
            if (next) sides[side] = next;
        }
    };
    const show = (side) => {
        inView = side;
        if (side) sides[side] = frontBeat(sides[side], { visible: true, came: true, now: t });
    };
    /** `ms` of both tabs' 1 s ticks. */
    const run = async (ms) => {
        const end = t + ms;
        while (t < end) {
            const before = t;
            beat();
            // The overlay asks only from a tab in view (its client sends nothing from a hidden one).
            if (inView === 'page' && frontMayAsk('page', sides, t) && !tabs.page.stats().coolingDown) await tabs.page.get('pricelist/1', { tag: 'w.feed' }).catch(() => {});
            if (!tabs.bids.stats().coolingDown) {
                if (frontMayAsk('bids', sides, t)) await tabs.bids.get('pricelist/2', { tag: 'w.flips' }).catch(() => {});
                else if (t - tradeReadAt >= 20000) {
                    tradeReadAt = t;
                    await tabs.bids.get('pricelist/206', { tag: 'w.trade' }).catch(() => {});
                }
            }
            if (t === before) t += 1000;
        }
    };
    return { run, show, sent, refused, sides, clock: () => t };
}

test('two tabs by these rules: the one in view gets its reads within the gap, the other only its trade\'s, and nothing is refused', async () => {
    const r = rig();
    const between = (side, tag, from, to) => r.sent.filter((s) => s.side === side && (!tag || s.tag === tag) && s.at >= from && s.at < to);
    const widest = (list) => list.slice(1).reduce((most, s, i) => Math.max(most, s.at - list[i].at), 0);

    // 1. A Torn page in view for three minutes, Torn Bids open behind it.
    r.show('page');
    let from = r.clock();
    await r.run(180 * S);
    let to = r.clock();
    const page1 = between('page', 'w.feed', from + 60 * S, to);
    assert.ok(page1.length >= 60, 'the page got ' + page1.length + ' reads in two minutes');
    assert.ok(widest(page1) <= 4 * S, 'the page waited ' + widest(page1) + ' ms between two reads');
    // Torn Bids: nothing of its own (it was never in front), its accepted trade's item every 20 s.
    assert.equal(between('bids', 'w.flips', from, to).length, 0);
    const trade1 = between('bids', 'w.trade', from, to);
    assert.ok(trade1.length >= 7 && trade1.length <= 10, 'the trade was read ' + trade1.length + ' times in three minutes');

    // 2. He goes to Torn Bids for three minutes: it has the reads, the page's tab is hidden and silent.
    r.show('bids');
    from = r.clock();
    await r.run(180 * S);
    to = r.clock();
    const bids2 = between('bids', 'w.flips', from, to);
    assert.ok(bids2.length >= 120, 'Torn Bids got ' + bids2.length + ' reads in three minutes');
    assert.ok(widest(bids2) <= 3 * S, 'Torn Bids waited ' + widest(bids2) + ' ms between two reads');
    assert.equal(between('page', null, from + 2 * S, to).length, 0);

    // 3. A buying run: ten seconds on a bazaar, ten on Torn Bids, for three minutes. Torn Bids never loses its turn.
    from = r.clock();
    for (let i = 0; i < 9; i++) {
        r.show('page');
        await r.run(10 * S);
        r.show('bids');
        await r.run(10 * S);
    }
    to = r.clock();
    const bids3 = between('bids', 'w.flips', from, to);
    assert.ok(widest(bids3) <= 5 * S, 'in the buying run Torn Bids waited ' + widest(bids3) + ' ms between two reads');
    assert.ok(between('page', 'w.feed', from, to).length >= 30, 'the bazaar pages got ' + between('page', 'w.feed', from, to).length + ' reads');

    // 4. He stays on a Torn page: Torn Bids' turn ends after the short while, and the page has the reads to itself.
    r.show('page');
    from = r.clock();
    await r.run(120 * S);
    to = r.clock();
    assert.equal(between('bids', 'w.flips', from + FRONT_KEEP_MS + 12 * S, to).length, 0);
    assert.ok(between('bids', 'w.trade', from + FRONT_KEEP_MS, to).length >= 3);

    // 5. He leaves for another site: nothing of its own from either side; the accepted trade is still read.
    r.show(null);
    from = r.clock();
    await r.run(180 * S);
    to = r.clock();
    assert.equal(between('page', null, from, to).length, 0);
    assert.equal(between('bids', 'w.flips', from, to).length, 0);
    assert.ok(between('bids', 'w.trade', from, to).length >= 7);

    // In all of it: never two requests closer than the gap, and nothing refused.
    assert.equal(r.refused.length, 0, 'refused ' + r.refused.length + ' times');
    const at = r.sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= W3B_GAP_MIN_MS, 'two requests ' + (at[i] - at[i - 1]) + ' ms apart');
});
