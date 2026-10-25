// Shared, end to end without a network: the script's exchange (src/feed/shared-link.js) against the
// real server code, a pretend Torn behind it, and a pretend GM storage that two tabs share.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedLink, SHARED_WHO_OUT_KEY, SHARED_CONFIG_KEY, SHARED_STATE_KEY, SHARED_GRANT_KEY, SHARED_MARKS_KEY, SHARED_TICK_MS, SHARED_UNKNOWN_MS, SHARED_UNKNOWN_STEPS_MS, sharedUnknownWait } from '../src/feed/shared-link.js';
import { sharedOutgoingOk, sharedMayCall, withShared, sharedNowLine, sharedPanelLine, sharedKnown, sharedWord, sharedSaid, sharedSaidLine } from '../src/core/shared.js';
import { whoOutAdd, seesOf, lookedOf } from '../src/core/who-sells.js';
import { serverFile } from './server-path.js';

const { peopleFrom, whoIs } = await import(serverFile('src/host.js'));
const { KEY_ABE, KEY_VINCENT, KEY_FRIEND, KEY_DONOR, PASS_ABE, PASS_OWNER, ENV, WHO, newWorld } = await import(serverFile('test/server-world.js'));

const ADDRESS = 'https://torn-bids-shared.test.workers.dev';
// This PC's clock runs seven minutes ahead of the server's.
const SKEW = 7 * 60000;

// GM storage as tabs see it: one store, and a tab is told of what ANOTHER tab wrote.
function newGm() {
    const values = new Map();
    const tabs = [];
    return {
        values,
        tab(onStored) {
            const me = { onStored };
            tabs.push(me);
            return {
                load: (key) => (values.has(key) ? structuredClone(values.get(key)) : null),
                save: (key, value) => { values.set(key, structuredClone(value)); for (const t of tabs) if (t !== me) t.onStored(key); },
                del: (key) => { values.delete(key); for (const t of tabs) if (t !== me) t.onStored(key); },
            };
        },
    };
}

function setUp({ pass = PASS_ABE, down = () => false, version = '3.25.0', env = ENV, door = false } = {}) {
    const gm = newGm();
    const posts = [];
    const pc = { used: 5, waiting: 0, links: [], redraws: 0 };
    const world = newWorld({
        env,
        onSleep: async (w) => { await pc.tickDue(w); },
    });
    const people = peopleFrom(env);
    const post = async (url, options) => {
        posts.push({ url, body: JSON.parse(options.body), headers: options.headers, at: world.t });
        if (down()) throw new Error('Network request failed.');
        const said = String(options.headers.Authorization).replace('Bearer ', '');
        const who = door ? null : whoIs(people, said);
        // door: the server's own front door, as the live server is entered - whatever was said is its to judge.
        const out = door ? await world.host.enter(said, 'POST', new URL(url).pathname, JSON.parse(options.body)) : who ? world.host.handle(who, 'POST', new URL(url).pathname, JSON.parse(options.body)) : null;
        const status = out ? out.status : 404;
        if (pc.afterPost) { const then = pc.afterPost; pc.afterPost = null; then(); }
        return { ok: status === 200, status, json: async () => structuredClone(out.body) };
    };
    const addTab = (world_, tabId, want) => {
        const holder = {};
        const store = gm.tab((key) => holder.link && holder.link.onStored(key.startsWith('sharedReads.') ? key : key));
        holder.want = want;
        holder.link = new SharedLink({
            tabId, world: world_, version, ...store, post,
            getUse: () => ({ used: pc.used, waiting: pc.waiting }),
            getWant: () => holder.want,
            onReads: () => { pc.redraws += 1; },
            now: () => world.t + SKEW,
        });
        pc.links.push(holder.link);
        return holder;
    };
    let tickedAt = world.t;
    pc.tickDue = async (w) => {
        while (w.t - tickedAt >= SHARED_TICK_MS) {
            tickedAt += SHARED_TICK_MS;
            for (const link of pc.links) await link.tick();
        }
    };
    // Time passes: the tabs tick every 3 s, the server's reader runs when it asked to be woken.
    const pass_ = async (ms) => {
        const end = world.t + ms;
        while (world.t < end) {
            if (world.store.alarmAt !== null && world.store.alarmAt <= world.t) {
                world.store.alarmAt = null;
                await world.host.alarm();
            } else {
                world.t += 1000;
                await pc.tickDue(world);
            }
        }
    };
    gm.values.set(SHARED_CONFIG_KEY, { address: ADDRESS, pass });
    return { gm, posts, pc, world, addTab, pass: pass_, setPass: (word) => gm.values.set(SHARED_CONFIG_KEY, { address: ADDRESS, pass: word }) };
}

test('with Shared off nothing is sent', async () => {
    const s = setUp();
    s.gm.values.delete(SHARED_CONFIG_KEY);
    const tab = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(120000);
    assert.equal(s.posts.length, 0);
    assert.equal(tab.link.reads(), null);
    assert.equal(tab.link.grant(), null);
    assert.equal(tab.link.status().on, false);
    s.gm.values.set(SHARED_CONFIG_KEY, { address: 'https://evil.example.com', pass: PASS_ABE });
    await s.pass(60000);
    assert.equal(s.posts.length, 0, 'an address that is not ours was used');
});

test('two tabs, one exchange every 30 s; the server reads the bazaars and both tabs get the same', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }, { ID: 999, price: 5, quantity: 1 }]);
    s.world.bazaars.set(12, [{ ID: 367, price: 1100, quantity: 40 }]);
    const sell = s.addTab('sell', 't-sell', { sellers: [11, 12], trades: [11], worth: { 206: 850000 } });
    const app = s.addTab('app', 't-app', { looking: [12], worth: { 367: 1500 } });
    await s.pass(150000);

    // One exchange per 30 s, not one per tab.
    assert.ok(s.posts.length >= 4 && s.posts.length <= 6, `${s.posts.length} exchanges in 150 s`);
    for (const p of s.posts) {
        assert.equal(p.url, `${ADDRESS}/sync`);
        assert.equal(p.headers.Authorization, `Bearer ${PASS_ABE}`);
        assert.equal(sharedOutgoingOk(p.body), true);
    }
    // What both parts of the script want went out together.
    const last = s.posts[s.posts.length - 1].body;
    assert.deepEqual([...last.sellers].sort((a, b) => a - b), [11, 12]);
    assert.deepEqual(last.trades, [11]);
    assert.deepEqual(last.looking, [12]);
    assert.deepEqual(s.posts[0].body.worth, { 206: 850000, 367: 1500 });
    assert.equal('worth' in s.posts[2].body, false, 'what the items are worth was sent again though it had not changed');
    // Each exchange asks only for what is new since the last.
    assert.equal(s.posts[0].body.since, 0);
    assert.ok(last.since > 0, 'everything was asked for again every time');
    assert.ok(last.seen > s.posts[1].body.seen && s.posts[1].body.seen > 0, 'the time of the last answer was not kept');

    // The server read them with a key of ours, and both tabs hold Torn's answer - only the items watched.
    assert.ok(s.world.requests.some((r) => r.url.includes('id=11')) && s.world.requests.every((r) => [KEY_ABE, KEY_VINCENT].includes(r.key)));
    for (const tab of [sell, app]) {
        const { index, joined } = tab.link.reads();
        assert.deepEqual(index.bySeller.get('11').items.get('206'), [{ price: 790000, qty: 2 }]);
        assert.equal(index.bySeller.get('11').items.has('999'), false);
        assert.deepEqual(index.byItem.get('367').map((l) => [l.sellerId, l.price, l.qty]), [['12', 1100, 40]]);
        // TornW3B's older row of seller 11 is corrected.
        const rows = [{ sellerId: '11', sellerName: 'Lumei', price: 800000, qty: 3, dataAt: 1000, changedAt: 1000, sponsored: false }];
        assert.deepEqual(withShared(rows, 206, index, joined).map((r) => [r.sellerName, r.price, r.qty]), [['Lumei', 790000, 2]]);
    }
    assert.ok(s.pc.redraws >= 2);
    assert.equal(sell.link.status().error, null);
    assert.equal(sell.link.status().key, 'working');
    assert.equal(sell.link.status().sellers, 2);
});

