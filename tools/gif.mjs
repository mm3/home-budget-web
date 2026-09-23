/**
 * An animated GIF writer, so the README can show the app being used without a
 * dependency. GIF is the one animated format a README renders everywhere.
 *
 * Colours are quantised by popularity: the frames of a flat interface hold few
 * distinct colours, so the 255 most common ones cover almost every pixel, and
 * the rest are mapped to the nearest of them. Each frame is then LZW compressed,
 * which is what the format asks for.
 */

/** One palette for the whole animation: the colours that actually occur most. */
function buildPalette(frames, limit = 255) {
  const counts = new Map();
  for (const { rgba } of frames) {
    for (let at = 0; at < rgba.length; at += 4) {
      const key = (rgba[at] << 16) | (rgba[at + 1] << 8) | rgba[at + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
}

/** Nearest palette entry, cached because the same colours repeat constantly. */
function createMapper(palette) {
  const cache = new Map();
  return (red, green, blue) => {
    const key = (red << 16) | (green << 8) | blue;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < palette.length; index += 1) {
      const [pr, pg, pb] = palette[index];
      const distance = (pr - red) ** 2 + (pg - green) ** 2 + (pb - blue) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    cache.set(key, best);
    return best;
  };
}

/** GIF's variable width LZW, with the clear and end codes the format requires. */
function compress(indices, minimumCodeSize) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = new Map();

  const bytes = [];
  let bits = 0;
  let bitCount = 0;
  const write = (code) => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bits & 0xff);
      bits >>= 8;
      bitCount -= 8;
    }
  };

  write(clearCode);
  let previous = String(indices[0]);
  for (let at = 1; at < indices.length; at += 1) {
    const candidate = `${previous},${indices[at]}`;
    if (dictionary.has(candidate)) {
      previous = candidate;
      continue;
    }
    write(dictionary.has(previous) ? dictionary.get(previous) : Number(previous));
    dictionary.set(candidate, nextCode);
    nextCode += 1;
    if (nextCode === (1 << codeSize) + 1 && codeSize < 12) codeSize += 1;
    if (nextCode >= 4096) {
      write(clearCode);
      dictionary = new Map();
      nextCode = endCode + 1;
      codeSize = minimumCodeSize + 1;
    }
    previous = String(indices[at]);
  }
  write(dictionary.has(previous) ? dictionary.get(previous) : Number(previous));
  write(endCode);
  if (bitCount > 0) bytes.push(bits & 0xff);

  // The compressed stream is carried in sub-blocks of at most 255 bytes.
  const blocks = [minimumCodeSize];
  for (let at = 0; at < bytes.length; at += 255) {
    const chunk = bytes.slice(at, at + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from(blocks);
}

/**
 * Encodes frames as an animated GIF.
 * @param {{rgba: Buffer, delay: number}[]} frames delay in hundredths of a second
 * @param {{width: number, height: number, loop?: number}} options
 * @returns {Buffer}
 */
export function encodeGif(frames, { width, height, loop = 0 }) {
  const palette = buildPalette(frames);
  const toIndex = createMapper(palette);
  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length + 1))));
  const paletteSize = 1 << bits;

  const table = Buffer.alloc(paletteSize * 3);
  palette.forEach(([red, green, blue], index) => {
    table[index * 3] = red;
    table[index * 3 + 1] = green;
    table[index * 3 + 2] = blue;
  });

  const header = Buffer.alloc(13);
  header.write('GIF89a', 0, 6, 'latin1');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0x80 | (bits - 1); // global colour table, its size
  header[11] = 0; // background colour index
  header[12] = 0; // pixel aspect ratio

  const netscape = Buffer.alloc(19);
  netscape.write('!\xff\x0bNETSCAPE2.0', 0, 14, 'latin1');
  netscape[14] = 3;
  netscape[15] = 1;
  netscape.writeUInt16LE(loop, 16);
  netscape[18] = 0;

  const parts = [header, table, netscape];
  for (const { rgba, delay } of frames) {
    const indices = new Uint8Array(width * height);
    for (let pixel = 0; pixel < indices.length; pixel += 1) {
      const at = pixel * 4;
      indices[pixel] = toIndex(rgba[at], rgba[at + 1], rgba[at + 2]);
    }
    const control = Buffer.alloc(8);
    control.write('!\xf9\x04', 0, 3, 'latin1');
    control[3] = 0; // no transparency, leave the frame in place
    control.writeUInt16LE(Math.max(2, Math.round(delay)), 4);
    control[6] = 0;
    control[7] = 0;

    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(0, 1);
    descriptor.writeUInt16LE(0, 3);
    descriptor.writeUInt16LE(width, 5);
    descriptor.writeUInt16LE(height, 7);
    descriptor[9] = 0; // no local colour table, not interlaced

    parts.push(control, descriptor, compress(indices, Math.max(2, bits)));
  }
  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}
