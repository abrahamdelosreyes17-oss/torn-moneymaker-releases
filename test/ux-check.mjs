/*
 * Clicks every control in the panel, in a real browser, against the built
 * userscript - the check that "every click does something".
 *
 *   npm run build
 *   PWPATH=$(npm root -g)/playwright node test/ux-check.mjs
 *
 * Needs Playwright (global install is fine). Screenshots go to the OS temp
 * directory. Exits non-zero if any check fails.
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
const sp = tmpdir();
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
ok((await txt(p, '.ttv2-empty')).includes('Needs a Public API key'), 'empty list says a key is needed');
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
await p.screenshot({ path: sp + '/ux-list.png' });

// settings replaces the list, same size
const box1 = await q(p, '.ttv2-panel').boundingBox();
await q(p, 'button[title="Settings"]').click();
ok(await vis(p, '.ttv2-page-settings') && !(await vis(p, '.ttv2-page-list')), 'Settings replaces the list');
const box2 = await q(p, '.ttv2-panel').boundingBox();
ok(Math.abs(box2.height - box1.height) <= 4, 'panel height steady when opening Settings (' + Math.round(box1.height) + ' -> ' + Math.round(box2.height) + ')');
ok((await q(p, 'button[title="Settings"]').getAttribute('aria-pressed')) === 'true', 'Settings button shows pressed');
ok(!(await q(p, '.ttv2-tos-box').evaluate(e => e.open)), 'key saved: ToS folded but present');
await p.screenshot({ path: sp + '/ux-settings.png' });
await q(p, 'button[title="Settings"]').click();
ok(await vis(p, '.ttv2-page-list'), 'Settings button again = Back');

// chips
await q(p, '.ttv2-chip[data-key="sellToNpc"]').click();
await p.waitForTimeout(300);
ok((await q(p, '.ttv2-chip[data-key="sellToNpc"]').getAttribute('aria-pressed')) === 'false', 'NPC chip toggles off');
ok((await txt(p, '.ttv2-empty')).includes('Nothing to sell to'), 'no exits: explains, offers a fix');
await q(p, '.ttv2-empty button').click();
await p.waitForTimeout(300);
ok((await q(p, '.ttv2-row').count()) === rows0, 'fix button restores the list');

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

// tabs
await q(p, '.ttv2-tab[data-label="Item Market"]').click();
await p.waitForTimeout(200);
ok((await q(p, '.ttv2-tab-on').textContent()).startsWith('Item Market'), 'tab switches');
await q(p, '.ttv2-tab[data-label="Bazaars"]').click();

// GO
await q(p, '.ttv2-go').first().click();
ok((await p.evaluate(() => window.__opened.length)) === 1, 'GO opens the listing: ' + (await p.evaluate(() => window.__opened[0])));

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
ok(/Nothing to scan here/.test(await txt(p, '.ttv2-bar-left')), 'Scan off a market page says so: ' + (await txt(p, '.ttv2-bar-left')));
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
await p.screenshot({ path: sp + '/ux-owner.png' });
await p.evaluate((h) => { document.getElementById('fake-bz').innerHTML = h; }, banner('closed'));
await p.waitForTimeout(3000);
ok(/Bazaar closed/.test(await txt(p, '.ttv2-seller')), 'closed bazaar flagged in the panel');
ok((await p.evaluate(() => document.querySelectorAll('.ttv2-owner').length)) === 1, 'badge survives the banner re-rendering');
await p.evaluate(() => history.pushState({}, '', '/test/harness-live.html'));
await p.waitForTimeout(800);
ok(!(await vis(p, '.ttv2-seller')), 'seller line gone off the bazaar');
ok((await p.evaluate(() => document.querySelectorAll('.ttv2-owner').length)) === 0, 'badge removed off the bazaar');

// ` shows and hides the overlay - but not while typing
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.keyboard.press('Backquote');
ok(!(await vis(p, '.ttv2-body')), '` collapses the overlay');
await p.keyboard.press('Backquote');
ok(await vis(p, '.ttv2-body'), '` expands it again');
await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'fake-chat'; document.body.appendChild(t); t.focus(); });
await p.keyboard.press('Backquote');
ok(await vis(p, '.ttv2-body'), '` typed in a chat box does not toggle');
ok((await p.evaluate(() => document.getElementById('fake-chat').value)) === '`', 'and the ` still reaches the chat box');

console.log('ERRORS', errs);
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
await b.close(); server.close();
process.exit(failures || errs.length ? 1 : 0);
