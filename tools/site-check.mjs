/**
 * Checks the GitHub Pages build: serves site/ on localhost, opens it in headless
 * Chromium and verifies that the manifest, the icons and the service worker are
 * all in place - and, most importantly, that the page still opens with the
 * network switched off.
 *
 *   node tools/site-check.mjs
 */

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, sleep } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'site');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * A static file server, close enough to what GitHub Pages does - plus two things
 * the update check needs: a count of what was actually asked for, which is how
 * "it went past the cache" is proved rather than assumed, and the ability to
 * publish a different version for a moment without rebuilding the site.
 */
function serve() {
  const hits = new Map();
  const state = { publish: null };
  const server = createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    hits.set(path, (hits.get(path) || 0) + 1);
    const file = join(siteDir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      let body = readFileSync(file);
      if (state.publish && path.endsWith('index.html')) {
        body = Buffer.from(String(body).replace(
          /(name="application-version" content=")[^"]*/,
          `$1${state.publish}`,
        ));
      }
      response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(readFileSync(join(siteDir, '404.html')));
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, hits, state })));
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  const { server, hits, state } = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const { cdp, chrome } = await launchChromium();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  console.log(`Checking ${siteDir} on ${base}`);

  await cdp.send('Page.navigate', { url: base });
  await sleep(1200);

  check('the published page is the app', await cdp.evaluate(
    'return !!document.querySelector(".app-bar") && document.querySelectorAll(".card").length > 2',
  ));

  const manifest = await cdp.evaluate(`
    const link = document.querySelector('link[rel=manifest]');
    const data = await (await fetch(link.href)).json();
    const icons = await Promise.all(data.icons.map(async (icon) => {
      const response = await fetch(new URL(icon.src, link.href));
      return response.ok && response.headers.get('content-type') === 'image/png';
    }));
    return { href: link.getAttribute('href'), name: data.name, start: data.start_url, display: data.display,
             version: data.version, purposes: data.icons.map((icon) => icon.purpose), icons };
  `);
  check('the manifest describes an installable app',
    manifest.name === 'Home Budget' && manifest.start === './' && manifest.display === 'standalone'
      && /^\d+\.\d+\.\d+$/.test(manifest.version),
    JSON.stringify(manifest));
  check('every manifest icon is a real PNG, including a maskable one',
    manifest.icons.every(Boolean) && manifest.purposes.includes('maskable'));

  const worker = await cdp.evaluate(`
    const registration = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const cached = await (await caches.open(names[0])).keys();
    return { scope: registration.scope, names, cached: cached.map((request) => new URL(request.url).pathname) };
  `);
  check('the service worker is registered and its cache is filled',
    worker.names.length === 1 && /^home-budget-\d+\.\d+\.\d+$/.test(worker.names[0])
      && worker.cached.includes('/index.html') && worker.cached.includes('/manifest.webmanifest'),
    JSON.stringify(worker));

  // The Update button. The page asks to be cached for a year and the service
  // worker answers from its own cache first, so the only thing that proves this
  // reached the server is the server saying it was asked.
  const asked = () => hits.get('/index.html') || 0;
  const before = asked();
  const current = await cdp.evaluate(`
    const app = window.homeBudget;
    app.setTab('settings');
    await new Promise((done) => setTimeout(done, 150));
    const button = [...document.querySelectorAll('.update-row button')][0];
    if (!button) return { missing: true };
    button.click();
    await new Promise((done) => setTimeout(done, 700));
    return { toast: (document.querySelector('.toast') || {}).textContent || '', label: button.textContent };
  `);
  check('the update button asks the server rather than the caches',
    !current.missing && asked() > before && /already the published version/i.test(current.toast),
    JSON.stringify({ ...current, requests: asked() - before }));

  // And when something else really is published, it is found and loaded.
  state.publish = '9.9.9';
  await cdp.evaluate(`
    // The last step is watched rather than allowed to happen: a page that
    // reloads takes the evidence with it.
    window.__reloaded = 0;
    window.homeBudget.reloadPage = () => { window.__reloaded += 1; };
    window.__toast = '';
    document.querySelector('.update-row button').click();
    return true;
  `);
  await sleep(1200);
  const found = await cdp.evaluate(`
    return { toast: (document.querySelector('.toast') || {}).textContent || '',
      reloaded: window.__reloaded, caches: (await caches.keys()).length,
      navigation: performance.getEntriesByType('navigation').map((entry) => entry.type).join(',') };
  `);
  state.publish = null;
  check('a version published since this one loaded is found, and the caches go with it',
    /9\.9\.9/.test(found.toast) && found.reloaded === 1 && found.caches === 0
      && found.navigation === 'navigate',
    JSON.stringify(found));

  // Put the service worker and its cache back, so the offline test below is
  // testing the app rather than the wreckage this check left behind. The worker
  // has to be unregistered rather than reloaded: it is still activated, and a
  // cache is only filled by an install, which an activated worker does not
  // repeat just because somebody emptied it.
  await cdp.evaluate(`
    const workers = await navigator.serviceWorker.getRegistrations();
    await Promise.all(workers.map((worker) => worker.unregister()));
    return true;
  `);
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  let refilled = false;
  for (let attempt = 0; attempt < 20 && !refilled; attempt += 1) {
    refilled = await cdp.evaluate(`
      await navigator.serviceWorker.ready;
      const names = await caches.keys();
      if (!names.length) return false;
      const kept = await (await caches.open(names[0])).keys();
      return kept.some((request) => new URL(request.url).pathname.endsWith('/index.html'));
    `);
    if (!refilled) await sleep(300);
  }
  check('the cache fills itself again after it is emptied', refilled);

  // The real test: pull the plug and reload.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  server.close();
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(1500);
  const offline = await cdp.evaluate(`
    return {
      rendered: !!document.querySelector('.app-bar'),
      cards: document.querySelectorAll('.card').length,
      version: (document.querySelector('meta[name=application-version]') || {}).content,
    };
  `);
  check('the page still opens with the network switched off',
    offline.rendered && offline.cards > 2 && /^\d+\.\d+\.\d+$/.test(offline.version),
    JSON.stringify(offline));

  chrome.kill();
  const failed = checks.filter((item) => !item.ok);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
