/*
 * Settings › Report a problem (3.15, the owner: "an error log he can export
 * in settings... write the report there, send the screenshot, and zip that
 * along with the error log - make it similar to how Anthropic does it").
 * Like Anthropic's own "report a problem": what happened, what you expected,
 * what is attached - shown before anything is made - then one file. Nothing
 * is sent anywhere: the zip is downloaded, and you send it.
 */
import { makeZip } from '../core/zip.js';
import { logAsText } from '../core/errlog.js';
import { usageExportFiles } from './usage-view.js';

function rvEl(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') node.textContent = v;
        else if (k === 'onclick') node.addEventListener('click', v);
        else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
}

const rvStamp = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
};

/**
 * What goes in the report zip (pure, tested): the words, the screenshots,
 * the problem log, the API use and the page's state. No key, no player id.
 *
 * @param {object} r
 * @param {string} r.happened
 * @param {string} r.expected
 * @param {Array<{name: string, data: Uint8Array}>} r.shots
 * @param {Array} r.log - the problem log (core/errlog.js)
 * @param {object} r.usage - getUsage(): {record, state}
 * @param {object} [r.env] - {userAgent, screen}
 * @returns {Array<{name: string, text?: string, data?: Uint8Array}>}
 */
export function reportFiles({ happened = '', expected = '', shots = [], log = [], usage = {}, env = {}, now = Date.now() }) {
    const state = usage.state || {};
    const errors = log.filter((e) => e.kind === 'error');
    const safe = (n) => String(n || 'screenshot').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const files = [
        { name: 'report.txt', text: [
            'Torn Trading - problem report',
            'Made ' + new Date(now).toString(),
            'Script ' + (state.script || '?') + ' · ' + (env.userAgent || '') + (env.screen ? ' · screen ' + env.screen : ''),
            '',
            'WHAT HAPPENED',
            happened.trim() || '(not filled in)',
            '',
            'WHAT I EXPECTED',
            expected.trim() || '(not filled in)',
            '',
            'ATTACHED',
            shots.length ? shots.map((s, i) => '  screenshots/' + (i + 1) + '-' + safe(s.name)).join('\n') : '  no screenshots',
            '  problem-log.txt - ' + errors.length + ' errors and ' + (log.length - errors.length) + ' other lines, the last 7 days',
            '  api-usage/ - every request by what it was for (see its README)',
            '  state.json - the page\'s switches, limits and coverage',
            '',
            'No API key, player id or name is in these files.',
        ].join('\n') + '\n' },
        { name: 'problem-log.txt', text: logAsText(log) },
        { name: 'problem-log.json', text: JSON.stringify(log) },
        { name: 'state.json', text: JSON.stringify(state, null, 2) },
    ];
    shots.forEach((s, i) => files.push({ name: 'screenshots/' + (i + 1) + '-' + safe(s.name), data: s.data }));
    for (const f of usageExportFiles(usage.record, { state, now })) files.push({ ...f, name: 'api-usage/' + f.name });
    return files;
}

