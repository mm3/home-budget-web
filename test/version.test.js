import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, DATA_VERSION } from '../src/core/version.js';
import { STATE_VERSION } from '../src/core/model.js';

test('the version is a single source of truth', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(packageVersion, APP_VERSION, 'package.json and src/core/version.js must agree');
  assert.equal(STATE_VERSION, DATA_VERSION);
});

test('the build stamps the version into the file name and the bundle', () => {
  const build = readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /home-budget-\$\{version\}/, 'the file name carries the version');
  assert.match(build, /Home Budget \$\{version\}/, 'the bundle banner carries the version');
  assert.match(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), /application-version/);
});
