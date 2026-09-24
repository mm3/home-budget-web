/**
 * Builds the single offline HTML file, and the GitHub Pages site around it.
 *
 *   node tools/build.mjs             -> dist/home-budget-<version>.html   (readable)
 *   node tools/build.mjs --minify    -> dist/home-budget-<version>.min.html
 *   node tools/build.mjs --all       -> both
 *   node tools/build.mjs --plain     -> dist/home-budget.html  (no version in the name)
 *   node tools/build.mjs --site      -> site/  ready to publish on GitHub Pages
 *
 * The version still travels inside every build - in the banner, the title, the
 * meta tag, the footer and the About card - so a file without a version in its
 * name can always say which one it is. A name without the version is what a
 * stable download link ("always the latest") needs.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, minifyCss, minifyJs } from './bundle.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src');
const outputDir = join(root, 'dist');
const siteDir = join(root, 'site');

/** Reads the single version source so the build never disagrees with the app. */
function readVersion() {
  return readConstant('APP_VERSION');
}

/** Reads one string constant out of the single version source. */
function readConstant(name) {
  const text = readFileSync(join(source, 'core', 'version.js'), 'utf8');
  const match = text.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
  if (!match) throw new Error(`${name} not found in src/core/version.js`);
  return match[1];
}

/** Icons the manifest and the service worker refer to, copied into the site. */
const ICONS = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

/** The web app manifest, so the site can be installed to a home screen. */
function manifest(version) {
  return `${JSON.stringify({
    name: 'Home Budget',
    short_name: 'Budget',
    description: 'Offline home budget: entries, categories, statistics, CSV/XLSX/PDF export and import.',
    version,
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7fb',
    theme_color: '#15803d',
    categories: ['finance', 'productivity', 'utilities'],
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2)}\n`;
}

/**
 * A service worker that keeps the whole app in the browser's cache, so the page
 * opens offline and loads instantly. Everything is versioned: a new release
 * uses a new cache and throws the old one away.
 */
function serviceWorker(version) {
  const assets = ['./', './index.html', './manifest.webmanifest', ...ICONS.map((icon) => `./${icon}`)];
  return `/* Home Budget ${version} - offline cache for the GitHub Pages build. */
const CACHE = 'home-budget-${version}';
const ASSETS = ${JSON.stringify(assets)};

// cache.addAll() would go through the browser's HTTP cache, and the page asks to
// be kept for a year, so a new release could cheerfully fill its brand new cache
// with last year's bytes. Every asset is fetched past that cache instead.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => Promise.all(ASSETS.map((asset) => fetch(asset, { cache: 'reload' })
      .then((response) => {
        if (!response || !response.ok) throw new Error('could not fetch ' + asset);
        return cache.put(asset, response);
      }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Cache first: the app is a static file and works without the network. A copy is
// refreshed in the background so the next visit picks up a new release.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // A request that asked to skip the caches is left alone: answering it from
  // this one is exactly what it said not to do. This is how the Update button
  // in the settings gets to see what is really published.
  if (event.request.cache === 'reload' || event.request.cache === 'no-store') return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => {
    const fromNetwork = fetch(event.request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => hit || caches.match('./index.html'));
    return hit || fromNetwork;
  }));
});
`;
}

/** The head snippet that turns the page into an installable app on the site build. */
const SITE_HEAD = `<link rel="canonical" href="${readConstant('SITE_URL')}">
<meta property="og:url" content="${readConstant('SITE_URL')}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
<script>
// Registered only in the published build; the standalone file has no server to ask.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
</script>`;

/**
 * iOS ignores an SVG apple-touch-icon, so the PNG the manifest uses is inlined
 * as well - a file opened from disk and added to a home screen then gets the
 * icon rather than a screenshot of the page.
 */
function appleIcon() {
  const png = readFileSync(join(root, 'assets', 'apple-touch-icon.png'));
  return `data:image/png;base64,${png.toString('base64')}`;
}

function render({ minify, head = '' }) {
  const version = readVersion();
  const { code, moduleCount } = bundle('main.js', source);
  const css = readFileSync(join(source, 'app.css'), 'utf8');
  const template = readFileSync(join(source, 'index.html'), 'utf8');
  const banner = `/*! Home Budget ${version} - offline single file build, no dependencies\n`
    + ` * ${readConstant('REPO_URL')} */\n`;
  const html = template
    .replaceAll('/*VERSION*/', version)
    .replace('/*APPLE_ICON*/', () => appleIcon())
    .replace('<!--MANIFEST-->', () => head)
    .replace('/*STYLES*/', () => `/*! Home Budget ${version} */\n${minify ? minifyCss(css) : css}`)
    .replace('/*SCRIPT*/', () => banner + (minify ? minifyJs(code) : code));
  return { html, version, moduleCount };
}

function build({ minify, plain }) {
  const { html, version, moduleCount } = render({ minify });
  const suffix = minify ? '.min.html' : '.html';
  const fileName = plain ? `home-budget${suffix}` : `home-budget-${version}${suffix}`;
  mkdirSync(outputDir, { recursive: true });
  const target = join(outputDir, fileName);
  writeFileSync(target, html);
  console.log(`${fileName}: ${(html.length / 1024).toFixed(1)} kB from ${moduleCount} modules`
    + `${minify ? ' (minified)' : ''}`);
  return target;
}

/** Lays out everything GitHub Pages serves: the app, the manifest, the worker and the icons. */
function buildSite() {
  const { html, version } = render({ minify: true, head: SITE_HEAD });
  const download = render({ minify: false }).html;
  rmSync(siteDir, { recursive: true, force: true });
  mkdirSync(siteDir, { recursive: true });

  writeFileSync(join(siteDir, 'index.html'), html);
  // The same app under a name that never changes, and one that never moves.
  writeFileSync(join(siteDir, 'home-budget.html'), download);
  writeFileSync(join(siteDir, `home-budget-${version}.html`), download);
  writeFileSync(join(siteDir, 'manifest.webmanifest'), manifest(version));
  writeFileSync(join(siteDir, 'sw.js'), serviceWorker(version));
  // Pages would otherwise run Jekyll over the files and drop anything starting with an underscore.
  writeFileSync(join(siteDir, '.nojekyll'), '');
  // A single page app has no other pages: send every unknown path to the app.
  writeFileSync(join(siteDir, '404.html'), '<!doctype html><meta charset="utf-8">'
    + '<title>Home Budget</title><meta http-equiv="refresh" content="0; url=./">'
    + '<p><a href="./">Home Budget</a></p>\n');
  writeFileSync(join(siteDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  writeFileSync(join(siteDir, 'VERSION'), `${version}\n`);
  for (const icon of ICONS) cpSync(join(root, 'assets', icon), join(siteDir, icon));

  console.log(`site/: index.html ${(html.length / 1024).toFixed(1)} kB, `
    + `home-budget-${version}.html, manifest, service worker and ${ICONS.length} icons`);
  return siteDir;
}

const flags = process.argv.slice(2);
const plain = flags.includes('--plain');
if (flags.includes('--site')) {
  buildSite();
} else if (flags.includes('--all')) {
  build({ minify: false, plain });
  build({ minify: true, plain });
} else {
  build({ minify: flags.includes('--minify'), plain });
}
