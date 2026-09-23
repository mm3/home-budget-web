import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr } from '../src/core/qr.js';
import { qrSvg } from '../src/core/charts.js';
import { SITE_URL } from '../src/core/version.js';

/** The three corner patterns every reader looks for first. */
function hasFinder(modules, top, left) {
  const ring = [[0, 0], [0, 6], [6, 0], [6, 6], [0, 3], [3, 0], [6, 3], [3, 6]];
  const core = [[2, 2], [3, 3], [4, 4], [2, 4], [4, 2]];
  const quiet = [[1, 1], [1, 5], [5, 1], [5, 5], [1, 3], [3, 1]];
  return ring.every(([y, x]) => modules[top + y][left + x] === true)
    && core.every(([y, x]) => modules[top + y][left + x] === true)
    && quiet.every(([y, x]) => modules[top + y][left + x] === false);
}

test('a symbol has the size its version says, and the three finder patterns', () => {
  for (const [text, level, version] of [['HI', 'L', 1], [SITE_URL, 'Q', 4], ['x'.repeat(200), 'M', 10]]) {
    const symbol = encodeQr(text, level);
    assert.equal(symbol.version, version, `${text.slice(0, 10)} at ${level}`);
    assert.equal(symbol.size, version * 4 + 17);
    assert.equal(symbol.modules.length, symbol.size);
    assert.ok(symbol.modules.every((row) => row.length === symbol.size));
    const last = symbol.size - 7;
    assert.ok(hasFinder(symbol.modules, 0, 0), 'top left');
    assert.ok(hasFinder(symbol.modules, 0, last), 'top right');
    assert.ok(hasFinder(symbol.modules, last, 0), 'bottom left');
    // The timing patterns alternate along row and column 6.
    for (let at = 8; at < last; at += 1) {
      assert.equal(symbol.modules[6][at], at % 2 === 0, `timing row at ${at}`);
      assert.equal(symbol.modules[at][6], at % 2 === 0, `timing column at ${at}`);
    }
    assert.ok(symbol.mask >= 0 && symbol.mask <= 7);
  }
});

test('the same text always gives the same symbol', () => {
  const first = encodeQr(SITE_URL, 'Q');
  const second = encodeQr(SITE_URL, 'Q');
  assert.deepEqual(first.modules, second.modules);
  assert.equal(first.mask, second.mask);
});

// The layout was checked against an independent decoder; this pins it, so a
// change to the encoder that breaks real scanners cannot pass unnoticed.
test('the published address encodes to the symbol a reader was shown', () => {
  const { modules, version, mask } = encodeQr('https://mm3.github.io/home-budget-web/', 'Q');
  assert.equal(version, 4);
  assert.equal(mask, 5);
  const fingerprint = modules.map((row) => row.map((dark) => (dark ? 1 : 0)).join('')).join('');
  let hash = 0;
  for (const character of fingerprint) hash = (hash * 31 + Number(character)) % 1000000007;
  assert.equal(fingerprint.length, 33 * 33);
  assert.equal(hash, 232783520, 'the symbol changed - decode it with a real reader before updating this');
});

test('text too long for a version 10 symbol is refused, not truncated', () => {
  assert.throws(() => encodeQr('x'.repeat(300), 'H'), /do not fit/);
  assert.doesNotThrow(() => encodeQr('x'.repeat(200), 'M'));
});

test('the SVG draws one rectangle per dark module inside a quiet zone', () => {
  const { modules, size } = encodeQr('HI', 'L');
  const svg = qrSvg(modules, { quiet: 3, title: 'x' });
  assert.match(svg, new RegExp(`viewBox="0 0 ${size + 6} ${size + 6}"`));
  const dark = modules.flat().filter(Boolean).length;
  assert.equal((svg.match(/h1v1h-1z/g) || []).length, dark);
  assert.match(svg, /shape-rendering="crispEdges"/);
});
