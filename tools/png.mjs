/**
 * A minimal PNG writer: a deflate stream of raw RGBA scanlines, wrapped in the
 * three chunks a decoder needs. Shared by the icon and QR generators, so neither
 * needs a dependency.
 */

import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encodes an image as PNG.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba width * height * 4 bytes, row by row
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const at = row * (width * 4 + 1);
    raw[at] = 0; // filter: none
    rgba.copy(raw, at + 1, row * width * 4, (row + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
