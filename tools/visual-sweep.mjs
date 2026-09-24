/**
 * Renders every screen and every dialog in every combination of language,
 * theme and layout, over several shapes of data, and reports what looks wrong.
 *
 *   node tools/visual-sweep.mjs [dist/home-budget-<version>.html]
 *
 * The point is that nobody can look at four hundred screens. The eye is good at
 * "that looks off" and terrible at doing it four hundred times, so the machine
 * measures the things that are measurable - a control past the edge, two
 * controls on top of each other, words cut off, a target too small for a
 * finger, text too pale to read - and keeps a screenshot of every screen it
 * complained about, so a person only has to look at those.
 *
 * It writes docs/visual-sweep.md and, next to it, the screenshots of the cases
 * that were flagged.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, sleep } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'sweep');

/** The three things that change the whole page at once. */
const LANGUAGES = ['en', 'ru', 'de'];
const THEMES = ['light', 'dark'];
const LAYOUTS = [
  { name: 'desktop', mode: 'desktop', width: 1280, height: 900, mobile: false },
  { name: 'phone', mode: 'mobile', width: 390, height: 844, mobile: true },
];

/**
 * The shapes of data that break layouts. "Normal" is what a screenshot shows;
 * the others are what a real store turns into after a year.
 */
const DATA = {
  empty: `
    store.clearEntries();
  `,
  normal: `
    store.clearEntries();
    store.addEntries([
      { amount: 4500, categoryId: 'groceries', currency: 'EUR', date: iso(1), note: 'Market' },
      { amount: 1900, categoryId: 'transport', currency: 'EUR', date: iso(3), note: 'Bus card' },
      { amount: 250000, categoryId: 'income', currency: 'EUR', date: iso(6), note: 'Salary' },
      { amount: 3200, categoryId: 'home', currency: 'EUR', date: iso(20), note: 'Lamp' },
      { amount: 800, categoryId: 'daily', currency: 'EUR', date: iso(40), note: 'Coffee' },
    ]);
    store.updateCategory('groceries', { limit: 30000, limitPeriod: 'week' });
  `,
  // Everything as long as the app allows: a 40 character category name, a 200
  // character note, a currency with the widest symbol it ships.
  long: `
    store.clearEntries();
    store.addCategory({ name: 'Wachstumsbeschleunigungsgesetzgebung', icon: '\\u{1f9fe}' });
    const wordy = store.categories[store.categories.length - 1];
    store.addEntries([
      { amount: 129900, categoryId: wordy.id, currency: 'CNY',
        date: iso(1), note: 'A note that somebody really did type out in full, because the field allows two hundred characters and this is what two hundred characters of somebody explaining a purchase to themselves actually looks like in a table' },
      { amount: 4500, categoryId: 'groceries', currency: 'EUR', date: iso(2), note: 'Market' },
    ]);
    store.updateCategory(wordy.id, { limit: 100000, limitPeriod: 'day' });
  `,
  // The extremes the validation allows: the largest amount that keeps the
  // totals exact, a currency with no decimals, and a budget blown many times
  // over, which is what turns a progress bar red and a figure long.
  extreme: `
    store.clearEntries();
    store.addEntries([
      { amount: 99999999999, categoryId: 'home', currency: 'EUR', date: iso(2), note: 'House' },
      { amount: 1234567, categoryId: 'daily', currency: 'JPY', date: iso(1), note: 'Tokyo' },
      { amount: 5, categoryId: 'groceries', currency: 'EUR', date: iso(1), note: 'Sweet' },
    ]);
    store.updateCategory('daily', { limit: 100, limitPeriod: 'day' });
    store.updateCategory('home', { limit: 1000, limitPeriod: 'month' });
  `,
  // Many currencies at once, folded into one - the conversion note, the mixed
  // list and the rate column all at the same time.
  multi: `
    store.clearEntries();
    store.updateSettings({ convertToDefault: true });
    for (const code of ['USD', 'GBP', 'JPY', 'CNY', 'RUB', 'SEK']) {
      store.addEntry({ amount: 12345, categoryId: 'daily', currency: code, date: iso(2), note: code });
    }
    store.addEntry({ amount: 450000, categoryId: 'income', currency: 'EUR', date: iso(4), note: 'Salary' });
  `,
};

