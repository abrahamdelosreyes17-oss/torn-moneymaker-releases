import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionedMap, versionsSig, touch } from '../src/core/versions.js';

test('a versioned map counts its changes, and is a Map', () => {
    const m = new VersionedMap([['a', 1]]);
    assert.ok(m instanceof Map);
    const v = m.version;
    m.set('b', 2);
    assert.equal(m.version, v + 1);
    m.delete('nope');
    assert.equal(m.version, v + 1);
    m.delete('a');
    m.clear();
    assert.equal(m.version, v + 3);
    assert.deepEqual([...new VersionedMap([['x', 1]])], [['x', 1]]);
});

test('the same word for the same data; a change or a list replaced whole is another word', () => {
    const m = new VersionedMap();
    const list = new Map();
    const before = versionsSig([m, list, 5, null]);
    assert.equal(versionsSig([m, list, 5, null]), before);
    m.set(1, 1);
    assert.notEqual(versionsSig([m, list, 5, null]), before);
    const after = versionsSig([m, list, 5, null]);
    assert.notEqual(versionsSig([m, new Map(), 5, null]), after);
});

test('an entry changed in place is one more version all the same', () => {
    const m = new VersionedMap([['a', { at: 0 }]]);
    const before = versionsSig([m]);
    m.get('a').at = 5;
    touch(m);
    assert.notEqual(versionsSig([m]), before);
});