export class ReportView {
    /** @param {{getReport: function, onClearLog: function}} h */
    constructor(h) {
        this.h = h;
        this.shots = [];
        this.el = rvEl('div', { class: 'rv' });
        this.happened = rvEl('textarea', { class: 'rv-text', rows: 4, placeholder: 'For example: I picked Xanax, the buyers list went empty and it said "Loading more buyers".' });
        this.expected = rvEl('textarea', { class: 'rv-text', rows: 2, placeholder: 'For example: the traders buying Xanax.' });
        this.fileInput = rvEl('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
        this.fileInput.addEventListener('change', () => this.addShots());
        this.shotsEl = rvEl('div', { class: 'rv-shots' });
        this.includesEl = rvEl('ul', { class: 'rv-includes' });
        this.logEl = rvEl('pre', { class: 'rv-log', hidden: true });
        this.statusEl = rvEl('p', { class: 'rv-status', role: 'status' });
        this.logBtn = rvEl('button', { type: 'button', class: 'rv-link', text: 'Show the log', onclick: () => this.toggleLog() });
        this.el.append(
            rvEl('label', { class: 'rv-label' }, [rvEl('b', { text: 'What happened?' }), this.happened]),
            rvEl('label', { class: 'rv-label' }, [rvEl('b', { text: 'What did you expect?' }), this.expected]),
            rvEl('div', { class: 'rv-label' }, [
                rvEl('b', { text: 'Screenshots' }),
                rvEl('div', { class: 'rv-row' }, [rvEl('button', { type: 'button', class: 'rv-btn', text: 'Add screenshots', onclick: () => this.fileInput.click() }), rvEl('small', { text: 'Take them with Win + Shift + S, save, then add them here.' })]),
                this.shotsEl,
            ]),
            rvEl('div', { class: 'rv-label' }, [rvEl('b', { text: 'What goes in the zip' }), this.includesEl, this.logBtn, this.logEl]),
            rvEl('div', { class: 'rv-row' }, [
                rvEl('button', { type: 'button', class: 'rv-btn rv-primary', text: 'Download report (.zip)', onclick: () => this.download() }),
                rvEl('button', { type: 'button', class: 'rv-link', text: 'Clear the log', title: 'Start the log again (after sending a report)', onclick: () => {
                    if (this.h.onClearLog) this.h.onClearLog();
                    this.statusEl.textContent = 'Log cleared.';
                    this.render();
                } }),
            ]),
            this.statusEl,
            this.fileInput,
        );
    }

    addShots() {
        const files = [...(this.fileInput.files || [])];
        this.fileInput.value = '';
        Promise.all(files.map((f) => f.arrayBuffer().then((b) => ({ name: f.name, data: new Uint8Array(b), url: URL.createObjectURL(f) })))).then((got) => {
            this.shots.push(...got);
            this.render();
        });
    }

    toggleLog() {
        this.logEl.hidden = !this.logEl.hidden;
        this.logBtn.textContent = this.logEl.hidden ? 'Show the log' : 'Hide the log';
        this.render();
    }

    /** What will be attached, drawn before anything is made (as Anthropic's report does). */
    render() {
        const r = this.h.getReport ? this.h.getReport() : { log: [] };
        const log = r.log || [];
        const errors = log.filter((e) => e.kind === 'error').length;
        this.shotsEl.textContent = '';
        this.shots.forEach((s, i) => {
            this.shotsEl.appendChild(rvEl('span', { class: 'rv-shot' }, [
                rvEl('img', { src: s.url, alt: s.name }),
                rvEl('button', { type: 'button', class: 'rv-x', 'aria-label': 'Remove ' + s.name, text: '×', onclick: () => {
                    URL.revokeObjectURL(s.url);
                    this.shots.splice(i, 1);
                    this.render();
                } }),
            ]));
        });
        this.includesEl.textContent = '';
        for (const line of [
            'What you wrote above',
            this.shots.length ? this.shots.length + (this.shots.length === 1 ? ' screenshot' : ' screenshots') : 'No screenshots yet',
            'The problem log: ' + errors + (errors === 1 ? ' error' : ' errors') + ' and ' + (log.length - errors) + ' of your steps, the last 7 days (every tab: Torn Bids and Torn\'s pages)',
            'API use: every request by what it was for, the last week',
            'This page\'s version, switches and limits - no API key, no player id or name',
        ]) this.includesEl.appendChild(rvEl('li', { text: line }));
        if (!this.logEl.hidden) this.logEl.textContent = logAsText(log.slice(-40)) || 'Nothing logged yet.';
    }

    /**
     * One file, then a clean form (3.16, the friend had to clear the log by
     * hand): the words, the screenshots and the log go, so the next report
     * starts empty. The zip is kept in memory for "Download it again".
     */
    download() {
        const r = this.h.getReport ? this.h.getReport() : {};
        const now = Date.now();
        const files = reportFiles({
            happened: this.happened.value,
            expected: this.expected.value,
            shots: this.shots,
            log: r.log || [],
            usage: r.usage || {},
            env: { userAgent: navigator.userAgent, screen: window.screen ? window.screen.width + 'x' + window.screen.height : '' },
            now,
        });
        this.lastZip = { data: makeZip(files, new Date(now)), name: 'torn-trading-report-' + rvStamp(now) + '.zip' };
        this.saveZip(this.lastZip);
        this.happened.value = '';
        this.expected.value = '';
        for (const s of this.shots) URL.revokeObjectURL(s.url);
        this.shots = [];
        if (this.h.onClearLog) this.h.onClearLog();
        this.statusEl.textContent = 'Saved ' + this.lastZip.name + ' to your downloads. Send that file - nothing was sent by this page. The form and the log are cleared for your next report. ';
        this.statusEl.appendChild(rvEl('button', { type: 'button', class: 'rv-link', text: 'Download it again', onclick: () => this.saveZip(this.lastZip) }));
        this.render();
    }

    saveZip(z) {
        if (!z) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([z.data], { type: 'application/zip' }));
        a.download = z.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
}

export const REPORT_CSS = `
.rv { display: flex; flex-direction: column; gap: 14px; }
.rv-label { display: flex; flex-direction: column; gap: 6px; }
.rv-text { width: 100%; padding: 8px 10px; border: 1px solid var(--cline2); border-radius: 8px; background: var(--card2); color: var(--text); font: inherit; resize: vertical; }
.rv-text:focus { outline: 2px solid var(--hot-line); outline-offset: 0; }
.rv-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.rv-row small { color: var(--muted); }
.rv-btn { padding: 7px 14px; border: 1px solid var(--cline2); border-radius: 8px; background: var(--card2); color: var(--text); cursor: pointer; }
.rv-btn:hover { border-color: var(--muted); }
.rv-btn.rv-primary { background: var(--price); border-color: var(--price); color: #111; font-weight: bold; }
.rv-link { padding: 0; border: 0; background: none; color: var(--offer); text-decoration: underline; cursor: pointer; align-self: flex-start; }
.rv-shots { display: flex; flex-wrap: wrap; gap: 8px; }
.rv-shot { position: relative; }
.rv-shot img { display: block; height: 72px; border-radius: 6px; border: 1px solid var(--cline2); }
.rv-x { position: absolute; top: 2px; right: 2px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 10px; background: rgba(0, 0, 0, 0.7); color: #fff; cursor: pointer; }
.rv-includes { margin: 0; padding-left: 18px; color: var(--muted); }
.rv-includes li::marker { content: '✓  '; color: var(--price); }
.rv-log { margin: 0; padding: 8px 10px; border: 1px solid var(--cline2); border-radius: 8px; background: #111; font: 11px/1.5 Consolas, monospace; white-space: pre-wrap; }
.rv-status { margin: 0; color: var(--muted); }
`;
