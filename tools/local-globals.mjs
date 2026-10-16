/*
 * The names the bundle takes from the page once, as its own (3.33.0).
 *
 * Why (the review of 2026-10-16, his zip of 10-14): Tampermonkey runs a script inside `with (sandbox) { ... }`,
 * so every `Math`, `String` or `Map` the script uses is looked up through the sandbox - each time. The
 * yardstick (400,000 turns of Math.imul, about a millisecond of work) took 246 ms on his page, 731 ms in a
 * hidden tab; the bench at the friend's size was 39 ms a redraw plain and 338 ms wrapped as Tampermonkey
 * wraps it. Handed to the bundle's own function as parameters, each name is looked up once, when the script
 * starts, and is a plain local name from then on.
 *
 * Only names that are the same object for the life of the page: the language's own (String, Math, Map...),
 * and document and performance. Not the timers, fetch or window - their calls go through the sandbox's own
 * versions, and they are not where the time goes.
 */

export const LOCAL_GLOBALS = [
    'undefined', 'NaN', 'Infinity',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Math', 'JSON', 'Date', 'RegExp', 'Intl',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
    'Error', 'TypeError', 'RangeError',
    'ArrayBuffer', 'DataView', 'Uint8Array', 'Uint32Array', 'Int32Array', 'Float64Array', 'TextEncoder', 'TextDecoder',
    'URL', 'URLSearchParams', 'encodeURIComponent', 'decodeURIComponent', 'isFinite', 'isNaN', 'parseInt', 'parseFloat',
    'document', 'performance',
];

/**
 * The parameters and the arguments of the bundle's function: the names of LOCAL_GLOBALS the body uses and
 * declares nowhere at its top level (a top-level name of ours would clash with the parameter).
 *
 * @param {string} body - the bundled modules
 * @param {Set<string>} declared - every top-level name the modules declare
 * @returns {{names: string[], params: string, args: string}}
 */
export function localGlobals(body, declared = new Set()) {
    const names = LOCAL_GLOBALS.filter((n) => !declared.has(n) && new RegExp('(?<![.\\w$])' + n + '(?![\\w$])').test(body));
    // A name a browser may lack is handed in as undefined, never a ReferenceError at start.
    const args = names.map((n) => (n === 'undefined' ? 'void 0' : 'typeof ' + n + " !== 'undefined' ? " + n + ' : void 0'));
    return { names, params: names.join(', '), args: args.join(', ') };
}
