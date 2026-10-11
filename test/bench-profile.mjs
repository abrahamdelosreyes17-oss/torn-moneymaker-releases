#!/usr/bin/env node
/*
 * Rig A (2026-10-09): what a processor profile says about a Torn Bids redraw.
 *
 * test/bench.mjs --profile takes the profile over its DevTools connection
 * (Profiler.start / Profiler.stop) while a scene runs and hands it here; a
 * profile saved with --profile-out can be read again on its own:
 *
 *     node test/bench-profile.mjs <file.cpuprofile> [--redraws N] [--top 25] [--build torn-moneymaker.user.js]
 *
 * The build is not minified, so the names are the source's own. Each function
 * is placed in src/ by the module mark the build writes above every module
 * and the text of the function's first line.
 *
 * Two kinds of time, both in milliseconds of the page's own (slowed) clock:
 *   self   - the processor was in this function's own lines
 *   total  - the function was running or waiting for something it called
 *            (counted once however often it is on the stack)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* A redraw, by the functions that are one: everything under these counts as redraw time. */
const REDRAW_ROOTS = ['renderSellingNow', 'renderSellingInPieces', 'stepSellWarm'];

/*
 * Where a redraw's time goes: each sample is given to the innermost function on its stack that one of these names,
 * so no millisecond is counted twice and the parts add up to the whole. The order does not matter; the stack does.
 * A function reached from two places is told apart by what else is on the stack (`under`, `notUnder`).
 */
const PARTS = [
    { part: 'buyers of an item: the list made (buyerLookup, buyersForItem, the kept buyers)', names: ['buyersForItem', 'look', 'tokensOf', 'begin', 'votesByTrader', 'trustOf', 'sameBuyers', 'buyerLookup'], anonIn: ['buyerLookup', 'makeBuyersKeeper'] },
    { part: 'buyers of an item: every buyer\'s badge noted, then your Show choices (buyersOf: blacklist, favourites first, online, fresh)', names: ['buyersOf', 'withoutBlacklisted', 'favouritesFirstOnTie', 'onlineOnly', 'trustedOnly', 'freshOnly', 'stalePrice', 'levelOf', 'presenceLevel', 'sellPresenceOf', 'w3bPresenceOf', 'favOf', 'statOf', 'isFavourite', 'partnerKey', 'listAtOf', 'buyersAllowed', 'hiddenBuyers'] },
    { part: 'believable buyers of an item (flipBuyersOf, flipBuyers, what a trader can pay)', names: ['flipBuyersOf', 'flipBuyers', 'flipBuyer', 'flipBuyerOf', 'unitsOf', 'payableUnits', 'networthOf', 'listBid', 'believableBid', 'bestBidOf'] },
    { part: 'bazaar listings of an item (sellersOf: copied, marked, sorted)', names: ['sellersOf', 'bazaarSellers', 'withOwnBuys', 'withoutGone', 'sellersBefore', 'lowestOf', 'bazaarDepthOf', 'depthNearCheapest', 'liveGone', 'liveStock', 'liveBought'] },
    { part: 'a flip plan for an item (planOf, flipPlan, pickBazaars)', names: ['planOf', 'flipPlan', 'pickBazaars', 'enoughProfit', 'stopsOf', 'planFrom'] },
    { part: 'which items to read next (flipCandidates, nearMisses)', names: ['flipCandidates', 'nearMisses'] },
    { part: 'the desk: whole trades with the first twelve traders (chooseTrade, tradeWith, planTrade)', names: ['chooseTrade', 'tradeDesk'], also: ['tradeWith', 'planTrade', 'planMainAndExtras', 'planEverything', 'usable', 'heldRowsOf', 'fitLeftOut', 'tradeItemsOf'], under: ['chooseTrade', 'tradeDesk'] },
    { part: 'Your traders: a whole trade with every favourite and Trusted trader (tradeWith, planTrade)', names: [], also: ['tradeWith', 'planTrade', 'planMainAndExtras', 'planEverything', 'usable', 'heldRowsOf', 'fitLeftOut', 'tradeItemsOf', 'tradeListOld', 'traderCards', 'scanOrder', 'nameFromLists'], notUnder: ['chooseTrade', 'tradeDesk'] },
    { part: 'the trader index rebuilt (indexW3bByItem, traderIdsByName, indexTeScanByItem)', names: ['w3bIndex', 'indexW3bByItem', 'traderIdsByName', 'indexTeScanByItem', 'teScanIndex', 'liveW3bPrices'] },
    { part: 'counting traders for the status line (traderDbStats, countTraders)', names: ['traderDbStats', 'countTraders'] },
    { part: 'stored values read and parsed (gmGet, JSON.parse)', names: ['gmGet', 'GM_getValue', 'parse', 'sellTeOwn', 'sellPrefs', 'teState', 'sellLeftovers', 'sellFavourites', 'sellBlacklist', 'sellDeclined', 'sellPinned', 'sellAccepted', 'expireSellAccepted', 'getSellKey', 'getTeKey', 'getLedgerKey', 'probe'] },
    { part: 'stored values written (gmSet, JSON.stringify)', names: ['gmSet', 'GM_setValue', 'stringify'] },
    { part: 'your favourites\' own lists by item (teOwnByItem, favouriteTraders)', names: ['teOwnByItem', 'favouriteTraders', 'partnersNow', 'sellBuyerSources'] },
    { part: 'statuses and networth asked for (sellWatch, updateSellPresence, updateSellNetworth)', names: ['sellWatch', 'updateSellPresence', 'updateSellNetworth', 'presenceUnknown', 'statusUnread', 'flipCards', 'sellStatusMap'] },
    { part: 'To sell and what you hold (toSellRows, toSellHeld, whereToSell)', names: ['toSellRows', 'toSellHeld', 'whereToSell', 'forSaleCount', 'leftoversAfterSales', 'heldGain'] },
    { part: 'the page drawn (SellingPage.render and the browser\'s own work in it)', names: ['render'], anonIn: [], classes: true },
];

