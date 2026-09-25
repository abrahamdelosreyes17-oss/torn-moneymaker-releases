import test from 'node:test';
import assert from 'node:assert/strict';

import { ownBazaarPage } from '../src/sources/route.js';
import { renderPriceGraph } from '../src/ui/graph.js';
import {
    emptyHistory,
    readHistory,
    mergeHistory,
    recordSample,
    recordMarketValue,
    touchItem,
    pruneHistory,
    averages,
    series,
    coverageText,
    RES,
    HISTORY_MAX_ITEMS,
} from '../src/core/history.js';

/* ============================================================ own bazaar */

test('own bazaar: bazaar.php with no userId and #/add or #/manage', () => {
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php#/add'), 'add');
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php#/manage'), 'manage');
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php#/Add'), 'add');
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php?#/manage'), 'manage');
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php#/'), null, 'your storefront');
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php#/personalize'), null);
    assert.equal(ownBazaarPage('https://www.torn.com/bazaar.php?userId=123#/add'), null, "someone else's bazaar");
    assert.equal(ownBazaarPage('https://www.torn.com/page.php?sid=ItemMarket#/add'), null);
    assert.equal(ownBazaarPage(''), null);
});

/* =============================================================== history */

const H = 60 * 60 * 1000;
const D = 24 * H;

test('history: samples land in 5-minute, hourly and 6-hourly buckets; averages carry coverage', () => {
    const store = emptyHistory();
    const t0 = 1_800_000_000_000;

    // Twelve samples, one every 5 minutes over the last hour.
    for (let i = 12; i >= 1; i--) {
        recordSample(store, '206', t0 - i * 5 * 60 * 1000, { im: 100 + i, bz: 200 });
    }
    // A sample with only a bazaar price leaves the Item Market column alone.
    recordSample(store, '206', t0, { bz: 190 });

    const rec = store.items['206'];
    assert.equal(rec.m5.length, 13);
    assert.equal(rec.m5[rec.m5.length - 1][1], null, 'no IM value in the last bucket');
    assert.equal(rec.m5[rec.m5.length - 1][2], 190);

    const a = averages(store, '206', t0);
    assert.equal(a['1h'].buckets, 12);
    assert.ok(a['1h'].coverage >= 0.9 && a['1h'].coverage <= 1, '1h covered: ' + a['1h'].coverage);
    assert.ok(a['1h'].im >= 101 && a['1h'].im <= 112);
    assert.ok(a['1h'].bz >= 190 && a['1h'].bz <= 200);

    // Six hours: only one of six hours has data.
    assert.ok(a['6h'].coverage > 0.14 && a['6h'].coverage < 0.2, '6h coverage ' + a['6h'].coverage);
    assert.ok(a['24h'].coverage < 0.06);
    assert.equal(a['7d'].buckets, 168);
    assert.ok(a['7d'].coverage > 0 && a['7d'].coverage < 0.02, 'one or two hourly buckets of 168');
    assert.equal(a['30d'].buckets, 120);
    assert.ok(a['30d'].im > 0, 'the 6-hourly bucket holds the running average');

    assert.equal(coverageText(0.4, '24h'), '40% of 24h');
});

test('history: no data means no number, not a fake one', () => {
    const store = emptyHistory();
    const a = averages(store, '1', 1_800_000_000_000);
    for (const key of ['1h', '6h', '24h', '7d', '30d']) {
        assert.equal(a[key].im, null);
        assert.equal(a[key].bz, null);
        assert.equal(a[key].coverage, 0);
    }
    const s = series(store, '1', 1_800_000_000_000, '24h');
    assert.deepEqual(s.points, []);
});

test('history: market value once a day, buckets pruned to their windows, items capped', () => {
    const store = emptyHistory();
    const now = 1_800_000_000_000;

    recordMarketValue(store, '1', now - D, 500);
    recordMarketValue(store, '1', now, 510);
    recordMarketValue(store, '1', now + 1000, 520);
    assert.equal(store.items['1'].mv.length, 2, 'same day overwrites');
    assert.equal(store.items['1'].mv[1][1], 520);

    // Old samples fall out of each resolution's window.
    recordSample(store, '1', now - 2 * D, { im: 1 });
    recordSample(store, '1', now - 8 * D, { im: 1 });
    recordSample(store, '1', now - 31 * D, { im: 1 });
    recordSample(store, '1', now, { im: 2 });
    pruneHistory(store, now);
    const rec = store.items['1'];
    assert.equal(rec.m5.length, 1, '5-minute buckets keep 24h');
    assert.equal(rec.h1.length, 2, 'hourly buckets keep 7d');
    assert.equal(rec.h6.length, 3, '6-hourly buckets keep 30d');
    assert.equal(RES.m5.keep * RES.m5.ms, D);

    for (let i = 0; i < HISTORY_MAX_ITEMS + 5; i++) touchItem(store, 'x' + i, now + i);
    pruneHistory(store, now + 1000);
    assert.equal(Object.keys(store.items).length, HISTORY_MAX_ITEMS);
    assert.equal(store.items['1'], undefined, 'least recently seen dropped first');

    const s = series(store, 'x60', now + 1000, '7d');
    assert.equal(s.to - s.from, 7 * D);

    assert.deepEqual(readHistory({ version: 99 }), emptyHistory());
    const round = JSON.parse(JSON.stringify(store));
    assert.equal(Object.keys(readHistory(round).items).length, HISTORY_MAX_ITEMS);
});

