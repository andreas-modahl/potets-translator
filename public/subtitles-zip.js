// ZIP's stored format avoids a dependency for these small UTF-8 text files.
export function zipFiles(files) {
  const encoder = new TextEncoder();
  const local = [], directory = [];
  let offset = 0;
  for (const [filename, text] of Object.entries(files)) {
    const name = encoder.encode(filename), data = encoder.encode(text);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(12, 33, true); // 1980-01-01
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    entry.set(header.subarray(4, 30), 6);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    local.push(header, data); directory.push(entry);
    offset += header.length + data.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, directory.length, true);
  e.setUint16(10, directory.length, true);
  e.setUint32(12, directory.reduce((sum, entry) => sum + entry.length, 0), true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end], { type: 'application/zip' });
}
