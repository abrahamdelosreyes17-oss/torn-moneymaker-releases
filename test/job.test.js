/*
 * One job at a time (3.25.0): NPC Arbitrage or Torn Bids - the owner's three rules.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { JOB_NPC, JOB_BIDS, jobStored, jobLock, jobNow, jobSwitch, jobLockWords, jobParts } from '../src/core/job.js';

const trade = (name, at) => ({ key: 'id:' + at, at, trader: { name } });

test('the job: what was chosen stays; never chosen, Torn Bids for someone who set it up, else NPC Arbitrage', () => {
    assert.equal(jobStored('npc'), JOB_NPC);
    assert.equal(jobStored('bids'), JOB_BIDS);
    assert.equal(jobStored(null), JOB_NPC);
    assert.equal(jobStored(undefined, { bidsSetUp: true }), JOB_BIDS);
    // Junk in the store is "never chosen", not a third job.
    assert.equal(jobStored('both', { bidsSetUp: false }), JOB_NPC);
    // A choice beats the guess.
    assert.equal(jobStored('npc', { bidsSetUp: true }), JOB_NPC);
});

test('the job: a trade going keeps it on Torn Bids, whatever is stored - and the switch says why it will not turn', () => {
    assert.equal(jobLock([]), null);
    assert.equal(jobLock(null), null);
    assert.deepEqual(jobLock([trade('Vesper', 5)]), { name: 'Vesper', trades: 1 });
    // Two going: the newest one's trader is named, and both are counted.
    assert.deepEqual(jobLock([trade('Vesper', 5), trade('Quill', 9)]), { name: 'Quill', trades: 2 });

    assert.equal(jobNow('npc', []), JOB_NPC);
    assert.equal(jobNow('npc', [trade('Vesper', 5)]), JOB_BIDS);
    assert.equal(jobNow(null, [trade('Vesper', 5)]), JOB_BIDS);
    assert.equal(jobNow('bids', []), JOB_BIDS);

    assert.deepEqual(jobSwitch(JOB_NPC, []), { ok: true, why: '' });
    assert.deepEqual(jobSwitch(JOB_NPC, [trade('Vesper', 5)]), { ok: false, why: 'NPC Arbitrage is locked. Finish or cancel the trade with Vesper first.' });
    assert.equal(jobSwitch(JOB_NPC, [trade('Vesper', 5), trade('Quill', 9)]).why, 'NPC Arbitrage is locked. Finish or cancel your 2 trades first.');
    // Torn Bids can always be turned on; a word that is no job turns nothing.
    assert.deepEqual(jobSwitch(JOB_BIDS, [trade('Vesper', 5)]), { ok: true, why: '' });
    assert.equal(jobSwitch('both', []).ok, false);
    assert.equal(jobLockWords(null), '');
});

test('the job: the side that is off does nothing - never both, never neither', () => {
    assert.deepEqual(jobParts(JOB_NPC), { deals: true, trades: false });
    assert.deepEqual(jobParts(JOB_BIDS), { deals: false, trades: true });
    for (const job of [JOB_NPC, JOB_BIDS, jobNow(null, []), jobNow('junk', [trade('Vesper', 1)])]) {
        const p = jobParts(job);
        assert.equal(p.deals !== p.trades, true, job);
    }
});
