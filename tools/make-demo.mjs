/**
 * Records the short animation the README shows: typing an amount, pressing Add,
 * and the entry landing in the list and on the chart.
 *
 *   node tools/make-demo.mjs [dist/home-budget-<version>.html] [docs/demo.gif]
 *
 * It drives the built file in headless Chromium, takes a screenshot per step and
 * writes them as a GIF through tools/gif.mjs - no dependency, same as the icons
 * and the QR code.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, sleep } from './cdp.mjs';
import { inflateSync } from 'node:zlib';
import { encodeGif } from './gif.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 760;
const HEIGHT = 540;

function latestBuild() {
  const dist = join(root, 'dist');
  const names = readdirSync(dist)
    .filter((name) => /^home-budget-\d.*\.html$/.test(name) && !name.endsWith('.min.html'))
    .sort();
  if (!names.length) throw new Error('No build found in dist - run npm run build first');
  return join(dist, names[names.length - 1]);
}

/** A screenshot as raw RGBA, which is what the GIF writer wants. */
async function grab(cdp) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const png = Buffer.from(data, 'base64');
  return decodePng(png);
}

/** Just enough PNG reading to get the pixels back out of a screenshot. */
function decodePng(png) {
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = 6;
  const idat = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9];
      // Chrome writes RGB or RGBA depending on the page; both are 8 bits a channel.
      if (body[8] !== 8 || (colourType !== 2 && colourType !== 6)) {
        throw new Error(`unsupported screenshot format: depth ${body[8]}, colour type ${colourType}`);
      }
    }
    if (type === 'IDAT') idat.push(body);
    if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colourType === 6 ? 4 : 3;
  const pixels = Buffer.alloc(width * height * channels);
  const stride = width * channels;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const target = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? pixels[target + index - channels] : 0;
      const up = row > 0 ? pixels[target - stride + index] : 0;
      const upLeft = row > 0 && index >= channels ? pixels[target - stride + index - channels] : 0;
      let value = line[index];
      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += (left + up) >> 1; break;
        case 4: {
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          value += dl <= du && dl <= dul ? left : (du <= dul ? up : upLeft);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[target + index] = value & 0xff;
    }
  }
  if (channels === 4) return { rgba: pixels, width, height };
  // The GIF writer reads four bytes a pixel, so RGB is widened to RGBA.
  const rgba = Buffer.alloc(width * height * 4, 0xff);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = pixels[pixel * 3];
    rgba[pixel * 4 + 1] = pixels[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = pixels[pixel * 3 + 2];
  }
  return { rgba, width, height };
}

async function main() {
  const file = resolve(root, process.argv[2] || latestBuild());
  const target = resolve(root, process.argv[3] || 'docs/demo.gif');
  const { cdp, chrome } = await launchChromium();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: `file://${file}` });
  await sleep(900);

  // A few days of entries, so the charts are not empty while the amount is typed.
  await cdp.evaluate(`
    localStorage.clear();
    location.reload();
  `);
  await sleep(900);
  await cdp.evaluate(`
    const store = window.homeBudget.store;
    store.updateSettings({ uiMode: 'desktop', language: 'en' });
    const iso = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    store.addEntries([
      { amount: 4500, categoryId: 'groceries', currency: 'EUR', date: iso(1), note: 'Market' },
      { amount: 1900, categoryId: 'transport', currency: 'EUR', date: iso(2), note: 'Bus card' },
      { amount: 3200, categoryId: 'home', currency: 'EUR', date: iso(3), note: 'Lamp' },
      { amount: 990, categoryId: 'daily', currency: 'EUR', date: iso(4), note: 'Coffee' },
      { amount: 6700, categoryId: 'groceries', currency: 'EUR', date: iso(5), note: 'Market' },
      { amount: 250000, categoryId: 'income', currency: 'EUR', date: iso(6), note: 'Salary' },
    ]);
    window.homeBudget.setTab('home');
    window.scrollTo(0, 0);
  `);
  await sleep(400);

  const frames = [];
  const shoot = async (delay) => {
    const { rgba } = await grab(cdp);
    frames.push({ rgba, delay });
  };

  await shoot(120); // the dashboard, before anything is typed
  // Type the amount one character at a time, the way a person would.
  for (const text of ['1', '12', '12.', '12.5', '12.50']) {
    await cdp.evaluate(`
      const input = document.getElementById('quick-amount');
      input.focus();
      input.value = '${text}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(90);
    await shoot(18);
  }
  await shoot(40); // a beat before the click
  await cdp.evaluate(`
    document.querySelector('.quick-form button').click();
    await new Promise((done) => setTimeout(done, 150));
  `);
  await shoot(200); // added: the message, the figures and the chart have moved
  await cdp.evaluate(`
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Stats')).click();
    window.scrollTo(0, 0);
    await new Promise((done) => setTimeout(done, 200));
  `);
  await shoot(260); // the statistics
  await cdp.evaluate(`
    window.homeBudget.ui.message = null;
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Home')).click();
    window.scrollTo(0, 0);
    await new Promise((done) => setTimeout(done, 200));
  `);
  await shoot(200); // back where it started, so the loop is seamless

  chrome.kill();
  const gif = encodeGif(frames, { width: WIDTH, height: HEIGHT });
  writeFileSync(target, gif);
  console.log(`${target}: ${frames.length} frames, ${WIDTH}x${HEIGHT}, ${(gif.length / 1024).toFixed(1)} kB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