test('a bazaar read again and found the same is "seen" later; one that changed is corrected', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const tab = s.addTab('sell', 't1', { sellers: [11], trades: [11], worth: { 206: 850000 } });
    // A second tab that looks from the start, before anything is there, and only ever follows.
    const other = s.addTab('app', 't2', null);
    assert.equal(other.link.reads().index.bySeller.size, 0);
    await s.pass(90000);
    const first = tab.link.reads().index.bySeller.get('11');
    assert.ok(first);
    assert.deepEqual(other.link.reads().index.bySeller.get('11'), first);
    await s.pass(120000);
    const later = tab.link.reads().index.bySeller.get('11');
    assert.equal(later.at, first.at, 'nothing changed, yet the change time moved');
    assert.ok(later.seen >= first.seen + 60000, `seen moved on by ${later.seen - first.seen} ms in two minutes of a trade`);

    s.world.bazaars.set(11, [{ ID: 206, price: 780000, quantity: 1 }]);
    await s.pass(90000);
    const changed = tab.link.reads().index.bySeller.get('11');
    assert.deepEqual(changed.items.get('206'), [{ price: 780000, qty: 1 }]);
    assert.ok(changed.at > first.at);
    assert.deepEqual(other.link.reads().index.bySeller.get('11'), changed, 'the tab that follows still holds the old price');
});

test('the PC\'s part of its Torn limit arrives in the PC\'s own time, and holds its calls back', async () => {
    const s = setUp();
    const sellers = Array.from({ length: 200 }, (_, i) => 100 + i);
    s.pc.used = 10;
    const tab = s.addTab('sell', 't1', { sellers, looking: sellers, worth: { 206: 850000 } });
    await s.pass(120000);
    const grant = tab.link.grant();
    const pcNow = s.world.t + SKEW;
    assert.deepEqual(s.gm.values.get(SHARED_GRANT_KEY), grant);
    assert.equal(grant.need, 30);
    assert.equal(grant.serverShare, 50);
    assert.ok(pcNow - grant.at < 35000, 'the grant is stamped in the server\'s time, not this PC\'s');
    assert.ok(grant.serverTimes.length > 10, 'the server made no calls with this key');
    assert.ok(grant.serverTimes.every((t) => t <= pcNow && pcNow - t < 100000), 'the server\'s calls are not in this PC\'s time');
    // 80 usable, 50 the server's: this PC may make its 30th call of the minute, not its 31st.
    assert.equal(sharedMayCall(grant, new Array(29).fill(pcNow - 1000), pcNow), true);
    assert.equal(sharedMayCall(grant, new Array(30).fill(pcNow - 1000), pcNow), false);
    // And the server kept to its side with this key, through all of it.
    const abe = s.world.requests.filter((r) => r.key === KEY_ABE).map((r) => r.at);
    for (const at of abe) assert.ok(abe.filter((t) => t <= at && at - t < 60000).length <= 50);
    // A PC with calls waiting asks for more, and gets it at the next exchange.
    s.pc.used = 28;
    s.pc.waiting = 30;
    await s.pass(40000);
    assert.equal(tab.link.grant().need, 68);
    assert.equal(tab.link.status().need, 68);
});

test('a tab whose calls are waiting gets an exchange sooner, but not at once', async () => {
    const s = setUp();
    const tab = s.addTab('sell', 't1', { sellers: [11] });
    await s.pass(20000);
    const before = s.posts.length;
    // Asked right after an exchange ...
    s.pc.afterPost = () => tab.link.askSoon();
    await s.pass(62000);
    assert.equal(s.pc.afterPost, null);
    // ... the next one comes six seconds after it, not thirty and not at once.
    const gap = s.posts[before + 1].at - s.posts[before].at;
    assert.ok(gap >= 6000 && gap <= 10000, `the next exchange came ${gap} ms after the last`);
    // And only that one: the 30 s start again from it.
    const next = s.posts[before + 2] ? s.posts[before + 2].at - s.posts[before + 1].at : 30000;
    assert.ok(next >= 30000, `and another ${next} ms later`);
});

test('a PC the server does not know: asked once, nothing kept, nothing shown, asked again hours later - and a server that does not answer', async () => {
    const wrong = setUp({ pass: 'w'.repeat(32) });
    const tab = wrong.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await wrong.pass(70000);
    assert.equal(tab.link.status().error, 'The server does not know this PC.');
    assert.equal(tab.link.status().unknown, true);
    assert.equal(tab.link.grant(), null);
    assert.equal(wrong.world.requests.length, 0);
    // Anyone may install Torn Bids: a stranger's copy asks once, not every half minute.
    assert.equal(wrong.posts.length, 1);
    await wrong.pass(3 * 60000);
    assert.equal(wrong.posts.length, 1);
    assert.match(sharedSaidLine(tab.link.status(), 6), /asked again in 5 minutes, or at once/);
    // To that PC there is no server: no line in the panel, nothing to show in Torn Bids.
    const st = tab.link.status();
    assert.equal(sharedKnown(st), false);
    assert.equal(sharedPanelLine(st, st.now), null);
    assert.equal(sharedNowLine(st, st.now).level, 'off');
    // Its owner may have let it in since: asked again after 5 minutes, then 15, then an hour (3.26.0: it was
    // six hours from the first, so a key just added waited that long) - and from then every six hours.
    assert.deepEqual(SHARED_UNKNOWN_STEPS_MS, [5 * 60000, 15 * 60000, 60 * 60000]);
    assert.deepEqual([1, 2, 3, 4, 9, 0, undefined].map(sharedUnknownWait), [5 * 60000, 15 * 60000, 60 * 60000, SHARED_UNKNOWN_MS, SHARED_UNKNOWN_MS, 5 * 60000, 5 * 60000]);
    await wrong.pass(2 * 60000);
    assert.equal(wrong.posts.length, 2);
    await wrong.pass(16 * 60000);
    assert.equal(wrong.posts.length, 3);
    await wrong.pass(61 * 60000);
    assert.equal(wrong.posts.length, 4);
    assert.match(sharedSaidLine(tab.link.status(), 6), /asked again in 6 hours, or at once/);
    await wrong.pass(SHARED_UNKNOWN_MS - 5 * 60000);
    assert.equal(wrong.posts.length, 4);
    await wrong.pass(10 * 60000);
    assert.equal(wrong.posts.length, 5);

    let down = false;
    const s = setUp({ down: () => down });
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const t = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    await s.pass(90000);
    assert.ok(t.link.reads().index.bySeller.has('11'));
    down = true;
    const posts = s.posts.length;
    await s.pass(95000);
    assert.equal(t.link.status().error, 'Network request failed.');
    assert.ok(s.posts.length >= posts + 2 && s.posts.length <= posts + 4, 'it did not keep trying every 30 s');
    assert.ok(t.link.reads().index.bySeller.has('11'), 'what was kept went with the first failure');
    down = false;
    await s.pass(40000);
    assert.equal(t.link.status().error, null);
});