/*
 * What the plan's reading named, each as ALL the time it was running inside a redraw (so these overlap: a flip plan
 * made for the desk's trade is in pickBazaars and in chooseTrade both). `has`: any of these on the stack; `all`:
 * every one of these; `not`: none of these. A function with no name of its own is "(in <the function it is written in>)".
 */
const ASKED = [
    { q: 'a flip plan for every item - planOf', has: ['planOf'] },
    { q: '    flipPlan, from planOf', all: ['flipPlan', 'planOf'] },
    { q: '    pickBazaars, from planOf', all: ['pickBazaars', 'planOf'] },
    { q: 'pickBazaars, whoever asked', has: ['pickBazaars'] },
    { q: 'the desk - tradeDesk (chooseTrade and what it shows)', has: ['tradeDesk'] },
    { q: '    chooseTrade (a whole trade with each of the first twelve traders)', has: ['chooseTrade'] },
    { q: '    tradeWith, from chooseTrade', all: ['tradeWith', 'chooseTrade'] },
    { q: 'Your traders - tradeWith for every favourite and Trusted trader (not from chooseTrade)', has: ['tradeWith'], not: ['chooseTrade'] },
    { q: '    nameFromLists (the name of a favourite, from the buyers of every item)', has: ['nameFromLists'] },
    { q: 'tradeItemsOf (which trader is a flip buyer of what: made once a redraw, by whoever asks first)', has: ['tradeItemsOf'] },
    { q: 'planTrade (planMainAndExtras, planEverything), whoever asked', has: ['planTrade', 'planMainAndExtras', 'planEverything'] },
    { q: 'buyersOf (every buyer of an item passed over: badge noted, your Show choices; and the lookup it asks)', has: ['buyersOf'] },
    { q: '    the lookup it asks - buyersAll (in buyerLookup): rows made, kept, compared', has: ['(in buyerLookup)'] },
    { q: '    the pieces before the redraw (the same lookup, 30 ms at a time)', has: ['warmSlice'] },
    { q: 'flipBuyersOf (the believable five of an item)', has: ['flipBuyersOf'] },
    { q: 'flipCandidates (which 150 items to read)', has: ['flipCandidates'] },
    { q: 'nearMisses', has: ['nearMisses'] },
    { q: 'countTraders (a pass over every buyer of every item)', has: ['countTraders'] },
    { q: 'sellersOf (the listings of an item filtered, copied, sorted)', has: ['sellersOf'] },
    { q: '    withOwnBuys', has: ['withOwnBuys'] },
    { q: '    bazaarSellers', has: ['bazaarSellers'] },
    { q: 'the trader index - w3bIndex (indexW3bByItem + traderIdsByName)', has: ['w3bIndex'] },
    { q: '    indexW3bByItem', has: ['indexW3bByItem'] },
    { q: '    traderIdsByName', has: ['traderIdsByName'] },
    { q: 'traderDbStats (every trader counted for the status line)', has: ['traderDbStats'] },
    { q: 'sellBuyerSources (the index, the own lists of your favourites by item, the lookup made)', has: ['sellBuyerSources'] },
    { q: '    teOwnByItem', has: ['teOwnByItem'] },
    { q: 'stored values read - gmGet (GM_getValue + JSON.parse)', has: ['gmGet'] },
    { q: '    sellTeOwnLists read and parsed - sellTeOwn', has: ['sellTeOwn'] },
    { q: 'the page - SellingPage.render (the page rebuild)', has: ['render'] },
    { q: 'sellWatch + updateSellPresence + updateSellNetworth', has: ['sellWatch', 'updateSellPresence', 'updateSellNetworth'] },
];

