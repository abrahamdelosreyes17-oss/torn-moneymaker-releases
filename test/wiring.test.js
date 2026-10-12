/*
 * The joins (3.29.0). A part tested alone proves nothing about the page: main.js is where the parts meet,
 * and no test can run it (it needs Torn's page). So its text is read here, and each join 3.29.0 stands on
 * must be in it - the ones that, missing, would leave every test of a part green and the page as it was.
 * (The page itself is looked at in the harness: test/harness-live.html, test/bench.mjs.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const main = read('src/main.js');
const page = read('src/ui/selling-page.js');
const overlay = read('src/ui/overlay.js');
const styles = read('src/ui/styles.js');

/** Every call of `name(` in main.js, each with its line. */
const callsOf = (name) => main.split('\n').filter((line) => line.includes(name + '(') && !/^\s*(\*|\/\/|import |function )/.test(line));
const has = (text, what) => assert.ok(main.includes(text), what + ' - not in src/main.js: ' + text);

test('the lag: every keeper is handed the redraw\'s clock (without it keeping stays off after one difference, and nothing ages)', () => {
    has('keeper.begin({ idsByName, dbIdsByName, votesById, db }, now)', 'the buyers');
    for (const k of ['sellers', 'plans', 'shown', 'possible']) has('keepers.' + k + '.begin(now)', k);
    // None begun without it.
    assert.deepEqual(main.match(/keepers\.\w+\.begin\(\)/g), null);
    assert.deepEqual(main.match(/keeper\.begin\([^)]*db \}\)/g), null);
    // A difference is said in the problem log, by the same words for every keeper.
    assert.ok(callsOf('sellKeptDiffered').length >= 2, 'the buyers\' keeper and the work keepers');
    for (const file of fs.readdirSync(new URL('../src/core/', import.meta.url))) assert.equal(read('src/core/' + file).includes('KEPT_OFF_MS'), false, file);
    assert.equal(main.includes('KEPT_OFF_MS'), false);
});

test('the lag: the buyers an item shows come from the kept list, against the very rows and the blacklist/favourites number', () => {
    has('shownBuyers(keepers.shown.get(key, [all, shownVer], () => shownKept(all, blacklist, favOf)), shownOpts)', 'buyersOf');
    has('shownFavourites(partnersNow(), favEdits, now)', 'who is a favourite, once a redraw');
    // The sort it replaced is not called from the page any more.
    assert.equal(callsOf('favouritesFirstOnTie').length, 0);
});

test('the lag: the speed log is told who asked for a redraw, and the sizes it worked through', () => {
    has('sell.redrawBy = \'byData\'', 'a redraw for data');
    has('sell.redrawBy = by || \'byPress\'', 'a redraw for a press');
    has('perfGauge(SPEED_BIDS[by], 1)', 'counted');
    has('perfGauge(SPEED_BIDS.buyerRows, counted.rows)', 'buyer rows');
    has('perfGauge(SPEED_BIDS.priceLists, stats.withW3b)', 'price lists');
    has('perfAdd(SPEED_BIDS.inShown, inside.shown)', 'the time in the shown buyers');
});

test('the prices: To sell and what goes into a trade are worked out with the price check, wherever they are', () => {
    const rows = callsOf('toSellRows');
    assert.ok(rows.length >= 2);
    for (const line of rows) assert.match(line, /checkOf \}\)/, line.trim());
    const held = callsOf('toSellHeld');
    assert.ok(held.length >= 1);
    for (const line of held) assert.match(line, /checkOf \}\)/, line.trim());
    // In a trade: only the checked lines are counted; the others are listed as waiting.
    has('const held = yours.some((h) => h.unchecked) ? yours.filter((h) => !h.unchecked) : yours;', 'the trade\'s lines');
    has('const heldWaiting = held === yours ? [] : yours.filter((h) => h.unchecked);', 'the waiting ones');
    assert.ok(page.includes('c.heldWaiting'), 'and the page lists them');
    assert.ok(page.includes('T.unchecked'), 'To sell shows the rows that wait for a check');
    // The rows that wait for a check are asked about as a flip is: before the flips while To sell is the tab in view, after them otherwise.
    has('sell.flipCheckIds = [...new Set([...(sell.filter === \'sell\' ? [...sellWaiting, ...flipIds] : [...flipIds, ...sellWaiting]), ...sellRows.map((r) => r.itemId)])];', 'what is checked first');
    has('sell.toSellIds = toSell.filter((r) => !r.kept).map((r) => r.itemId);', 'every To sell item has its buyers read');
    has('...sellRows.map((r) => r.best.id)].filter(Boolean).map(String));', 'and its best payer\'s own list is read as a flip\'s trader\'s is');
});

test('the prices: picking a deal, Plan trade, Every flip and "said yes" each read that trader\'s price list', () => {
    for (const why of ['Picked a deal', 'Plan trade', 'Every flip', 'Said yes']) assert.equal(callsOf('checkTraderNow').filter((line) => line.includes('\'' + why + '\'')).length, 1, why);
    // The yes waits for the answer, and is written with what the read found.
    has('out.done.then(() => go(true));', 'the yes follows the answer');
    has('setTimeout(() => go(false), ACCEPT_WAIT_MS)', 'or a few seconds');
    has('const acc = { ...acceptTrade(t, itemId), priceCheck };', 'written down with the check');
    assert.ok(page.includes('A.priceCheck'), 'and the accepted trade says it');
    assert.ok(page.includes('LC.waitingYes'), 'the button says it is reading');
    // A trader's list read brings its bulk prices.
    has('recordW3bList(sell.db, id, { prices, bulk: parseW3bBulk(body) }, at)', 'the list read');
});

test('the prices: Torn Bids writes down what it checked, and the overlay shows a price as sure only from that table', () => {
    has('sellStoreChecked(lastChecked, now);', 'written at the end of a redraw');
    has('gmSet(STORE_SELL_CHECKED, table);', 'the write');
    has('gmGet(STORE_SELL_CHECKED, null)', 'the read');
    has('const unchecked = Boolean(buyer) && !priceCheckedHere(l.itemId, buyer, now);', 'a bazaar card\'s tag');
    has('traderTagLabel(buyer, l.listingPrice, !unchecked)', 'its words');
    has('sellElsewhere(trade, buyersForHolding, (itemId, b) => priceCheckedHere(itemId, b))', 'Checkout');
    // The tag's muted look hangs on one data attribute: the name the overlay writes is the one the styles read.
    const key = overlay.match(/TRADER_UNSURE_KEY = '(\w+)'/)[1];
    const attr = 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    assert.ok(styles.includes('[' + attr + ']'), attr);
    assert.ok(overlay.includes('row.el.dataset[TRADER_UNSURE_KEY] = \'1\''));
});