test('a new item to watch: the server is asked for everything again, so unchanged bazaars are known for it too', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }, { ID: 367, price: 1100, quantity: 40 }]);
    const tab = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    await s.pass(90000);
    assert.equal(tab.link.reads().index.byItem.has('367'), false);
    const rows = [{ sellerId: '11', sellerName: 'Lumei', price: 1200, qty: 40, dataAt: 1000, changedAt: 1000, sponsored: false }];
    // Not known yet for 367: TornW3B's row stands.
    const early = tab.link.reads();
    assert.equal(withShared(rows, 367, early.index, early.joined), rows);

    tab.want = { sellers: [11], looking: [11], worth: { 206: 850000, 367: 1500 } };
    await s.pass(100000);
    const { index, joined } = tab.link.reads();
    assert.deepEqual(index.bySeller.get('11').items.get('367'), [{ price: 1100, qty: 40 }]);
    assert.deepEqual(withShared(rows, 367, index, joined).map((r) => r.price), [1100]);
});

test('whatever a part of the script hands over, only the agreed numbers leave this PC', async () => {
    const s = setUp();
    s.addTab('sell', 't1', {
        sellers: [11, 'Lumei', { id: 12, name: 'x' }], trades: ['13'], looking: [null],
        worth: { 206: 850000.4, Xanax: 1 }, inventory: [{ id: 206, qty: 54321 }], cash: 123456789, key: KEY_ABE, name: 'Abe',
        going: [[206, 0, 11, 'Lumei'], { item: 206, who: 'Abe' }], bought: [[11, 206, 2, 790000, 0, 'Xanax'], ['Lumei', 206, 1, 5, 0]],
    });
    await s.pass(70000);
    assert.ok(s.posts.length >= 2);
    for (const p of s.posts) {
        assert.equal(sharedOutgoingOk(p.body), true);
        const text = JSON.stringify(p.body);
        for (const secret of ['Lumei', 'Xanax', 'inventory', '54321', '123456789', KEY_ABE, 'Abe', PASS_ABE]) assert.equal(text.includes(secret), false, `"${secret}" left this PC`);
        // `calls` (3.26.2): this PC's request counts, with the first page of an exchange only.
        assert.deepEqual(Object.keys(p.body).filter((k) => k !== 'calls').sort(), p.body.worth ? ['app', 'bought', 'going', 'looking', 'seen', 'sellers', 'since', 'trades', 'used', 'ver', 'waiting', 'worth'] : ['app', 'bought', 'going', 'looking', 'seen', 'sellers', 'since', 'trades', 'used', 'ver', 'waiting']);
        for (const n of Object.values(p.body.calls || {})) assert.ok(Number.isInteger(n) && n >= 1);
        assert.deepEqual([p.body.app, p.body.ver], ['torn-bids', '3.25.0']);
    }
    assert.deepEqual(s.posts[0].body.sellers, [13, 11]);
    assert.deepEqual(s.posts[0].body.worth, { 206: 850000 });
});

test('Shared switched off: what was kept goes, in every tab', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const a = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    const b = s.addTab('app', 't2', {});
    await s.pass(90000);
    assert.ok(b.link.reads().index.bySeller.has('11'));
    assert.ok(b.link.grant());
    a.link.forget();
    s.gm.values.delete(SHARED_CONFIG_KEY);
    b.link.onStored(SHARED_CONFIG_KEY);
    assert.equal(a.link.reads(), null);
    assert.equal(b.link.reads(), null);
    assert.equal(b.link.grant(), null);
    assert.equal(s.gm.values.has(SHARED_STATE_KEY), false);
    assert.equal([...s.gm.values.keys()].some((k) => k.startsWith('sharedReads.')), false);
    const posts = s.posts.length;
    await s.pass(70000);
    assert.equal(s.posts.length, posts);
});

test('what a closed tab wanted stops being sent two minutes after it closed', async () => {
    const s = setUp();
    s.addTab('sell', 't1', { sellers: [11], trades: [11] });
    const app = s.addTab('app', 't2', { looking: [12] });
    await s.pass(70000);
    assert.deepEqual(s.posts[s.posts.length - 1].body.looking, [12]);
    s.pc.links.splice(s.pc.links.indexOf(app.link), 1);
    await s.pass(200000);
    const last = s.posts[s.posts.length - 1].body;
    assert.deepEqual(last.looking, []);
    assert.deepEqual(last.trades, [11]);
});

test('calls held back in a tab that does not lead are asked for by the tab that does', async () => {
    const s = setUp();
    const lead = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    const other = s.addTab('app', 't2', { looking: [11] });
    await s.pass(40000);
    assert.equal(lead.link.status().leading, true);
    assert.equal(other.link.status().leading, false);
    s.pc.used = 20;
    other.link.askSoon(14);
    await s.pass(12000);
    const last = s.posts[s.posts.length - 1].body;
    assert.equal(last.waiting, 14, 'the other tab\'s waiting calls were not counted');
    // 20 used + 14 waiting + the headroom of 10.
    assert.equal(lead.link.grant().need, 44);
    // An ask of its own is not counted twice: what it has waiting is already in its own use.
    s.pc.waiting = 3;
    lead.link.askSoon(3);
    await s.pass(12000);
    assert.equal(s.posts[s.posts.length - 1].body.waiting, 3);
    // And an old ask stops counting.
    s.pc.waiting = 0;
    other.link.askSoon(9);
    await s.pass(100000);
    assert.equal(s.posts[s.posts.length - 1].body.waiting, 0);
});

test('who the others are reaches this PC as their Torn names; the labels typed at set-up never do', async () => {
    const s = setUp();
    const tab = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    // The other person's PC, straight at the server.
    const other = () => s.world.host.handle('vincent', 'POST', '/sync', { used: 3, sellers: [11] });
    for (let i = 0; i < 6; i += 1) {
        other();
        await s.pass(30000);
    }
    const st = tab.link.status();
    assert.equal(st.people, 2);
    assert.deepEqual(st.peopleOn, [WHO[KEY_VINCENT]]);
    assert.deepEqual(st.you, WHO[KEY_ABE]);
    for (const [key, value] of s.gm.values) {
        assert.ok(!/vincent|"abe"/i.test(JSON.stringify(value)), `a label typed at set-up is stored on this PC under ${key}`);
    }
});

