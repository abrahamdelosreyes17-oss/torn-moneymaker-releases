#!/usr/bin/env node
/*
 * The speed bench (3.17.0): the harness driven in a real browser with the
 * processor slowed four times, with rows another extension keeps writing
 * into and with large stored values - and the script's own speed log printed
 * at the end. It is how a change meant to make the script faster is measured
 * before and after: the same scenes, the same slow processor, the numbers
 * side by side.
 *
 *     node test/bench.mjs                 every scene, 4x slower
 *     node test/bench.mjs --rate 1        this machine as it is
 *     node test/bench.mjs --only bazaar   one scene (a word of its name)
 *     node test/bench.mjs --json out.json the records as data too
 *     node test/bench.mjs --build dist/before.user.js
 *                                         time another build (one inside the repo)
 *                                         on the same scenes: the before of an after
 *     node test/bench.mjs --compare dist/before.user.js
 *                                         each scene twice - that build, then
 *                                         this one - and whether both sent the
 *                                         same requests and drew the same page
 *
 * No dependencies: it starts Chrome (or Edge) itself with a throw-away
 * profile, talks to it over the DevTools protocol, and serves the repo from
 * a port of its own. Nothing leaves the machine: the harness answers every
 * request the script makes. CHROME_PATH names another browser.
 *
 * Build first (node build.mjs): the harness loads dist/torn-trading.user.js.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, extname, join, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { speedExpand, speedMerge, speedText } from '../src/core/speed.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const RATE = Number(arg('rate', 4)) || 1;
const ONLY = arg('only', null);
const JSON_OUT = arg('json', null);
const SECONDS = Number(arg('seconds', 14)) || 14;
// The build to compare with: a path inside the repo, as the harness page will ask for it (with / between its parts).
const buildArg = (name) => {
    const given = arg(name, null);
    if (!given) return null;
    const rel = relative(ROOT, resolve(process.cwd(), given)).split(sep).join('/');
    if (!rel || rel.startsWith('..') || !/^[\w./-]+$/.test(rel) || !existsSync(resolve(ROOT, rel))) {
        console.error('--' + name + ' needs a build inside the repo (for example dist/before.user.js); not found or not usable: ' + given);
        process.exit(1);
    }
    return rel;
};
const COMPARE = buildArg('compare');
// Another build to time instead of this one (3.18.0): the same scenes, the same slow processor.
const BUILD = buildArg('build');

/*
 * The scenes. Each is a harness page and what a player does on it; `run` is
 * evaluated in the page and may use wait(ms). `input` (3.19.0) is a real
 * mouse and keyboard, sent by the browser itself at `at` ms into the scene:
 * a click on the first element matching a selector, text typed, keys pressed -
 * the speed log's SLOW CLICKS AND KEY PRESSES counts only those.
 */
