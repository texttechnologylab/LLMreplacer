(function () {
  "use strict";

  // CRC-32 (IEEE 802.3), table built once.
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
    const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
    return { time, date };
  }

  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const { time, date } = dosDateTime(now);

    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const dataBytes = enc.encode(f.text);
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + name).
      const lfh = new DataView(new ArrayBuffer(30));
      lfh.setUint32(0, 0x04034b50, true); // signature
      lfh.setUint16(4, 20, true); // version needed
      lfh.setUint16(6, 0x0800, true); // flags: UTF-8 filename
      lfh.setUint16(8, 0, true); // method: store
      lfh.setUint16(10, time, true);
      lfh.setUint16(12, date, true);
      lfh.setUint32(14, crc, true);
      lfh.setUint32(18, size, true); // compressed size
      lfh.setUint32(22, size, true); // uncompressed size
      lfh.setUint16(26, nameBytes.length, true);
      lfh.setUint16(28, 0, true); // extra length

      chunks.push(new Uint8Array(lfh.buffer), nameBytes, dataBytes);

      // Central directory record (46 bytes + name).
      const cdr = new DataView(new ArrayBuffer(46));
      cdr.setUint32(0, 0x02014b50, true);
      cdr.setUint16(4, 20, true); // version made by
      cdr.setUint16(6, 20, true); // version needed
      cdr.setUint16(8, 0x0800, true); // flags
      cdr.setUint16(10, 0, true); // method
      cdr.setUint16(12, time, true);
      cdr.setUint16(14, date, true);
      cdr.setUint32(16, crc, true);
      cdr.setUint32(20, size, true);
      cdr.setUint32(24, size, true);
      cdr.setUint16(28, nameBytes.length, true);
      cdr.setUint16(30, 0, true); // extra
      cdr.setUint16(32, 0, true); // comment
      cdr.setUint16(34, 0, true); // disk number
      cdr.setUint16(36, 0, true); // internal attrs
      cdr.setUint32(38, 0, true); // external attrs
      cdr.setUint32(42, offset, true); // local header offset

      central.push(new Uint8Array(cdr.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    // End of central directory (22 bytes).
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, centralStart, true);
    eocd.setUint16(20, 0, true);

    return new Blob([...chunks, ...central, new Uint8Array(eocd.buffer)], {
      type: "application/zip",
    });
  }

  window.makeZip = makeZip;
})();
