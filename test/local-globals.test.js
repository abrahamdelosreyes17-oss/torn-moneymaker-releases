import test from 'node:test';
import assert from 'node:assert/strict';
import { localGlobals, LOCAL_GLOBALS } from '../tools/local-globals.mjs';

/*
 * 3.33.0 - Tampermonkey runs the bundle inside `with (sandbox)`: a name like Math is looked up through the
 * sandbox each time it is used. Handed in as a parameter, it is looked up once.
 */

/** Runs `body` the way the build wraps it, inside a sandbox like Tampermonkey's that counts every lookup. */
function runSandboxed(body) {
    const looked = new Map();
    const sandbox = new Proxy(Object.create(null), {
        has: (t, k) => k in globalThis,
        get: (t, k) => {
            if (k === Symbol.unscopables) return undefined;
            looked.set(k, (looked.get(k) || 0) + 1);
            return globalThis[k];
        },
    });
    const local = localGlobals(body);
    const run = new Function('sandbox', 'with (sandbox) { return (function (' + local.params + ') { "use strict"; ' + body + ' })(' + local.args + '); }');
    return { value: run(sandbox), looked, local };
}

test('a name the bundle uses is looked up through the sandbox at start only, not once a use', () => {
    const body = 'let h = 7; for (let i = 0; i < 10000; i += 1) h = Math.imul(h ^ i, 16777619) >>> 0; return String(h) + new Map([[1, 2]]).size;';
    const { value, looked, local } = runSandboxed(body);
    assert.equal(value, new Function(body)());
    assert.ok(local.names.includes('Math') && local.names.includes('String') && local.names.includes('Map'));
    // At start: `typeof Math` and `Math` - two looks, whatever the body does with it after.
    assert.equal(looked.get('Math'), 2);
    assert.equal(looked.get('String'), 2);
    assert.equal(runSandboxed(body.replace('10000', '1')).looked.get('Math'), 2);
});

test('only the names the bundle uses; a top-level name of ours is never a parameter (it would clash)', () => {
    const { names } = localGlobals('const x = Math.max(1, 2); obj.Date = 1;', new Set(['x']));
    assert.deepEqual(names, ['Math']);
    assert.deepEqual(localGlobals('function Map() {} Map();', new Set(['Map'])).names, []);
});

test('a name a browser lacks starts as undefined, never as an error', () => {
    const { args } = localGlobals('TextDecoder; undefined;');
    assert.match(args, /^void 0, typeof TextDecoder !== 'undefined' \? TextDecoder : void 0$/);
});

test('the timers, fetch and window stay the sandbox\'s own', () => {
    for (const n of ['setTimeout', 'setInterval', 'clearTimeout', 'fetch', 'window', 'location', 'GM_getValue', 'GM_xmlhttpRequest']) assert.ok(!LOCAL_GLOBALS.includes(n), n);
});
