/*
 * Torn Bids' shell (3.25.0): which item list a page shows, and which page shows a list.
 * The two must agree: a filter set from elsewhere ("see To sell", a trade opened from Today)
 * lands on the page that then asks for that same filter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BD_PAGES, BD_FLIPS_BEST, BD_FLIPS_TRADER, BD_FLIPS_ITEMS, BD_ITEMS_ALL, BD_ITEMS_RESELL, bdFilterOf, bdPageOf } from '../src/ui/bids-shell.js';

test('the shell: each page asks for its own list, and By trader, Today, Ledger and Settings for none', () => {
    assert.equal(bdFilterOf('flips', BD_FLIPS_BEST), 'flips');
    assert.equal(bdFilterOf('flips', BD_FLIPS_ITEMS), 'all');
    assert.equal(bdFilterOf('flips', BD_FLIPS_TRADER), null);
    // Mockup AM: My items and To resell are the two tabs of Items.
    assert.equal(bdFilterOf('items', BD_ITEMS_ALL), 'mine');
    assert.equal(bdFilterOf('items', BD_ITEMS_RESELL), 'sell');
    assert.equal(bdFilterOf('mine', 0), null);
    assert.equal(bdFilterOf('sell', 0), null);
    assert.equal(bdFilterOf('trades', 0), 'trades');
    for (const id of ['today', 'ledger', 'settings', 'nowhere']) assert.equal(bdFilterOf(id, 0), null);
});

test('the shell: a filter set from elsewhere lands on the page that shows it', () => {
    for (const filter of ['all', 'mine', 'flips', 'sell', 'trades']) {
        const at = bdPageOf(filter);
        assert.equal(bdFilterOf(at.page, at.tab), filter, filter);
    }
    // A filter nobody knows is Best flips, never a page that does not exist.
    assert.deepEqual(bdPageOf('something else'), { page: 'flips', tab: BD_FLIPS_BEST });
});

test('the shell: every page a filter lands on is in the sidebar, with the tab it names', () => {
    const pages = new Map(BD_PAGES.filter((p) => p.id).map((p) => [p.id, p]));
    for (const filter of ['all', 'mine', 'flips', 'sell', 'trades']) {
        const at = bdPageOf(filter);
        assert.ok(pages.has(at.page), at.page);
        assert.ok(at.tab === 0 || at.tab < (pages.get(at.page).tabs || []).length, at.page + ' tab ' + at.tab);
    }
    // Sidebar ids are each used once.
    assert.equal(pages.size, BD_PAGES.filter((p) => p.id).length);
});

test('the shell: Flips > Dropping (3.33.0) follows All items, For <the server owner> comes last; neither asks for an item list', async () => {
    const { BD_FLIPS_OWNER, BD_FLIPS_DROPPING } = await import('../src/ui/bids-shell.js');
    assert.equal(BD_FLIPS_DROPPING, BD_FLIPS_ITEMS + 1);
    assert.equal(BD_FLIPS_OWNER, BD_FLIPS_DROPPING + 1);
    assert.equal(bdFilterOf('flips', BD_FLIPS_OWNER), null);
    assert.equal(bdFilterOf('flips', BD_FLIPS_DROPPING), null);
});