/** Every screen and dialog, reached through the app rather than by clicking words. */
const VIEWS = {
  home: `app.setTab('home');`,
  entries: `
    app.setTab('entries');
    await pause(150);
    const box = document.querySelector('.filters-box');
    if (box) box.open = true;
  `,
  stats: `app.setTab('stats');`,
  settings: `app.setTab('settings');`,
  translations: `
    app.setTab('settings');
    await pause(150);
    const editor = [...document.querySelectorAll('details.card')][0];
    if (editor) editor.open = true;
  `,
  'dialog-entry-new': `app.setTab('home'); await pause(100); app.editEntry(null);`,
  'dialog-entry-edit': `
    app.setTab('entries');
    await pause(100);
    const entry = app.store.entries[0];
    if (!entry) return 'skip';
    app.editEntry(entry.id);
  `,
  'dialog-category-new': `app.setTab('settings'); await pause(100); app.editCategory(null);`,
  'dialog-category-edit': `
    app.setTab('settings');
    await pause(100);
    app.editCategory(app.store.categories[app.store.categories.length - 1].id);
  `,
  'dialog-share': `app.setTab('settings'); await pause(100); app.openShare();`,
};

/**
 * What counts as strange, measured in the page.
 *
 * Every rule here exists because the thing it looks for is invisible to a
 * passing glance and obvious once it is named. The exclusions matter as much as
 * the rules: a table that scrolls sideways on purpose and a name cut with an
 * ellipsis on purpose are not faults, and a check that cries about them gets
 * ignored, which is worse than no check.
 */
