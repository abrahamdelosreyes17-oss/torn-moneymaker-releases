/*
 * A .zip of a few text files, made in the browser (3.15: Settings › API use ›
 * Export, "downloads as a zip file so he can send it to us"). Stored, not
 * compressed - a few hundred KB of numbers at most - so nothing but a CRC-32
 * and the zip headers: no library.
 */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, as zip headers keep them. */
function dosTime(d) {
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
        date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

/**
 * @param {Array<{name: string, text?: string, data?: Uint8Array}>} files
 * @param {Date} [when]
 * @returns {Uint8Array} the .zip
 */
export function makeZip(files, when = new Date()) {
    const enc = new TextEncoder();
    const { time, date } = dosTime(when);
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const name = enc.encode(f.name);
        // Text, or bytes as they are (a screenshot).
        const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.text || '');
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true); // version needed
        local.setUint16(6, 0x0800, true); // UTF-8 names
        local.setUint16(8, 0, true); // stored
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, data);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, date, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, data.length, true);
        cen.setUint32(24, data.length, true);
        cen.setUint16(28, name.length, true);
        cen.setUint32(42, offset, true);
        central.push(new Uint8Array(cen.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of all) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
