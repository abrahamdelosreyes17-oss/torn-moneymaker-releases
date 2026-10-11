/*
 * Rig A (2026-10-09): a Torn Bids page the size of the friend's.
 *
 * Loaded by test/harness-live.html only when the address has &scene=friend-size,
 * after the harness's own data and BEFORE the script. It fills the harness's
 * stored values and page storage with a week-old installation's worth of data
 * and answers every request the script makes from that same data. Nothing
 * leaves the machine.
 *
 * What is taken from the friend's zip of 2026-10-06 22:44 (script 3.24.1):
 *   traders known and read ............ 2,825 (108 of them the script's own seeds, learned at start-up)
 *   items with a believable buyer ..... 387   ("every item": summary items a flip buyer is shown for)
 *   possible flips .................... 150   (the cap; more than 150 items qualify)
 *   favourites / blacklisted .......... 12 / 6
 *   his settings ...................... cash 150,000,000 - most per flip 10,000 - 10 extras - least profit 0.1% -
 *                                       trader can pay 10% - online only on - trusted only off - fresh only on -
 *                                       overlay live feed off
 *   stored sizes (bytes) .............. traderDb about 930,000 (his slow days, 10-03 to 10-05: 915,520 - 1,027,989;
 *                                       570,677 at export, a lean day), sellTeOwnLists 156,342, teIds 52,570 (older
 *                                       than a day, as his is: active_traders keeps failing), listAt 11,290,
 *                                       sellPriceRecords 18,299, sellMoves 18,387, teCache 117,716
 *   bazaar listings held .............. about 20,000 (the plan's estimate; his zip does not count them)
 *
 * What the zip does NOT say and is chosen here (see the rig's report):
 *   how many traders have a live TornW3B list (400 here) and how long the lists are - only the bytes are known;
 *   how many buyers each item has (a few items are on most lists, most items on few);
 *   how many traders carry a Trusted badge (it decides how long "Your traders" is);
 *   how many items exist beside the 387 (1,250 here, about 1,077 with a buyer of some kind).
 *
 * Everything is made from one seed (&seed=, 20261006 unless given): the same seed gives the same items, traders,
 * lists and listings. Only the clock differs between runs (times are counted back from now).
 *
 * &flists= live lists, &fdb= traderDb bytes aimed at, &ftrusted= share (percent) of list holders with 100+ votes,
 * &frows= listings per possible flip, &fbid= items with a believable buyer: to see what the redraw grows with.
 */