const PROBE = `
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  const findings = [];
  const say = (kind, what, detail) => findings.push({ kind, what, detail });

  const scope = document.querySelector('.dialog') || document.querySelector('.main');
  // Charts are SVG: they draw outside their own boxes on purpose, and the
  // scroll properties of SVG children mean something else entirely.
  const nodes = [...scope.querySelectorAll('*')].filter((node) => !(node.closest('svg')));

  /**
   * Whether the thing is actually on screen rather than scrolled out of a box
   * that clips it. Without this the translation editor - 200 rows in a 320
   * pixel window - reports every row it is hiding as lying on top of whatever
   * is drawn below the editor, which is true of the rectangles and false of
   * the pixels.
   */
  const visible = (node) => {
    // A closed <details> still hands out real rectangles for the content it is
    // not drawing - Chrome keeps the layout of ::details-content - so every row
    // of a collapsed translation editor looks like it lies on the card below.
    const folded = node.closest('details:not([open])');
    if (folded && !node.closest('summary')) return false;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    let at = node.parentElement;
    while (at && at !== document.body) {
      const style = getComputedStyle(at);
      if (/auto|scroll|hidden/.test(style.overflowX + style.overflowY)) {
        const frame = at.getBoundingClientRect();
        if (box.right <= frame.left + 1 || box.left >= frame.right - 1
          || box.bottom <= frame.top + 1 || box.top >= frame.bottom - 1) return false;
      }
      at = at.parentElement;
    }
    return true;
  };

  const controls = nodes.filter((node) => /^(INPUT|SELECT|BUTTON|A|TEXTAREA)$/.test(node.tagName)
    && node.getAttribute('aria-hidden') !== 'true'
    && node.offsetParent !== null
    && visible(node));

  const label = (node) => (node.getAttribute('aria-label') || node.textContent || node.placeholder
    || node.value || node.className || node.tagName).trim().slice(0, 34);

  /**
   * The part of a box a person can actually see. A row straddling the bottom
   * edge of a scrolling list is half drawn and half clipped, and comparing the
   * whole rectangle makes the clipped half look like it lies on what is below.
   */
  const clamped = (node) => {
    const box = node.getBoundingClientRect();
    let { top, left, right, bottom } = box;
    let at = node.parentElement;
    while (at && at !== document.body) {
      const style = getComputedStyle(at);
      if (/auto|scroll|hidden/.test(style.overflowX + style.overflowY)) {
        const frame = at.getBoundingClientRect();
        top = Math.max(top, frame.top);
        left = Math.max(left, frame.left);
        right = Math.min(right, frame.right);
        bottom = Math.min(bottom, frame.bottom);
      }
      at = at.parentElement;
    }
    return { top, left, right, bottom };
  };

  // 1. The page is wider than the screen. Measured against the width of the
  //    device, not window.innerWidth: on a phone the visual viewport widens to
  //    fit content that does not fit, so innerWidth grows with the overflow and
  //    comparing the two always says everything is fine.
  if (document.documentElement.scrollWidth > DEVICE_WIDTH + 1) {
    say('overflow-page', 'the page', document.documentElement.scrollWidth + ' > ' + DEVICE_WIDTH);
  }

  // 2. Something is drawn past the right edge, or off to the left.
  for (const node of controls) {
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    if (box.right > DEVICE_WIDTH + 1 || box.left < -1) {
      say('offscreen', label(node), Math.round(box.left) + '..' + Math.round(box.right)
        + ' of ' + DEVICE_WIDTH);
    }
  }

  // 3. Content bigger than the box holding it - words outside a button, a
  //    figure cut off. A box that scrolls or ellipsises says so in its style.
  for (const node of nodes) {
    if (node.getAttribute('aria-hidden') === 'true' || node.offsetParent === null) continue;
    if (!node.clientWidth || !node.clientHeight) continue;
    if (!visible(node)) continue;
    const style = getComputedStyle(node);
    // Text longer than the box is how a text field works; it scrolls.
    if (/^(INPUT|TEXTAREA)$/.test(node.tagName)) continue;
    const scrolls = /auto|scroll/.test(style.overflowX + style.overflowY);
    const ellipsis = style.textOverflow === 'ellipsis';
    const wide = node.scrollWidth > node.clientWidth + 1;
    const tall = node.scrollHeight > node.clientHeight + 1;
    if (!wide && !tall) continue;
    if (scrolls) continue;
    if (wide && ellipsis) { say('truncated', label(node), node.clientWidth + '<' + node.scrollWidth); continue; }
    say('spill', label(node), node.clientWidth + 'x' + node.clientHeight
      + ' < ' + node.scrollWidth + 'x' + node.scrollHeight + ' [' + node.className + ']');
  }

  // 4. Two things a person can press, on top of each other.
  for (let first = 0; first < controls.length; first += 1) {
    for (let second = first + 1; second < controls.length; second += 1) {
      const a = controls[first];
      const b = controls[second];
      if (a.contains(b) || b.contains(a)) continue;
      const one = clamped(a);
      const two = clamped(b);
      if (one.right <= one.left || two.right <= two.left) continue;
      const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (across > 2 && down > 2) {
        say('overlap', label(a) + ' / ' + label(b), Math.round(across) + 'x' + Math.round(down));
      }
    }
  }

  // 5. A target too small to hit with a finger.
  if (DEVICE_WIDTH < 500) {
    for (const node of controls) {
      if (node.tagName === 'A') continue; // a link in a sentence is not a target
      // A control inside a label is hit by the whole label - that is what a
      // label is for - so the target is the label's box, not the checkbox's.
      const target = node.closest('label') || node;
      const box = target.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      if (box.width < 24 || box.height < 24) {
        say('tiny', label(node), Math.round(box.width) + 'x' + Math.round(box.height));
      }
    }
  }

  // 6. Text too pale to read against what is behind it. The background is
  //    whatever the nearest ancestor actually paints; walking up is the only
  //    way to find it, because most elements paint nothing at all.
  const channel = (value) => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4);
  };
  const luminance = ([red, green, blue]) =>
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  const parse = (colour) => (colour.match(/[\\d.]+/g) || []).map(Number);
  const behind = (node) => {
    let at = node;
    while (at && at !== document.documentElement) {
      const parts = parse(getComputedStyle(at).backgroundColor);
      if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0.95)) return parts.slice(0, 3);
      at = at.parentElement;
    }
    return [255, 255, 255];
  };
  for (const node of nodes) {
    if (node.offsetParent === null || node.getAttribute('aria-hidden') === 'true') continue;
    const own = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
    if (!own || !visible(node)) continue;
    const style = getComputedStyle(node);
    const colour = parse(style.color);
    if (colour.length >= 4 && colour[3] < 0.95) continue;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 600;
    const light = luminance(colour.slice(0, 3));
    const dark = luminance(behind(node));
    const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio + 0.01 < need) {
      say('contrast', node.textContent.trim().slice(0, 30),
        ratio.toFixed(2) + ' < ' + need + ' at ' + Math.round(size) + 'px [' + node.className + ']');
    }
  }

  return findings;
`;

const checks = [];
let rendered = 0;

