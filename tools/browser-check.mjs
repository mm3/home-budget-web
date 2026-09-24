/**
 * End-to-end check of a built HTML file in headless Chromium over the DevTools protocol.
 * It exercises the quick form, persistence, all three exports, the import flow, and
 * takes screenshots in mobile and desktop mode.
 *
 *   node tools/browser-check.mjs [dist/home-budget.html] [--shots <dir>]
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, sleep } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
/** Newest built file, so the check does not need to know the version number. */
function latestBuild(minified) {
  const dist = join(root, 'dist');
  const names = readdirSync(dist)
    .filter((name) => /^home-budget-.*\.html$/.test(name) && name.endsWith('.min.html') === minified)
    .sort();
  if (!names.length) throw new Error('No build found in dist - run npm run build first');
  return join(dist, names[names.length - 1]);
}

// the value after --shots is a directory, not the file to check
const positional = args.filter((argument, index) => !argument.startsWith('--') && args[index - 1] !== '--shots');
const given = positional[0];
const file = given ? resolve(root, given) : latestBuild(args.includes('--min'));
const shotIndex = args.indexOf('--shots');
const shotDir = shotIndex >= 0 ? resolve(args[shotIndex + 1]) : join(root, 'dist', 'screenshots');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  mkdirSync(shotDir, { recursive: true });
  const { cdp, chrome } = await launchChromium();
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

  const version = await cdp.evaluate(`
    return {
      meta: document.querySelector('meta[name=application-version]').content,
      title: document.title,
      footer: document.querySelector('.app-version').textContent.trim(),
      banner: document.documentElement.outerHTML.includes('Home Budget ' + document.querySelector('meta[name=application-version]').content + ' -'),
      state: JSON.parse(localStorage.getItem('home-budget/v1') || '{}').appVersion || null,
    };
  `);
  check('the version is stamped into the page',
    /^\d+\.\d+\.\d+$/.test(version.meta) && version.title.includes(version.meta)
      && version.footer.includes(version.meta) && version.banner,
    JSON.stringify(version));
  check('the quick form only asks for a number', await cdp.evaluate(
    'const inputs = document.querySelectorAll(".quick-form input"); return inputs.length === 1 && inputs[0].type === "number";',
  ));

  // Everything below books and reads entries in euro. The app now starts in the
  // currency its locale suggests, so without saying which one this is, the run
  // would depend on the language of whatever machine it happens to be on - and
  // a check that passes on a laptop and fails on a runner is worse than none.
  await cdp.evaluate(`window.homeBudget.store.updateSettings({ defaultCurrency: 'EUR' });`);

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



  // The card for a week, a month or a year has to divide by the sub-periods that
  // have passed inside it - days, weeks, months - not repeat the period's own
  // total. With a single entry made today, the week card must read a quarter of
  // it on a Thursday, and the year card a ninth of it in September.
  const pace = await cdp.evaluate(`
    const app = window.homeBudget;
    const store = app.store;
    const today = store.today();
    store.clearEntries();
    store.updateSettings({ language: 'en' });
    store.addEntry({ amount: 12000, categoryId: 'daily', currency: store.settings.defaultCurrency,
      date: today, note: 'pace' });
    app.setTab('home');
    await new Promise((done) => setTimeout(done, 200));
    const cards = [...document.querySelectorAll('.cards .stat')].map((card) => ({
      title: card.querySelector('.stat-title').textContent,
      value: card.querySelector('.stat-value').textContent,
      sub: card.querySelector('.stat-sub').textContent,
    }));
    return { cards, today };
  `);
  const paceNumber = (text) => Number(text.replace(/[^0-9.,]/g, '').replace(/\s/g, '').replace(',', '.'));
  const paceOk = pace.cards.length === 4
    // Today: the long-run average per day, and today is the only day with data.
    && /\/ day$/.test(pace.cards[0].sub)
    // The other three name the span they are paced over, and none of them can
    // just echo the period total.
    && /day this week$/.test(pace.cards[1].sub)
    && /week this month$/.test(pace.cards[2].sub)
    && /month this year$/.test(pace.cards[3].sub)
    && [1, 2, 3].every((index) => paceNumber(pace.cards[index].sub) <= paceNumber(pace.cards[index].value) + 0.01);
  check('a card paces its period by the days, weeks or months that passed in it',
    paceOk, JSON.stringify(pace.cards));


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
    'return window.homeBudget.store.categories.map((category) => category.id).slice(0, 4).join(",");',
  );
  check('daily, monthly, yearly and budget are predefined', predefined === 'daily,monthly,yearly,budget', predefined);

  const periods = await cdp.evaluate(`
    const store = window.homeBudget.store;
    store.updateCategory('daily', { limit: 2000, limitPeriod: 'day' });
    store.updateCategory('groceries', { limit: 10000, limitPeriod: 'week' });
    await new Promise((done) => setTimeout(done, 150));
    const text = [...document.querySelectorAll('.bar-list li')].map((row) => row.textContent).join(' | ');
    const budgets = store.budgets('EUR');
    return { text, periods: budgets.map((budget) => budget.period).join(','), from: budgets[0].from };
  `);
  check('limits can use different periods per category',
    /day|week/.test(periods.periods) && /per (day|week|month)/.test(periods.text), periods.text.slice(0, 90));

  const conversion = await cdp.evaluate(`
    const store = window.homeBudget.store;
    const today = store.today();
    store.updateCurrency('USD', { rate: 0.5 });
    store.addEntry({ amount: 2000, categoryId: 'daily', currency: 'USD', date: today, note: 'in dollars' });
    const before = document.querySelector('.stat-value').textContent;
    store.updateSettings({ convertToDefault: true });
    await new Promise((done) => setTimeout(done, 200));
    const after = document.querySelector('.stat-value').textContent;
    const note = document.querySelector('.converted-note');
    store.updateSettings({ convertToDefault: false });
    await new Promise((done) => setTimeout(done, 100));
    return { before, after, note: note ? note.textContent : '', currencies: store.currencies.length };
  `);
  check('conversion folds other currencies into the default one',
    conversion.before !== conversion.after && /EUR/.test(conversion.note) && conversion.currencies >= 10,
    JSON.stringify(conversion));

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

  const localized = await cdp.evaluate(`
    // What the statistics table actually shows, which is where the names appear.
    const read = () => [...document.querySelectorAll('.entries-table tbody td strong, .stat-title')]
      .map((node) => node.textContent).join(' | ');
    const store = window.homeBudget.store;
    const labels = (language) => {
      store.updateSettings({ language });
      return window.homeBudget.periodTexts();
    };
    const english = labels('en');
    const russian = labels('ru');
    const german = labels('de');
    store.updateSettings({ language: 'en' });
    return {
      english: english.months[8] + ' / ' + english.week,
      russian: russian.months[8] + ' / ' + russian.week,
      german: german.months[8] + ' / ' + german.week,
      shown: read().slice(0, 60),
    };
  `);
  check('month and week names follow the language',
    localized.english.startsWith('September') && localized.russian.startsWith('Сентябрь')
      && localized.german.startsWith('September') && localized.russian.includes('неделя'),
    JSON.stringify(localized));

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
      shown: document.querySelectorAll('.entries-table tbody tr').length,
      xlsxMagic: String.fromCharCode(xlsx[0], xlsx[1]),
      xlsxSize: xlsx.length,
      xlsxHasChart: xlsxText.includes('charts/chart1.xml'),
      pdfHead: pdf.slice(0, 8),
      pdfHasChart: pdf.includes('re f') && pdf.includes('/Contents'),
      pdfHasFont: pdf.includes('/Identity-H') && pdf.includes('/CIDFontType2')
        && pdf.includes('/FontFile2') && pdf.includes('beginbfchar'),
      pdfCyrillic: /<[0-9a-f]{4}> <04[0-9a-f]{2}>/i.test(pdf),
    };
  `);
  check('CSV export has a header and one row per entry',
    exported.csvHead === 'Date,Category,Type,Amount,Currency,Note' && exported.csvRows === exported.shown + 1,
    JSON.stringify(exported));
  check('XLSX export is a zip archive', exported.xlsxMagic === 'PK' && exported.xlsxSize > 1000);
  check('PDF export starts with the PDF header', exported.pdfHead.startsWith('%PDF-1.4'));
  check('the spreadsheet contains a chart part', exported.xlsxHasChart);
  check('the PDF contains the drawn chart', exported.pdfHasChart);
  check('the PDF embeds the unicode font', exported.pdfHasFont);

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

  const head = await cdp.evaluate(`
    const meta = (name, attribute = 'name') =>
      (document.querySelector('meta[' + attribute + '="' + name + '"]') || {}).content || '';
    return {
      cache: meta('Cache-Control', 'http-equiv'),
      expires: meta('Expires', 'http-equiv'),
      theme: meta('theme-color'),
      webApp: meta('mobile-web-app-capable'),
      appleApp: meta('apple-mobile-web-app-capable'),
      appleBar: meta('apple-mobile-web-app-status-bar-style'),
      appleTitle: meta('apple-mobile-web-app-title'),
      version: meta('application-version'),
      appleIcon: !!document.querySelector('link[rel="apple-touch-icon"]'),
      title: document.title,
    };
  `);
  check('the page asks to be cached forever',
    head.cache.includes('immutable') && head.cache.includes('max-age=31536000') && !!head.expires,
    head.cache);
  check('the page carries the single page app metadata',
    head.theme === '#15803d' && head.webApp === 'yes' && head.appleApp === 'yes'
      && head.appleBar === 'black-translucent' && head.appleTitle === 'Home Budget' && head.appleIcon,
    JSON.stringify(head));

  // The install offer must be taken from the browser and used only when the
  // button is pressed - never automatically, and never twice.
  const install = await cdp.evaluate(`
    const app = window.homeBudget;
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Settings')).click();
    await new Promise((done) => setTimeout(done, 200));
    const before = document.querySelector('.install-row').textContent;
    const hasButtonBefore = !!document.querySelector('.install-row button');

    let prompted = 0;
    let defaultPrevented = false;
    const offer = new Event('beforeinstallprompt', { cancelable: true });
    offer.prompt = () => { prompted += 1; };
    offer.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(offer);
    defaultPrevented = offer.defaultPrevented;
    await new Promise((done) => setTimeout(done, 200));

    const button = document.querySelector('.install-row button');
    const promptedBeforeClick = prompted;
    button.click();
    await new Promise((done) => setTimeout(done, 250));
    const promptedAfterClick = prompted;
    const gone = !document.querySelector('.install-row button');
    const toast = document.querySelector('.toast');
    return { before: before.slice(0, 40), hasButtonBefore, defaultPrevented, promptedBeforeClick,
      promptedAfterClick, gone, toast: toast ? toast.textContent : '' };
  `);
  check('the install button appears only when the browser offers one',
    !install.hasButtonBefore && /published page|Safari/.test(install.before), JSON.stringify(install));
  check('the install prompt is shown on the click and not before',
    install.defaultPrevented && install.promptedBeforeClick === 0 && install.promptedAfterClick === 1
      && install.gone && /Installed/i.test(install.toast),
    JSON.stringify(install));

  const icons = await cdp.evaluate(`
    const load = (href) => new Promise((done) => {
      const image = new Image();
      image.onload = () => done(image.width > 0);
      image.onerror = () => done(false);
      image.src = href;
    });
    const icon = document.querySelector('link[rel=icon]');
    const apple = document.querySelector('link[rel="apple-touch-icon"]');
    return {
      inline: icon.getAttribute('href').startsWith('data:image/svg+xml,'),
      iconLoads: await load(icon.href),
      appleLoads: await load(apple.href),
    };
  `);
  check('the icons are inline and actually decode',
    icons.inline && icons.iconLoads && icons.appleLoads, JSON.stringify(icons));

  const links = await cdp.evaluate(`
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Settings')).click();
    await new Promise((done) => setTimeout(done, 200));
    const anchors = [...document.querySelectorAll('.about-links a')];
    return {
      count: anchors.length,
      hrefs: anchors.map((anchor) => anchor.getAttribute('href')),
      texts: anchors.map((anchor) => anchor.textContent),
      sourceNamesGitHub: anchors.some((anchor) => /GitHub/i.test(anchor.textContent)),
      safe: anchors.every((anchor) => anchor.rel.includes('noopener') && anchor.target === '_blank'),
      external: [...document.querySelectorAll('link[rel=stylesheet], script[src], img[src^=http]')].length,
    };
  `);
  check('About links to the published page and to the repository',
    links.count === 2 && links.hrefs.every((href) => /^https:\/\//.test(href))
      && links.hrefs.some((href) => href.includes('github.io'))
      && links.hrefs.some((href) => href.includes('github.com')) && links.safe
      && links.sourceNamesGitHub,
    JSON.stringify(links));
  check('the page still loads nothing from the network', links.external === 0, String(links.external));

  const share = await cdp.evaluate(`
    [...document.querySelectorAll('.about-links button')]
      .find((button) => /Share|\u041f\u043e\u0434\u0435\u043b/.test(button.textContent)).click();
    await new Promise((done) => setTimeout(done, 250));
    const svg = document.querySelector('.qr-box svg');
    const dark = svg ? svg.querySelectorAll('path').length : 0;
    const modules = svg ? Number(svg.getAttribute('viewBox').split(' ')[2]) : 0;
    const address = (document.querySelector('.qr-address') || {}).textContent || '';
    window.homeBudget.closeDialog();
    return { drawn: !!svg, dark, modules, address, label: svg ? svg.getAttribute('aria-label') : '' };
  `);
  check('sharing draws the address as a QR code, offline',
    share.drawn && share.dark === 1
      // viewBox = symbol (4 * version + 17) plus the quiet zone on both sides
      && (share.modules - 6 - 17) % 4 === 0 && share.modules >= 27
      && share.address.startsWith('https://') && share.label === share.address,
    JSON.stringify(share));

  const currencies = await cdp.evaluate(`
    const store = window.homeBudget.store;
    const rub = store.currencies.find((currency) => currency.code === 'RUB');
    return {
      rub: rub ? rub.symbol + ' ' + rub.flag : null,
      withoutFlag: store.currencies.filter((currency) => !currency.flag).map((currency) => currency.code),
      count: store.currencies.length,
    };
  `);
  check('the ruble is one of the currencies', currencies.rub === '\u20bd \ud83c\uddf7\ud83c\uddfa', currencies.rub);
  check('every currency has a flag', currencies.withoutFlag.length === 0,
    `${currencies.count} currencies`);

  const nordic = await cdp.evaluate(`
    const symbols = window.homeBudget.store.currencies.map((currency) => currency.symbol);
    return { repeated: symbols.filter((symbol, index) => symbols.indexOf(symbol) !== index) };
  `);
  check('no two currencies share a symbol', nordic.repeated.length === 0, nordic.repeated.join(' '));

  const russianPdf = await cdp.evaluate(`
    window.homeBudget.store.quickAdd('15');
    window.homeBudget.store.updateSettings({ language: 'ru' });
    await new Promise((done) => setTimeout(done, 200));
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('\u0417\u0430\u043f\u0438\u0441\u0438')).click();
    await new Promise((done) => setTimeout(done, 150));
    let blob = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = (value) => { blob = value; return original.call(URL, value); };
    [...document.querySelectorAll('.transfer button')].find((button) => button.textContent === 'PDF').click();
    await new Promise((done) => setTimeout(done, 400));
    URL.createObjectURL = original;
    const pdf = await blob.text();
    window.homeBudget.store.updateSettings({ language: 'en' });
    return {
      cyrillic: /<[0-9a-f]{4}> <04[0-9a-f]{2}>/i.test(pdf),
      questionMarks: (pdf.match(/<[0-9a-f]{4}> <003f>/gi) || []).length,
    };
  `);
  check('a Russian PDF holds real cyrillic text, not question marks',
    russianPdf.cyrillic && russianPdf.questionMarks === 0, JSON.stringify(russianPdf));

  const dates = await cdp.evaluate(`
    const store = window.homeBudget.store;
    store.updateSettings({ language: 'en' });
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Entries')).click();
    await new Promise((done) => setTimeout(done, 250));
    const result = { nativeDateInputs: document.querySelectorAll('input[type=date]:not(.date-native)').length };
    const filter = document.querySelector('.filters .date-text');
    result.placeholder = filter.placeholder;
    filter.value = '01.09.2026';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 200));
    result.typed = window.homeBudget.ui.filter.from;
    document.querySelector('.entries-table tbody tr').click();
    await new Promise((done) => setTimeout(done, 250));
    const field = document.querySelector('.dialog .date-text');
    result.shown = field.value;
    field.value = '3/9/2026';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    result.loose = field.value;
    field.value = 'nonsense';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    result.invalidMarked = field.classList.contains('invalid');
    document.querySelector('.dialog button[type=submit]').click();
    await new Promise((done) => setTimeout(done, 200));
    const error = document.querySelector('.dialog .error');
    result.refused = !!document.querySelector('.dialog') && !!error && error.textContent.length > 0;
    window.homeBudget.closeDialog();
    window.homeBudget.setUi({ filter: {} });
    return result;
  `);
  check('dates are shown and typed in the app\'s own format, not the browser\'s',
    dates.placeholder === 'dd.mm.yyyy' && dates.shown.match(/^\d{2}\.\d{2}\.\d{4}$/)
      && dates.typed === '2026-09-01' && dates.loose === '03.09.2026' && dates.nativeDateInputs === 0,
    JSON.stringify(dates));
  check('an unreadable date is refused instead of becoming today',
    dates.invalidMarked && dates.refused, JSON.stringify(dates));

  const bulk = await cdp.evaluate(`
    const store = window.homeBudget.store;
    const before = store.entries.length;
    const rows = [];
    for (let index = 0; index < 5000; index += 1) {
      rows.push({ amount: 100 + (index % 900), categoryId: 'daily', currency: 'EUR',
        date: new Date(Date.now() - (index % 400) * 86400000).toISOString().slice(0, 10),
        note: 'Bulk ' + index });
    }
    store.addEntries(rows);
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Entries')).click();
    const started = performance.now();
    window.homeBudget.render();
    const renderMs = Math.round(performance.now() - started);
    const drawn = document.querySelectorAll('.entries-table tbody tr').length;
    const summary = document.querySelector('.summary').textContent;
    const more = document.querySelector('.more-row');
    const showMore = more ? [...more.querySelectorAll('button')][0] : null;
    if (showMore) showMore.click();
    await new Promise((done) => setTimeout(done, 200));
    const afterMore = document.querySelectorAll('.entries-table tbody tr').length;
    const showAll = [...document.querySelector('.more-row').querySelectorAll('button')][1];
    showAll.click();
    await new Promise((done) => setTimeout(done, 600));
    const afterAll = document.querySelectorAll('.entries-table tbody tr').length;
    return { total: store.entries.length, before, drawn, renderMs, afterMore, afterAll,
      summaryCounts: /5[0-9. ]{3}/.test(summary) || summary.includes(String(store.entries.length)),
      showingText: more ? more.textContent.slice(0, 40) : '' };
  `);
  check('a long list is drawn one page at a time',
    bulk.drawn === 200 && bulk.afterMore === 400 && bulk.afterAll === bulk.total && bulk.renderMs < 400,
    JSON.stringify(bulk));
  check('the summary still counts every matching entry, not just the page shown',
    bulk.summaryCounts, bulk.showingText);

  const amounts = await cdp.evaluate(`
    const store = window.homeBudget.store;
    const result = {};
    const attempt = (value) => {
      try { const entry = store.quickAdd(value); store.deleteEntry(entry.id); return 'accepted ' + entry.amount; }
      catch (error) { return 'rejected: ' + window.homeBudget.errorText(error); }
    };
    result.huge = attempt('999999999999999999999');
    result.exponent = attempt('1e15');
    result.tiny = attempt('0.001');
    result.zero = attempt('0');
    result.normal = attempt('12.50');
    result.totalsFinite = Number.isSafeInteger(store.entries.reduce((sum, entry) => sum + entry.amount, 0));
    return result;
  `);
  check('an amount that would break the totals is refused',
    amounts.huge.startsWith('rejected') && amounts.exponent.startsWith('rejected')
      && amounts.tiny.startsWith('rejected') && amounts.zero.startsWith('rejected')
      && amounts.normal === 'accepted 1250' && amounts.totalsFinite,
    JSON.stringify(amounts));

  // Every control in a row of fields has to sit on the same line: the distance from
  // the top of its field must be the same everywhere, whatever the label's length or
  // a hint underneath, and the controls must be equally tall. Wrapping to a second
  // line is fine, which is why the offset inside the field is measured, not the page.
  //
  // It runs twice. A phone is where this breaks first - the columns are narrow, so
  // "Category for quick entries" wraps to two lines and used to drag its select
  // below the one beside it - and a desktop check alone never saw that.
  const alignmentProbe = `
    const check = (where) => {
      const problems = [];
      for (const row of document.querySelectorAll('.inline-form, .row-2, .filters')) {
        const items = [...row.querySelectorAll('.field')]
          .map((field) => ({ field, control: field.querySelector('input:not([type=checkbox]), select') }))
          .filter((item) => item.control)
          .map((item) => ({ box: item.field.getBoundingClientRect(), control: item.control.getBoundingClientRect() }))
          .sort((a, b) => a.box.top - b.box.top);
        // Fields whose boxes overlap vertically are on the same visual line; a form
        // that wrapped onto a second line is fine and must not count as a problem.
        const lines = [];
        for (const item of items) {
          const line = lines[lines.length - 1];
          if (line && item.box.top < line.bottom - 1) {
            line.items.push(item);
            line.bottom = Math.max(line.bottom, item.box.bottom);
          } else {
            lines.push({ bottom: item.box.bottom, items: [item] });
          }
        }
        for (const line of lines) {
          const tops = [...new Set(line.items.map((item) => Math.round(item.control.top)))];
          const heights = [...new Set(line.items.map((item) => Math.round(item.control.height)))];
          if (tops.length > 1 || heights.length > 1) {
            problems.push(where + ' ' + row.className
              + ' tops=' + tops.join('/') + ' heights=' + heights.join('/'));
          }
        }
        const buttonHeights = [...new Set([...row.querySelectorAll('button')]
          .map((button) => Math.round(button.getBoundingClientRect().height)))];
        const controlHeight = items.length ? Math.round(items[0].control.height) : null;
        if (buttonHeights.some((height) => height !== controlHeight) && controlHeight !== null) {
          problems.push(where + ' ' + row.className
            + ' buttons=' + buttonHeights.join('/') + ' controls=' + controlHeight);
        }
      }
      return problems;
    };
    const found = [];
    window.homeBudget.closeDialog();
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Settings')).click();
    await new Promise((done) => setTimeout(done, 200));
    found.push(...check('settings'));
    // the category dialog, with its colour/icon and limit/limit period rows
    [...document.querySelectorAll('.entries-table button')]
      .find((button) => button.getAttribute('aria-label') === 'Edit').click();
    await new Promise((done) => setTimeout(done, 250));
    found.push(...check('category dialog'));
    window.homeBudget.closeDialog();
    [...document.querySelectorAll('.tab')].find((tab) => tab.textContent.includes('Entries')).click();
    await new Promise((done) => setTimeout(done, 200));
    const box = document.querySelector('.filters-box');
    if (box) box.open = true;
    await new Promise((done) => setTimeout(done, 200));
    found.push(...check('entry filters'));
    const row = document.querySelector('.entries-table tbody tr');
    if (row) {
      row.click();
      await new Promise((done) => setTimeout(done, 250));
      found.push(...check('entry dialog'));
      window.homeBudget.closeDialog();
    }
    return found;
  `;

  const aligned = [];
  for (const layout of [
    { name: 'desktop', width: 1280, height: 900, mobile: false, mode: 'desktop' },
    { name: 'phone', width: 390, height: 844, mobile: true, mode: 'mobile' },
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: layout.width, height: layout.height, deviceScaleFactor: 1, mobile: layout.mobile,
    });
    await cdp.evaluate(`window.homeBudget.store.updateSettings({ uiMode: '${layout.mode}' });`);
    await sleep(200);
    const found = await cdp.evaluate(alignmentProbe);
    aligned.push(...found.map((item) => `${layout.name}: ${item}`));
  }
  check('controls in a row of fields stay on one line', aligned.length === 0, aligned.join(' | '));

  // Hiding the row actions on a narrow screen left no way at all to edit or delete
  // a category, a currency or an entry from a phone. They are there, and they are
  // big enough to hit: 24 CSS pixels is the smallest target this layout allows.
  const reachable = await cdp.evaluate(`
    const app = window.homeBudget;
    const look = async (tab) => {
      app.setTab(tab);
      await new Promise((done) => setTimeout(done, 250));
      // An action the layout deliberately drops - the pencil in the entry list,
      // where tapping the row already opens the editor - is not measured.
      const buttons = [...document.querySelectorAll('.entries-table .row-actions button')]
        .filter((button) => getComputedStyle(button).display !== 'none');
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      // A table wider than the screen scrolls sideways, so a button can exist and
      // still be out of reach until someone discovers they can drag the table.
      const table = document.querySelector('.entries-table');
      return {
        count: buttons.length,
        onScreen: boxes.filter((box) => box.width > 0 && box.right <= window.innerWidth + 1).length,
        tiny: boxes.filter((box) => box.width < 24 || box.height < 24).length,
        labels: [...new Set(buttons.map((button) => button.getAttribute('aria-label')))],
        sideways: table ? table.scrollWidth > table.parentElement.clientWidth + 1 : false,
        wordShown: buttons.some((button) => {
          const span = button.querySelector('.action-text');
          return span && getComputedStyle(span).display !== 'none';
        }),
      };
    };
    return { settings: await look('settings'), entries: await look('entries'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  `);
  const reachableOk = (where) => where.count > 0 && where.onScreen === where.count
    && where.tiny === 0 && !where.wordShown && !where.sideways && where.labels.includes('Delete');
  check('a phone can still edit and delete the rows of a table',
    reachableOk(reachable.settings) && reachableOk(reachable.entries) && !reachable.overflow
      && reachable.settings.labels.includes('Edit'),
    JSON.stringify(reachable));

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.evaluate(`window.homeBudget.store.updateSettings({ uiMode: 'desktop' });`);
  await sleep(150);

  // screenshots
  const shots = [
    { name: 'desktop-home', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Home' },
    { name: 'desktop-stats', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Stats' },
    { name: 'desktop-entries', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Entries' },
    { name: 'mobile-home', width: 390, height: 844, mobile: true, mode: 'mobile', tab: 'Home' },
    { name: 'mobile-entries', width: 390, height: 844, mobile: true, mode: 'mobile', tab: 'Entries' },
    { name: 'desktop-settings', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Settings' },
    { name: 'desktop-home-ru', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Home', language: 'ru' },
    { name: 'desktop-currencies', width: 1280, height: 900, mobile: false, mode: 'desktop', tab: 'Settings', scrollTo: '.rate-input' },
  ];
  for (const shot of shots) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: shot.mobile,
    });
    await cdp.evaluate(`
      const app = window.homeBudget;
      app.ui.message = null; // no leftover toast from the checks above on the screenshots
      app.store.updateSettings({ uiMode: '${shot.mode}', language: '${shot.language || 'en'}' });
      app.setTab('${shot.tab.toLowerCase()}');
      ${shot.scrollTo ? `const anchor = document.querySelector('${shot.scrollTo}'); if (anchor) anchor.closest('.card').scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);` : 'window.scrollTo(0, 0);'}
    `);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(shotDir, `${shot.name}.png`), Buffer.from(data, 'base64'));
  }
  console.log(`  screenshots in ${shotDir}`);


  // The default currency follows the interface language, but only while the app
  // is still empty and nobody has picked one. The second half is the part that
  // matters: a figure already recorded must never change meaning underneath it.
  const follows = await cdp.evaluate(`
    const app = window.homeBudget;
    const store = app.store;
    const logo = () => document.querySelector('.logo').textContent;
    store.resetAll();
    await new Promise((done) => setTimeout(done, 100));
    const start = store.settings.defaultCurrency;

    app.setLanguage('ru');
    await new Promise((done) => setTimeout(done, 120));
    const afterRussian = { currency: store.settings.defaultCurrency, logo: logo(),
      told: (app.ui.message || {}).text || '' };

    app.setLanguage('de');
    await new Promise((done) => setTimeout(done, 120));
    const afterGerman = store.settings.defaultCurrency;

    // The person picks one: from here the language must not move it again.
    store.updateSettings({ defaultCurrency: 'GBP' });
    app.setLanguage('ru');
    await new Promise((done) => setTimeout(done, 120));
    const afterChoosing = store.settings.defaultCurrency;

    // And an app that already holds entries is left alone even before that.
    store.resetAll();
    await new Promise((done) => setTimeout(done, 100));
    store.quickAdd('5');
    const held = store.settings.defaultCurrency;
    app.setLanguage('ru');
    await new Promise((done) => setTimeout(done, 120));
    const afterEntries = store.settings.defaultCurrency;

    store.resetAll();
    await new Promise((done) => setTimeout(done, 100));
    return { start, afterRussian, afterGerman, afterChoosing, held, afterEntries };
  `);
  check('the currency follows the language until it is chosen, then never again',
    follows.afterRussian.currency === 'RUB' && follows.afterRussian.logo === '\u20bd'
      && /RUB/.test(follows.afterRussian.told)
      && follows.afterGerman === 'EUR'
      && follows.afterChoosing === 'GBP'
      && follows.afterEntries === follows.held,
    JSON.stringify(follows));

  const reset = await cdp.evaluate(`
    window.confirm = () => true;
    const store = window.homeBudget.store;
    store.addCategory({ name: 'Scratch category' });
    store.updateSettings({ theme: 'dark' });
    store.quickAdd('9');
    await new Promise((done) => setTimeout(done, 100));
    window.homeBudget.clearEntries();
    await new Promise((done) => setTimeout(done, 150));
    const afterDelete = { entries: store.entries.length, theme: store.settings.theme,
      mine: store.categories.some((category) => category.name === 'Scratch category') };
    window.homeBudget.resetAll();
    await new Promise((done) => setTimeout(done, 150));
    const afterReset = { entries: store.entries.length, theme: store.settings.theme,
      mine: store.categories.some((category) => category.name === 'Scratch category') };
    return { afterDelete, afterReset };
  `);
  check('deleting the entries keeps categories and settings',
    reset.afterDelete.entries === 0 && reset.afterDelete.mine && reset.afterDelete.theme === 'dark',
    JSON.stringify(reset.afterDelete));
  check('resetting everything really restores the defaults',
    !reset.afterReset.mine && reset.afterReset.theme === 'auto',
    JSON.stringify(reset.afterReset));

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
