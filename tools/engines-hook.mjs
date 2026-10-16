/*
 * For the tests: `#engines/<path>` is that file of the shared folder (tools/engines.mjs), as the build has it.
 * Loaded with `node --import ./tools/engines-hook.mjs`.
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ENGINES_PREFIX, resolveImport } from './engines.mjs';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (!specifier.startsWith(ENGINES_PREFIX)) return nextResolve(specifier, context);
        return { url: pathToFileURL(resolveImport('', specifier)).href, shortCircuit: true };
    },
});