async function main() {
  const file = resolve(root, process.argv[2] || latestBuild());
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const { cdp, chrome } = await launchChromium();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  const consoleErrors = [];
  cdp.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.exception?.description || 'exception');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      consoleErrors.push(message.params.entry.text);
    }
  });

  console.log(`Sweeping ${file}`);

  // Pass one: every language, theme and layout, on ordinary data. This is the
  // combination that breaks first, because a longer word is all it takes.
  for (const layout of LAYOUTS) {
    for (const language of LANGUAGES) {
      for (const theme of THEMES) {
        await run(cdp, file, { layout, language, theme, data: 'normal' });
      }
    }
  }

  // Pass two: the shapes of data, at the two ends of the layout range. A store
  // full of long names does not care which language the menu is in, but it
  // very much cares whether the window is 390 or 1280 pixels wide.
  for (const data of Object.keys(DATA)) {
    if (data === 'normal') continue;
    await run(cdp, file, { layout: LAYOUTS[0], language: 'en', theme: 'light', data });
    await run(cdp, file, { layout: LAYOUTS[1], language: 'ru', theme: 'dark', data });
  }

  chrome.kill();
  report(consoleErrors);
}

function latestBuild() {
  const dist = join(root, 'dist');
  const names = readdirSync(dist)
    .filter((name) => /^home-budget-\d.*\.html$/.test(name) && !name.endsWith('.min.html'))
    .sort();
  if (!names.length) throw new Error('No build found in dist - run npm run build first');
  return join(dist, names[names.length - 1]);
}

async function run(cdp, file, { layout, language, theme, data }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: layout.width, height: layout.height, deviceScaleFactor: 1, mobile: layout.mobile,
  });
  await cdp.send('Page.navigate', { url: `file://${file}` });
  await sleep(700);
  await cdp.evaluate(`
    const app = window.homeBudget;
    const store = app.store;
    const iso = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    store.resetAll();
    store.updateSettings({ language: '${language}', theme: '${theme}', uiMode: '${layout.mode}' });
    ${DATA[data]}
    app.ui.message = null;
    app.render();
    return true;
  `);

  for (const [view, open] of Object.entries(VIEWS)) {
    const where = `${layout.name}/${language}/${theme}/${data}/${view}`;
    const skipped = await cdp.evaluate(`
      const app = window.homeBudget;
      const pause = (ms) => new Promise((done) => setTimeout(done, ms));
      app.closeDialog();
      app.ui.message = null;
      ${open}
      await pause(250);
      window.scrollTo(0, 0);
      return 'ok';
    `);
    if (skipped === 'skip') continue;
    rendered += 1;
    const findings = await cdp.evaluate(`const DEVICE_WIDTH = ${layout.width};\n${PROBE}`);
    if (findings.length) {
      const name = where.replace(/\//g, '_') + '.png';
      const { data: shot } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, name), Buffer.from(shot, 'base64'));
      for (const finding of findings) checks.push({ where, shot: name, ...finding });
    }
  }
}

function report(consoleErrors) {
  const byKind = new Map();
  for (const finding of checks) {
    if (!byKind.has(finding.kind)) byKind.set(finding.kind, []);
    byKind.get(finding.kind).push(finding);
  }
  const lines = [`# Visual sweep`, '',
    `${rendered} screens rendered: ${LAYOUTS.length} layouts x ${LANGUAGES.length} languages`
    + ` x ${THEMES.length} themes on ordinary data, plus ${Object.keys(DATA).length - 1} shapes of data`
    + ` at both ends of the range, across ${Object.keys(VIEWS).length} screens and dialogs.`, ''];

  if (!checks.length) lines.push('Nothing was flagged.', '');
  for (const [kind, found] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} (${found.length})`, '');
    // One line per distinct thing, with every place it happens behind it.
    const grouped = new Map();
    for (const item of found) {
      const key = `${item.what} | ${item.detail}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.where);
    }
    for (const [key, where] of grouped) {
      lines.push(`- \`${key}\``);
      lines.push(`  - ${where.length} place(s): ${where.slice(0, 6).join(', ')}${where.length > 6 ? ' ...' : ''}`);
    }
    lines.push('');
  }
  if (consoleErrors.length) {
    lines.push('## console', '', ...consoleErrors.slice(0, 10).map((error) => `- ${error}`), '');
  }
  writeFileSync(join(root, 'docs', 'visual-sweep.md'), lines.join('\n'));

  const kinds = [...byKind.entries()].map(([kind, found]) => `${kind}: ${found.length}`).join(', ');
  console.log(`${rendered} screens rendered`);
  console.log(checks.length ? `flagged ${checks.length} - ${kinds}` : 'nothing flagged');
  console.log(`report in docs/visual-sweep.md, screenshots in docs/sweep/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
