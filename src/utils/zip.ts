/**
 * Minimal ZIP file writer (store / no-compression method only).
 *
 * PNGs are already compressed, so "store" mode costs nothing in size while
 * avoiding a dependency on a compression library. This keeps the batch
 * feature from requiring `npm install` of a new package.
 *
 * Implements just enough of the PKZIP APPNOTE format (local file headers,
 * central directory, end-of-central-directory record) to produce a zip that
 * Windows Explorer, macOS Archive Utility, and 7-Zip can all open.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: dosDate };
}

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

const UTF8_FLAG = 0x0800;

export async function createZipBlob(entries: ZipEntryInput[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(new Date());

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true); // version needed to extract
    localHeader.setUint16(6, UTF8_FLAG, true); // general purpose bit flag
    localHeader.setUint16(8, 0, true); // compression method: store
    localHeader.setUint16(10, time, true);
    localHeader.setUint16(12, date, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, size, true); // compressed size
    localHeader.setUint32(22, size, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    localParts.push(localHeaderBytes, nameBytes, entry.data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed to extract
    centralHeader.setUint16(8, UTF8_FLAG, true);
    centralHeader.setUint16(10, 0, true); // compression method
    centralHeader.setUint16(12, time, true);
    centralHeader.setUint16(14, date, true);
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, size, true);
    centralHeader.setUint32(24, size, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // file comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal file attributes
    centralHeader.setUint32(38, 0, true); // external file attributes
    centralHeader.setUint32(42, offset, true); // relative offset of local header

    centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

    offset += localHeaderBytes.length + nameBytes.length + size;
  }

  const centralDirStart = offset;
  const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central directory
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralDirSize, true);
  eocd.setUint32(16, centralDirStart, true);
  eocd.setUint16(20, 0, true); // comment length

  // Concatenate into a single explicitly ArrayBuffer-backed Uint8Array before
  // handing it to Blob — avoids TypeScript's stricter BlobPart typing (which
  // rejects a bare Uint8Array<ArrayBufferLike>) across TS/lib versions.
  const allParts = [...localParts, ...centralParts, new Uint8Array(eocd.buffer)];
  const totalLength = allParts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(new ArrayBuffer(totalLength));
  let pos = 0;
  for (const part of allParts) {
    output.set(part, pos);
    pos += part.length;
  }

  return new Blob([output], { type: "application/zip" });
}