const SCENES = [
    {
        name: 'Torn Bids, a large trader list',
        url: 'test/harness-live.html?ttv2=traders&sellkeys=1&bigflip=1&ledgerkey=1&manytrades=1&leftmany=1&awake=1&bigstore=2000',
        run: 'await wait(' + SECONDS * 1000 + ');',
    },
    {
        // 3.23.0: a long list of items no trader's price reaches (each read "in turn", its cheapest rows kept).
        // --sweeprows 0: as if only the listings under the trader's price had been asked for.
        name: 'Torn Bids, 400 items read in turn',
        url: 'test/harness-live.html?ttv2=traders&sellkeys=1&bigflip=1&awake=1&sweepitems=400&sweeprows=' + (Number(arg('sweeprows', 10)) || 0),
        run: 'await wait(' + SECONDS * 1000 + ');',
        timedOnly: true,
    },
    {
        // 3.19.0: what the page feels like while it loads - a real mouse and keyboard (the browser times only those).
        // What is pressed, and when, decides what is asked and drawn: timed, not compared.
        name: 'typing in the search box and picking flips while the traders page loads',
        url: 'test/harness-live.html?ttv2=traders&sellkeys=1&bigflip=1&ledgerkey=1&manytrades=1&leftmany=1&awake=1&bigstore=2000',
        run: 'await wait(' + SECONDS * 1000 + ');',
        timedOnly: true,
        input: [
            { at: 3000, click: '.sp-search' },
            { at: 3400, type: 'gent', every: 220 },
            { at: 5500, keys: ['Backspace', 'Backspace', 'Backspace', 'Backspace'], every: 220 },
            { at: 7500, click: '.sp-fc:not(.sp-tc):not(.sp-lo)' },
            { at: 9000, click: '.sp-search' },
            { at: 9400, type: 'bag', every: 220 },
            { at: 11000, keys: ['Backspace', 'Backspace', 'Backspace'], every: 220 },
            { at: 12500, click: '.sp-fc:not(.sp-tc):not(.sp-lo):not(.sp-sel)' },
        ],
    },
    {
        name: 'a long bazaar, another extension writing into its rows',
        url: 'test/harness-live.html?page=bazaar&userId=901&bazaarwindow=250&want=5&ttbusy=1&awake=1&nofeed=1&bigstore=2000',
        run: 'await wait(3000); for (let y = 0; y <= 6000; y += 600) { window.scrollTo(0, y); window.__draw(); await wait(350); } window.scrollTo(0, 0); window.__draw(); await wait(1000); window.__buy(206, 2); await wait(' + Math.max(1000, SECONDS * 1000 - 9000) + ');',
    },
    {
        name: 'a long bazaar while buying for an accepted trade',
        url: 'test/harness-live.html?page=bazaar&userId=902&bazaarwindow=250&want=5&buyplan=2&ttbusy=1&awake=1&nofeed=1&bigstore=2000',
        run: 'await wait(3000); window.__buy(206, 2); await wait(2000); window.__buy(3001, 2); await wait(' + Math.max(1000, SECONDS * 1000 - 5000) + ');',
    },
    {
        name: 'your own bazaar\'s add page',
        url: 'test/harness-live.html?ownbazaar=1&page=bazaar&ttvalues=1&awake=1&nofeed=1&bigstore=2000#/add',
        run: 'await wait(' + SECONDS * 1000 + ');',
    },
    {
        name: 'the trade page\'s add step',
        url: 'test/harness-live.html?ownbazaar=1&page=trade&sendplan=1&awake=1&nofeed=1&bigstore=2000#step=add&ID=5',
        run: 'await wait(3000); const b = document.querySelector(".ttv2-sendfillall"); if (b) b.click(); await wait(' + Math.max(1000, SECONDS * 1000 - 3000) + ');',
    },
];

/* Run in the page: the middle of the first element matching `sel` (looked for in shadow roots too), scrolled into view; null when there is none. */
const CENTRE_OF = '(sel) => { const find = (root) => { const e = root.querySelector(sel); if (e) return e; for (const h of root.querySelectorAll("*")) { const f = h.shadowRoot ? find(h.shadowRoot) : null; if (f) return f; } return null; }; const e = find(document); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return r.width && r.height ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; }';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
    return new Promise((done) => {
        const server = createServer(async (req, res) => {
            const path = resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
            // Only files of the repo itself, and none of its hidden folders (.git, .claude).
            const rel = relative(ROOT, path);
            if (!rel || rel.startsWith('..') || resolve(ROOT, rel) !== path || rel.split(sep).some((part) => part.startsWith('.'))) {
                res.writeHead(403).end();
                return;
            }
            try {
                const body = await readFile(path);
                res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
            } catch {
                res.writeHead(404).end();
            }
        });
        server.listen(0, '127.0.0.1', () => done(server));
    });
}

