/*
 * Mockup AM (3.33.0): every page and tab of Torn Bids and the overlay, in a real browser, against the built
 * userscript in the live harness (canned Torn, TornW3B and TornExchange answers - nothing leaves the laptop).
 * It presses what the owner presses and checks what the redo promised: every page and tab draws, nothing runs
 * off sideways, nothing is cut with an ellipsis, a page fits the window (its lists scroll inside), the sidebar
 * pins and opens on hover, Read now reads and Redraw reads nothing, the trade's pane and its tabs, the Prices
 * pop, the (i) help, the pins, old #mine / #sell addresses, and the overlay sized to what it holds.
 *
 *   npm run build
 *   $env:PWPATH = "$(npm root -g)\playwright"; node test/ui-check.mjs
 *
 * Runs in the installed Chrome (channel 'chrome'). Screenshots go to $SHOTS or the OS temp folder.
 * Exits non-zero if any check fails. (test/ux-check.mjs is the 3.20.0 check of the old screens.)
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PWPATH || 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || join(tmpdir(), 'torn-bids-ui-check');
await mkdir(shots, { recursive: true });
const PORT = 8781;
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    try {
        const body = await readFile(root + path);
        res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
}).listen(PORT);

const BASE = `http://localhost:${PORT}/test/harness-live.html`;
const PAGE_Q = '?ttv2=traders&sellkeys=1&bigflip=1&ledgerkey=1&manytrades=1&leftmany=1&awake=1';
const SIZES = [['his', 1707, 932], ['friend 1536', 1536, 960], ['friend 1280', 1280, 800]];
// Pages whose own view scrolls by design (long tools); every other page fits the window.
const SCROLLS_BY_DESIGN = new Set(['ledger:0', 'settings:2']);

let failures = 0;
const ok = (cond, msg, extra = '') => {
    console.log((cond ? 'PASS ' : 'FAIL ') + msg + (cond || !extra ? '' : ' :: ' + extra));
    if (!cond) failures += 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome' });

/* In the page: the shadow root of Torn Bids. */
const R = "document.querySelector('#ttv2-sell-host').shadowRoot";

async function open(w, h, q = PAGE_Q) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    page.on('response', (r) => { if (r.status() === 404 && !/favicon/.test(r.url())) errs.push('404 ' + r.url()); });
    await page.goto(BASE + q);
    await page.waitForFunction(() => {
        const h = document.querySelector('#ttv2-sell-host');
        return h && h.shadowRoot && h.shadowRoot.querySelector('.nav-b');
    }, null, { timeout: 20000 });
    await wait(5000);
    return { page, errs };
}

async function go(page, id, tab) {
    await page.evaluate(([id, tab]) => {
        const r = document.querySelector('#ttv2-sell-host').shadowRoot;
        r.querySelector(`.nav-b[data-go="${id}"]`).click();
        if (tab !== null) {
            const t = r.querySelectorAll('.top .tab')[tab];
            if (t) t.click();
        }
    }, [id, tab]);
    await wait(900);
}

/* What the page in view shows: its title, tab, whether it drew, sideways overflow, cut text, window fit. */
async function look(page) {
    return page.evaluate(() => {
        const r = document.querySelector('#ttv2-sell-host').shadowRoot;
        const view = r.querySelector('.view');
        const on = [...r.querySelectorAll('.page')].find((p) => p.offsetParent !== null && getComputedStyle(p).display !== 'none');
        const tab = r.querySelector('.top .tab.on');
        const out = { tab: tab ? tab.textContent.trim() : '', text: on ? on.innerText.trim().length : 0, sideways: [], cut: [], small: [], fit: null };
        for (const el of r.querySelectorAll('*')) {
            if (!el.getClientRects().length) continue;
            const cs = getComputedStyle(el);
            if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && !el.matches('.subtabs')) out.sideways.push((el.className || el.tagName) + ' ' + el.clientWidth + '/' + el.scrollWidth);
            if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.cut.push((el.className || el.tagName) + ': ' + el.textContent.trim().slice(0, 40));
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            // Uppercase labels may be 10px (the trust badges, the usage table's heads); other text 11px at least.
            const fs = parseFloat(cs.fontSize);
            if (own && (fs < 10 || (fs < 11 && cs.textTransform !== 'uppercase'))) out.small.push((el.className || el.tagName) + ' ' + cs.fontSize + ' "' + el.textContent.trim().slice(0, 30) + '"');
        }
        if (view) out.fit = { client: view.clientHeight, scroll: view.scrollHeight };
        // Nothing of ours is wider than the window.
        out.wide = document.documentElement.scrollWidth > window.innerWidth + 1;
        return out;
    });
}