test('the two marks: what one PC is going for and what it bought reach the other, by Torn name and in its own time', async () => {
    const s = setUp();
    const tab = s.addTab('sell', 't1', {});
    const app = s.addTab('app', 't2', {});
    // The other person's PC, straight at the server: going for item 206 at bazaars 11 and 12 since 3 minutes, bought 2 a minute ago.
    // Their trade opened 3 minutes before this starts; ages are what their PC works out at each exchange.
    const opened = s.world.t - 180000;
    const paid = s.world.t - 60000;
    let done = false;
    const other = () => s.world.host.handle('vincent', 'POST', '/sync', {
        used: 3,
        going: done ? [] : [[206, s.world.t - opened, 11, 12]],
        bought: [[11, 206, 2, 790000, s.world.t - paid]],
    });
    for (let i = 0; i < 4; i += 1) {
        other();
        await s.pass(30000);
    }
    const now = s.world.t + SKEW;
    const got = tab.link.marks(now);
    assert.equal(got.going.length, 1);
    assert.deepEqual({ ...got.going[0], at: 0 }, { who: WHO[KEY_VINCENT].name, whoId: WHO[KEY_VINCENT].id, item: 206, at: 0, sellers: [11, 12] });
    assert.deepEqual({ ...got.bought[0], at: 0 }, { who: WHO[KEY_VINCENT].name, whoId: WHO[KEY_VINCENT].id, seller: 11, item: 206, qty: 2, price: 790000, at: 0 });
    // In this PC's own time, whatever the two clocks say: the ages the other PC sent, plus the wait since.
    assert.ok(Math.abs(got.going[0].at - (opened + SKEW)) < 2000, String(got.going[0].at - opened - SKEW));
    assert.ok(Math.abs(got.bought[0].at - (paid + SKEW)) < 2000);
    // The tab that does not lead has the same.
    assert.deepEqual(app.link.marks(now), got);
    // Unchanged marks are not written again.
    const kept = JSON.stringify(s.gm.values.get(SHARED_MARKS_KEY));
    for (let i = 0; i < 3; i += 1) {
        other();
        await s.pass(30000);
    }
    assert.equal(JSON.stringify(s.gm.values.get(SHARED_MARKS_KEY)), kept);
    // They finish the trade: the mark goes with the next exchange, in both tabs. The buy stays.
    done = true;
    other();
    await s.pass(35000);
    assert.deepEqual(tab.link.marks().going, []);
    assert.deepEqual(app.link.marks().going, []);
    assert.equal(tab.link.marks().bought.length, 1);
    // No label of the set-up is kept on this PC.
    assert.ok(!/vincent/i.test(JSON.stringify(s.gm.values.get(SHARED_MARKS_KEY))));
});

test('this PC\'s own marks reach the server from either part of the script, and are never sent back to it', async () => {
    const s = setUp();
    const at = () => s.world.t + SKEW;
    const sell = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    s.addTab('app', 't2', {});
    await s.pass(35000);
    sell.want = { sellers: [11], worth: { 206: 850000 }, going: [[206, at() - 5000, 11, 12]], bought: [[11, 206, 2, 790000, at() - 2000]] };
    await s.pass(65000);
    const last = s.posts[s.posts.length - 1].body;
    assert.equal(last.going.length, 1);
    assert.deepEqual([last.going[0][0], ...last.going[0].slice(2)], [206, 11, 12]);
    assert.ok(last.going[0][1] >= 5000 && last.going[0][1] < 5000 + 80000, 'the age sent is the PC\'s own, not a clock time');
    assert.deepEqual(last.bought[0].slice(0, 4), [11, 206, 2, 790000]);
    assert.equal(sharedOutgoingOk(last), true);
    // The other person gets them, by this person's Torn name.
    const theirs = s.world.host.handle('vincent', 'POST', '/sync', { used: 1 }).body.marks;
    assert.deepEqual(theirs.going.map((m) => [m.who, m.item, m.sellers]), [[WHO[KEY_ABE].name, 206, [11, 12]]]);
    assert.deepEqual(theirs.bought.map((m) => [m.who, m.seller, m.item, m.qty, m.price]), [[WHO[KEY_ABE].name, 11, 206, 2, 790000]]);
    // And this PC is not told of its own.
    assert.deepEqual(sell.link.marks(), { going: [], bought: [] });
    // The trade is finished: the next exchange says so, and the mark is gone for the other.
    sell.want = { sellers: [11], worth: { 206: 850000 } };
    await s.pass(65000);
    assert.deepEqual(s.posts[s.posts.length - 1].body.going, []);
    assert.deepEqual(s.world.host.handle('vincent', 'POST', '/sync', { used: 1 }).body.marks.going, []);
});

test('the server silent for two minutes: nobody is "going for" anything any more; Shared off: no marks at all', async () => {
    let down = false;
    const s = setUp({ down: () => down });
    const tab = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    const other = () => s.world.host.handle('vincent', 'POST', '/sync', { used: 3, going: [[206, 1000, 11]], bought: [[11, 206, 1, 790000, 1000]] });
    for (let i = 0; i < 3; i += 1) {
        other();
        await s.pass(30000);
    }
    assert.equal(tab.link.marks().going.length, 1);
    down = true;
    await s.pass(150000);
    assert.deepEqual(tab.link.marks().going, []);
    assert.equal(tab.link.marks().bought.length, 1, 'a buy that happened is still true');
    down = false;
    other();
    await s.pass(65000);
    assert.equal(tab.link.marks().going.length, 1);
    // Switched off in another tab: nothing is shown from that moment, whatever is still kept here.
    s.gm.values.delete(SHARED_CONFIG_KEY);
    tab.link.onStored(SHARED_CONFIG_KEY);
    assert.equal(s.gm.values.has(SHARED_MARKS_KEY), true);
    assert.deepEqual(tab.link.marks(), { going: [], bought: [] });
    tab.link.forget();
    assert.deepEqual(tab.link.marks(), { going: [], bought: [] });
    assert.equal(s.gm.values.has(SHARED_MARKS_KEY), false);
});

test('3.25.0: which TornW3B lists each PC read passes through the server: this PC\'s leave as ages, the other\'s arrive in this PC\'s time', async () => {
    const { world, posts, addTab, pass } = setUp();
    const mine = world.t + SKEW - 3000;
    const tab = addTab('sell', 'tab-1', { sellers: [11], worth: { 206: 800000, 367: 5000 }, dir: [[206, mine]] });
    assert.deepEqual(tab.link.dir(), { reads: {}, turn: { of: 1, me: 0 } });
    // The other PC read item 367's list five seconds ago, by its own clock.
    world.host.handle('vincent', 'POST', '/sync', { used: 0, dir: [[367, 5000]] });
    const told = world.t;
    await pass(40000);
    const sent = posts[posts.length - 1].body;
    assert.equal(sent.dir.length, 1);
    assert.equal(sent.dir[0][0], 206);
    assert.ok(sent.dir[0][1] >= 3000 && sent.dir[0][1] < 60000, 'an age, not this PC\'s clock: ' + sent.dir[0][1]);
    const got = tab.link.dir();
    assert.deepEqual(got.turn, { of: 2, me: 0 });
    assert.deepEqual(Object.keys(got.reads), ['367']);
    assert.ok(Math.abs(got.reads[367] - (told - 5000 + SKEW)) < 2000, 'in this PC\'s own time');
    // And the server knows this PC's read, for the other PC.
    const other = world.host.handle('vincent', 'POST', '/sync', { used: 0 }).body;
    assert.deepEqual(other.dir.map((d) => d[0]), [206]);
    // Shared switched off: forgotten.
    tab.link.forget();
    assert.deepEqual(tab.link.dir(), { reads: {}, turn: { of: 1, me: 0 } });
});

