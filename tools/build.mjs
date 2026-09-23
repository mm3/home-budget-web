/**
 * Builds the single offline HTML file.
 *
 *   node tools/build.mjs            -> dist/home-budget.html      (readable)
 *   node tools/build.mjs --minify   -> dist/home-budget.min.html  (minified)
 *   node tools/build.mjs --all      -> both
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, minifyCss, minifyJs } from './bundle.mjs';

/** Reads the single version source so the build never disagrees with the app. */
function readVersion() {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core', 'version.js'), 'utf8');
  const match = source.match(/APP_VERSION\s*=\s*'([^']+)'/);
  if (!match) throw new Error('APP_VERSION not found in src/core/version.js');
  return match[1];
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src');
const outputDir = join(root, 'dist');

function build({ minify }) {
  const version = readVersion();
  const { code, moduleCount } = bundle('main.js', source);
  const css = readFileSync(join(source, 'app.css'), 'utf8');
  const template = readFileSync(join(source, 'index.html'), 'utf8');
  const banner = `/*! Home Budget ${version} - offline single file build, `
    + `https://github.com/ (no dependencies) */\n`;
  const script = banner + (minify ? minifyJs(code) : code);
  const styles = (minify ? minifyCss(css) : css);
  const html = template
    .replaceAll('/*VERSION*/', version)
    .replace('/*STYLES*/', () => `/*! Home Budget ${version} */\n${styles}`)
    .replace('/*SCRIPT*/', () => script);
  const fileName = minify ? `home-budget-${version}.min.html` : `home-budget-${version}.html`;
  mkdirSync(outputDir, { recursive: true });
  const target = join(outputDir, fileName);
  writeFileSync(target, html);
  const kilobytes = (html.length / 1024).toFixed(1);
  console.log(`${fileName}: ${kilobytes} kB from ${moduleCount} modules${minify ? ' (minified)' : ''}`);
  return target;
}

const flags = process.argv.slice(2);
if (flags.includes('--all')) {
  build({ minify: false });
  build({ minify: true });
} else {
  build({ minify: flags.includes('--minify') });
}