(function () {
    'use strict';
    const Q = new URLSearchParams(location.search);
    const opt = (k, d) => {
        const v = Number(Q.get(k));
        return Q.has(k) && Number.isFinite(v) ? v : d;
    };
    const SEED = opt('seed', 20261006);
    /* mulberry32: small, fast, the same everywhere. */
    const rngOf = (seed) => {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };
    const NOW = Date.now();
    const MIN = 60000;
    const HOUR = 3600000;
    const DAY = 86400000;

    const N = {
        items: 1250,
        bid: opt('fbid', 387), // flippable kinds, in the summary, bought by traders
        flips: 175, // of them: the cheapest bazaar is under the best price (150 are kept)
        near: 55, // of them: the cheapest bazaar is a little over it
        stat: 400, // weapons and armour: bought, never a flip
        clothing: 180,
        other: 110,
        bare: 123, // in the summary, bought by nobody
        traders: opt('ftraders', 2717),
        holders: 520, // traders with a TornW3B price list
        live: opt('flists', 400), // of them: read within the last six hours
        teOnly: 160, // TornExchange top-three traders with no TornW3B list
        favourites: 12,
        blacklisted: 6,
        dbBytes: opt('fdb', 930000),
        trustedPct: opt('ftrusted', 12),
        flipRows: opt('frows', 92),
    };
    const BOUGHT = N.bid + N.stat + N.clothing + N.other; // 1,077: items some trader buys
    const IN_SUMMARY = BOUGHT + N.bare; // 1,200

    /* ------------------------------------------------------------ items */
    const FLIP_TYPES = ['Flower', 'Plushie', 'Drug', 'Booster', 'Energy Drink', 'Candy', 'Alcohol', 'Medical', 'Temporary', 'Supply Pack', 'Special', 'Enhancer', 'Material', 'Tool', 'Collectible', 'Jewelry', 'Artifact'];
    const STAT_TYPES = ['Melee', 'Primary', 'Secondary', 'Defensive'];
    const item = [null];
    {
        const r = rngOf(SEED + 1);
        for (let id = 1; id <= N.items; id += 1) {
            let type;
            let kind = 'none';
            if (id <= N.bid) {
                type = FLIP_TYPES[id % FLIP_TYPES.length];
                kind = id <= N.flips ? 'flip' : id <= N.flips + N.near ? 'near' : 'far';
            } else if (id <= N.bid + N.stat) type = STAT_TYPES[id % 4];
            else if (id <= N.bid + N.stat + N.clothing) type = 'Clothing';
            else if (id <= BOUGHT) type = 'Other';
            else type = FLIP_TYPES[id % FLIP_TYPES.length];
            const stat = STAT_TYPES.includes(type);
            const mv = Math.round(Math.exp(Math.log(stat ? 5000 : 80) + r() * Math.log(stat ? 16000 : 37500)));
            // How many lists carry it: a few items are on most lists (Xanax: 412 buyers), most on few.
            const rank = id <= N.bid ? (id * 73) % N.bid : -1;
            const pop = rank < 0 ? (id <= BOUGHT ? 0.008 : 0) : rank < 60 ? 0.75 : 0.75 * Math.pow(60 / rank, 1.1);
            // The cheapest bazaar, as a share of the Item Market Average.
            const low = kind === 'flip' ? 0.78 + r() * 0.14 : kind === 'near' ? 0.975 + r() * 0.035 : 1.06 + r() * 0.44;
            item.push({ id, name: type + ' ' + id, type, kind, mv, pop, lowest: Math.max(2, Math.round(mv * low)) });
        }
    }
    // The harness's own items go: the script reads the item list from the harness (/v2/torn/items answers from ITEMS).
    for (const k of Object.keys(ITEMS)) delete ITEMS[k];
    for (let id = 1; id <= N.items; id += 1) ITEMS[id] = { name: item[id].name, type: item[id].type, sell_price: Math.max(1, Math.round(item[id].mv * 0.4)), market_value: item[id].mv };

    /* ---------------------------------------------------------- traders */
    const SYL = ['ka', 'ro', 'mi', 'ten', 'zu', 'lo', 'vex', 'dar', 'shi', 'no', 'bel', 'qui', 'ra', 'mo', 'tor', 'ny', 'ix', 'fa', 'gre', 'us'];
    const trader = [];
    {
        const r = rngOf(SEED + 2);
        const seen = new Set();
        for (let k = 0; k < N.traders; k += 1) {
            let name = '';
            const parts = 2 + Math.floor(r() * 3);
            for (let p = 0; p < parts; p += 1) name += SYL[Math.floor(r() * SYL.length)];
            name = name[0].toUpperCase() + name.slice(1) + (r() < 0.5 ? '' : String(Math.floor(r() * 990) + 10));
            while (seen.has(name.toLowerCase())) name += 'x';
            seen.add(name.toLowerCase());
            const holder = k < N.holders;
            const te = k < 60 || (k >= N.holders && k < N.holders + N.teOnly);
            // Last active: one in eight online, as many idle, the rest away for up to three days.
            const a = r();
            const activeAgo = a < 0.12 ? r() * 4 * MIN : a < 0.25 ? 5 * MIN + r() * 24 * MIN : 40 * MIN + r() * 3 * DAY;
            // When their list last changed (TornW3B's own count, 2026-10-05: about two in five within a day, half within three).
            const l = r();
            const listAgo = l < 0.4 ? r() * DAY : l < 0.55 ? DAY + r() * DAY : 2.2 * DAY + r() * 40 * DAY;
            // Votes: 100 and more is Trusted, 20 and more Known.
            const v = r();
            const up = v < N.trustedPct / 100 ? 100 + Math.floor(r() * 900) : v < 0.42 ? 20 + Math.floor(r() * 80) : Math.floor(r() * 20);
            const down = Math.floor(r() * up * 0.03);
            const s = r();
            const score = s < 0.4 ? 100 + Math.floor(r() * 1500) : s < 0.75 ? 20 + Math.floor(r() * 80) : Math.floor(r() * 20);
            trader.push({ k, id: String(2100001 + k * 7), name, holder, live: k < N.live, te, activeAgo, listAgo, up, down, score, tradeAgo: r() < 0.45 ? r() * 2 * DAY : 2 * DAY + r() * 30 * DAY, networth: Math.round(Math.exp(Math.log(5e7) + r() * Math.log(1000))) });
        }
    }
    const byId = new Map(trader.map((t) => [t.id, t]));
    const favourites = [0, 1, 2, 3, 4, 5, N.holders, N.holders + 1, N.holders + 2, N.holders + 3, N.holders + 4, N.holders + 5].map((k) => trader[k]);
    const blacklisted = [60, 61, 62, 63, 64, 65].map((k) => trader[k]);

    /* A trader's price for an item: most pay 70-96% of the average, a few name a price nobody honours. */
    const priceOf = (mv, v) => (v < 0.015 ? Math.round(mv * (4 + v * 2400)) : Math.max(1, Math.round(mv * (0.965 - 0.265 * Math.pow((v - 0.015) / 0.985, 2)))));
    /* A holder's TornW3B list: {itemId: price}. `scale` sets how long the lists are (found below, to reach the bytes). */
    const listOf = (k, scale) => {
        const r = rngOf(SEED + 1000 + k);
        const f = 0.25 * Math.pow(12.8, r());
        const out = {};
        for (let id = 1; id <= BOUGHT; id += 1) {
            const u = r();
            const v = r();
            if (u < Math.min(0.97, scale * item[id].pop * f)) out[id] = priceOf(item[id].mv, v);
        }
        return out;
    };
    const dbOf = (scale) => {
        const r = rngOf(SEED + 3);
        const traders = {};
        const lists = new Map();
        for (const t of trader) {
            const seenAt = NOW - Math.floor(r() * 2 * DAY);
            const age = r();
            const rec = { name: t.name, from: t.holder ? 'w3b' : 'te', seenAt, w3b: null };
            if (t.holder) {
                const prices = listOf(t.k, scale);
                lists.set(t.id, prices);
                // Live: read 5 minutes to 5.3 hours ago. The rest: read once, their list since dropped (older than six hours).
                const at = t.live ? NOW - Math.floor(5 * MIN + age * 5.2 * HOUR) : NOW - Math.floor(6.2 * HOUR + age * 30 * HOUR);
                rec.w3b = { checkedAt: at, at, found: true, prices: t.live ? prices : null };
                rec.rating = { up: t.up, down: t.down, at: seenAt };
            } else {
                rec.w3b = { checkedAt: NOW - Math.floor(age * 23 * HOUR), found: false };
            }
            traders[t.id] = rec;
        }
        return { db: { version: 1, traders }, lists };
    };
    // How long the lists are: found so that the stored database is the size his was (three tries, the same every run).
    let scale = 1;
    let made = dbOf(scale);
    let dbText = JSON.stringify(made.db);
    for (let i = 0; i < 4 && Math.abs(dbText.length - N.dbBytes) > N.dbBytes * 0.01; i += 1) {
        const bare = JSON.stringify(dbOf(0).db).length;
        scale *= Math.max(0.1, (N.dbBytes - bare) / Math.max(1, dbText.length - bare));
        made = dbOf(scale);
        dbText = JSON.stringify(made.db);
    }
    const lists = made.lists;
    _store[NS + 'traderDb'] = dbText;

    /* Each item's TornW3B buyers (every holder whose list has it), highest price first. */
    const holdersOf = new Map();
    for (const [tid, prices] of lists) {
        for (const [id, price] of Object.entries(prices)) {
            if (!holdersOf.has(id)) holdersOf.set(id, []);
            holdersOf.get(id).push({ t: byId.get(tid), price });
        }
    }
    for (const list of holdersOf.values()) list.sort((a, b) => b.price - a.price);

    /* TornExchange: the top three of every item some trader buys, from its own 220 traders. */
    const tePool = trader.filter((t) => t.te);
    const teTop = new Map();
    {
        const r = rngOf(SEED + 4);
        for (let id = 1; id <= BOUGHT; id += 1) {
            const mv = item[id].mv;
            const stat = id > N.bid;
            const rows = [];
            const used = new Set();
            for (let n = 0; n < 3; n += 1) {
                // A few traders lead most items, as on the real site.
                const t = tePool[Math.floor(Math.pow(r(), 1.8) * tePool.length)];
                const m = stat ? 0.5 + r() * 0.4 : 0.975 - n * 0.012 - r() * 0.02;
                if (used.has(t.id)) continue;
                used.add(t.id);
                rows.push({ trader: t.name, trader_id: Number(t.id), price: Math.max(1, Math.round(mv * m)), vote_score: t.score });
            }
            rows.sort((a, b) => b.price - a.price);
            teTop.set(String(id), rows);
        }
    }
    // The top three, as the script keeps them (core/selling.js makeTeCacheEntry): read three minutes ago.
    _store[NS + 'teCache'] = JSON.stringify({ version: 1, fetchedAt: NOW - 3 * MIN, items: Object.fromEntries([...teTop].map(([id, rows]) => [id, rows.map((x) => [x.trader, String(x.trader_id), x.price, x.vote_score])])) });
    // Every active trader's name and id, read three days ago and never since (his: no write all week).
    _store[NS + 'teIds'] = JSON.stringify({ fetchedAt: NOW - 3 * DAY, map: Object.fromEntries(trader.slice(N.holders - 80, N.holders - 80 + 2390).map((t) => [t.name.toLowerCase(), t.id])) });

    /* Your favourites' own whole TornExchange lists: about 13 KB each. */
    const ownList = new Map();
    {
        const r = rngOf(SEED + 5);
        for (const t of favourites) {
            const prices = [];
            for (let id = 1; id <= BOUGHT; id += 1) {
                const u = r();
                const v = r();
                if (u < (id <= N.bid ? 0.62 : 0.225)) prices.push({ itemId: String(id), price: Math.max(1, Math.round(item[id].mv * (0.84 + v * 0.125))) });
            }
            ownList.set(t.id, prices);
        }
    }
    _store[NS + 'sellTeOwnLists'] = JSON.stringify(Object.fromEntries(favourites.map((t, i) => [t.id, { at: NOW - (2 + i * 2) * MIN, name: t.name, prices: ownList.get(t.id) }])));
    _store[NS + 'sellFavourites'] = JSON.stringify({ added: favourites.map((t) => t.id), names: Object.fromEntries(favourites.map((t) => [t.id, t.name])) });
    _store[NS + 'sellBlacklist'] = JSON.stringify(blacklisted.map((t) => ({ key: 'id:' + t.id, id: t.id, name: t.name, at: NOW - 2 * DAY })));
    // His settings (state.json), with the two once-only marks so start-up leaves them as they are.
    _store[NS + 'sellingPage'] = JSON.stringify({ onlineOnly: true, trustedOnly: false, freshOnly: true, cash: 150000000, cashLast: 150000000, maxPerFlip: 10000, extraItems: 10, minProfitPct: 0.1, networthPct: 10, neverFlip: ['Clothing', 'Other'], trustedOn311: true, otherOn3142: true });
    // The overlay: live feed off, TornW3B on (his).
    _store[NS + 'settings'] = JSON.stringify({ liveFeed: false, saveCalls: false, useW3b: true });
    // When each holder's list last changed: kept by the script in both places.
    {
        const rows = trader.filter((t) => t.holder).map((t) => [t.id, Math.round((NOW - t.listAgo) / 1000)]);
        _store[NS + 'listAt'] = JSON.stringify(rows);
        localStorage.setItem('ttv2.bids.listat', JSON.stringify(rows));
        // When TornW3B last saw each active (600 kept at most, read within 20 minutes).
        const r = rngOf(SEED + 6);
        localStorage.setItem('ttv2.bids.active', JSON.stringify({ v: 1, rows: trader.slice(0, 600).map((t) => [t.id, Math.round(NOW - t.activeAgo), t.name, NOW - Math.floor(r() * 8 * MIN)]) }));
    }

    /* ------------------------------------------------- what you hold */
    const held = [];
    {
        const r = rngOf(SEED + 7);
        for (let n = 0; n < 45; n += 1) {
            const id = 3 + n * 8;
            held.push({ id, amount: 1 + Math.floor(Math.pow(r(), 2) * 400), equipped: false, name: item[id].name, faction_owned: false, uid: null });
        }
        // Ten things a trader did not take (To sell), each still held.
        _store[NS + 'sellLeftovers'] = JSON.stringify(held.slice(0, 10).map((h, i) => ({ itemId: String(h.id), name: h.name, qty: Math.min(h.amount, 5 + i * 3), each: Math.round(item[h.id].mv * 0.86), from: trader[20 + i].name, at: NOW - (i + 1) * 2 * HOUR, why: 'left', since: NOW - (i + 1) * 2 * HOUR - 20000 })));
        // 94 price lists traders accepted, and how fast 300 items sold: his sizes.
        _store[NS + 'sellPriceRecords'] = JSON.stringify(Array.from({ length: 94 }, (_, i) => {
            const t = trader[Math.floor(r() * 60)];
            const prices = {};
            for (let p = 0; p < 9; p += 1) {
                const id = 1 + Math.floor(r() * N.bid);
                prices[id] = Math.round(item[id].mv * 0.95);
            }
            return { traderId: t.id, name: t.name, at: NOW - Math.floor((i + 1) * 1.7 * HOUR), prices };
        }));
        _store[NS + 'sellMoves'] = JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(1 + i), { units: Math.round(r() * 4000) / 10, ms: Math.floor(HOUR + r() * 5 * HOUR), at: NOW - Math.floor(r() * 2 * DAY) }])));
    }

    /* ------------------------------------------- the bazaars' listings */
    /* Every listing of an item, cheapest first: [sellerId, sellerName, price, qty, ageMs, changedAgoMs|null, sponsored]. */
    const rowsKept = new Map();
    const rowsOf = (id) => {
        if (rowsKept.has(id)) return rowsKept.get(id);
        const it = item[id];
        const r = rngOf(SEED + 50000 + id);
        const n = !it || id > IN_SUMMARY ? 0 : it.kind === 'flip' ? N.flipRows - 7 + Math.floor(r() * 16) : it.kind === 'near' ? 60 + Math.floor(r() * 31) : it.kind === 'far' ? 15 + Math.floor(r() * 50) : 3 + Math.floor(r() * 8);
        const rows = [];
        for (let k = 0; k < n; k += 1) {
            const price = Math.max(2, Math.round(it.lowest * (1 + 0.0035 * Math.pow(k, 1.15) + (k ? r() * 0.002 : 0))));
            // Three listings in a hundred are a trader's own bazaar.
            const seller = r() < 0.03 ? trader[Math.floor(r() * N.holders)] : null;
            const sid = seller ? seller.id : String(1500001 + Math.floor(r() * 9000));
            const age = r() < 0.85 ? r() * 20 * MIN : 30 * MIN + r() * 150 * MIN;
            rows.push([sid, seller ? seller.name : 'Seller' + sid.slice(3), price, 1 + Math.floor(Math.pow(r(), 3) * 300), Math.floor(age), r() < 0.3 ? null : Math.floor(age + r() * 6 * HOUR), r() < 0.01]);
        }
        rowsKept.set(id, rows);
        return rows;
    };
    // The reads the page kept from before (core/start-up.js packBazaarReads): every possible flip and 40 near ones in
    // full, read within the last 50 minutes; every other bought item's ten cheapest.
    {
        const r = rngOf(SEED + 8);
        const items = {};
        let listings = 0;
        for (let id = 1; id <= N.bid; id += 1) {
            const full = id <= N.flips + 40;
            const rows = rowsOf(id).slice(0, full ? 1000 : 10).map(([sid, sname, price, qty, age, changed, sp]) => [sid, sname, price, qty, NOW - age, changed === null ? null : NOW - changed, sp]);
            items[id] = { at: NOW - Math.floor((full ? 2 : 5) * MIN + r() * (full ? 30 : 38) * MIN), sweep: !full, rows };
            listings += rows.length;
        }
        localStorage.setItem('ttv2.bids.reads', JSON.stringify({ v: 1, at: NOW - MIN, items }));
        window.__sceneListings = listings;
    }

    /* -------------------------------------------------- the answers */
    const earlier = respond;
    const statusOf = (t, now) => {
        const ago = t.activeAgo + (now - NOW);
        return ago < 5 * MIN ? 'Online' : ago < 30 * MIN ? 'Idle' : 'Offline';
    };
    // eslint-disable-next-line no-global-assign
    respond = function (url) {
        const u = new URL(url);
        const now = Date.now();
        const nowS = Math.floor(now / 1000);
        let m;
        if (u.hostname === 'weav3r.dev') {
            if (u.pathname === '/api/marketplace') {
                const items = [];
                for (let id = 1; id <= IN_SUMMARY; id += 1) items.push({ item_id: id, item_name: item[id].name, lowest_price: item[id].lowest, market_price: item[id].mv, total_bazaars: rowsOf(id).length });
                return { items };
            }
            if ((m = u.pathname.match(/^\/api\/marketplace\/(\d+)\/traders$/))) {
                const within = Number(u.searchParams.get('tradedWithinHours')) || 0;
                let all = holdersOf.get(m[1]) || [];
                if (within) all = all.filter((x) => x.t.tradeAgo <= within * HOUR);
                // People stay as active as they were when the page opened (a status does not drift during a run).
                return { total_count: all.length, traders: all.slice(0, 100).map((x) => ({ player_id: Number(x.t.id), player_name: x.t.name, price: x.price, rating: { upvotes: x.t.up, downvotes: x.t.down }, last_action: Math.floor((now - x.t.activeAgo) / 1000), last_trade: Math.floor((NOW - x.t.tradeAgo) / 1000), pricelist_updated: Math.floor((NOW - x.t.listAgo) / 1000) })) };
            }
            if ((m = u.pathname.match(/^\/api\/marketplace\/(\d+)$/))) {
                const rows = rowsOf(Number(m[1]));
                // TornW3B goes on checking: a listing is as old now as it was when the page opened.
                return { total_listings: rows.length, listings: rows.map(([sid, sname, price, qty, age, changed, sp]) => ({ player_id: Number(sid), player_name: sname, price, quantity: qty, last_checked: Math.floor((now - age) / 1000), content_updated: changed === null ? null : Math.floor((NOW - changed) / 1000), ...(sp ? { sponsored: 1 } : {}) })) };
            }
            if ((m = u.pathname.match(/^\/api\/pricelist\/(\d+)$/))) {
                const prices = lists.get(m[1]);
                if (!prices) return { error: 'Pricelist not found for this user', __http: 404 };
                return Object.entries(prices).map(([id, price]) => ({ itemId: Number(id), name: item[id].name, buyPrice: price }));
            }
            return { error: 'Not found', __http: 404 };
        }
        if (u.hostname === 'www.tornexchange.com') {
            if (u.searchParams.get('key') !== TEKEY) return earlier(url);
            if (u.pathname === '/api/all_best_listings') return { status: 'success', data: Object.fromEntries([...teTop].map(([id, rows]) => [id, { item: item[id].name, traders: rows }])) };
            if ((m = u.pathname.match(/^\/api\/prices\/(\w+)$/))) {
                const own = ownList.get(m[1]);
                return own ? { status: 'success', data: { items: own.map((p) => ({ item_id: Number(p.itemId), name: item[p.itemId].name, price: p.price })) }, meta: { trader: byId.get(m[1]).name } } : { status: 'error', message: 'Trader not found', __http: 404 };
            }
            // His: 18 asks of 20 time out, and the list of names is days old.
            if (u.pathname === '/api/active_traders') return { status: 'error', message: 'Gateway time-out', __http: 504 };
            if (u.pathname === '/api/listings') {
                const rows = (teTop.get(String(u.searchParams.get('item_id'))) || []).map((x) => ({ trader: x.trader, price: x.price, item: 'x' }));
                return { status: 'success', data: { item: 'x', meta: { total_listings: rows.length, total_pages: 1, current_page: 1 }, listings: rows } };
            }
            return { status: 'error', message: 'Endpoint not found', __http: 404 };
        }
        if (u.hostname === 'api.torn.com') {
            if (u.pathname === '/v2/user/inventory') {
                if (u.searchParams.get('key') !== LIMITED) return earlier(url);
                return { inventory: { items: held, timestamp: nowS }, _metadata: { links: { next: null, prev: null }, total: held.length } };
            }
            if ((m = u.pathname.match(/^\/v2\/user\/(\d+)\/profile$/))) {
                const t = byId.get(m[1]);
                const status = t ? statusOf(t, now) : 'Offline';
                return { profile: { id: Number(m[1]), name: t ? t.name : 'Player' + m[1], last_action: { status, timestamp: t ? Math.floor((NOW - t.activeAgo) / 1000) : nowS - 86400, relative: '' }, status: { description: 'Okay', state: 'Okay' } } };
            }
            if ((m = u.pathname.match(/^\/v2\/user\/(\d+)\/personalstats$/)) && u.searchParams.get('cat') === 'networth') {
                const t = byId.get(m[1]);
                return { personalstats: { networth: { total: t ? t.networth : 750000000 } } };
            }
            if ((m = u.pathname.match(/^\/v2\/market\/(\d+)\/itemmarket$/))) {
                const it = item[Number(m[1])];
                const listings = it ? [{ price: Math.round(it.mv * 1.01), amount: 12 }, { price: Math.round(it.mv * 1.02), amount: 40 }] : [];
                return { itemmarket: { item: { id: Number(m[1]), average_price: it ? it.mv : 0 }, listings, cache_timestamp: nowS - 10, cache_delay: 30 }, _metadata: { total: listings.length } };
            }
            // The key, who you are, the item list: the harness's own answers.
            return earlier(url);
        }
        // Any other host: the harness refuses it (and the request fails on the page).
        return earlier(url);
    };

    /* ------------------------------------------------ the warm-up */
    /*
     * The script reads TornW3B once a second (one item's bazaars, one price list, one item's buyers), so a page the
     * size of the friend's takes minutes to come to rest: the 108 seed traders' lists, the possible flips' bazaars
     * read again, a first few items' buyers. __sceneWarmUp runs that reader `ticks` times `gap` ms apart, with the
     * harness's clock put forward a second and a bit each time (its own 60-a-minute limit is kept, in the page's
     * time). The reader is found by its name when the script starts its once-a-second timer; the timer itself is
     * left as it is.
     */
    const realSetInterval = window.setInterval;
    window.setInterval = function (fn, ms, ...rest) {
        if (typeof fn === 'function' && fn.name === 'stepW3b') window.__sceneStep = fn;
        return realSetInterval.call(window, fn, ms, ...rest);
    };
    window.__sceneWarmUp = async function (ticks = 330, gap = 25) {
        const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
        if (!window.__sceneStep) throw new Error('scene friend-size: the script never started its once-a-second TornW3B reader');
        for (let i = 0; i < ticks; i += 1) {
            _ahead += 1100;
            window.__sceneStep();
            await wait(gap);
        }
        await wait(1500);
        return window.__sceneCounts();
    };
    /* The log so far is put aside (window.__sceneBefore) and a new one begun: what is measured after is the page at rest. */
    window.__sceneMark = async function () {
        window.dispatchEvent(new Event('pagehide'));
        await new Promise((ok) => setTimeout(ok, 200));
        window.__sceneBefore = _store[NS + 'speedLog'] || null;
        delete _store[NS + 'speedLog'];
        window.__sceneMarkAt = (window.__requests || []).length;
        window.__sceneTasks = [];
        return true;
    };
    /* Every stretch of 50 ms and more in which the page could do nothing else, as the browser reports it. */
    window.__sceneTasks = [];
    try {
        new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.__sceneTasks.push([Math.round(e.startTime), Math.round(e.duration)]);
        }).observe({ type: 'longtask', buffered: true });
    } catch {
        /* no long-task observer in this browser */
    }
    /* What the scene holds and what was asked, for the bench to print. */
    window.__sceneCounts = function () {
        const asked = (window.__requests || []).slice(window.__sceneMarkAt || 0);
        const count = (re) => asked.filter((u) => re.test(u)).length;
        const db = _store[NS + 'traderDb'] ? JSON.parse(_store[NS + 'traderDb']) : { traders: {} };
        const all = Object.values(db.traders);
        const live = all.filter((t) => t.w3b && t.w3b.found && t.w3b.prices);
        let reads = null;
        try {
            reads = JSON.parse(localStorage.getItem('ttv2.bids.reads') || 'null');
        } catch {
            reads = null;
        }
        const readItems = reads && reads.items ? Object.values(reads.items) : [];
        const pics = [...document.querySelectorAll('*')].flatMap((e) => (e.shadowRoot ? [...e.shadowRoot.querySelectorAll('img')] : [])).concat([...document.querySelectorAll('img')]);
        return {
            seed: SEED,
            made: { items: N.items, itemsBought: BOUGHT, itemsInSummary: IN_SUMMARY, itemsWithBuyerAimed: N.bid, tradersStored: N.traders, listHolders: N.holders, liveListsStored: N.live, listScale: Math.round(scale * 1000) / 1000, pricesStored: [...lists].filter(([id]) => byId.get(id).live).reduce((a, [, p]) => a + Object.keys(p).length, 0), holdersTrusted: trader.filter((t) => t.holder && t.up - t.down >= 100).length, teTradersTrusted: tePool.filter((t) => t.score >= 100).length, favourites: favourites.length, blacklisted: blacklisted.length, listingsStored: window.__sceneListings, held: held.length, mostBuyersOfAnItem: Math.max(...[...holdersOf.values()].map((l) => l.length)) },
            now: { tradersInDb: all.length, unread: all.filter((t) => !t.w3b || !t.w3b.checkedAt).length, liveLists: live.length, livePrices: live.reduce((a, t) => a + Object.keys(t.w3b.prices).length, 0), keptReadItems: readItems.length, keptListings: readItems.reduce((a, b) => a + (b.rows ? b.rows.length : 0), 0), keptBytes: (localStorage.getItem('ttv2.bids.reads') || '').length },
            asked: { all: asked.length, bazaars: count(/weav3r\.dev\/api\/marketplace\/\d+(\?|$)/), buyers: count(/\/marketplace\/\d+\/traders/), lists: count(/\/api\/pricelist\//), summary: count(/weav3r\.dev\/api\/marketplace(\?|$)/), statuses: count(/\/v2\/user\/\d+\/profile/), networth: count(/personalstats/), tornexchange: count(/tornexchange\.com/), otherTorn: count(/api\.torn\.com\/(?!v2\/user\/\d+\/(profile|personalstats))/) },
            picturesAskedOfTorn: pics.filter((i) => /^https?:\/\/(www\.)?torn\.com\//.test(i.src)).length,
            // The page's own words: its status pills, the line under the keys, the counts on its tabs.
            page: (() => {
                const roots = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.shadowRoot);
                const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
                const classes = new Map();
                for (const e of all('*')) for (const c of typeof e.className === 'string' ? e.className.split(/\s+/).filter(Boolean) : []) classes.set(c, (classes.get(c) || 0) + 1);
                return {
                    pills: all('.sp-pill').map((e) => e.getAttribute('title')),
                    line: all('.sp-keystate').map((e) => e.textContent).filter(Boolean),
                    chips: all('.sp-chip').map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
                    elements: all('*').length,
                    classes: [...classes].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([c, n]) => c + ' ' + n).join(', '),
                };
            })(),
            tasks: window.__sceneTasks,
        };
    };
})();
