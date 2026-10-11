/*
 * A wait that a hidden tab keeps too (3.25.0).
 *
 * A hidden tab's timers fire late - once a second at first, after five minutes
 * hidden once a minute. Torn Bids reads TornW3B from behind your Torn tab, so
 * until now each of its reads started as the last one ended, with nothing
 * between them: up to 40 back to back, the burst TornW3B refuses. The gap
 * between two reads (api/w3b.js) has to be waited out there by something the
 * browser does not slow: a worker's timer.
 *
 * In view no worker is ever made. Hidden, one is made for the tab, and the
 * plain timer runs beside it - whichever ends first ends the wait - so a page
 * that refuses a worker costs nothing but the late timer of before.
 */

/** The whole worker: told [number, ms], it answers with the number after ms. */
export const STEADY_WORKER_SOURCE = 'onmessage = function (e) { var id = e.data[0]; setTimeout(function () { postMessage(id); }, e.data[1]); }';

/**
 * @param {object} o
 * @param {function} o.makeWorker - (source) => Worker; may throw (the page's policy)
 * @param {function} [o.isHidden] - () => boolean
 * @returns {function(number): Promise<void>} sleep(ms)
 */
export function makeSteadySleep({ makeWorker = null, isHidden = () => false, setTimer = setTimeout, clearTimer = clearTimeout, onRefused = null } = {}) {
    let worker = null;
    let refused = false;
    let next = 1;
    const waiting = new Map();
    const giveUp = () => {
        const first = !refused;
        refused = true;
        worker = null;
        // For the log, once: from here a hidden tab waits on the browser's slowed timer.
        if (first && onRefused) {
            try {
                onRefused();
            } catch {
                // The log is best-effort.
            }
        }
    };
    const start = () => {
        if (worker || refused || !makeWorker) return;
        try {
            worker = makeWorker(STEADY_WORKER_SOURCE);
            worker.onmessage = (e) => {
                const done = waiting.get(e && e.data);
                if (done) done();
            };
            worker.onerror = giveUp;
        } catch {
            giveUp();
        }
    };
    const sleep = (ms) => new Promise((resolve) => {
        const id = next++;
        let timer = null;
        const done = () => {
            if (!waiting.delete(id)) return;
            clearTimer(timer);
            resolve();
        };
        waiting.set(id, done);
        timer = setTimer(done, ms);
        if (!isHidden()) return;
        start();
        if (!worker) return;
        try {
            worker.postMessage([id, ms]);
        } catch {
            giveUp();
        }
    });
    /** For the export: 'worker' (a hidden tab keeps time), 'refused' (the page allows no worker), or 'not needed yet'. */
    sleep.state = () => (refused ? 'refused' : worker ? 'worker' : 'not needed yet');
    return sleep;
}
