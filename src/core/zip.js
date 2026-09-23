/**
 * Minimal ZIP reader and writer, enough for the .xlsx format.
 * Compression uses the browser's built-in CompressionStream; when it is missing,
 * entries are stored uncompressed, which is still a valid archive.
 */

const textEncoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 as used by ZIP. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot read compressed .xlsx files');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Builds a ZIP archive.
 * @param {Array<{name: string, data: string|Uint8Array}>} files
 * @returns {Promise<Uint8Array>}
 */
export async function createZip(files) {
  const entries = [];
  let offset = 0;
  const chunks = [];
  for (const file of files) {
    const raw = typeof file.data === 'string' ? textEncoder.encode(file.data) : file.data;
    const name = textEncoder.encode(file.name);
    const compressed = await deflateRaw(raw);
    const useDeflate = compressed !== null && compressed.length < raw.length;
    const data = useDeflate ? compressed : raw;
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, useDeflate ? 8 : 0, true);
    view.setUint16(10, 0, true); // time
    view.setUint16(12, 0x2821, true); // date: 2000-01-01
    view.setUint32(14, crc32(raw), true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, raw.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    chunks.push(header, data);
    entries.push({
      name, offset, crc: crc32(raw), compressedSize: data.length, size: raw.length, method: useDeflate ? 8 : 0,
    });
    offset += header.length + data.length;
  }

  const central = [];
  let centralSize = 0;
  for (const entry of entries) {
    const record = new Uint8Array(46 + entry.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0x2821, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.compressedSize, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.name, 46);
    central.push(record);
    centralSize += record.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const result = new Uint8Array(total);
  let position = 0;
  for (const chunk of [...chunks, ...central, end]) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

/**
 * Reads a ZIP archive into a map of file name to bytes.
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= 0 && index > bytes.length - 22 - 0xffff; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Not a ZIP file');
  const count = view.getUint16(endOffset + 10, true);
  let pointer = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('Damaged ZIP file');
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error(`Unsupported compression in ${name}`);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