test('history: two tabs\' copies merge, so inventory items and bazaar samples both survive', () => {
    const now = 1_800_000_000_000;

    // The selling tab: touched its inventory items and saved.
    const selling = emptyHistory();
    touchItem(selling, '206', now);
    touchItem(selling, '1', now - 1000);
    recordSample(selling, '1', now + 10 * 60 * 1000, { im: 100 });

    // The bazaar tab: loaded before that save, recorded samples for other items.
    const bazaar = emptyHistory();
    recordSample(bazaar, '1', now + 20 * 60 * 1000, { im: 120, bz: 90 });
    recordSample(bazaar, '180', now, { im: 30 });
    touchItem(bazaar, '1', now + 25 * 60 * 1000);

    const merged = mergeHistory(selling, bazaar);
    assert.deepEqual(Object.keys(merged.items).sort(), ['1', '180', '206'], 'items from both tabs');
    assert.equal(merged.items['1'].seen, now + 25 * 60 * 1000, 'the later seen wins');
    assert.equal(merged.items['1'].m5.length, 2, 'both samples, union by bucket');
    assert.deepEqual(merged.items['1'].m5.map((b) => b[1]), [100, 120]);
    assert.equal(merged.items['1'].h1.length, 1, 'same hour: one bucket');
    assert.equal(merged.items['1'].h1[0][3], 1, 'sample counts are per copy, not added twice');

    // A 5-minute bucket both have: the local column wins, a missing column is filled from storage.
    const a = emptyHistory();
    recordSample(a, '9', now, { im: 50, bz: 40 });
    const b = emptyHistory();
    recordSample(b, '9', now, { im: 55 });
    assert.deepEqual(mergeHistory(a, b).items['9'].m5[0].slice(1), [55, 40]);
    assert.deepEqual(mergeHistory(b, a).items['9'].m5[0].slice(1), [50, 40]);

    // An hourly bucket both have: per column, the value backed by more samples.
    const c = emptyHistory();
    for (let i = 0; i < 3; i++) recordSample(c, '9', now + i * 1000, { im: 100 });
    const d = emptyHistory();
    recordSample(d, '9', now, { im: 900, bz: 10 });
    const cd = mergeHistory(c, d).items['9'].h1[0];
    assert.equal(cd[1], 100, 'three samples beat one');
    assert.equal(cd[3], 3);
    assert.equal(cd[2], 10, 'the only bazaar sample is kept');

    // Neither input is changed, and the result round-trips.
    assert.equal(selling.items['180'], undefined);
    assert.equal(bazaar.items['206'], undefined);
    assert.equal(Object.keys(readHistory(JSON.parse(JSON.stringify(merged))).items).length, 3);
    assert.deepEqual(mergeHistory(null, null), emptyHistory());
});

/** Just enough of a DOM for the graph: attributes and children are recorded. */
function fakeDocument() {
    const make = (tag) => {
        const node = { tag, attrs: {}, children: [], textContent: '' };
        node.setAttribute = (k, v) => (node.attrs[k] = v);
        node.appendChild = (c) => node.children.push(c);
        node.addEventListener = () => {};
        node.style = {};
        return node;
    };
    return { createElementNS: (_ns, tag) => make(tag), createElement: make };
}

test('graph: recorded runs are solid, gaps are bridged by a dotted line, a lone sample is a dot', () => {
    const prev = globalThis.document;
    globalThis.document = fakeDocument();
    try {
        const step = RES.m5.ms;
        const t0 = 1_800_000_000_000;
        const points = [
            { t: t0, im: 10, bz: null },
            { t: t0 + step, im: 11, bz: null },
            // three buckets missing here
            { t: t0 + 5 * step, im: 12, bz: null },
            { t: t0 + 6 * step, im: 13, bz: null },
            // a lone sample after a gap
            { t: t0 + 9 * step, im: 14, bz: null },
        ];
        const svgOf = (fig) => fig.children.find((c) => c.tag === 'svg');
        const runs = (svg) => {
            const paths = svg.children.filter((c) => c.tag === 'path');
            const solid = paths.find((p) => !p.attrs['stroke-dasharray']);
            const dotted = paths.find((p) => p.attrs['stroke-dasharray']);
            return {
                solid: solid.attrs.d.split('M').filter(Boolean).length,
                dotted: dotted ? dotted.attrs.d.split('M').filter(Boolean).length : 0,
            };
        };
        const svg = svgOf(renderPriceGraph({ from: t0, to: t0 + 10 * step, points, mv: [], step }));
        assert.deepEqual(runs(svg), { solid: 3, dotted: 2 }, 'three recorded runs, two gaps bridged');
        const dots = svg.children.filter((c) => c.tag === 'circle' && c.attrs.visibility !== 'hidden');
        assert.equal(dots.length, 1, 'the lone sample is a dot');
        // A price scale and time marks are drawn, so the graph can be read.
        const labels = svg.children.filter((c) => c.tag === 'text').map((c) => c.textContent);
        assert.equal(labels.length, 6);
        assert.ok(labels.includes('now'));

        // Without `step`, the bucket width is inferred from the closest neighbours.
        const inferred = svgOf(renderPriceGraph({ from: t0, to: t0 + 10 * step, points, mv: [] }));
        assert.deepEqual(runs(inferred), { solid: 3, dotted: 2 });
    } finally {
        globalThis.document = prev;
    }
});
