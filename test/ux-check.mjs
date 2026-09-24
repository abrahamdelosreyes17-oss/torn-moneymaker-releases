/*
 * Clicks every control in the panel and the selling page, in a real
 * browser, against the built userscript - the check that "every click does
 * something".
 *
 *   npm run build
 *   PWPATH=$(npm root -g)/playwright node test/ux-check.mjs
 *
 * Needs Playwright (global install is fine). Screenshots go to $SHOTS or the
 * OS temp directory. Exits non-zero if any check fails.
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PWPATH || 'playwright');
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sp = process.env.SHOTS || tmpdir();
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  try { const body = await readFile(root + path); res.writeHead(200, {'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html'}); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8780);
const b = await chromium.launch();
const errs = [];
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

// shadow-root helpers
const q = (p, sel) => p.locator('#ttv2-host').locator(sel);
const vis = async (p, sel) => (await q(p, sel).count()) > 0 && await q(p, sel).first().isVisible();
const txt = async (p, sel) => (await q(p, sel).first().textContent()) || '';

/*
 * Design rules, checked on every screen: no text under 12px except 11px
 * uppercase labels; nothing overflowing sideways.
 */
async function designCheck(p, hostSel, label) {
  const bad = await p.locator(hostSel).evaluate((host) => {
    const out = [];
    for (const el of host.shadowRoot.querySelectorAll('*')) {
      if (!el.textContent.trim() || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (size < 11) out.push(el.className + ' ' + size);
      if (size < 12 && cs.textTransform !== 'uppercase') out.push(el.className + ' ' + size + ' not uppercase');
    }
    return out;
  });
  ok(bad.length === 0, label + ': no text under 12px except uppercase labels: ' + JSON.stringify(bad.slice(0, 5)));
}

/* ---------- first run: no key ---------- */
let p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:8780/test/harness.html');
await p.waitForTimeout(1500);
ok(await vis(p, '.ttv2-page-settings'), 'no key: opens on Settings');
ok(!(await vis(p, '.ttv2-page-list')), 'no key: list page hidden while Settings shows');
ok(await p.evaluate(() => document.getElementById('ttv2-host').shadowRoot.activeElement?.classList.contains('ttv2-key')), 'no key: key field focused');
ok(await q(p, '.ttv2-tos-box').evaluate(e => e.open), 'no key: ToS table expanded where the key is entered');
await p.screenshot({ path: sp + '/ux-firstrun.png' });
await q(p, '.ttv2-back').click();
ok(await vis(p, '.ttv2-page-list'), 'Back returns to the list');
ok((await txt(p, '.ttv2-empty')).includes('Add a Public API key'), 'empty list says a key is needed');
await q(p, '.ttv2-empty button').click();
ok(await vis(p, '.ttv2-page-settings'), '"Add key" opens Settings');
await p.keyboard.press('Escape');
ok(await vis(p, '.ttv2-page-list'), 'Esc closes Settings');
await q(p, 'button[title="Refresh now"]').click();
ok(await vis(p, '.ttv2-page-settings'), 'Refresh with no key goes to Settings (never a dead click)');
await p.close();

/* ---------- with a key: live list ---------- */
p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:8780/test/harness-live.html');
await p.waitForTimeout(8000);
ok(await vis(p, '.ttv2-page-list'), 'with key: opens on the list');
const rows0 = await q(p, '.ttv2-row').count();
const rowText0 = (await q(p, '.ttv2-row').allTextContents()).join(' | ');
ok(rows0 > 0, 'live feed shows at least one deal');
ok(!/Companion Script|Stick of Dynamite/.test(rowText0), '"Sell: N/A" items (Companion Script, Stick of Dynamite) never listed');
ok(rows0 > 0, 'rows shown: ' + rows0);
ok(/deal/.test(await txt(p, '.ttv2-bar-left')), 'status line: ' + (await txt(p, '.ttv2-bar-left')));
ok(/live/.test(await txt(p, '.ttv2-bar-right')), 'live indicator: ' + (await txt(p, '.ttv2-bar-right')));
ok(!/Trader|By trader/.test(await q(p, '.ttv2-panel').textContent()), 'no trader features in the overlay');
ok((await q(p, '.ttv2-tab').count()) === 2, 'two tabs only');
await p.screenshot({ path: sp + '/ux-list.png' });
await designCheck(p, '#ttv2-host', 'list');

// Money lines up: every profit figure is right-aligned in the same column.
const rights = await q(p, '.ttv2-row-profit').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
ok(new Set(rights).size === 1, 'profit column lines up row to row: ' + JSON.stringify(rights));
const sizes = await q(p, '.ttv2-row-profit').evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
ok(sizes.every((s) => s === '15px'), 'the key money number is 15px: ' + sizes[0]);

// settings replaces the list, same size
const box1 = await q(p, '.ttv2-panel').boundingBox();
await q(p, 'button[title="Settings"]').click();
ok(await vis(p, '.ttv2-page-settings') && !(await vis(p, '.ttv2-page-list')), 'Settings replaces the list');
const box2 = await q(p, '.ttv2-panel').boundingBox();
ok(Math.abs(box2.height - box1.height) <= 4, 'panel height steady when opening Settings (' + Math.round(box1.height) + ' -> ' + Math.round(box2.height) + ')');
ok((await q(p, 'button[title="Settings"]').getAttribute('aria-pressed')) === 'true', 'Settings button shows pressed');
ok(!(await q(p, '.ttv2-tos-box').evaluate(e => e.open)), 'key saved: ToS folded but present');
ok(!/TornExchange/.test(await txt(p, '.ttv2-page-settings')), 'overlay Settings has no TornExchange section');
// The TornExchange key pasted as the Torn key is refused, like the reverse.
await p.evaluate(() => GM_setValue('tornTrading.v2.teKey', JSON.stringify('TEKEYabcdefgh123')));
await q(p, 'input.ttv2-key').fill('TEKEYabcdefgh123');
await q(p, 'input.ttv2-key').press('Enter');
await p.waitForTimeout(300);
ok(/TornExchange key/.test(await txt(p, '.ttv2-bar-left')), 'the TornExchange key is refused as the Torn key: ' + (await txt(p, '.ttv2-bar-left')));
ok((await p.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.apiKey')))) === 'abcdefgh12345678', 'the saved Torn key is untouched');
await p.evaluate(() => GM_deleteValue('tornTrading.v2.teKey'));
await p.screenshot({ path: sp + '/ux-settings.png' });
await designCheck(p, '#ttv2-host', 'settings');
await q(p, 'button[title="Settings"]').click();
ok(await vis(p, '.ttv2-page-list'), 'Settings button again = Back');

// chips
ok(!(await vis(p, '.ttv2-chip[data-key="sellToTrader"]')), 'no Trader chip');
await q(p, '.ttv2-chip[data-key="sellToNpc"]').click();
await p.waitForTimeout(300);
ok((await q(p, '.ttv2-chip[data-key="sellToNpc"]').getAttribute('aria-pressed')) === 'false', 'NPC chip toggles off');
ok((await txt(p, '.ttv2-empty')).includes('Pick where to sell'), 'no exits: explains, offers a fix');
await q(p, '.ttv2-empty button').click();
await p.waitForTimeout(300);
ok((await q(p, '.ttv2-row').count()) === rows0, 'fix button restores the list');
const chipsWrap = await q(p, '.ttv2-chips').evaluate((n) => n.scrollWidth <= n.clientWidth);
ok(chipsWrap, 'filters fit in one row');

// value chip editor
await q(p, '.ttv2-chip[data-key="minTotalProfit"]').click();
ok(await vis(p, '.ttv2-chip-input'), 'Min chip opens an inline editor');
await q(p, '.ttv2-chip-input').fill('100');
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok((await txt(p, '.ttv2-chip[data-key="minTotalProfit"]')) === 'Min $100', 'Min chip: ' + (await txt(p, '.ttv2-chip[data-key="minTotalProfit"]')));
const rowsMin = await q(p, '.ttv2-row').count();
ok(rowsMin < rows0, 'min profit filters rows (' + rows0 + ' -> ' + rowsMin + ')');
await q(p, '.ttv2-chip[data-key="minTotalProfit"]').click();
await q(p, '.ttv2-chip-input').fill('999');
await p.keyboard.press('Escape');
ok((await txt(p, '.ttv2-chip[data-key="minTotalProfit"]')) === 'Min $100' && await vis(p, '.ttv2-page-list'), 'Esc cancels the edit, stays on list');
await q(p, '.ttv2-chip[data-key="minTotalProfit"]').click();
await q(p, '.ttv2-chip-input').fill('1');
await p.keyboard.press('Enter');

// ---------- Cash ----------
const cashChip = q(p, '.ttv2-chip[data-key="cashOnHand"]');
await cashChip.click();
await q(p, '.ttv2-chip-input').fill('1234567');
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok((await cashChip.textContent()) === 'Cash $1.23m', 'plain digits read as money: ' + (await cashChip.textContent()));
ok((await p.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.settings')).cashOnHand)) === 1234567, 'cash saved as 1234567');
await cashChip.click();
await q(p, '.ttv2-chip-input').fill('lots');
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok(/must be a number/.test(await txt(p, '.ttv2-bar-left')), 'unreadable cash: visible error: ' + (await txt(p, '.ttv2-bar-left')));
ok((await cashChip.textContent()) === 'Cash $1.23m', 'unreadable cash keeps the old value');
// $40 buys nothing: Hammer costs $50 in the bazaar, Beer $30 on the market.
await cashChip.click();
await q(p, '.ttv2-chip-input').fill('40');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
ok((await q(p, '.ttv2-row').count()) === 0, '$40 cash hides every bazaar deal it cannot buy one of');
ok(/hidden/.test(await txt(p, '.ttv2-empty')), 'empty state says cash hid them: ' + (await txt(p, '.ttv2-empty')));
await q(p, '.ttv2-tab[data-label="Item Market"]').click();
await p.waitForTimeout(300);
const beer = q(p, '.ttv2-row').filter({ hasText: 'Bottle of Beer' }).first();
ok((await beer.count()) === 1 && /×1 of 10/.test(await beer.textContent()), '$40 buys one $30 Beer of ten: row priced for one: ' + (await beer.textContent()));
ok(/1 deal · \+\$20$/.test(await txt(p, '.ttv2-bar-left')), 'header total is what the cash buys: ' + (await txt(p, '.ttv2-bar-left')));
await p.screenshot({ path: sp + '/ux-cash.png' });
await cashChip.click();
await q(p, '.ttv2-chip-input').fill('');
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
ok((await cashChip.textContent()) === 'Cash: any', 'blank clears the cash cap');
await q(p, '.ttv2-tab[data-label="Bazaars"]').click();
await p.waitForTimeout(300);

// tabs
await q(p, '.ttv2-tab[data-label="Item Market"]').click();
await p.waitForTimeout(200);
ok((await q(p, '.ttv2-tab-on').textContent()).startsWith('Item Market'), 'tab switches');
await q(p, '.ttv2-tab[data-label="Bazaars"]').click();

// Seller status next to the seller's name on bazaar rows
const cheap = q(p, '.ttv2-row', ).filter({ hasText: 'CheapSeller' }).first();
ok((await cheap.count()) === 1, 'CheapSeller bazaar row listed');
const src = (await cheap.locator('.ttv2-row-details').textContent()) || '';
ok(/^\$50 → NPC \$100 · CheapSeller\s*Traveling$/.test(src), 'details line: prices, seller with a one-word status: ' + src);
ok(/^\+\$200\d+s$/.test((await cheap.locator('.ttv2-row-profit').textContent()) || ''), 'the age sits under the profit: ' + (await cheap.locator('.ttv2-row-profit').textContent()));
ok((await cheap.locator('.ttv2-status').getAttribute('data-level')) === 'offline', 'status coloured by level');
ok(/Traveling to Mexico/.test(await cheap.locator('.ttv2-status').getAttribute('title')), 'tooltip has the full status');
ok(!/Bazaar|TornW3B/.test(src), 'the tab already says Bazaars and credits TornW3B; rows do not repeat it');
const profileCalls = await p.evaluate(() => window.__requests.filter((u) => /\/v2\/user\/777\/profile/.test(u)).length);
ok(profileCalls === 1, 'one profile call per seller, not one per render: ' + profileCalls);

// GO
await q(p, '.ttv2-go').first().click();
ok((await p.evaluate(() => window.__opened.length)) === 1, 'Go opens the listing: ' + (await p.evaluate(() => window.__opened[0])));

// refresh
await q(p, 'button[title="Refresh now"]').click();
await p.waitForTimeout(1500);
ok(!(await q(p, 'button[title="Refresh now"]').isDisabled()), 'Refresh completes');

// collapse / expand
await q(p, 'button[aria-label="Collapse"]').click();
ok(!(await vis(p, '.ttv2-body')), 'collapse hides the body');
ok(/deal/.test(await txt(p, '.ttv2-mini')), 'collapsed bar keeps the headline: ' + (await txt(p, '.ttv2-mini')));
await p.screenshot({ path: sp + '/ux-collapsed.png' });
await q(p, '.ttv2-title').click();
ok(await vis(p, '.ttv2-body'), 'clicking the collapsed bar expands it');

// drag + persistence
const before = await q(p, '.ttv2-panel').boundingBox();
await p.mouse.move(before.x + 60, before.y + 15);
await p.mouse.down();
await p.mouse.move(before.x - 300, before.y - 200, { steps: 8 });
await p.mouse.up();
const after = await q(p, '.ttv2-panel').boundingBox();
ok(Math.abs(after.x - (before.x - 360)) < 3, 'drag moves the panel');
const saved = await p.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.settings')).panelPos);
ok(saved && Math.abs(saved.left - after.x) < 2, 'position remembered: ' + JSON.stringify(saved));
ok(await vis(p, '.ttv2-body'), 'a drag is not a click (did not collapse)');

// Scan button: always animates, and says what it found
const scanning = () => q(p, '.ttv2-panel').evaluate((n) => n.classList.contains('ttv2-scanning'));
await q(p, 'button.ttv2-scan').click();
ok(await scanning(), 'Scan plays the scan animation');
ok(/Not a Bazaar or Item Market page/.test(await txt(p, '.ttv2-bar-left')), 'Scan off a market page says so: ' + (await txt(p, '.ttv2-bar-left')));
await p.waitForTimeout(1000);
ok(!(await scanning()), 'scan animation ends by itself');

// A Torn-style page change (pushState, no event) with listings that draw
// late: picked up without pressing anything, well inside the old 2.5s poll.
const tiles = await p.evaluate(async () => {
  const html = await (await fetch('/test/fixture.html')).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('.itemTile___gJeSo')].map((n) => n.outerHTML).join('');
});
ok(tiles.length > 0, 'fixture listings loaded');
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html?sid=ItemMarket#/market/view=search&itemID=1'));
await p.waitForTimeout(500);
await p.evaluate((h) => { const d = document.createElement('div'); d.id = 'fake-market'; d.innerHTML = h; document.body.appendChild(d); }, tiles);
let caught = false;
for (let i = 0; i < 20 && !caught; i++) { await p.waitForTimeout(50); caught = await scanning(); }
ok(caught, 'new page auto-scanned (with animation) within ~1s of its listings drawing');
await p.waitForTimeout(900);
await q(p, 'button.ttv2-scan').click();
ok(/Scanned: \d+ listing/.test(await txt(p, '.ttv2-bar-left')), 'Scan on a market page counts listings: ' + (await txt(p, '.ttv2-bar-left')));

// A padlocked ($1 Dollar Sale) card is skipped outright - never priced,
// never highlighted - even though its price is far below the NPC price.
// Control: an identical UNLOCKED card at that price is highlighted.
const beforeLock = await txt(p, '.ttv2-bar-left');
const nBefore = Number((beforeLock.match(/Scanned: (\d+) listing/) || [])[1]);
await p.evaluate(() => {
  const make = (id, locked) => {
    const tile = document.querySelector('#fake-market .itemTile___gJeSo').cloneNode(true);
    tile.id = id;
    for (const b of tile.querySelectorAll('[aria-label^="Buy item"]')) b.setAttribute('aria-label', 'Buy item Hammer, $1, 1 in total.');
    tile.querySelector('.price').textContent = '$1';
    if (locked) { const l = document.createElement('span'); l.className = 'isBlockedForBuying___x1Y2z'; tile.querySelector('.actionsWrapper___t9l4N').appendChild(l); }
    document.getElementById('fake-market').appendChild(tile);
  };
  make('open-tile', false);
  make('locked-tile', true);
});
await q(p, 'button.ttv2-scan').click();
const afterLock = await txt(p, '.ttv2-bar-left');
const hit = (id) => p.evaluate((id) => { const t = document.getElementById(id); return [t, ...t.querySelectorAll('*')].some((n) => n.classList.contains('ttv2-hit') || n.hasAttribute('data-ttv2-hit')); }, id);
ok(nBefore > 0 && new RegExp('Scanned: ' + (nBefore + 1) + ' listing.*1 locked').test(afterLock), 'locked card skipped and counted: ' + afterLock);
ok(await hit('open-tile'), 'control: the unlocked $1 card below NPC IS highlighted');
ok(!(await hit('locked-tile')), 'the padlocked $1 card is NOT highlighted');
await p.screenshot({ path: sp + '/ux-scan.png' });

// Bazaar owner: status badge after the name in the page banner, the same
// line in the panel, and a closed bazaar hides its deals.
const banner = (state) => `<div class="delimiter" id="fake-banner"><div class="msg right-round messageContent___cdSrs"><a href="profiles.php?XID=4254715">DixieNormousss's</a> bazaar, favorited by <b>3</b> citizens, is currently <span class="bold">${state}.</span></div></div>`
  + '<div class="listItem___h3qQ0"><a href="profiles.php?XID=4254715">DixieNormousss\'s Profile</a></div>';
await p.evaluate((h) => { document.getElementById('fake-market')?.remove(); const d = document.createElement('div'); d.id = 'fake-bz'; d.innerHTML = h; document.body.prepend(d); }, banner('open'));
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html?page=bazaar&userId=4254715'));
await p.waitForTimeout(1500);
const badge = await p.evaluate(() => [...document.querySelectorAll('.ttv2-owner')].map((b) => [b.dataset.level, b.textContent, b.previousElementSibling && b.previousElementSibling.textContent]));
ok(badge.length === 1, 'one owner badge on the page (not in the dropdown): ' + JSON.stringify(badge));
ok(badge[0] && badge[0][0] === 'offline' && /Offline · 3h ago · Traveling to Mexico/.test(badge[0][1]) && /DixieNormousss/.test(badge[0][2]), 'badge sits after the name and reads the status');
ok(/Seller: DixieNormousss.*Offline · 3h ago/.test(await txt(p, '.ttv2-seller')), 'panel seller line: ' + (await txt(p, '.ttv2-seller')));
ok(!/closed/i.test(await txt(p, '.ttv2-seller')), 'open bazaar is not flagged closed');
await p.setViewportSize({ width: 1280, height: 420 });
await p.waitForTimeout(300);
const sellerBox = await q(p, '.ttv2-seller').evaluate((n) => ({ h: n.getBoundingClientRect().height, need: n.scrollHeight }));
ok(sellerBox.h >= 20 && sellerBox.h >= sellerBox.need, 'seller line not squeezed by a long list: ' + JSON.stringify(sellerBox));
await p.setViewportSize({ width: 1280, height: 900 });
await p.screenshot({ path: sp + '/ux-owner.png' });
await p.evaluate((h) => { document.getElementById('fake-bz').innerHTML = h; }, banner('closed'));
await p.waitForTimeout(3000);
ok(/Bazaar closed/.test(await txt(p, '.ttv2-seller')), 'closed bazaar flagged in the panel');
ok((await p.evaluate(() => document.querySelectorAll('.ttv2-owner').length)) === 1, 'badge survives the banner re-rendering');
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html'));
await p.waitForTimeout(800);
ok(!(await vis(p, '.ttv2-seller')), 'seller line gone off the bazaar');
ok((await p.evaluate(() => document.querySelectorAll('.ttv2-owner').length)) === 0, 'badge removed off the bazaar');

// ` shows and hides the panel - but not while typing
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.keyboard.press('Backquote');
ok(!(await vis(p, '.ttv2-body')), '` collapses the panel');
await p.keyboard.press('Backquote');
ok(await vis(p, '.ttv2-body'), '` expands it again');
await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'fake-chat'; document.body.appendChild(t); t.focus(); });
await p.keyboard.press('Backquote');
ok(await vis(p, '.ttv2-body'), '` typed in a chat box does not toggle');
ok((await p.evaluate(() => document.getElementById('fake-chat').value)) === '`', 'and the ` still reaches the chat box');
await p.evaluate(() => { document.getElementById('fake-chat').blur(); document.getElementById('fake-bz')?.remove(); });

// ---------- Your own bazaar: the pricing helper ----------
const ownRows = `<ul class="items-cont">
  <li class="clearfix"><div class="img-wrap"><img src="/images/items/180/large.png" alt="Bottle of Beer"></div><div class="title-wrap"><div class="name-wrap">Bottle of Beer x12</div></div><div class="amount-wrap"><input type="text" class="amount"></div></li>
  <li class="clearfix"><div class="img-wrap"><img src="/images/items/206/large.png" alt="Xanax"></div><div class="title-wrap"><div class="name-wrap">Xanax</div></div><div class="amount-wrap"><input type="text" class="amount"></div></li>
</ul>`;
await p.evaluate((h) => { const d = document.createElement('div'); d.id = 'fake-own'; d.innerHTML = h; document.body.prepend(d); }, ownRows);
const reqsBeforeOwn = await p.evaluate(() => window.__requests.length);
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html?page=bazaar#/add'));
await p.waitForTimeout(14000); // the helper asks one Item Market price per 10s, on a 2.5s poll
const tags = await p.evaluate(() => [...document.querySelectorAll('.ttv2-bztag')].map((t) => t.textContent));
ok(tags.length === 2, 'a price tag in each own-bazaar row: ' + JSON.stringify(tags));
ok(await p.evaluate(() => [...document.querySelectorAll('.ttv2-bztag')].every((t) => t.previousElementSibling && t.previousElementSibling.classList.contains('name-wrap'))), 'the tag sits after the name element, not inside it');
ok(await p.evaluate(() => [...document.querySelectorAll('#fake-own .name-wrap')].every((n) => !n.querySelector('.ttv2-bztag') && /^(Bottle of Beer x12|Xanax)$/.test(n.textContent.trim()))), 'the name element still reads as the name');
ok(/IM \$30 · Bazaar none/.test(tags[0] || ''), 'Beer: lowest Item Market ask $30, no bazaar lists it: ' + tags[0]);
ok(/IM \$9,999,999 · Bazaar \$840,000/.test(tags[1] || ''), 'Xanax: market $9,999,999, bazaar $840,000: ' + tags[1]);
ok(/My bazaar/.test(await txt(p, '.ttv2-title')), 'panel switches to My bazaar');
ok((await q(p, '.ttv2-bzrow').count()) === 3, 'panel lists both items under a header');
ok((await q(p, '.ttv2-avg tr').count()) === 6, 'averages for 1h, 6h, 24h, 7d, 30d');
const avgText = await txt(p, '.ttv2-avg');
ok(/1 hour.*\$30.*no data/.test(avgText.replace(/\s+/g, ' ')), 'the hour has one sample; bazaar column says no data: ' + avgText.replace(/\s+/g, ' ').slice(0, 120));
ok((avgText.match(/no data/g) || []).length >= 5 && /24 hours\$30no data<1%7 days\$30no data1%30 days\$30no data1%/.test(avgText.replace(/\s+/g, ' ')), 'a column with nothing recorded says no data; coverage is stated per window: ' + avgText.replace(/\s+/g, ' ').slice(-60));
ok((await q(p, 'svg.ttv2-graph').count()) === 1, 'a graph is drawn');
ok(/Asking prices this script recorded/.test(await txt(p, '.ttv2-bzdetail')), 'labelled as recorded asking prices');
await p.evaluate(() => document.querySelectorAll('.ttv2-bztag')[1].click());
await p.waitForTimeout(300);
ok(/Xanax/.test(await txt(p, '.ttv2-bzdetail h3')), 'clicking a row tag selects that item in the panel');
ok(/Market value \$830,000/.test(await txt(p, '.ttv2-bzdetail')), 'market value shown as the sale-based line');
await q(p, '.ttv2-window[aria-pressed="false"]').first().click();
ok((await q(p, '.ttv2-window[aria-pressed="true"]').textContent()) === '7d', 'graph window switches');
await p.screenshot({ path: sp + '/ux-own-bazaar.png' });
await designCheck(p, '#ttv2-host', 'my bazaar');
const imCalls = await p.evaluate((n) => window.__requests.slice(n).filter((u) => /\/v2\/market\/(180|206)\/itemmarket/.test(u)).length, reqsBeforeOwn);
ok(imCalls >= 1 && imCalls <= 3, 'at most one Item Market call per item on screen, not a loop: ' + imCalls);
// Idle: the helper must not keep rewriting its own tags (each rewrite was a rescan, was a rewrite).
const idle = await p.evaluate(() => new Promise((resolve) => {
  let n = 0;
  const mo = new MutationObserver((ms) => { n += ms.length; });
  mo.observe(document.getElementById('fake-own'), { childList: true, subtree: true, characterData: true, attributes: true });
  setTimeout(() => { mo.disconnect(); resolve(n); }, 10000);
}));
ok(idle < 5, 'fewer than 5 DOM mutations in 10s of idle on the own-bazaar rows: ' + idle);
ok((await p.evaluate(() => Object.keys(JSON.parse(GM_getValue('tornTrading.v2.priceHistory') || '{"items":{}}').items).length)) >= 2, 'history recorded for both items');
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html'));
await p.waitForTimeout(1200);
ok((await p.evaluate(() => document.querySelectorAll('.ttv2-bztag').length)) === 0, 'tags removed off the own bazaar');
ok(/NPC Arbitrage/.test(await txt(p, '.ttv2-title')), 'panel back to the list');
await p.evaluate(() => document.getElementById('fake-own')?.remove());

// The helper on its own (live feed and TornW3B off): one Item Market call per
// item, 10s apart, and none again while the price is fresh (120s).
{
  const h = await b.newPage({ viewport: { width: 1280, height: 900 } });
  h.on('pageerror', e => errs.push(String(e)));
  await h.goto('http://localhost:8780/test/harness-live.html?nofeed=1');
  await h.waitForTimeout(2500);
  await h.evaluate((html) => { const d = document.createElement('div'); d.id = 'fake-own'; d.innerHTML = html; document.body.prepend(d); }, ownRows);
  const before = await h.evaluate(() => window.__requests.length);
  await h.evaluate(() => history.pushState({}, '', '/test/harness-live.html?nofeed=1&page=bazaar#/add'));
  await h.waitForTimeout(14000);
  const helperCalls = () => h.evaluate((n) => window.__requests.slice(n).filter((u) => /\/v2\/market\/(180|206)\/itemmarket/.test(u)), before);
  const first = await helperCalls();
  ok(first.length === 2, 'helper alone: one Item Market call per item in the first 14s: ' + first.length);
  ok(/IM \$30/.test((await h.evaluate(() => document.querySelectorAll('.ttv2-bztag')[0].textContent))) && /IM \$9,999,999/.test((await h.evaluate(() => document.querySelectorAll('.ttv2-bztag')[1].textContent))), 'both tags priced');
  await h.waitForTimeout(10000);
  const later = await helperCalls();
  ok(later.length === 2, 'helper alone: no Item Market call again while the price is fresh: ' + later.length);
  const w3bCalls = await h.evaluate((n) => window.__requests.slice(n).filter((u) => /weav3r\.dev/.test(u)).length, before);
  ok(w3bCalls === 0, 'TornW3B off: never contacted: ' + w3bCalls);
  await h.close();
}

// The overlay's Sell button opens the selling page in a new tab.
await q(p, 'button.ttv2-sell').click();
ok(/index\.php\?ttv2=traders$/.test(await p.evaluate(() => window.__opened.at(-1))), 'Sell opens the selling page in its own tab');
ok(!(await vis(p, '.ttv2-prompt')), 'no open-mode question');

// Narrow: nothing overflows at 430px.
await p.setViewportSize({ width: 430, height: 800 });
await p.waitForTimeout(400);
const panelBox = await q(p, '.ttv2-panel').boundingBox();
ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= 430, 'panel inside a 430px screen: ' + JSON.stringify(panelBox));
const clipped = await q(p, '.ttv2-row-details').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
ok(clipped === 0, 'no details line is cut off at 430px');
ok(await q(p, '.ttv2-chips').evaluate((n) => n.scrollWidth <= n.clientWidth), 'filters still one row at 430px');
await p.screenshot({ path: sp + '/ux-list-430.png' });
await p.setViewportSize({ width: 1280, height: 900 });

// Settings -> "Open deals in a new tab" off: Go goes there in this tab.
await q(p, 'button[title="Settings"]').click();
const newTab = q(p, '.ttv2-check').filter({ hasText: 'Open deals in a new tab' }).locator('input');
ok(await newTab.isChecked(), 'new-tab setting on by default');
await newTab.uncheck();
ok((await p.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.settings')).openInNewTab)) === false, 'new-tab setting saved off');
await q(p, 'button[title="Settings"]').click();
await p.route('https://www.torn.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>torn</p>' }));
// gmOpenTab would record the URL and leave this page; only assign() lands here.
await Promise.all([p.waitForURL(/torn\.com/, { timeout: 5000 }), q(p, '.ttv2-go').first().click()]);
ok(/torn\.com\/bazaar\.php\?userId=\d+/.test(p.url()), 'Go with new tab off navigates this tab: ' + p.url());
await p.close();

/* ---------- The selling page: its own tab, its own keys ---------- */
{
  const t = await b.newPage({ viewport: { width: 1280, height: 900 } });
  t.on('pageerror', e => errs.push(String(e)));
  const s = (sel) => t.locator('#ttv2-sell-host').locator(sel);
  const stxt = async (sel) => (await s(sel).first().textContent()) || '';

  // No keys yet: the page opens on its settings and says what it needs.
  await t.goto('http://localhost:8780/test/harness-live.html?ttv2=traders');
  await t.waitForTimeout(1500);
  ok((await t.locator('#ttv2-sell-host').count()) === 1, 'a ?ttv2=traders tab IS the selling page');
  ok((await t.locator('#ttv2-host').count()) === 0, 'the overlay does not draw on the selling tab');
  ok(await s('.sp-settings').isVisible(), 'no keys: opens on its settings');
  ok((await s('.sp-tos tr').count()) === 6, 'Torn ToS table beside the Limited key field');
  ok(/Limited/.test(await stxt('.sp-tos')), 'ToS names Limited access and the selections used');
  ok(/Add a Limited API key/.test(await stxt('.sp-banner')), 'banner asks for the Limited key');
  await t.screenshot({ path: sp + '/ux-sell-settings.png' });
  await designCheck(t, '#ttv2-sell-host', 'selling settings');
  // The overlay's Public key cannot read an inventory: a clear message.
  await s('input.sp-key').first().fill('abcdefgh12345678');
  await s('input.sp-key').first().press('Enter');
  await t.waitForTimeout(2500);
  ok(/needs Limited access/.test(await stxt('.sp-banner')), 'a Public key: says it needs Limited access: ' + (await stxt('.sp-banner')));
  await t.close();

  const u = await b.newPage({ viewport: { width: 1280, height: 900 } });
  u.on('pageerror', e => errs.push(String(e)));
  const su = (sel) => u.locator('#ttv2-sell-host').locator(sel);
  const utxt = async (sel) => (await su(sel).first().textContent()) || '';
  await u.goto('http://localhost:8780/test/harness-live.html?ttv2=traders&sellkeys=1');
  await u.waitForTimeout(4000);
  ok(await su('.sp-table').isVisible(), 'with keys: the table shows');
  const names = await su('.sp-row .sp-item').allTextContents();
  ok(names.length === 3 && names[0] === 'Xanax' && names[1] === 'Hammer', 'one row per held item, best offer per item first: ' + JSON.stringify(names));
  ok((await su('.sp-seg-btn[data-sort="item"]').getAttribute('aria-pressed')) === 'true' && (await su('.sp-seg-btn[data-sort="bundle"]').getAttribute('aria-pressed')) === 'false', 'the Per item | Bundle control shows Per item active');
  const xan = su('.sp-row').filter({ hasText: 'Xanax' }).first();
  const xanCells = await xan.locator('td').allTextContents();
  ok(xanCells[1] === '15', 'stacks merged: 12 + 3 Xanax, equipped Hammer left out: ' + JSON.stringify(xanCells));
  ok(xanCells[2] === '$850,000' && /Bob/.test(xanCells[3]), 'best offer and trader: ' + xanCells[2] + ' ' + xanCells[3]);
  ok(xanCells[4] === '$830,000', 'market value from Torn: ' + xanCells[4]);
  ok(/\$850,000/.test(xanCells[5]) && /top 3/.test(xanCells[5]), 'traders average, marked top 3 until the full list loads: ' + xanCells[5]);
  ok(xanCells[6] === '$12,750,000', 'total = qty x best offer: ' + xanCells[6]);
  const ham = su('.sp-row').filter({ hasText: 'Hammer' }).first();
  const hamCells = await ham.locator('td').allTextContents();
  ok(hamCells[1] === '150,000' && hamCells[2] === '$115' && /Alice/.test(hamCells[3]), 'Hammer: highest offer first even from an offline trader: ' + JSON.stringify(hamCells));
  const beerRow = su('.sp-row').filter({ hasText: 'Bottle of Beer' }).first();
  ok(/No buyer on TE/.test(await beerRow.textContent()), 'an item no trader buys says so, last');
  await u.waitForTimeout(3000);
  ok(/Alice\s*Offline 2h$/.test((await ham.locator('td').allTextContents())[3]), 'trader status next to the name: ' + (await ham.locator('td').allTextContents())[3]);
  ok(/3 items · 2 with a buyer · \$30\.00m at best offers/.test(await utxt('.sp-bar-left')), 'summary line: ' + (await utxt('.sp-bar-left')));
  await u.screenshot({ path: sp + '/ux-sell.png' });
  await u.screenshot({ path: sp + '/sell-perItem.png', clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await designCheck(u, '#ttv2-sell-host', 'selling page');
  const totals = await su('.sp-total').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  ok(new Set(totals).size === 1, 'totals right-aligned in one column: ' + JSON.stringify(totals));

  // Per item | Bundle: 150,000 Hammers at $115 ($17.25m) outrank one stack of Xanax ($12.75m) as a bundle.
  await su('.sp-seg-btn[data-sort="bundle"]').click();
  await u.waitForTimeout(300);
  const bundleNames = await su('.sp-row .sp-item').allTextContents();
  ok(bundleNames[0] === 'Hammer' && bundleNames[1] === 'Xanax', 'Bundle: qty x offer, highest first: ' + JSON.stringify(bundleNames));
  ok((await su('.sp-seg-btn[data-sort="bundle"]').getAttribute('aria-pressed')) === 'true' && (await su('.sp-seg-btn[data-sort="item"]').getAttribute('aria-pressed')) === 'false', 'Bundle shows active');
  ok((await u.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.sellingPage')).sortBy)) === 'bundle', 'the order is remembered in the page\'s own preferences');
  await u.screenshot({ path: sp + '/sell-bundle.png', clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await u.setViewportSize({ width: 430, height: 800 });
  await u.waitForTimeout(400);
  ok(await su('.sp-seg').isVisible() && await su('.sp-toggle').isVisible(), 'the order control and Online only are on screen at 430px');
  ok(await u.locator('#ttv2-sell-host').evaluate((h) => { const s = h.shadowRoot; const head = s.querySelector('.sp-head'); return head.scrollWidth <= head.clientWidth + 1; }), 'the header does not overflow at 430px');
  await u.screenshot({ path: sp + '/sell-430-toggle.png', clip: { x: 0, y: 0, width: 430, height: 140 } });
  await u.setViewportSize({ width: 1280, height: 900 });
  await u.waitForTimeout(300);
  await su('.sp-seg-btn[data-sort="item"]').click();
  await u.waitForTimeout(300);
  ok((await su('.sp-row .sp-item').allTextContents())[0] === 'Xanax', 'Per item again: Xanax first');

  // Online only: Hammer's best becomes Bob (online, $110); Xanax stays Bob.
  await su('.sp-toggle').click();
  await u.waitForTimeout(500);
  const hamOnline = await su('.sp-row').filter({ hasText: 'Hammer' }).first().locator('td').allTextContents();
  ok(hamOnline[2] === '$110' && /Bob/.test(hamOnline[3]), 'Online only: highest ONLINE trader: ' + JSON.stringify(hamOnline));
  ok((await su('.sp-row').count()) === 2, 'Online only hides the item with no online buyer');
  ok((await u.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.sellingPage')).onlineOnly)) === true, 'the toggle is remembered in the page\'s own preferences');
  await su('.sp-toggle').click();
  await u.waitForTimeout(300);

  // Expand: every buyer, highest first, with Profile and TE list links.
  await su('.sp-row').filter({ hasText: 'Xanax' }).first().click();
  await u.waitForTimeout(300);
  ok((await su('.sp-expanded').count()) === 1, 'clicking a row expands its traders');
  let trs = await su('.sp-tr').allTextContents();
  ok(trs.length === 1 && /Bob/.test(trs[0]), 'top-three traders shown at once');
  await u.waitForTimeout(23000); // the TornExchange gap: active_traders, then the full list
  trs = await su('.sp-tr').allTextContents();
  ok(trs.length === 3 && /Bob/.test(trs[0]) && /Carol/.test(trs[1]) && /Alice/.test(trs[2]), 'full list: Bob $850k, Carol $845k, Alice $830k, highest first: ' + JSON.stringify(trs));
  const xanAvg = (await su('.sp-row').filter({ hasText: 'Xanax' }).first().locator('td').allTextContents())[5];
  ok(xanAvg === '$841,667', 'traders average now over all buyers: ' + xanAvg);
  await u.waitForTimeout(2500);
  ok(/Carol\s*Online/.test(trs[1]) || /Carol\s*Online/.test((await su('.sp-tr').allTextContents())[1]), 'a buyer from the full list got its id and status: ' + (await su('.sp-tr').allTextContents())[1]);
  await su('.sp-tr').first().locator('a', { hasText: 'Profile' }).click();
  ok(/profiles\.php\?XID=11$/.test(await u.evaluate(() => window.__opened.at(-1))), 'Profile opens the trader\'s Torn profile');
  await su('.sp-tr').first().locator('a', { hasText: 'TE list' }).click();
  ok((await u.evaluate(() => window.__opened.at(-1))) === 'https://www.tornexchange.com/prices/11/', 'TE list opens their TornExchange price list');
  await u.screenshot({ path: sp + '/ux-sell-expanded.png' });

  // Keys go where they belong and nowhere else.
  const reqs = await u.evaluate(() => window.__requests);
  const inv = reqs.filter((r) => r.includes('/v2/user/inventory'));
  ok(inv.length >= 2 && inv.every((r) => r.includes('key=LIMITED123456789')), 'inventory read with the Limited key, paged: ' + inv.length);
  ok(!reqs.some((r) => r.includes('api.torn.com') && r.includes('TEKEY')), 'the TornExchange key never goes to Torn');
  ok(!reqs.some((r) => r.includes('tornexchange.com') && r.includes('LIMITED')), 'the Limited key never goes to TornExchange');
  ok(!reqs.some((r) => r.includes('weav3r.dev')), 'the selling page never contacts TornW3B');
  const teReqs = reqs.filter((r) => r.includes('tornexchange.com'));
  ok(teReqs.length <= 4, 'few TornExchange calls: ' + teReqs.length);

  // Narrow: stacked cards, no sideways scroll.
  await u.setViewportSize({ width: 430, height: 800 });
  await u.waitForTimeout(400);
  const overflow = await u.locator('#ttv2-sell-host').evaluate((h) => { const m = h.shadowRoot.querySelector('.sp-main'); return m.scrollWidth - m.clientWidth; });
  ok(overflow <= 2, 'no sideways scroll at 430px: ' + overflow);
  await u.screenshot({ path: sp + '/ux-sell-430.png' });
  await designCheck(u, '#ttv2-sell-host', 'selling page 430');
  await u.setViewportSize({ width: 1280, height: 900 });

  // Settings: the page's own; forgetting the TornExchange key clears traders.
  await su('button[title="Settings"]').click();
  ok(/Saved · Limited access/.test(await utxt('.sp-keystate >> nth=0')), 'key state names the access level: ' + (await utxt('.sp-keystate >> nth=0')));
  ok(/Saved · prices/.test(await utxt('.sp-keystate >> nth=1')), 'TornExchange key state shows price age: ' + (await utxt('.sp-keystate >> nth=1')));
  await su('.sp-check input').uncheck();
  ok((await u.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.sellingPage')).linksNewTab)) === false, 'links preference saved in the page\'s own store');
  ok((await u.evaluate(() => JSON.parse(GM_getValue('tornTrading.v2.settings') || '{}').openInNewTab)) !== false, 'the overlay\'s own setting untouched');
  await u.keyboard.press('Escape');
  ok(await su('.sp-table').isVisible(), 'Esc leaves settings');
  await u.close();

  // A remembered Bundle order opens in Bundle order.
  const v = await b.newPage({ viewport: { width: 1280, height: 900 } });
  v.on('pageerror', e => errs.push(String(e)));
  const sv = (sel) => v.locator('#ttv2-sell-host').locator(sel);
  await v.goto('http://localhost:8780/test/harness-live.html?ttv2=traders&sellkeys=1&sellprefs=' + encodeURIComponent(JSON.stringify({ sortBy: 'bundle' })));
  await v.waitForTimeout(4000);
  ok((await sv('.sp-row .sp-item').allTextContents())[0] === 'Hammer' && (await sv('.sp-seg-btn[data-sort="bundle"]').getAttribute('aria-pressed')) === 'true', 'a saved Bundle preference opens in Bundle order with Bundle active');
  await v.close();

  // Online only from the start, with slow status lookups: says it is checking,
  // then shows the online buyers (it used to show nobody, forever).
  const w = await b.newPage({ viewport: { width: 1280, height: 900 } });
  w.on('pageerror', e => errs.push(String(e)));
  const sw = (sel) => w.locator('#ttv2-sell-host').locator(sel);
  await w.goto('http://localhost:8780/test/harness-live.html?ttv2=traders&sellkeys=1&slow=1&sellprefs=' + encodeURIComponent(JSON.stringify({ onlineOnly: true })));
  let sawChecking = false;
  let onlineRows = 0;
  for (let i = 0; i < 200 && onlineRows === 0; i++) {
    await w.waitForTimeout(50);
    if ((await sw('.sp-empty').count()) && /Checking who's online/.test(await sw('.sp-empty').first().textContent())) sawChecking = true;
    onlineRows = await sw('.sp-row').count();
  }
  ok(sawChecking, 'Online only while statuses load says "Checking who\'s online…"');
  ok(onlineRows === 2, 'Online only then shows the items with an online buyer: ' + onlineRows);
  ok((await sw('.sp-row').first().locator('td').allTextContents())[3].includes('Bob'), 'the online buyer: ' + (await sw('.sp-row').first().locator('td').allTextContents())[3]);
  ok((await sw('.sp-toggle').getAttribute('aria-pressed')) === 'true', 'Online only shows active');
  await w.close();
}

console.log('ERRORS', errs);
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
await b.close(); server.close();
process.exit(failures || errs.length ? 1 : 0);
