/**
 * End-to-end check of a built HTML file in headless Chromium over the DevTools protocol.
 * It exercises the quick form, persistence, all three exports, the import flow, and
 * takes screenshots in mobile and desktop mode.
 *
 *   node tools/browser-check.mjs [dist/home-budget.html] [--shots <dir>]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = resolve(root, args.find((argument) => !argument.startsWith('--')) || 'dist/home-budget.html');
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : join(root, 'dist', 'screenshots');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 9333 + Math.floor(Math.random() * 300);

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = null;
    this.events = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true });
      socket.addEventListener('error', () => fail(new Error('Cannot connect to Chromium')), { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId = this.sessionId) {
    this.id += 1;
    const id = this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((done, fail) => {
      this.pending.set(id, { resolve: done, reject: fail });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          fail(new Error(`Timeout waiting for ${method}`));
        }
      }, 30000);
    });
  }

  /** Runs an expression in the page and returns its value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Page error');
    }
    return result.result.value;
  }
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  mkdirSync(shotDir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/hb-chrome-${PORT}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let wsUrl = null;
  for (let attempt = 0; attempt < 50 && !wsUrl; attempt += 1) {
    await sleep(200);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
  }
  if (!wsUrl) {
    chrome.kill();
    throw new Error('Chromium did not start');
  }

  const cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  cdp.sessionId = sessionId;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const problems = [];
  cdp.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      problems.push(message.params.exceptionDetails.exception?.description || 'exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((argument) => argument.value).join(' '));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      problems.push(message.params.entry.text);
    }
  });

  const open = async () => {
    await cdp.send('Page.navigate', { url: `file://${file}` });
    await sleep(700);
  };

  console.log(`Checking ${file}`);
  await open();
  await cdp.evaluate('localStorage.clear(); location.reload();');
  await sleep(700);

  check('the app renders', await cdp.evaluate('return !!document.querySelector(".app-bar") && document.querySelectorAll(".card").length > 2'));
  check('the quick form only asks for a number', await cdp.evaluate(
    'const inputs = document.querySelectorAll(".quick-form input"); return inputs.length === 1 && inputs[0].type === "number";',
  ));

  const added = await cdp.evaluate(`
    const input = document.getElementById('quick-amount');
    input.value = '12.50';
    document.querySelector('.quick-form button').click();
    await new Promise((done) => setTimeout(done, 100));
    const entries = window.homeBudget.store.entries;
    const toast = document.querySelector('.toast');
    return { count: entries.length, amount: entries[0].amount, category: entries[0].categoryId,
             toast: toast ? toast.textContent : '' };
  `);
  check('quick add books to the default category',
    added.count === 1 && added.amount === 1250 && added.category === 'daily' && /Added/.test(added.toast),
    JSON.stringify(added));

  check('the entry is written to browser storage', await cdp.evaluate(
    'return JSON.parse(localStorage.getItem("home-budget/v1")).entries.length === 1;',
  ));

  await cdp.evaluate(`
    const store = window.homeBudget.store;
    const today = new Date();
    const iso = (offset) => new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
    store.addEntry({ amount: 4500, categoryId: 'groceries', currency: 'EUR', date: iso(1), note: 'Rimi' });
    store.addEntry({ amount: 1900, categoryId: 'transport', currency: 'EUR', date: iso(3), note: 'Bus card' });
    store.addEntry({ amount: 250000, categoryId: 'income', currency: 'EUR', date: iso(6), note: 'Salary' });
    store.addEntry({ amount: 3200, categoryId: 'home', currency: 'EUR', date: iso(20), note: 'Lamp' });
    store.addEntry({ amount: 800, categoryId: 'daily', currency: 'EUR', date: iso(40), note: 'Coffee' });
  `);

  check('charts are drawn', await cdp.evaluate(
    'return document.querySelectorAll(".chart rect").length > 3 && document.querySelectorAll(".donut path").length > 1;',
  ));

  check('the average line is on the chart', await cdp.evaluate(
    'return document.querySelectorAll(".average-line").length === 1 && /avg|average|среднее|Durchschnitt/i.test(document.querySelector(".average-label").textContent);',
  ));

  check('categories show their icons', await cdp.evaluate(
    'return document.querySelectorAll(".category-icon").length > 3;',
  ));

  const budgets = await cdp.evaluate(`
    const store = window.homeBudget.store;
    store.updateCategory('groceries', { limit: 30000 });
    await new Promise((done) => setTimeout(done, 100));
    const rows = [...document.querySelectorAll('.bar-list li')];
    const text = rows.map((row) => row.textContent).join(' | ');
    return { rows: rows.length, text, over: /over|%/.test(text) };
  `);
  check('a category limit shows up as a budget bar', budgets.rows > 0 && /Groceries/.test(budgets.text),
    budgets.text.slice(0, 80));

  const predefined = await cdp.evaluate(
    'return window.homeBudget.store.categories.map((category) => category.id).slice(0, 3).join(",");',
  );
  check('daily, monthly and yearly are predefined', predefined === 'daily,monthly,yearly', predefined);

  const languages = await cdp.evaluate(`
    const store = window.homeBudget.store;
    store.updateSettings({ language: 'ru' });
    await new Promise((done) => setTimeout(done, 100));
    const russian = document.querySelector('.tab').textContent;
    const russianCategory = document.querySelector('.card-head h2').textContent;
    store.updateSettings({ language: 'de' });
    await new Promise((done) => setTimeout(done, 100));
    const german = document.querySelector('.tab').textContent;
    store.updateSettings({ language: 'custom', customTranslation: { 'nav.home': 'Kodu' }, customLanguageName: 'Eesti' });
    await new Promise((done) => setTimeout(done, 100));
    const custom = document.querySelector('.tab').textContent;
    const fallback = document.querySelectorAll('.tab')[1].textContent;
    store.updateSettings({ language: 'en' });
    await new Promise((done) => setTimeout(done, 100));
    return { russian, russianCategory, german, custom, fallback, english: document.querySelector('.tab').textContent };
  `);
  check('the interface switches language',
    languages.russian.includes('Главная') && languages.german.includes('Start')
      && languages.custom.includes('Kodu') && languages.fallback.includes('Entries')
      && languages.english.includes('Home'),
    JSON.stringify(languages));
  check('predefined category names are translated too', /Ежедневные/.test(languages.russianCategory),
    languages.russianCategory);

  const stats = await cdp.evaluate(`
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Stats')).click();
    await new Promise((done) => setTimeout(done, 100));
    const rows = [...document.querySelectorAll('.stats-table tbody tr')].map((row) => row.children[0].textContent);
    return { rows, hasChart: !!document.querySelector('.chart-box.tall svg') };
  `);
  check('statistics show day, week, month and year', stats.rows.length === 4 && stats.hasChart, stats.rows.join(' '));

  const exported = await cdp.evaluate(`
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Entries')).click();
    await new Promise((done) => setTimeout(done, 100));
    const captured = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { captured.push(blob); return original.call(URL, blob); };
    for (const label of ['CSV', 'Excel (.xlsx)', 'PDF']) {
      [...document.querySelectorAll('.transfer button')].find((button) => button.textContent === label).click();
      await new Promise((done) => setTimeout(done, 300));
    }
    URL.createObjectURL = original;
    const csv = await captured[0].text();
    const xlsx = new Uint8Array(await captured[1].arrayBuffer());
    const xlsxText = new TextDecoder('latin1').decode(xlsx);
    const pdf = await captured[2].text();
    return {
      count: captured.length,
      csvHead: csv.split('\\r\\n')[0].replace('\\ufeff', ''),
      csvRows: csv.trim().split('\\r\\n').length,
      xlsxMagic: String.fromCharCode(xlsx[0], xlsx[1]),
      xlsxSize: xlsx.length,
      xlsxHasChart: xlsxText.includes('charts/chart1.xml'),
      pdfHead: pdf.slice(0, 8),
      pdfHasChart: pdf.includes('re f') && pdf.includes('Expenses'),
    };
  `);
  check('CSV export has a header and one row per entry',
    exported.csvHead === 'Date,Category,Type,Amount,Currency,Note' && exported.csvRows === 7, JSON.stringify(exported));
  check('XLSX export is a zip archive', exported.xlsxMagic === 'PK' && exported.xlsxSize > 1000);
  check('PDF export starts with the PDF header', exported.pdfHead.startsWith('%PDF-1.4'));
  check('the spreadsheet contains a chart part', exported.xlsxHasChart);
  check('the PDF contains the drawn chart', exported.pdfHasChart);

  const imported = await cdp.evaluate(`
    const csv = 'Datum;Betrag;Kategorie;Kommentar\\n20.09.2026;-15,75;Groceries;Rimi\\n21.09.2026;-3,20;Pets;Food for the cat\\n';
    const file = new File([csv], 'bank.csv', { type: 'text/csv' });
    const input = document.querySelector('.transfer input[type=file]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 400));
    const preview = document.querySelector('.import-preview');
    const before = window.homeBudget.store.entries.length;
    const button = [...preview.querySelectorAll('button')].find((item) => item.textContent.startsWith('Import'));
    const label = button.textContent;
    button.click();
    await new Promise((done) => setTimeout(done, 300));
    const store = window.homeBudget.store;
    return {
      label,
      added: store.entries.length - before,
      pets: store.categories.some((category) => category.name === 'Pets'),
      amounts: store.entries.filter((entry) => entry.note === 'Rimi' && entry.date === '2026-09-20').map((entry) => entry.amount),
    };
  `);
  check('CSV import detects the columns and adds the entries',
    imported.added === 2 && imported.pets && imported.amounts[0] === 1575, JSON.stringify(imported));

  const translationEditor = await cdp.evaluate(`
    window.homeBudget.setTab('settings');
    await new Promise((done) => setTimeout(done, 150));
    const card = [...document.querySelectorAll('details.card')].find((item) => item.textContent.includes('My own translation'));
    card.open = true;
    const rows = [...card.querySelectorAll('tbody tr')];
    const homeRow = rows.find((row) => row.textContent.includes('nav.home'));
    const input = homeRow.querySelector('input');
    input.value = 'Kodu';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...card.querySelectorAll('button')].find((button) => button.textContent.includes('Use my translation')).click();
    await new Promise((done) => setTimeout(done, 200));
    const tab = document.querySelector('.tab').textContent;
    const stored = JSON.parse(localStorage.getItem('home-budget/v1')).settings;
    window.homeBudget.store.updateSettings({ language: 'en' });
    await new Promise((done) => setTimeout(done, 100));
    return { rows: rows.length, tab, stored: stored.customTranslation['nav.home'], language: stored.language };
  `);
  check('the translation editor stores a user language',
    translationEditor.rows > 100 && translationEditor.tab.includes('Kodu')
      && translationEditor.stored === 'Kodu' && translationEditor.language === 'custom',
    JSON.stringify(translationEditor));

  const persisted = await cdp.evaluate('const count = window.homeBudget.store.entries.length; location.reload(); return count;');
  await sleep(700);
  const afterReload = await cdp.evaluate('return window.homeBudget.store.entries.length;');
  check('data survives a reload', afterReload === persisted, `${persisted} -> ${afterReload}`);

  // screenshots
  const shots = [
    { name: 'desktop-home', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Home' },
    { name: 'desktop-stats', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Stats' },
    { name: 'desktop-entries', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Entries' },
    { name: 'mobile-home', width: 390, height: 844, mobile: true, mode: 'mobile', tab: 'Home' },
    { name: 'mobile-entries', width: 390, height: 844, mobile: true, mode: 'mobile', tab: 'Entries' },
    { name: 'desktop-settings', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Settings' },
    { name: 'desktop-home-ru', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Home', language: 'ru' },
  ];
  for (const shot of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: shot.mobile,
    });
    await cdp.evaluate(`
      const app = window.homeBudget;
      app.store.updateSettings({ uiMode: '${shot.mode}', language: '${shot.language || 'en'}' });
      app.setTab('${shot.tab.toLowerCase()}');
      window.scrollTo(0, 0);
    `);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotDir, `${shot.name}.png`), Buffer.from(data, 'base64'));
  }
  console.log(`  screenshots in ${shotDir}`);

  check('no errors in the browser console', problems.length === 0, problems.slice(0, 3).join(' | '));

  chrome.kill();
  const failed = checks.filter((item) => !item.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
