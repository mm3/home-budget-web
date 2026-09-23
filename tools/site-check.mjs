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

/** A static file server, close enough to what GitHub Pages does. */
function serve() {
  const server = createServer((request, response) => {
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(siteDir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(readFileSync(join(siteDir, '404.html')));
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function main() {
  const server = await serve();
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
