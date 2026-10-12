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

/*
 * 3.32.0 - Flips > For <the server owner>. Its parts are tested alone (test/owner-tab.test.js) and its list comes
 * through the real server code (test/said-list.test.js); these are the joins in between, and the page was looked at
 * on test/harness-live.html with &scene=owner.
 */
test('the owner\'s tab: the list, the reads and every press are joined in the page', () => {
    const screen = read('src/ui/owner-page.js');
    has('owner: ownerView,', 'the view is handed to the page');
    has('onOwner: onOwnerAct,', 'the tab\'s presses reach the script');
    assert.ok(screen.includes('h.onOwner(what, value)'), 'the screen calls the handler the script gives');
    assert.ok(page.includes('\'For \' + this.state.owner.name'), 'the tab is named after them, by the name handed');
    assert.ok(page.includes('this.ownerView.render(this.state.owner)'), 'the screen is drawn from that view');
    // Every press the screen sends is one the script acts on.
    const acts = [...new Set([...screen.matchAll(/this\.act\('(\w+)'/g)].map((m) => m[1]))].sort();
    assert.deepEqual(acts, ['clear', 'drop', 'fill', 'from', 'make', 'mode', 'n', 'set']);
    for (const act of acts) assert.ok(main.includes('act === \'' + act + '\''), 'the script acts on "' + act + '"');
    // The list: taken at once when this very tab's link saves it, and read again when it changes.
    has('if (key === SHARED_OWN_KEY && world === \'sell\') takeSharedOwn();', 'saved by this tab');
    has('sell.ownerHeld = undefined;', 'a new list is read');
    // The pieces: this PC's own to read, first in line, counted apart, never let go while the tab is in view.
    has('...pinnedIds, ...setIds].filter(Boolean)', 'the pieces are this PC\'s to read');
    has('[...new Set([...setFirst, ...flipOrder.map(String), ...setIds])]', 'the set in view before the flips');
    has(': setIds.includes(id) ? \'w.sets\'', 'their sellers lists are counted apart');
    has('...pinned, ...sell.ownerIds]);', 'their rows are kept');
    has('tag: \'t.sets\'', 'their Item Market reads are counted apart');
    const usage = read('src/core/usage.js');
    for (const tag of ['\'t.sets\'', '\'w.sets\'']) assert.ok(usage.includes(tag), tag + ' has a name in Settings > API use');
});

test('the owner\'s tab: whole sets only, and the Item Market as a stop, wherever a trade is read or walked', () => {
    has('for (const key of Object.keys(all)) all[key] = ownerCapped(all[key]);', 'every reader of the trades sends whole sets only');
    has('types: onMarket.size ? [LOG_BAZAAR_BUY, LOG_MARKET_BUY] : [LOG_BAZAAR_BUY]', 'the log is asked for Item Market buys only while a list buys there');
    has('...marketBuyRows(read, onMarket)]', 'those buys tick the steps');
    has('noteOwnBuys(buys.filter((b) => String(b.sellerId) !== OWNER_MARKET));', 'and are no bazaar\'s listing');
    has('marketNext(t, marketPageItem(location.href))', 'Next walks the pieces on the Item Market');
    has('openSellLink(stepUrl(next.step, next.itemId, next.name))', 'the run starts on the right page');
    has('stepUrl({ sellerId: l.sellerId, price: l.price }, l.itemId, l.name)', 'the checkout\'s links');
    // No link to a "bazaar" of the Item Market is built from a step anywhere.
    assert.equal(callsOf('bazaarUrl').filter((line) => /next\.step|l\.sellerId/.test(line) && !/marketStep|stepUrl/.test(line)).length, 1, 'only the one behind the market check in Next');
    has('if (next && !marketStep(next.step)) {', 'that one');
    // A list made here stands on his own list alone.
    has('const made = ownerOf(trade);', 'what he pays comes from his list');
    // The Trades desk draws the stops, and names the next one, in the order Next walks them.
    const desk = read('src/ui/selling-page.js');
    assert.ok(desk.includes('stops.sort((x, y) => stepRank(A, x.sellerId) - stepRank(A, y.sellerId));'), 'the desk\'s stops');
    assert.ok(desk.includes('[...steps].sort((x, y) => stepRank(A, x.sellerId) - stepRank(A, y.sellerId)).find('), 'the desk\'s next stop');
    assert.ok(read('src/core/accepted.js').includes('const rank = stepRank(trade, st.sellerId);'), 'Next goes by the same order');
});

test('the owner\'s tab: no person\'s name in its code - the name shown is the one the server hands', () => {
    for (const file of ['src/core/owner-tab.js', 'src/ui/owner-page.js']) assert.equal(/nochance|\babe\b|vincent/i.test(read(file)), false, file);
    has('list.name || (status && status.name) || (known && known.name) || \'Trader \' + list.id', 'the name: the server\'s, Torn\'s, TornW3B\'s');
});
