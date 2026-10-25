import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchInventory, TORN_INVENTORY_CATEGORIES } from '../src/api/torn.js';
import { TornApiClient } from '../src/api/client.js';
import {
    inventoryPlan, inventoryLearn, inventoryDue, inventoryResume, inventoryPolicyClean, networthWanted,
    INVENTORY_EMPTY_RECHECK_MS, INVENTORY_DIRTY_GAP_MS, INVENTORY_RESUME_MS, NETWORTH_CANDIDATES_MAX,
} from '../src/core/key-spend.js';

const KEY = 'abcdef1234567890';
const NOW = 1_900_000_000_000;
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const page = (items) => response(200, { inventory: { items }, _metadata: { links: { next: null } } });

/** A Torn that refuses the no-category read and holds Xanax (Drug) and a Hammer (Tool). */
function torn({ failOn = null } = {}) {
    const urls = [];
    const client = new TornApiClient({
        getKey: () => KEY,
        maxRetries: 0,
        fetchImpl: async (url) => {
            urls.push(url);
            const cat = new URL(url).searchParams.get('cat');
            if (!cat) return response(200, { error: { code: 21, error: 'Incorrect category' } });
            if (cat === failOn) return response(200, { error: { code: 9, error: 'API disabled' } });
            if (cat === 'Drug') return page([{ id: 206, amount: 12, name: 'Xanax' }]);
            if (cat === 'Tool') return page([{ id: 1, amount: 4, name: 'Hammer' }]);
            return page([]);
        },
    });
    return { client, urls, cats: () => urls.map((u) => new URL(u).searchParams.get('cat')) };
}

test('the first read learns the no-category read is refused and which categories are empty; the next asks only the rest', async () => {
    let policy = inventoryPolicyClean(null);
    const w = torn();
    const learn = (now) => (e) => { policy = inventoryLearn(policy, e, now); };
    await fetchInventory(w.client, { ...inventoryPlan(policy, NOW), onLearn: learn(NOW) });
    assert.equal(w.urls.length, 1 + TORN_INVENTORY_CATEGORIES.length);
    assert.equal(policy.byCategory, true);
    assert.equal(Object.keys(policy.empty).length, TORN_INVENTORY_CATEGORIES.length - 2);

    // An hour later: no refused call, and only the two categories that held something.
    const again = torn();
    const rows = await fetchInventory(again.client, { ...inventoryPlan(policy, NOW + 3_600_000), onLearn: learn(NOW + 3_600_000) });
    assert.deepEqual(again.cats().sort(), ['Drug', 'Tool']);
    assert.equal(rows.length, 2);

    // After the long wait the empty categories are asked once more.
    const later = inventoryPlan(policy, NOW + INVENTORY_EMPTY_RECHECK_MS + 1);
    assert.equal(later.skip.size, 0);
    // ...and a category that now holds something is not skipped again.
    policy = inventoryLearn(policy, { cat: 'Flower', count: 3 }, NOW + 5);
    assert.equal('Flower' in policy.empty, false);
});

test('a failed read keeps what it got; the next one resumes from there instead of the first category', async () => {
    const w = torn({ failOn: 'Drug' });
    let err = null;
    try {
        await fetchInventory(w.client, { byCategory: true });
    } catch (e) {
        err = e;
    }
    assert.ok(err && /API disabled/.test(err.message));
    assert.ok(err.partial.done.includes('Tool') && !err.partial.done.includes('Drug'));
    assert.equal(err.partial.rows.length, 1);
    const callsBefore = w.urls.length;
    assert.equal(callsBefore, TORN_INVENTORY_CATEGORIES.indexOf('Drug') + 1, 'stopped at the failing category');

    const ok = torn();
    const rows = await fetchInventory(ok.client, { resume: err.partial });
    assert.equal(ok.urls.length, TORN_INVENTORY_CATEGORIES.length - err.partial.done.length);
    assert.equal(ok.cats().includes('Tool'), false, 'Tool was not asked again');
    assert.equal(rows.length, 2);
});

test('a key that answers without a category is asked once, as before', async () => {
    const urls = [];
    const client = new TornApiClient({ getKey: () => KEY, maxRetries: 0, fetchImpl: async (u) => (urls.push(u), page([{ id: 206, amount: 1, name: 'Xanax' }])) });
    await fetchInventory(client, {});
    assert.equal(urls.length, 1);
});

test('read again on the hour, or sooner only when something changed - and then not within a minute of the last read', () => {
    const base = { inventoryAt: NOW, now: NOW + 5 * 60 * 1000 };
    assert.equal(inventoryDue({ ...base }), false);
    assert.equal(inventoryDue({ ...base, dirty: true }), true);
    assert.equal(inventoryDue({ inventoryAt: NOW, now: NOW + INVENTORY_DIRTY_GAP_MS - 1, dirty: true }), false);
    assert.equal(inventoryDue({ inventoryAt: NOW, now: NOW + 3_600_000 }), true);
    assert.equal(inventoryDue({ ...base, dirty: true, retryAt: base.now + 1 }), false, 'a failed read waits');
    assert.equal(inventoryDue({ ...base, dirty: true, keyDead: true }), false);
});

test('what a failed read got is resumed from for ten minutes only', () => {
    const kept = { at: NOW, rows: [{}], done: ['Drug'] };
    assert.equal(inventoryResume(kept, NOW + INVENTORY_RESUME_MS - 1), kept);
    assert.equal(inventoryResume(kept, NOW + INVENTORY_RESUME_MS), null);
    assert.equal(inventoryResume(null, NOW), null);
});

test('networth: the buyers in view, then the first few of the candidate flips - not every one', () => {
    const candidates = Array.from({ length: 40 }, (_, i) => 'c' + i);
    const ids = networthWanted({ view: ['v1', 'v2', 'c1'], candidates });
    assert.equal(ids.length, 2 + NETWORTH_CANDIDATES_MAX);
    assert.deepEqual(ids.slice(0, 3), ['v1', 'v2', 'c1']);
    assert.equal(ids.includes('c39'), false);
    assert.deepEqual(networthWanted({}), []);
});