test('the server is told this is Torn Bids and its version, and counts it under that name', async () => {
    const s = setUp();
    s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(70000);
    const seen = (await s.world.admin('GET', '/admin/state')).body;
    assert.deepEqual(seen.apps.map((a) => [a.app, a.ver]), [['torn-bids', '3.25.0']]);
    assert.deepEqual(seen.keys.find((k) => k.who === 'abe').apps, [{ app: 'torn-bids', ver: '3.25.0' }]);
});

test('a server that wants a newer Torn Bids: said in Settings, nothing exchanged, and the 100 still split with it', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const tab = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    await s.pass(70000);
    assert.ok(tab.link.reads().index.bySeller.has('11'));
    await s.world.admin('POST', '/admin/settings', { min: { 'torn-bids': '3.26.0' } });
    s.world.bazaars.set(11, [{ ID: 206, price: 1, quantity: 1 }]);
    s.pc.used = 60;
    await s.pass(70000);
    const st = tab.link.status();
    assert.equal(st.update, '3.26.0');
    assert.equal(st.error, null);
    assert.match(sharedNowLine(st, st.now).text, /wants Torn Bids 3\.26\.0 or newer/);
    assert.equal(sharedNowLine(st, st.now).level, 'bad');
    assert.match(sharedPanelLine(st, st.now).rest, /newer Torn Bids/);
    // Nothing new came in: the price of before the refusal is what is kept.
    assert.deepEqual(tab.link.reads().index.bySeller.get('11').items.get('206'), [{ price: 790000, qty: 2 }]);
    // The grant is fresh and leaves this PC its 60: the server did count what this PC uses.
    const grant = tab.link.grant();
    assert.ok(st.now - grant.at < 40000, 'the grant was not renewed by a refused exchange');
    assert.ok(grant.serverShare <= 80 - 60);
    const mine = Array.from({ length: 59 }, (_, i) => st.now - i * 1000);
    assert.equal(sharedMayCall(grant, mine, st.now), true);

    // Whoever runs the server lets this version in again: back to normal by itself.
    await s.world.admin('POST', '/admin/settings', { min: { 'torn-bids': '' } });
    await s.pass(70000);
    assert.equal(tab.link.status().update, null);
    assert.equal(sharedNowLine(tab.link.status(), tab.link.status().now).level, 'ok');
});

test('the server stopped by whoever runs it: said as it is, and nothing is read for this PC', async () => {
    const s = setUp();
    const tab = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    await s.pass(70000);
    await s.world.admin('POST', '/admin/stop', { stopped: true });
    await s.pass(70000);
    const st = tab.link.status();
    assert.equal(st.reading, 'stopped');
    const line = sharedNowLine(st, st.now);
    assert.equal(line.level, 'warn');
    assert.match(line.text, /stopped its reading/);
    assert.match(sharedPanelLine(st, st.now).rest, /not reading now/);
    await s.world.admin('POST', '/admin/stop', { stopped: false });
    await s.pass(70000);
    assert.equal(tab.link.status().reading, 'reading');
});