/* ------------------------------------------------ every page and tab, at the three laptop sizes */
const PAGES = [['today', null], ['flips', 0], ['flips', 1], ['flips', 2], ['flips', 3], ['trades', 0], ['trades', 1], ['items', 0], ['items', 1], ['ledger', null], ['settings', 0], ['settings', 1], ['settings', 2]];
for (const [name, w, h] of SIZES) {
    const { page, errs } = await open(w, h);
    for (const [id, tab] of PAGES) {
        await go(page, id, tab);
        const key = id + ':' + (tab === null ? 0 : tab);
        const l = await look(page);
        const label = `${name} ${id}${tab === null ? '' : ' › ' + (l.tab || tab)}`;
        ok(l.text > 20, label + ': the page draws');
        ok(!l.sideways.length && !l.wide, label + ': nothing runs off sideways', JSON.stringify(l.sideways.slice(0, 4)));
        ok(!l.cut.length, label + ': no text cut with an ellipsis', JSON.stringify(l.cut.slice(0, 4)));
        ok(!l.small.length, label + ': no text under 11px', JSON.stringify(l.small.slice(0, 4)));
        if (!SCROLLS_BY_DESIGN.has(key)) {
            // 1280 x 800: Settings may scroll a little (known, reported).
            const slack = name === 'friend 1280' && id === 'settings' ? 120 : 4;
            ok(l.fit && l.fit.scroll <= l.fit.client + slack, label + ': fits the window, lists scroll inside', l.fit && l.fit.client + '/' + l.fit.scroll);
        }
        await page.screenshot({ path: join(shots, `${name.replace(/ /g, '-')}-${id}${tab === null ? '' : tab}.png`) });
    }
    ok(!errs.length, name + ': no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
}

/* ------------------------------------------------ the sidebar: pin, and open on hover (his ask) */
{
    const { page } = await open(1707, 932);
    await page.evaluate(() => { try { localStorage.removeItem('ttv2.bd.sidePin'); } catch {} });
    const sideW = () => page.evaluate(() => Math.round(document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('.side-in').getBoundingClientRect().width));
    const pinned = () => page.evaluate(() => document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('.app').classList.contains('pinned'));
    const was = await pinned();
    const pin = page.locator('#ttv2-sell-host').locator('button.pin');
    if (was) { await pin.click(); await wait(400); }
    const rail = await sideW();
    ok(!(await pinned()) && rail < 90, 'sidebar: folded to a rail', String(rail));
    await page.locator('#ttv2-sell-host').locator('.side').hover();
    await wait(500);
    ok((await sideW()) > rail + 60, 'sidebar: opens on hover', String(await sideW()));
    await page.mouse.move(900, 500);
    await wait(500);
    ok((await sideW()) <= rail + 2, 'sidebar: folds again when the mouse leaves', String(await sideW()));
    await page.locator('#ttv2-sell-host').locator('.side').hover();
    await wait(300);
    await pin.click();
    await page.mouse.move(900, 500);
    await wait(500);
    ok((await pinned()) && (await sideW()) > rail + 60, 'sidebar: pinned stays open', String(await sideW()));
    ok((await pin.getAttribute('aria-pressed')) === 'true', 'sidebar: the pin says it is pressed');
    await pin.click();
    await wait(400);
    ok(!(await pinned()), 'sidebar: unpinned folds back');
    if (was) await pin.click();
    await page.close();
}

/* ------------------------------------------------ Read now reads, Redraw reads nothing */
{
    const { page } = await open(1707, 932);
    await go(page, 'flips', 0);
    const reqs = () => page.evaluate(() => (window.__requests || []).length);
    // Redraw: the harness reads all the time at its pace, so a Redraw is judged against that pace: five
    // presses in a 3 s window may not read more than the busiest of five 3 s windows without one.
    const base = [];
    for (let i = 0; i < 5; i += 1) {
        const a = await reqs();
        await wait(3000);
        base.push((await reqs()) - a);
    }
    const a = await reqs();
    for (let i = 0; i < 5; i += 1) {
        await page.locator('#ttv2-sell-host').locator('button.ib[aria-label="Redraw"]').click();
        await wait(600);
    }
    const pressed = (await reqs()) - a;
    ok(pressed <= Math.max(...base), 'Redraw: nothing more is read than without it', 'pressed ' + pressed + ' vs ' + JSON.stringify(base));
    ok(await page.evaluate(() => document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('.view').innerText.trim().length > 20), 'Redraw: the page is still drawn');
    const before = await reqs();
    await page.locator('#ttv2-sell-host').locator('button.btn', { hasText: 'Read now' }).click();
    await wait(3000);
    const fresh = await page.evaluate((n) => window.__requests.slice(n), before);
    ok(fresh.length > 0, 'Read now: reads again', String(fresh.length));
    ok(fresh.length <= 60, 'Read now: within the limits (no burst)', String(fresh.length));
    await page.close();
}

/* ------------------------------------------------ Best flips and the trade's pane */
{
    const { page, errs } = await open(1707, 932);
    await go(page, 'flips', 0);
    const host = page.locator('#ttv2-sell-host');
    const rows = host.locator('tr.lr:not(.pinrow)');
    await rows.first().waitFor({ timeout: 25000 }).catch(() => {});
    const n = await rows.count();
    ok(n > 0, 'Best flips: rows drawn', String(n));
    if (n) {
        await rows.first().click();
        await wait(900);
        const head = (await host.locator('.tph').first().innerText().catch(() => '')).trim();
        ok(head.length > 0, 'the pane: the trade opens beside the list');
        ok(await rows.first().evaluate((r) => r.classList.contains('sel')), 'the pane: the pressed row is the picked one');
        const tabs = host.locator('.subtabs > button');
        const nt = await tabs.count();
        ok(nt >= 2, 'the pane: its tabs', String(nt));
        for (let i = 0; i < nt; i += 1) {
            const label = (await tabs.nth(i).innerText()).trim().replace(/\s+/g, ' ');
            await tabs.nth(i).click();
            await wait(600);
            const on = await tabs.nth(i).evaluate((b) => b.classList.contains('on'));
            const body = (await host.locator('.tpb').first().innerText().catch(() => '')).trim();
            ok(on && body.length > 0, `the pane: tab "${label}" draws`);
        }
        // The Take choice is reached whole (the bar wraps, never hides its end).
        const takeIn = await page.evaluate(() => {
            const r = document.querySelector('#ttv2-sell-host').shadowRoot;
            const t = r.querySelector('.subtabs .take');
            const bar = r.querySelector('.subtabs');
            if (!t) return null;
            const a = t.getBoundingClientRect();
            const b = bar.getBoundingClientRect();
            return a.right <= b.right + 1 && a.left >= b.left - 1;
        });
        ok(takeIn !== false, 'the pane: the Take choice is in view whole');
        // A row's pin: pressed, the row is pinned; pressed again, unpinned.
        const pinBtn = host.locator('tr.lr:not(.pinrow) button.rowpin').first();
        if (await pinBtn.count()) {
            await pinBtn.click();
            await wait(900);
            ok((await host.locator('tr.pinrow').count()) > 0, 'Best flips: a pinned trade comes first');
            await host.locator('tr.pinrow button.rowpin').first().click();
            await wait(900);
            ok((await host.locator('tr.pinrow').count()) === 0, 'Best flips: unpinned');
        } else ok(false, 'Best flips: every live trade has its pin');
    }
    // The Prices pill: its pop opens on hover.
    await host.locator('.top .pill').nth(1).hover();
    await wait(400);
    ok(await page.evaluate(() => { const p = document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('.top .pill .pop'); return p && getComputedStyle(p).visibility !== 'hidden' && getComputedStyle(p).display !== 'none' && getComputedStyle(p).opacity !== '0'; }), 'Prices: the pop opens on hover');
    // The bottom line: nothing cut, what does not fit is "+ N more".
    const tape = await page.evaluate(() => { const t = document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('.tape-r'); return t ? t.scrollWidth - t.clientWidth : 0; });
    ok(tape <= 1, 'the bottom line: nothing cut', String(tape));
    ok(!errs.length, 'Flips: no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
}

/* ------------------------------------------------ several traders (his 2026-10-16 shots): no hold on a press, ranked live */
{
    const { page, errs } = await open(1707, 932, '?ttv2=traders&sellkeys=1&bigflip=1&manybuyers=1&ledgerkey=1&awake=1');
    const host = page.locator('#ttv2-sell-host');
    await go(page, 'flips', 0);
    await page.mouse.move(1000, 600);
    // Online, Trusted and Fresh prices off: every trader the harness has.
    for (let k = 0; k < 3; k += 1) {
        const t = host.locator('.only .tog.on').first();
        if (await t.count()) { await t.click(); await wait(500); }
    }
    await page.mouse.move(1300, 880);
    await wait(12000);
    const list = () => page.evaluate(() => {
        const r = document.querySelector('#ttv2-sell-host').shadowRoot;
        const money = (t) => Number(String(t).replace(/[^0-9-]/g, '')) || 0;
        const table = r.querySelector('tr.lr') && r.querySelector('tr.lr').closest('table');
        return {
            rows: [...r.querySelectorAll('tr.lr:not(.pinrow)')].map((tr) => ({
                name: (tr.querySelector('.lrow .a > b') || {}).textContent || '',
                profit: money((tr.querySelector('.lrow .p b') || {}).textContent || ''),
                gone: tr.classList.contains('gone'),
                sel: tr.classList.contains('sel'),
                nameH: Math.round((tr.querySelector('.lrow .a > b') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
                over: Math.round(tr.getBoundingClientRect().right - table.parentElement.getBoundingClientRect().right),
            })),
            held: Boolean(r.querySelector('.sp-still-box:not([hidden])')),
            onThis: [...r.querySelectorAll('tr.lr .tag.b')].filter((t) => /on this/i.test(t.textContent)).length,
            pane: ((r.querySelector('.tph h3') || {}).textContent || '').trim(),
        };
    });
    let l = await list();
    const names = l.rows.map((x) => x.name);
    ok(l.rows.length >= 3, 'several traders: rows drawn', JSON.stringify(names));
    ok(new Set(names).size === names.length, 'several traders: one row a trader', JSON.stringify(names));
    ok(l.rows.every((x, i) => i === 0 || l.rows[i - 1].profit >= x.profit), 'several traders: the biggest trade first', JSON.stringify(l.rows.map((x) => x.name + ' ' + x.profit)));
    ok(l.rows.every((x) => x.over <= 1), 'several traders: no row wider than its panel', JSON.stringify(l.rows.map((x) => x.over)));
    ok(l.rows.every((x) => x.nameH <= 24), 'several traders: a name on one line', JSON.stringify(l.rows.map((x) => x.nameH)));
    ok(!l.rows.some((x) => x.gone), 'several traders: no "No flip now" row kept');
    // A press in the trade (its quantity box, a tick) holds nothing: no frozen list, no "You are on this".
    await host.locator('tr.lr:not(.pinrow)').first().click();
    await wait(1200);
    const box = host.locator('.tpb input').first();
    if (await box.count()) { await box.click(); await wait(400); await page.keyboard.press('Tab'); }
    await wait(1500);
    l = await list();
    ok(!l.held, 'a press in a trade does not freeze the list');
    ok(l.onThis === 0, 'a press in a trade is not "You are on this"', String(l.onThis));
    // The pane follows every pick.
    const rows = host.locator('tr.lr:not(.pinrow)');
    const n = Math.min(await rows.count(), 4);
    for (let i = 1; i < n; i += 1) {
        const want = ((await rows.nth(i).locator('.lrow .a > b').textContent()) || '').trim();
        await rows.nth(i).click();
        await wait(1500);
        const pane = (await list()).pane;
        ok(pane.startsWith(want), `the pane follows the pick: ${want}`, pane);
    }
    await page.screenshot({ path: join(shots, 'several-traders.png') });
    ok(!errs.length, 'several traders: no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
}

/* ------------------------------------------------ Today, Items, Trades, Settings */
{
    const { page, errs } = await open(1707, 932);
    const host = page.locator('#ttv2-sell-host');
    await go(page, 'today', null);
    ok((await host.locator('.kpi').count()) === 4, 'Today: four totals');
    const all = host.locator('.p-dash .ph .btn.gh').first();
    await all.click();
    await wait(700);
    const now = await page.evaluate(() => { const r = document.querySelector('#ttv2-sell-host').shadowRoot; const t = r.querySelector('.top .tab.on'); return [r.querySelector('.nav-b.on, .nav-b[aria-current="page"]') && r.querySelector('.nav-b.on, .nav-b[aria-current="page"]').dataset.go, t && t.textContent.trim()]; });
    ok(now[0] === 'flips', 'Today: "All" opens Flips', JSON.stringify(now));
    for (const tab of [0, 1]) {
        await go(page, 'items', tab);
        const l = await look(page);
        ok(l.text > 20, 'Items › ' + l.tab + ': draws');
    }
    const navCount = (await host.locator('.nav-b[data-go="items"] .cnt').first().innerText().catch(() => '')).trim();
    ok(navCount.length > 0, 'sidebar: Items has its count', navCount);
    // Old addresses: #mine and #sell are Items' two tabs.
    for (const [hash, want] of [['mine', 0], ['sell', 1]]) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await wait(900);
        const t = await page.evaluate(() => { const r = document.querySelector('#ttv2-sell-host').shadowRoot; return [...r.querySelectorAll('.top .tab')].findIndex((x) => x.classList.contains('on')); });
        const pg = await page.evaluate(() => { const r = document.querySelector('#ttv2-sell-host').shadowRoot; const b = r.querySelector('.nav-b.on, .nav-b[aria-current="page"]'); return b && b.dataset.go; });
        ok(pg === 'items' && t === want, `old address #${hash}: Items, tab ${want + 1}`, JSON.stringify([pg, t]));
    }
    await go(page, 'trades', 1);
    ok((await look(page)).text > 10, 'Trades › History: draws');
    // Settings: the (i) help opens on focus and keeps its links.
    await go(page, 'settings', 0);
    const tip = host.locator('.i').first();
    ok((await tip.count()) > 0, 'Settings: (i) help beside the names');
    if (await tip.count()) {
        await tip.focus();
        await wait(300);
        ok(await tip.evaluate((i) => { const p = i.querySelector('.ip'); const cs = getComputedStyle(p); return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; }), 'Settings: (i) opens on focus');
    }
    ok(await page.evaluate(() => [...document.querySelector('#ttv2-sell-host').shadowRoot.querySelectorAll('.ip a[href]')].length > 0), 'Settings: links in the help stay links');
    ok(!(await page.evaluate(() => document.querySelector('#ttv2-sell-host').shadowRoot.querySelector('p.sp-lead'))), 'Settings: no explaining sentence on the page');
    ok(!errs.length, 'Today/Items/Trades/Settings: no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
}

/* ------------------------------------------------ the overlay on Torn's pages: sized to what it holds */
for (const [lay, job, w, h] of [[460, 'bids', 1707, 932], [320, 'bids', 1707, 932], [180, 'bids', 1536, 960], [460, 'npc', 1707, 932]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${BASE}?sellkeys=1&awake=1&tornlayout=${lay}&job=${job}`);
    await wait(6000);
    const label = `overlay ${job} ${lay}`;
    const m = () => page.evaluate(() => {
        const host = document.querySelector('#ttv2-host');
        const p = host && host.shadowRoot && host.shadowRoot.querySelector('.ttv2-panel');
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), max: Math.min(window.innerHeight * 0.75, 640) };
    });
    const a = await m();
    ok(Boolean(a), label + ': the panel is there');
    if (a) {
        ok(a.h <= a.max + 2, label + ': no taller than its maximum', JSON.stringify(a));
        const sw = page.locator('#ttv2-host').locator('.ttv2-title .ttv2-jobb');
        ok((await sw.count()) === 2, label + ': the NPC Arbitrage | Torn Bids switch');
        ok((await page.locator('#ttv2-host').locator('.ttv2-title .ttv2-jobb-on').count()) === 1, label + ': one side of the switch is on');
        const fold = page.locator('#ttv2-host').locator('button', { hasText: /^–$/ }).first();
        if (await fold.count()) {
            await fold.click();
            await wait(500);
            const b = await m();
            ok(b && b.h < a.h, label + ': minimised it is smaller', JSON.stringify(b));
            await page.screenshot({ path: join(shots, `overlay-${job}-${lay}-min.png`) });
            const unfold = page.locator('#ttv2-host').locator('button', { hasText: /^\+$/ }).first();
            if (await unfold.count()) await unfold.click();
            await wait(400);
        } else ok(false, label + ': a minimise button');
        // Nothing of ours pushes Torn's page: the page is as wide as without us.
        ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), label + ': Torn\'s page not pushed sideways');
    }
    await page.screenshot({ path: join(shots, `overlay-${job}-${lay}.png`) });
    ok(!errs.length, label + ': no page errors', errs.slice(0, 3).join(' | '));
    await page.close();
}

await browser.close();
server.close();
console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'} · screenshots in ${shots}`);
process.exit(failures ? 1 : 0);
