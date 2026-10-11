// Where the shared server's code is. It is a folder of its own beside the apps (D:\torn\server), not a part of
// this repository, so the tests that hold the script's side and the server's side together find it by walking up
// from here: the first folder above that has server/src/host.js in it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function serverFile(rel) {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const root = path.join(dir, 'server');
        if (fs.existsSync(path.join(root, 'src', 'host.js'))) return pathToFileURL(path.join(root, rel)).href;
        const up = path.dirname(dir);
        if (up === dir) throw new Error('The shared server folder (server/, with src/host.js in it) was not found above ' + fileURLToPath(import.meta.url));
        dir = up;
    }
}