/** The build's lines and where each module starts. */
function readBuild(buildPath) {
    const path = resolve(ROOT, buildPath || 'torn-moneymaker.user.js');
    if (!existsSync(path)) return null;
    const lines = readFileSync(path, 'utf8').split('\n');
    const marks = [];
    lines.forEach((text, i) => {
        const m = text.match(/^\s*\/\* ===== (src\/[\w./-]+) ===== \*\/\s*$/);
        if (m) marks.push({ line: i, file: m[1] });
    });
    return { lines, marks, kept: new Map() };
}

/** A line of the build (0-based) as a place in src/: "src/main.js:7527", or the build's own line when it cannot be told. */
function placeOf(build, line) {
    if (!build || !(line >= 0)) return '';
    let mark = null;
    for (const m of build.marks) {
        if (m.line > line) break;
        mark = m;
    }
    if (!mark) return 'build:' + (line + 1);
    if (!build.kept.has(mark.file)) {
        const p = resolve(ROOT, mark.file);
        build.kept.set(mark.file, existsSync(p) ? readFileSync(p, 'utf8').split('\n').map((t) => t.replace(/^export\s+(default\s+)?/, '').trim()) : null);
    }
    const src = build.kept.get(mark.file);
    const text = String(build.lines[line] || '').trim();
    if (!src || !text) return mark.file;
    // The line with the same text; of several, the one nearest to where the build has it.
    const guess = line - mark.line;
    let best = -1;
    for (let i = 0; i < src.length; i += 1) if (src[i] === text && (best < 0 || Math.abs(i - guess) < Math.abs(best - guess))) best = i;
    return mark.file + ':' + (best >= 0 ? best + 1 : '~' + guess);
}

/**
 * @param {{nodes: Array, samples: number[], timeDeltas: number[], startTime: number, endTime: number}} profile
 * @param {{redraws?: number, top?: number, build?: string}} [opts] - `redraws`: how many redraws the scene's own speed log counted while the profile ran
 * @returns {{text: string, data: object}}
 */