// 3.25.0: nobody types a password. Torn Bids says the word it makes from the Public key it holds, and the
// server lets in only the word of a key its owner added as "runs our app". The real client, the real door.
test('the word Torn Bids makes from its key opens the server, from the panel and from Torn Bids alike - and the key itself is never sent', async () => {
    const word = await sharedWord(KEY_ABE);
    const s = setUp({ pass: word, door: true });
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const bids = s.addTab('sell', 't1', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    const panel = s.addTab('app', 't2', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(90000);
    const st = bids.link.status();
    assert.equal(st.error, null);
    assert.equal(st.unknown, false);
    assert.equal(sharedKnown(st), true);
    assert.equal(sharedSaid(st), 'ok');
    assert.equal(sharedSaidLine(st, 6), 'Shared: the server knows this PC and answers');
    assert.ok(bids.link.reads().index.bySeller.has('11'), 'Torn Bids got the bazaar the server read');
    assert.ok(panel.link.reads().index.bySeller.has('11'), 'the panel on a Torn page got it too');
    assert.ok(s.posts.length >= 2);
    for (const p of s.posts) {
        assert.equal(p.headers.Authorization, 'Bearer ' + word);
        assert.ok(!JSON.stringify(p).includes(KEY_ABE), 'the key left this PC');
    }
    // The password of the first set-up is still let in beside it.
    const old = setUp({ pass: PASS_ABE, door: true });
    const t = old.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await old.pass(70000);
    assert.equal(sharedSaid(t.link.status()), 'ok');
});

test('a key the owner never added, and a key added as key-only: 404, said once in the log\'s words, nothing exchanged - and let in once added as "runs our app"', async () => {
    const BARE = { OWNER_PASS: PASS_OWNER, READS_PER_WAKE: '40' };
    const s = setUp({ pass: await sharedWord(KEY_FRIEND), env: BARE, door: true });
    const tab = s.addTab('app', 't1', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(70000);
    let st = tab.link.status();
    assert.equal(st.unknown, true);
    assert.equal(sharedSaid(st), 'unknown');
    assert.match(sharedSaidLine(st, 6), /answered 404 - the Public key of this PC is not on the server as "runs our app"/);
    assert.equal(sharedKnown(st), false);
    assert.equal(s.posts.length, 1);
    assert.equal(s.world.requests.length, 0, 'the server read something for a PC it does not know');

    // A key given only to be read with opens nothing for the app that holds it.
    const d = setUp({ pass: await sharedWord(KEY_DONOR), env: BARE, door: true });
    await d.world.admin('POST', '/admin/keys', { key: KEY_DONOR, kind: 'only' });
    const donor = d.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await d.pass(70000);
    assert.equal(sharedSaid(donor.link.status()), 'unknown');

    // The owner adds the first key as "runs our app": the same copy, untouched, is let in at its next asking.
    assert.equal((await s.world.admin('POST', '/admin/keys', { key: KEY_FRIEND, kind: 'app' })).status, 200);
    await s.pass(SHARED_UNKNOWN_MS + 60000);
    st = tab.link.status();
    assert.equal(st.unknown, false);
    assert.equal(sharedSaid(st), 'ok');
    assert.ok(tab.link.reads().index.bySeller.has('11'));
});

/* 3.26.0: the server hands out TornW3B's work - which sellers lists are this PC's, and the trader lists another PC read. */
test('TornW3B\'s work through the server: this PC reads only the sellers lists handed to it, and trader lists go both ways', async () => {
    const { SHARED_W3B_ASK_KEY, SHARED_LISTS_OUT_KEY, SHARED_LISTS_IN_KEY } = await import('../src/feed/shared-link.js');
    const { sharedMayRead, sharedList, sharedBody, sharedAskIn, sharedListsIn, SHARED_MAX_WANT, SHARED_MAX_LISTS, SHARED_ASK_FRESH_MS } = await import('../src/core/shared.js');

    const s = setUp();
    const want = { sellers: [11], worth: { 206: 850000 }, want: [206, 367, 180], w3b: [8, 900], lists: true };
    const tab = s.addTab('sell', 't1', want);
    const app = s.addTab('app', 't2', {});
    // This PC read trader 77's list a moment ago: it waits in the stored value for the next exchange.
    const readAt = s.world.t + SKEW - 5000;
    s.gm.values.set(SHARED_LISTS_OUT_KEY, [[77, readAt, { 206: 849500, 180: 61 }]]);
    // The other person's PC read item 367's sellers a moment ago, and trader 44's list.
    const theirs = () => s.world.host.handle('vincent', 'POST', '/sync', { used: 1, dir: [[367, 2000]], lists: [[44, s.world.t - 3000, { 1: 118 }]], listsSince: 0 }).body;
    theirs();
    await s.pass(40000);

    // What left this PC: the want, the room, the list - numbers only, in the agreed shape.
    const sent = s.posts.find((p) => p.body.want);
    assert.deepEqual(sent.body.want, [206, 367, 180]);
    assert.deepEqual(sent.body.w3b, [8, 900]);
    assert.deepEqual(sent.body.lists, [[77, readAt, { 206: 849500, 180: 61 }]]);
    assert.equal(sent.body.listsSince, 0);
    assert.ok(s.posts.every((p) => sharedOutgoingOk(p.body)));
    // Sent once: the next exchange does not carry the same list again.
    assert.equal(s.posts.filter((p) => p.body.lists).length, 1);

    // The server left 367 to the PC that just read it: 206 and 180 are this PC's.
    const handed = tab.link.w3bAsk();
    assert.deepEqual(handed.want, [206, 367, 180]);
    assert.deepEqual(handed.ask, [206, 180]);
    const now = s.world.t + SKEW;
    assert.equal(sharedMayRead(handed, 206, now), true);
    assert.equal(sharedMayRead(handed, '367', now), false);
    // An item the server was never told of is this PC's as before; so is everything once the server has been silent.
    assert.equal(sharedMayRead(handed, 999, now), true);
    assert.equal(sharedMayRead(handed, 367, handed.at + SHARED_ASK_FRESH_MS), true);
    assert.equal(sharedMayRead(null, 367, now), true);
    // The tab that does not lead goes by the same.
    assert.deepEqual(app.link.w3bAsk(), handed);
    assert.deepEqual(tab.link.status().w3bAsk, [2, 3]);

    // The other PC's trader list is here for Torn Bids' page to take, and this PC's is with the other PC.
    const box = s.gm.values.get(SHARED_LISTS_IN_KEY);
    assert.equal(box.n, 1);
    assert.deepEqual(box.lists.map((l) => [l[0], l[2]]), [[44, { 1: 118 }]]);
    assert.equal(tab.link.status().listsIn, 1);
    assert.equal(tab.link.status().listsOut, 1);
    const got = theirs();
    assert.deepEqual(got.lists.map((l) => [l[0], l[2]]), [[77, { 206: 849500, 180: 61 }]]);
    // Nothing new: nothing is taken twice.
    await s.pass(65000);
    assert.equal(s.gm.values.get(SHARED_LISTS_IN_KEY).n, 1);

    // With Torn Bids' page closed (only the panel's tab), no lists are asked for and no want is sent.
    const o = setUp();
    o.addTab('app', 't1', { sellers: [11], worth: { 206: 850000 } });
    o.gm.values.set(SHARED_LISTS_OUT_KEY, [[77, o.world.t, { 206: 1 }]]);
    await o.pass(40000);
    assert.ok(o.posts.length > 0 && o.posts.every((p) => !('lists' in p.body) && !('listsSince' in p.body) && !('want' in p.body) && !('w3b' in p.body)));
    assert.equal(o.gm.values.has(SHARED_W3B_ASK_KEY), false);

    // The shapes, whatever is put in: numbers only, within the limits.
    assert.equal(sharedList([77, 5, { 206: 1.6, x: 5, 180: -1, 9: 'a' }])[2][206], 2);
    assert.deepEqual(sharedList([77, 5, { 206: 1.6, x: 5, 180: -1, 9: 'a' }]), [77, 5, { 206: 2 }]);
    for (const bad of [null, [77, 5], [77, 5, {}], ['x', 5, { 1: 1 }], [77, 0, { 1: 1 }], [77, 5.5, { 1: 1 }], [77, 5, [1]], [77, 5, { 1: 0 }]]) assert.equal(sharedList(bad), null, JSON.stringify(bad));
    const big = sharedBody({ wants: [{ want: Array.from({ length: 200 }, (_, i) => i + 1), w3b: [3, 4] }], lists: Array.from({ length: 9 }, (_, i) => [i + 1, 5, { 1: 1 }]), listsSince: 7 });
    assert.equal(big.want.length, SHARED_MAX_WANT);
    assert.equal(big.lists.length, SHARED_MAX_LISTS);
    assert.equal(big.listsSince, 7);
    assert.equal(sharedOutgoingOk(big), true);
    // A want with no room said, or room with no want: neither is sent. A name can never ride along.
    assert.equal('want' in sharedBody({ wants: [{ want: [1, 2] }] }), false);
    assert.equal('w3b' in sharedBody({ wants: [{ w3b: [1, 2] }] }), false);
    assert.equal(sharedOutgoingOk({ ...big, lists: [[1, 5, { 1: 'Bob' }]] }), false);
    assert.equal(sharedOutgoingOk({ ...big, want: ['206'] }), false);
    assert.equal(sharedOutgoingOk({ ...big, w3b: [1, 2, 3] }), false);
    // The answer: only what was wanted, each once; a server that says nothing about it is no hand-out.
    assert.deepEqual(sharedAskIn({ ask: [180, 5, 180, 'x', 206] }, [206, 180], 9).ask, [180, 206]);
    assert.equal(sharedAskIn({}, [206], 9), null);
    assert.equal(sharedAskIn({ ask: [206] }, [], 9), null);
    assert.deepEqual(sharedListsIn({ lists: [[44, 5, { 1: 118 }], 'junk', [0, 5, { 1: 1 }]] }), [[44, 5, { 1: 118 }]]);
});

test('the same key saved again while the server does not know this PC: asked again at once, and the short waits start over', async () => {
    const wrong = setUp({ pass: 'w'.repeat(32) });
    const tab = wrong.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await wrong.pass(70000);
    assert.equal(wrong.posts.length, 1);
    assert.equal(tab.link.status().unknown, true);
    // Nothing to ask again about while the wait is the only thing in the way... until the key is saved again.
    await wrong.pass(60000);
    assert.equal(wrong.posts.length, 1);
    assert.equal(tab.link.knock(), true);
    await wrong.pass(SHARED_TICK_MS * 2);
    assert.equal(wrong.posts.length, 2);
    // Still not known: the first short wait again (5 minutes), not the second.
    assert.equal(tab.link.status().unknownWaitMs, SHARED_UNKNOWN_STEPS_MS[0]);
    // A PC the server knows has nothing to knock about.
    const s = setUp();
    const ok = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(40000);
    assert.equal(ok.link.knock(), false);
});

test('another tab stored its own exchange while this one waited for the answer: the answer is still taken (3.26.0 read a null there)', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    const tab = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    // What a second tab's exchange does to this one, at the worst moment: between the request and its answer.
    let rev = 500;
    const between = () => {
        rev += 7;
        s.gm.values.set(SHARED_STATE_KEY, { ...(s.gm.values.get(SHARED_STATE_KEY) || {}), rev, touched: [] });
        tab.link.onStored(SHARED_STATE_KEY);
        s.pc.afterPost = between;
    };
    s.pc.afterPost = between;
    const errors = [];
    for (let i = 0; i < 6; i += 1) {
        await s.pass(31000);
        if (tab.link.status().error) errors.push(tab.link.status().error);
    }
    assert.deepEqual(errors, []);
    assert.ok(s.posts.length >= 4);
    // And the server's read of the bazaar came through.
    assert.ok(tab.link.status().sellers > 0);
});

test('the server stops handing out at what this PC has left of its minute: what it did not get to is this PC\'s own', async () => {
    const { sharedMayRead, sharedAskIn, sharedAskLeft } = await import('../src/core/shared.js');
    const want = [11, 12, 13, 14, 15, 16];
    // Room for two: the server handed 11 and 13, left 12 to another PC, and never looked at 14, 15, 16.
    const cut = sharedAskIn({ ask: [11, 13] }, want, 1000, 2);
    assert.equal(cut.judged, 3);
    assert.equal(sharedMayRead(cut, 12, 2000), false);
    for (const id of [11, 13, 14, 15, 16]) assert.equal(sharedMayRead(cut, id, 2000), true, 'item ' + id);
    assert.equal(sharedAskLeft(cut), 1);
    // Room to spare: the server looked at every one, and what it did not hand is another PC's.
    const all = sharedAskIn({ ask: [11, 13] }, want, 1000, 8);
    assert.equal(all.judged, 6);
    assert.equal(sharedMayRead(all, 16, 2000), false);
    assert.equal(sharedAskLeft(all), 4);
    // No room at all: nothing was looked at, nothing is another PC's (this PC's own limit is what holds it).
    const none = sharedAskIn({ ask: [] }, want, 1000, 0);
    assert.equal(none.judged, 0);
    assert.equal(sharedMayRead(none, 11, 2000), true);
    assert.equal(sharedAskLeft(none), 0);
    // The room not known (an older copy's stored answer): as 3.26.0 took it.
    const old = { at: 1000, want, ask: [11, 13] };
    assert.equal(sharedMayRead(old, 16, 2000), false);
    assert.equal(sharedAskLeft(old), 4);
    assert.equal(sharedAskLeft(null), 0);
    // Two PCs behind one address: the server stops at half of what this PC said it has left, which this PC
    // cannot reckon. A server that says how far it looked is believed; one that says something impossible is not.
    const told = sharedAskIn({ ask: [11, 13], judged: 3 }, want, 1000, 4);
    assert.equal(told.judged, 3);
    assert.equal(sharedMayRead(told, 16, 2000), true);
    assert.equal(sharedAskLeft(told), 1);
    for (const bad of [-1, 7, 2.5, '3', null]) assert.equal(sharedAskIn({ ask: [11, 13], judged: bad }, want, 1000, 4).judged, 6, String(bad));
});

test('this PC\'s request counts go to the server with each exchange, come off the sum once answered, and wait out a server that is down (3.26.2)', async () => {
    const { SHARED_CALLS_KEY } = await import('../src/feed/shared-link.js');
    const { usageAdd, usageCallsAdd } = await import('../src/core/usage.js');
    let down = false;
    const s = setUp({ down: () => down });
    const tab = s.addTab('sell', 't1', { sellers: [11], worth: { 206: 850000 } });
    const other = s.addTab('app', 't2', { looking: [12], worth: { 367: 1500 } });
    const now = () => s.world.t + SKEW;
    // As main.js flushUsage does it, from whichever tab made the requests.
    const count = (tags) => {
        const pending = {};
        for (const [tag, n] of Object.entries(tags)) for (let i = 0; i < n; i += 1) usageAdd(pending, tag, now());
        s.gm.values.set(SHARED_CALLS_KEY, usageCallsAdd(s.gm.values.get(SHARED_CALLS_KEY) || null, pending, now()));
    };
    const shown = async () => (await s.world.admin('GET', '/admin/state')).body.calls;

    count({ 'w.flips': 4, 'w.lists': 9, 'r.w.ok': 12, 'r.w.429': 1, 'e.top': 1, 'r.e.slow': 1, 't.status': 3, 'r.s.ok': 2 });
    await s.pass(10000);
    assert.equal(s.posts.length, 1);
    assert.deepEqual(s.posts[0].body.calls, { 'w.flips': 4, 'w.lists': 9, 'r.w.ok': 12, 'r.w.429': 1, 'e.top': 1, 'r.e.slow': 1, 't.status': 3 });
    assert.deepEqual(s.gm.values.get(SHARED_CALLS_KEY), { since: null, n: {} });
    let said = await shown();
    assert.deepEqual(said.h2.abe, { on: 1, 'w.flips': 4, 'w.lists': 9, 'r.w.ok': 12, 'r.w.429': 1, 'e.top': 1, 'r.e.slow': 1, 't.status': 3 });
    assert.deepEqual([tab.link.status().callsOut + other.link.status().callsOut > 0, tab.link.status().callsOut], [true, 31]);

    // Nothing asked since: an empty object goes, and the server counts the minute as on.
    await s.pass(60000);
    assert.ok(s.posts.length >= 3);
    assert.deepEqual(s.posts.at(-1).body.calls, {});
    said = await shown();
    assert.equal(said.h2.abe['w.lists'], 9);
    assert.ok(said.h2.abe.on >= 2);

    // The server does not answer: the sum is kept, added to, and sent whole with the first exchange that is answered.
    down = true;
    count({ 'w.flips': 2 });
    await s.pass(45000);
    assert.equal(s.gm.values.get(SHARED_CALLS_KEY).n['w.flips'], 2);
    count({ 'w.flips': 5, 'e.trader': 1 });
    down = false;
    await s.pass(45000);
    assert.deepEqual(s.gm.values.get(SHARED_CALLS_KEY), { since: null, n: {} });
    said = await shown();
    assert.equal(said.h2.abe['w.flips'], 4 + 7);
    assert.equal(said.h2.abe['e.trader'], 1);
    assert.ok(s.posts.every((p) => sharedOutgoingOk(p.body)));
    // Shared forgotten (another key, or none): the sum goes with it.
    count({ 'w.flips': 1 });
    tab.link.forget();
    assert.equal(s.gm.values.has(SHARED_CALLS_KEY), false);
});

test('a page opened for the first time: the exchange that brings the server\'s bazaars comes seconds after it knows its items, not half a minute (3.26.2)', async () => {
    const s = setUp();
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: 2 }]);
    // Another PC's page had the server read that bazaar long before.
    const old = s.addTab('sell', 't0', { sellers: [11], looking: [11], worth: { 206: 850000 } });
    await s.pass(90000);
    assert.ok(old.link.reads().index.byItem.has('206'));
    // The same storage wiped: as a first install. Its first exchange is made before its bids are worked out.
    for (const key of [...s.gm.values.keys()]) if (key !== SHARED_CONFIG_KEY) s.gm.values.delete(key);
    s.pc.links.length = 0;
    const tab = s.addTab('sell', 't1', { sellers: [], worth: {} });
    const from = s.posts.length;
    await s.pass(4000);
    assert.equal(s.posts.length, from + 1);
    assert.equal(tab.link.reads().index.byItem.has('206'), false);
    // With nothing to watch yet, the pace is the usual one: no second exchange before the half minute.
    while (s.world.t - s.posts[from].at < 20000) await s.pass(1000);
    assert.equal(s.posts.length, from + 1);
    const knewAt = s.world.t;
    tab.want = { sellers: [], worth: { 206: 850000 } };
    await s.pass(SHARED_TICK_MS * 2);
    assert.equal(s.posts.length, from + 2, 'the second exchange did not wait for the half minute');
    assert.ok(s.posts[from + 1].at - knewAt <= SHARED_TICK_MS * 2);
    assert.equal(s.posts.at(-1).body.since, 0);
    assert.deepEqual(tab.link.reads().index.byItem.get('206').map((l) => [l.sellerId, l.price, l.qty]), [['11', 790000, 2]]);
    // A few items more (fewer than it already asked about): the usual pace. Twice as many again: soon.
    tab.want = { sellers: [], worth: { 206: 850000, 367: 1500 } };
    await s.pass(60000);
    assert.ok(s.posts.length >= from + 3);
    assert.ok(s.posts[from + 2].at - s.posts[from + 1].at >= 30000);
    while (s.world.t - s.posts.at(-1).at < 8000) await s.pass(1000);
    const n = s.posts.length;
    const grewAt = s.world.t;
    tab.want = { sellers: [], worth: { 206: 850000, 367: 1500, 180: 61, 335: 18000, 1: 118 } };
    await s.pass(SHARED_TICK_MS * 2);
    assert.equal(s.posts.length, n + 1);
    assert.ok(s.posts[n].at - grewAt <= SHARED_TICK_MS * 2);
    assert.equal(s.posts[n].body.since, 0);
});