function findBrowser() {
    const env = process.env;
    const list = [
        env.CHROME_PATH,
        join(env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        join(env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        join(env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter(Boolean);
    return list.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `promise`, or an error once `ms` have passed (a browser that died must not hang the bench). */
function within(promise, ms, what) {
    let timer = null;
    const late = new Promise((_, fail) => {
        timer = setTimeout(() => fail(new Error(what + ': no answer in ' + Math.round(ms / 1000) + ' s')), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A DevTools protocol session over one WebSocket: send(method, params) -> result. */
function session(ws) {
    let next = 1;
    const waiting = new Map();
    const events = new Map();
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method && events.has(m.method)) {
            const list = events.get(m.method);
            events.delete(m.method);
            for (const ok of list) ok(m.params);
        }
        if (!m.id || !waiting.has(m.id)) return;
        const { ok, fail } = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) fail(new Error(m.error.message));
        else ok(m.result);
    });
    const send = (method, params = {}) => within(new Promise((ok, fail) => {
        const id = next++;
        waiting.set(id, { ok, fail });
        ws.send(JSON.stringify({ id, method, params }));
    }), (SECONDS + 60) * 1000, method);
    /** The next event of this name. */
    const once = (method) => new Promise((ok) => events.set(method, [...(events.get(method) || []), ok]));
    return { send, once };
}

async function openPage(port) {
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
        ws.addEventListener('open', ok, { once: true });
        ws.addEventListener('error', () => fail(new Error('could not reach the browser')), { once: true });
    });
    return { ...session(ws), close: () => ws.close(), id: target.id };
}

async function runScene(port, base, scene, script = null) {
    const page = await openPage(port);
    try {
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        // A desktop window, in view (a hidden page's timers are slowed by the browser).
        await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
        await page.send('Emulation.setCPUThrottlingRate', { rate: RATE });
        // Script errors on the page are part of the result.
        // And the page is kept drawing frames, as a window in view is (3.19.0): a headless page that goes quiet has
        // its timers run late - the script's once-a-second read fired 74 times in 90 s, against every 1,000 ms in a
        // real browser - so a build that leaves the page free more often looked as if it read less.
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__benchErrors = []; window.addEventListener("error", (e) => window.__benchErrors.push(String(e.message))); (function awake() { requestAnimationFrame(awake); })();' });
        // Each run starts with nothing stored in the browser (the Ledger keeps its rows in IndexedDB).
        await page.send('Storage.clearDataForOrigin', { origin: base.slice(0, -1), storageTypes: 'all' });
        const loaded = page.once('Page.loadEventFired');
        const url = base + (script ? scene.url.replace(/(#|$)/, '&script=' + script + '$1') : scene.url);
        await page.send('Page.navigate', { url });
        await within(loaded, 30000, 'loading ' + scene.name);
        const body = 'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
            'await wait(1500);' + scene.run +
            // The tab "goes": the recorder writes what it holds.
            'window.dispatchEvent(new Event("pagehide")); await wait(200);' +
            'const store = typeof _store === "object" ? _store : {};' +
            'const sizes = Object.entries(store).filter(([k]) => k.startsWith("tornTrading.v2.")).map(([k, v]) => [k.slice(15).replace(/\\.[a-z0-9]+-[a-z0-9]+$/, ".this-tab"), String(v).length]);' +
            // What was asked of the three services (keys and clock values out), and the page as drawn:
            // every element by tag and class, in the document and in each shadow root, with its text's digits out
            // (but for the harness's own status line, #out: it is the harness's, and says what the clock made of the run;
            // and but for whether an item's picture has failed to load yet, sp-img-none: the browser's doing, not the script's).
            'const requests = (window.__requests || []).map((u) => String(u).replace(/key=[^&]+/g, "key=K").replace(/\\d{9,}/g, "T"));' +
            'const shape = (root) => [...root.querySelectorAll("*")].filter((e) => !/^(SCRIPT|STYLE)$/.test(e.tagName) && e.id !== "out").map((e) => e.tagName + "." + (typeof e.className === "string" ? e.className.replace(" sp-img-none", "") : "") + (e.children.length ? "" : ":" + (e.textContent || "").replace(/\\d+/g, "#").slice(0, 60)) + (e.shadowRoot ? "{" + shape(e.shadowRoot) + "}" : "")).join("|");' +
            'return JSON.stringify({ record: store["tornTrading.v2.speedLog"] ? JSON.parse(store["tornTrading.v2.speedLog"]) : null, sizes, errors: window.__benchErrors || [], requests, dom: shape(document) });';
        const began = Date.now();
        const running = page.send('Runtime.evaluate', { expression: '(async () => {' + body + '})()', awaitPromise: true, returnByValue: true, timeout: (SECONDS + 30) * 1000 });
        // A real mouse and keyboard, while the scene runs (a step whose element is not in the page is skipped).
        for (const step of scene.input || []) {
            await sleep(Math.max(0, began + step.at - Date.now()));
            if (step.click) {
                const at = await page.send('Runtime.evaluate', { expression: '(' + CENTRE_OF + ')(' + JSON.stringify(step.click) + ')', returnByValue: true });
                const xy = at.result && at.result.value;
                if (!xy) continue;
                await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xy[0], y: xy[1] });
                await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
                await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xy[0], y: xy[1], button: 'left', clickCount: 1 });
            }
            for (const ch of step.type || []) {
                await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
                await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
                await sleep(step.every || 200);
            }
            for (const key of step.keys || []) {
                const code = { Backspace: 8, Enter: 13, Escape: 27 }[key] || 0;
                await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
                await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
                await sleep(step.every || 200);
            }
        }
        const out = await running;
        if (out.exceptionDetails) throw new Error(scene.name + ': ' + (out.exceptionDetails.exception && out.exceptionDetails.exception.description || out.exceptionDetails.text));
        return JSON.parse(out.result.value);
    } finally {
        page.close();
        await fetch('http://127.0.0.1:' + port + '/json/close/' + page.id).catch(() => {});
    }
}

async function main() {
    if (typeof WebSocket !== 'function') throw new Error('This needs Node 22 or newer (its built-in WebSocket).');
    if (!existsSync(resolve(ROOT, 'dist/torn-trading.user.js'))) throw new Error('Build first: node build.mjs');
    const exe = findBrowser();
    if (!exe) throw new Error('No Chrome or Edge found. Set CHROME_PATH to one.');
    const scenes = SCENES.filter((s) => !ONLY || s.name.toLowerCase().includes(String(ONLY).toLowerCase()));
    if (!scenes.length) throw new Error('No scene has "' + ONLY + '" in its name.');

    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    const profile = await mkdtemp(join(tmpdir(), 'torn-bench-'));
    const browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
    const results = [];
    try {
        // The browser writes the port it took into its profile.
        let port = null;
        for (let i = 0; i < 100 && !port; i += 1) {
            await sleep(100);
            try {
                port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) || null;
            } catch {
                port = null;
            }
        }
        if (!port) throw new Error('The browser did not start.');

        console.log('Torn Trading speed bench - processor slowed ' + RATE + 'x, ' + SECONDS + ' s a scene, ' + exe.replace(/.*[\\/]/, '') + (BUILD ? ' - the build ' + BUILD : ''));
        if (COMPARE) {
            // Nothing compromised: the same requests and the same page - before and after.
            let same = true;
            for (const scene of scenes) {
                if (scene.timedOnly) continue;
                const before = await runScene(port, base, scene, COMPARE);
                const after = await runScene(port, base, scene);
                const firstDiff = (a, b) => {
                    const n = Math.min(a.length, b.length);
                    for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
                    return a.length === b.length ? -1 : n;
                };
                // Requests under way at the same moment can land in either order: the same ones, each as often, is the test.
                const rq = firstDiff([...before.requests].sort(), [...after.requests].sort());
                const inOrder = firstDiff(before.requests, after.requests) < 0;
                const da = before.dom.split('|');
                const db = after.dom.split('|');
                const dm = firstDiff(da, db);
                console.log('\n' + scene.name.toUpperCase());
                console.log('  requests: ' + before.requests.length + ' before, ' + after.requests.length + ' after - ' + (rq < 0 ? 'the same' + (inOrder ? ', in the same order' : ' (some that were under way together landed in another order)') : 'DIFFERENT: "' + ([...before.requests].sort()[rq] || '(none)') + '" / "' + ([...after.requests].sort()[rq] || '(none)') + '"'));
                console.log('  the page: ' + da.length + ' elements before, ' + db.length + ' after - ' + (dm < 0 ? 'the same' : 'DIFFERENT at element ' + (dm + 1) + ': "' + (da[dm] || '(none)') + '" / "' + (db[dm] || '(none)') + '"'));
                if (before.errors.length || after.errors.length) console.log('  script errors: before ' + JSON.stringify(before.errors) + ', after ' + JSON.stringify(after.errors));
                if (rq >= 0 || dm >= 0) same = false;
            }
            console.log('\n' + (same ? 'Every scene: the same requests and the same page.' : 'Some scenes differ (see above).'));
            if (!same) process.exitCode = 1;
            return;
        }
        for (const scene of scenes) {
            const got = await runScene(port, base, scene, BUILD);
            results.push({ scene: scene.name, ...got });
            const now = Date.now();
            console.log('\n' + '='.repeat(100) + '\n' + scene.name.toUpperCase() + '\n' + '='.repeat(100));
            if (got.errors.length) console.log('SCRIPT ERRORS ON THE PAGE: ' + got.errors.join(' | '));
            console.log(got.record ? speedText(got.record, { sizes: got.sizes, now }) : '(the script recorded nothing)');
        }
        // Every scene added together: one table to compare a before and an after by.
        let all = null;
        for (const r of results) if (r.record) all = speedMerge(all, speedExpand(r.record));
        if (all && results.length > 1) {
            const text = speedText(all, { now: Date.now() });
            const at = text.indexOf('OUR OWN WORK');
            const end = text.indexOf('STORED VALUES');
            console.log('\n' + '='.repeat(100) + '\nALL SCENES TOGETHER\n' + '='.repeat(100) + '\n' + text.slice(at, end));
        }
        if (JSON_OUT) {
            await writeFile(resolve(process.cwd(), JSON_OUT), JSON.stringify({ rate: RATE, seconds: SECONDS, at: new Date().toISOString(), results }, null, 1));
            console.log('Wrote ' + JSON_OUT);
        }
    } finally {
        const gone = new Promise((ok) => browser.once('exit', ok));
        browser.kill();
        server.close();
        await Promise.race([gone, sleep(5000)]);
        // The browser lets go of its profile a moment after it exits: tried until it is gone.
        for (let i = 0; i < 20 && existsSync(profile); i += 1) {
            await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
            if (existsSync(profile)) await sleep(500);
        }
        if (existsSync(profile)) console.error('Could not remove the throw-away browser profile: ' + profile);
    }
    if (results.some((r) => r.errors.length)) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