export function profileReport(profile, { redraws = 0, top = 25, build: buildPath = null } = {}) {
    const build = readBuild(buildPath);
    const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    // An arrow function the source gives no name is named by the function it is written in: "(in buyerLookup)".
    const nameOf = (n) => n.callFrame.functionName || '';
    const scriptOf = (n) => /\.user\.js/.test(n.callFrame.url || '');
    const keyOf = (n) => {
        const f = n.callFrame;
        const where = f.url ? f.url.replace(/.*\//, '').replace(/\?.*/, '') + ':' + f.lineNumber : '';
        return (f.functionName || '(anonymous)') + '|' + where;
    };
    const stacks = new Map();
    const stackOf = (id) => {
        let s = stacks.get(id);
        if (!s) {
            // Leaf first.
            s = [];
            for (let at = id; at !== undefined; at = parent.get(at)) s.push(nodes.get(at));
            stacks.set(id, s);
        }
        return s;
    };
    const self = new Map();
    const total = new Map();
    const info = new Map();
    const parts = new Map(PARTS.map((p) => [p.part, 0]));
    const other = new Map();
    let all = 0;
    let idle = 0;
    let gc = 0;
    let program = 0;
    let redraw = 0;
    let scriptElse = 0;
    const partNames = PARTS.map((p) => ({ ...p, set: new Set([...p.names, ...(p.also || [])]) }));
    const asked = ASKED.map((a) => ({ ...a, ms: 0 }));
    // A frame's name; one with no name of its own is "(in <the function it is written in>)".
    const tags = new Map();
    const tagOf = (n) => {
        let t = tags.get(n.id);
        if (t === undefined) {
            t = nameOf(n) || (build && scriptOf(n) ? '(in ' + enclosing(build, n.callFrame.lineNumber) + ')' : '');
            tags.set(n.id, t);
        }
        return t;
    };
    for (let i = 0; i < profile.samples.length; i += 1) {
        // A sample stands for the time until the next one.
        const ms = (i + 1 < profile.timeDeltas.length ? profile.timeDeltas[i + 1] : 0) / 1000;
        if (!(ms > 0)) continue;
        const stack = stackOf(profile.samples[i]);
        const leaf = stack[0];
        const leafName = nameOf(leaf);
        all += ms;
        if (leafName === '(idle)') {
            idle += ms;
            continue;
        }
        if (leafName === '(garbage collector)') gc += ms;
        if (leafName === '(program)') program += ms;
        const k = keyOf(leaf);
        self.set(k, (self.get(k) || 0) + ms);
        if (!info.has(k)) info.set(k, leaf);
        const seen = new Set();
        for (const n of stack) {
            const key = keyOf(n);
            if (seen.has(key)) continue;
            seen.add(key);
            total.set(key, (total.get(key) || 0) + ms);
            if (!info.has(key)) info.set(key, n);
        }
        const names = stack.map(nameOf);
        const inRedraw = names.some((n) => REDRAW_ROOTS.includes(n));
        if (!inRedraw) {
            if (leafName !== '(garbage collector)' && leafName !== '(program)') scriptElse += ms;
            continue;
        }
        redraw += ms;
        const tagged = new Set(stack.map(tagOf));
        for (const a of asked) {
            if (a.has && !a.has.some((x) => tagged.has(x))) continue;
            if (a.all && !a.all.every((x) => tagged.has(x))) continue;
            if (a.not && a.not.some((x) => tagged.has(x))) continue;
            a.ms += ms;
        }
        // The innermost frame a part names.
        let given = null;
        for (let d = 0; d < stack.length && !given; d += 1) {
            const name = names[d];
            const n = stack[d];
            for (const p of partNames) {
                let hit = p.set.has(name);
                // Arrow functions with no name of their own, by the function they are written in (the next named frame's line range is not known: the build's lines are).
                if (!hit && !name && p.anonIn && build && scriptOf(n)) hit = p.anonIn.includes(enclosing(build, n.callFrame.lineNumber));
                // The page's own class: its methods are the drawing.
                if (!hit && p.classes && build && scriptOf(n)) hit = /^src\/ui\/selling-page\.js/.test(placeOf(build, n.callFrame.lineNumber));
                if (!hit) continue;
                if (p.under && p.also && p.also.includes(name) && !p.names.includes(name) && !names.some((x) => p.under.includes(x))) continue;
                if (p.notUnder && names.some((x) => p.notUnder.includes(x))) continue;
                given = p.part;
                break;
            }
        }
        if (given) parts.set(given, parts.get(given) + ms);
        else {
            // Not named by any part: by the innermost of the script's own functions (the working out's own lines mostly).
            const own = stack.find((n) => scriptOf(n));
            const label = own ? (nameOf(own) || '(a function with no name)') + ' - ' + placeOf(build, own.callFrame.lineNumber) : leafName || '(the browser)';
            other.set(label, (other.get(label) || 0) + ms);
        }
    }
    const per = (ms) => (redraws > 0 ? (ms / redraws).toFixed(1).padStart(9) : ''.padStart(9));
    const pct = (ms, of) => (of > 0 ? ((100 * ms) / of).toFixed(1) + '%' : '').padStart(7);
    const out = [];
    const sampled = all - idle;
    out.push('PROCESSOR PROFILE - ' + profile.samples.length + ' samples over ' + Math.round((profile.endTime - profile.startTime) / 1000) + ' ms; busy ' + Math.round(sampled) + ' ms, idle ' + Math.round(idle) + ' ms');
    out.push('  inside a Torn Bids redraw (working out, the pieces before it, the page): ' + Math.round(redraw) + ' ms' + (redraws ? ' = ' + (redraw / redraws).toFixed(1) + ' ms for each of ' + redraws + ' redraws' : ''));
    out.push('  garbage collection (the browser names no function for it): ' + Math.round(gc) + ' ms' + (redraws ? ' = ' + (gc / redraws).toFixed(1) + ' ms a redraw if all of it is the redraws\'' : ''));
    out.push('  the browser\'s own work with no script running ("(program)"): ' + Math.round(program) + ' ms; the script outside a redraw: ' + Math.round(scriptElse) + ' ms');
    out.push('');
    out.push('WHERE A REDRAW\'S TIME GOES (each millisecond once: given to the innermost function that names a part)');
    out.push('  ' + 'ms in all'.padStart(9) + 'a redraw'.padStart(9) + 'share'.padStart(7) + '  part');
    const partRows = [...parts].sort((a, b) => b[1] - a[1]);
    for (const [label, ms] of partRows) out.push('  ' + Math.round(ms).toString().padStart(9) + per(ms) + pct(ms, redraw) + '  ' + label);
    const otherAll = [...other.values()].reduce((a, b) => a + b, 0);
    out.push('  ' + Math.round(otherAll).toString().padStart(9) + per(otherAll) + pct(otherAll, redraw) + '  none of these - by the script\'s own function it was in:');
    for (const [label, ms] of [...other].sort((a, b) => b[1] - a[1]).slice(0, 14)) out.push('  ' + Math.round(ms).toString().padStart(9) + per(ms) + pct(ms, redraw) + '      ' + label);
    out.push('');
    out.push('WHAT THE PLAN NAMED, each as all the time it was running inside a redraw (these overlap - they do not add up)');
    out.push('  ' + 'ms in all'.padStart(9) + 'a redraw'.padStart(9) + 'share'.padStart(7) + '  what');
    for (const a of asked) out.push('  ' + Math.round(a.ms).toString().padStart(9) + per(a.ms) + pct(a.ms, redraw) + '  ' + a.q);
    out.push('');
    out.push('THE ' + top + ' FUNCTIONS THE PROCESSOR WAS IN MOST (self), with all the time each was running (total)');
    out.push('  ' + 'self ms'.padStart(9) + 'a redraw'.padStart(9) + 'share'.padStart(7) + ' ' + 'total ms'.padStart(9) + 'a redraw'.padStart(9) + 'share'.padStart(7) + '  function');
    const rows = [...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, top);
    const label = (k) => {
        const n = info.get(k);
        const f = n.callFrame;
        const name = f.functionName || '(no name)';
        if (!f.url) return name + '  [the browser]';
        if (!scriptOf(n)) return name + '  [' + f.url.replace(/.*\//, '').replace(/\?.*/, '') + ':' + (f.lineNumber + 1) + ']';
        const inside = f.functionName ? '' : ' in ' + (enclosing(build, f.lineNumber) || '?');
        return name + inside + '  [' + placeOf(build, f.lineNumber) + ']';
    };
    for (const [k, ms] of rows) out.push('  ' + Math.round(ms).toString().padStart(9) + per(ms) + pct(ms, sampled) + ' ' + Math.round(total.get(k) || 0).toString().padStart(9) + per(total.get(k) || 0) + pct(total.get(k) || 0, sampled) + '  ' + label(k));
    out.push('');
    out.push('THE ' + top + ' FUNCTIONS RUNNING LONGEST (total), the script\'s own');
    out.push('  ' + 'total ms'.padStart(9) + 'a redraw'.padStart(9) + 'share'.padStart(7) + ' ' + 'self ms'.padStart(9) + '  function');
    const totals = [...total].filter(([k]) => info.get(k) && scriptOf(info.get(k))).sort((a, b) => b[1] - a[1]).slice(0, top);
    for (const [k, ms] of totals) out.push('  ' + Math.round(ms).toString().padStart(9) + per(ms) + pct(ms, sampled) + ' ' + Math.round(self.get(k) || 0).toString().padStart(9) + '  ' + label(k));
    return {
        text: out.join('\n'),
        data: {
            samples: profile.samples.length, busyMs: sampled, idleMs: idle, redrawMs: redraw, gcMs: gc, programMs: program, redraws,
            parts: Object.fromEntries(partRows), asked: Object.fromEntries(asked.map((a) => [a.q.trim(), a.ms])), other: Object.fromEntries([...other].sort((a, b) => b[1] - a[1]).slice(0, 30)),
            self: rows.map(([k, ms]) => ({ fn: label(k), self: ms, total: total.get(k) || 0 })),
            total: totals.map(([k, ms]) => ({ fn: label(k), total: ms, self: self.get(k) || 0 })),
        },
    };
}

/**
 * The named function a line of the build is written in: the nearest line above it that starts a function at a
 * shallower indent ("function name(", "const name = (", "name(...) {"). Good enough to name an arrow function's home.
 */
function enclosing(build, line) {
    if (!build || !(line >= 0)) return '';
    const indent = (t) => t.length - t.trimStart().length;
    const own = indent(build.lines[line] || '');
    for (let i = line - 1; i >= 0 && i > line - 4000; i -= 1) {
        const t = build.lines[i];
        if (!t || !t.trim() || indent(t) >= own) continue;
        const m = t.match(/^\s*(?:async\s+)?function\s+([\w$]+)\s*\(/) || t.match(/^\s*(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/) || t.match(/^\s*(?:async\s+)?([\w$]+)\s*\([^)]*\)\s*\{\s*$/);
        if (m && !/^(if|for|while|switch|catch|return)$/.test(m[1])) return m[1];
    }
    return '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--redraws' && args[args.indexOf(a) - 1] !== '--top' && args[args.indexOf(a) - 1] !== '--build');
    const flag = (name, d) => (args.includes('--' + name) ? args[args.indexOf('--' + name) + 1] : d);
    if (!file) {
        console.error('node test/bench-profile.mjs <file.cpuprofile> [--redraws N] [--top 25] [--build torn-moneymaker.user.js]');
        process.exit(1);
    }
    const profile = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    console.log(profileReport(profile, { redraws: Number(flag('redraws', 0)) || 0, top: Number(flag('top', 25)) || 25, build: flag('build', null) }).text);
}