test('item speeds (3.28.0): Torn Bids\' page asks with one number and is handed the server\'s table once the server has watched long enough; the panel alone never asks', async () => {
    const { SHARED_MOVES_KEY } = await import('../src/feed/shared-link.js');
    const { measuredRate, amountCap } = await import('../src/core/liquidity.js');

    // The panel on a Torn page alone: nothing about speeds leaves this PC, and none are kept.
    const alone = setUp();
    alone.addTab('app', 't-app', { sellers: [11], worth: { 206: 850000 } });
    await alone.pass(70000);
    assert.ok(alone.posts.length >= 2);
    assert.ok(alone.posts.every((p) => !('moves' in p.body)), 'the panel asked for item speeds');
    assert.equal(alone.gm.values.has(SHARED_MOVES_KEY), false);

    // Torn Bids' page open. Bazaar 11 sells one of item 206 a minute; item 180 stands still in five bazaars.
    const s = setUp();
    const still = [{ ID: 180, price: 50, quantity: 20 }];
    for (const id of [12, 13, 14, 15]) s.world.bazaars.set(id, still);
    let stock = 5000;
    s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: stock }, ...still]);
    const tab = s.addTab('sell', 't-sell', { sellers: [11, 12, 13, 14, 15], looking: [11], worth: { 206: 850000, 180: 61 }, lists: true });
    await s.pass(40000);
    const first = s.posts.find((p) => 'moves' in p.body);
    assert.ok(first, 'Torn Bids\' page never asked for item speeds');
    assert.equal(first.body.moves, 0);
    assert.ok(s.posts.every((p) => sharedOutgoingOk(p.body)));
    // The first answer is an empty table: the server has watched nothing long enough, and every item is planned as before.
    const early = s.gm.values.get(SHARED_MOVES_KEY);
    assert.ok(early && early.at > 0 && Object.keys(early.rows).length === 0, JSON.stringify(early));
    assert.equal(measuredRate(early.rows[206]), null);
    // The table it holds is named by its time on the server's clock, and is not sent again.
    await s.pass(40000);
    assert.equal(s.posts.at(-1).body.moves, early.at);
    assert.equal(s.gm.values.get(SHARED_MOVES_KEY).got, early.got, 'the same table was stored again');

    for (let minute = 0; minute < 135; minute += 1) {
        stock -= 1;
        s.world.bazaars.set(11, [{ ID: 206, price: 790000, quantity: stock }, ...still]);
        await s.pass(60000);
    }
    const box = s.gm.values.get(SHARED_MOVES_KEY);
    assert.ok(box.at > early.at && box.got > early.got);
    assert.ok(box.rows[206] > 40 && box.rows[206] < 75, `one a minute came as ${box.rows[206]} an hour`);
    assert.equal(box.rows[180], 0, 'five bazaars list it and none sold: it stands still');
    assert.equal(tab.link.status().moves, 2);
    // What Torn Bids makes of it: the mover up to Most per flip, the still one a single unit - never none.
    assert.equal(amountCap({ most: 100, rate: measuredRate(box.rows[206]) }), Math.ceil(box.rows[206]));
    assert.equal(amountCap({ most: 100, rate: measuredRate(box.rows[180]) }), 1);
    // This PC's word changed (another key): the table kept under the old one goes with the rest.
    tab.link.forget();
    assert.equal(s.gm.values.has(SHARED_MOVES_KEY), false);
});

