/*
 * Scene owner (3.32.0): the tab "For <name>" - the shared server holds its owner's price list, said by his Torn
 * Archive, and Torn Bids buys the pieces of his plushie and flower sets against it.
 *
 * Loaded by test/harness-live.html when the address has &scene=owner, before the script. Open it as Torn Bids'
 * page with the pretend server on:
 *   test/harness-live.html?ttv2=traders&job=bids&sellkeys=1&ledgerkey=1&shared=on&awake=1&scene=owner#flips
 *
 * The owner here is player 7001, "Setter" (a made-up name: the script takes his name from the server's answer).
 * His list was last said 3 h 12 min ago and his shop is closed. He pays for every piece of both sets; he holds
 * enough Sheep and Kitten plushies (not bought as single pieces), takes 4 plushie sets and 2 flower sets.
 * Every piece is sold in four bazaars (9101-9104) and on the Item Market, dearer step by step, so the first sets
 * pay and a later one does not. Two pieces are made awkward on purpose:
 *   Banana Orchid (617)   its cheapest listing is over what he pays: only its whole set carries it.
 *   Tribulus Omanense (385) no bazaar sells it: only the Item Market does.
 *
 *   &ownerbare=1   his Torn Archive is one from before 1.3.10: prices only, no word on how many he takes.
 *   &ownernone=1   the server holds no list (no key marked as the owner's): the tab is not there.
 *   &ownerfull=1   his sets are full: he takes none now.
 */
(() => {
    const q = new URLSearchParams(location.search);
    const HOUR = 3600000;
    const OWNER = 7001;
    const PLUSH = { 186: 'Sheep Plushie', 187: 'Teddy Bear Plushie', 215: 'Kitten Plushie', 258: 'Jaguar Plushie', 261: 'Wolverine Plushie', 266: 'Nessie Plushie', 268: 'Red Fox Plushie', 269: 'Monkey Plushie', 273: 'Chamois Plushie', 274: 'Panda Plushie', 281: 'Lion Plushie', 384: 'Camel Plushie', 618: 'Stingray Plushie' };
    const FLOWER = { 260: 'Dahlia', 263: 'Crocus', 264: 'Orchid', 267: 'Heather', 271: 'Ceibo Flower', 272: 'Edelweiss', 276: 'Peony', 277: 'Cherry Blossom', 282: 'African Violet', 385: 'Tribulus Omanense', 617: 'Banana Orchid' };
    const PAY = {};
    Object.keys(PLUSH).forEach((id, k) => { PAY[id] = 30000 + k * 1500; });
    Object.keys(FLOWER).forEach((id, k) => { PAY[id] = 20000 + k * 1200; });
    for (const [id, name] of Object.entries(PLUSH)) ITEMS[id] = { name, type: 'Plushie', sell_price: 100, market_value: PAY[id] };
    for (const [id, name] of Object.entries(FLOWER)) ITEMS[id] = { name, type: 'Flower', sell_price: 100, market_value: PAY[id] };

    const OFF = ['186', '215'];
    const prices = Object.fromEntries(Object.entries(PAY).filter(([id]) => !OFF.includes(id)));
    const full = q.get('ownerfull') === '1';
    const more = {
        name: 'Setter',
        ...(q.get('ownerbare') === '1' ? {} : {
            all: { ...PAY },
            sets: { plushie: full ? 0 : 4, flower: full ? 0 : 2 },
            take: Object.fromEntries(Object.keys(prices).map((id, k) => [id, full ? 0 : 2 + (k % 4)])),
        }),
    };
    const SELLERS = [[9101, 'Ada'], [9102, 'Bram'], [9103, 'Cleo'], [9104, 'Dov']];
    const round = (n) => Math.round(n / 10) * 10;
    /* A piece's bazaar listings: 2 at 90% of what he pays, 2 at 93%, 3 at 97%, 5 at 102%. */
    const bazaarOf = (id) => {
        if (id === '385') return [];
        const p = PAY[id];
        const steps = id === '617' ? [[1.05, 3], [1.08, 2], [1.1, 4], [1.2, 5]] : [[0.9, 2], [0.93, 2], [0.97, 3], [1.02, 5]];
        const nowS = Math.floor(Date.now() / 1000);
        return steps.map(([f, qty], k) => ({ player_id: SELLERS[k][0], player_name: SELLERS[k][1], price: round(p * f), quantity: qty, last_checked: nowS - 30 - k * 5 }));
    };
    /* And its Item Market listings: 1 at 92%, 4 at 99% (the Tribulus: 3 at 91%, 6 at 95%). */
    const marketOf = (id) => {
        const p = PAY[id];
        return id === '385' ? [{ price: round(p * 0.91), amount: 3 }, { price: round(p * 0.95), amount: 6 }] : [{ price: round(p * 0.92), amount: 1 }, { price: round(p * 0.99), amount: 4 }];
    };

    const answer = respond;
    window.__ownerAsked = { bazaars: [], market: [] };
    // eslint-disable-next-line no-global-assign
    respond = (url) => {
        const u = new URL(url);
        if (u.hostname.endsWith('.workers.dev') && u.pathname === '/sync') {
            const out = answer(url);
            if (!out || out.__http || q.get('ownernone') === '1') return out;
            const age = 3 * HOUR + 12 * 60000;
            return { ...out, ownAt: 5, own: [[OWNER, age, age + 2 * HOUR, 0, prices, OFF.map(Number)]], ownMore: { [OWNER]: more } };
        }
        const b = u.hostname === 'weav3r.dev' ? u.pathname.match(/^\/api\/marketplace\/(\d+)$/) : null;
        if (b && PAY[b[1]]) {
            window.__ownerAsked.bazaars.push(b[1]);
            const listings = bazaarOf(b[1]);
            return { total_listings: listings.length, listings };
        }
        const m = u.hostname === 'api.torn.com' ? u.pathname.match(/^\/v2\/market\/(\d+)\/itemmarket$/) : null;
        if (m && PAY[m[1]]) {
            window.__ownerAsked.market.push(m[1]);
            const listings = marketOf(m[1]);
            return { itemmarket: { item: { id: +m[1], average_price: PAY[m[1]] }, listings, cache_timestamp: Math.floor(Date.now() / 1000) - 10, cache_delay: 30 }, _metadata: { total: listings.length } };
        }
        return answer(url);
    };
})();
