/*
 * The shared folder (engines plan, option D): code both Torn Bids and Torn Archive build in, its own git repo.
 * An import of `#engines/<path>` is that file of the folder - for the build (build.mjs) and for the tests
 * (tools/engines-hook.mjs). Built into the app at build time, never loaded at runtime.
 *
 * Where it is: TORN_ENGINES, else D:/torn/engines.
 */
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export const ENGINES_DIR = resolve(process.env.TORN_ENGINES || 'D:/torn/engines');
export const ENGINES_PREFIX = '#engines/';

/** The file an import names, from the module that imports it. */
export function resolveImport(fromFile, spec) {
    return spec.startsWith(ENGINES_PREFIX) ? resolve(ENGINES_DIR, spec.slice(ENGINES_PREFIX.length)) : resolve(dirname(fromFile), spec);
}

/** The folder's commit a build is made from, "+changes" when it has edits not committed; null when unknown. */
export function enginesCommit() {
    try {
        const git = (...args) => execFileSync('git', ['-C', ENGINES_DIR, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        let head = 'no commit';
        try {
            head = git('rev-parse', '--short', 'HEAD');
        } catch {
            // A new folder: nothing committed yet.
        }
        return head + (git('status', '--porcelain') ? ' +changes' : '');
    } catch {
        return null;
    }
}