test('who sells what (3.35.0): the seller lists this PC read leave as ages and come off the box once answered; /who-sells names them back, and a server that is off costs nothing', async () => {
    const s = setUp();
    const tab = s.addTab('sell', 't-sell', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(35000);
    // Read by this PC 20 s and 40 s ago (this PC's own clock).
    const nowPc = s.world.t + SKEW;
    s.gm.values.set(SHARED_WHO_OUT_KEY, whoOutAdd(whoOutAdd(null, 'sees', seesOf(206, [501, 502, 'market'], nowPc - 20000), nowPc), 'looked', lookedOf(503, [206, 367], nowPc - 40000), nowPc));
    await s.pass(35000);
    const sent = s.posts.filter((p) => p.url.endsWith('/sync') && p.body.sees);
    assert.equal(sent.length, 1, 'told once');
    assert.equal(sharedOutgoingOk(sent[0].body), true);
    assert.deepEqual(sent[0].body.sees[0][2], [501, 502]);
    assert.ok(sent[0].body.sees[0][1] >= 20000 && sent[0].body.sees[0][1] < 60000);
    assert.equal(sent[0].body.looked[0][0], 503);
    assert.deepEqual(s.gm.values.get(SHARED_WHO_OUT_KEY), { sees: [], looked: [], missed: [] });
    const st = tab.link.status();
    assert.equal(st.seesOut, 1);
    assert.equal(st.lookedOut, 1);
    // The index answers.
    const answer = await tab.link.whoSells({ items: [206], n: 5 });
    assert.ok(answer.items.get('206').map((x) => x.id).includes('501'));
    assert.ok(!answer.items.get('206').some((x) => x.id === 'market'));
    // Shared off: nothing is asked.
    s.gm.values.delete(SHARED_CONFIG_KEY);
    assert.equal(await tab.link.whoSells({ items: [1], n: 1 }), null);
});

test('who sells what: a server that is down or does not know this PC gives an error or null, never a hang', async () => {
    let down = false;
    const s = setUp({ down: () => down });
    const tab = s.addTab('sell', 't-sell', { sellers: [11], worth: { 206: 850000 } });
    await s.pass(35000);
    down = true;
    await assert.rejects(() => tab.link.whoSells({ items: [206], n: 5 }));
    down = false;
    assert.equal(await tab.link.whoSells(null), null);
    // A word that is not in the agreed shape is no config at all: nothing is sent.
    const stranger = setUp({ pass: 'x' });
    const t2 = stranger.addTab('sell', 't', { sellers: [11] });
    assert.equal(await t2.link.whoSells({ items: [206], n: 5 }), null);
    assert.equal(stranger.posts.length, 0);
});
