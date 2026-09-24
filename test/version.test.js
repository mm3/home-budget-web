import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, DATA_VERSION, REPO_URL, SITE_URL } from '../src/core/version.js';
import { STATE_VERSION } from '../src/core/model.js';

test('the version is a single source of truth', () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal(packageVersion, APP_VERSION, 'package.json and src/core/version.js must agree');
  assert.equal(STATE_VERSION, DATA_VERSION);
});

// The major version says which document format the app writes, so someone with
// a backup file can tell from the number alone which releases will read it.
// Raising DATA_VERSION without raising the major version - or the other way
// round - breaks that promise quietly, so it breaks this test loudly instead.
test('the major version is the data version', () => {
  assert.equal(Number(APP_VERSION.split('.')[0]), DATA_VERSION,
    'raise the major version with DATA_VERSION, and DATA_VERSION with the major version');
});

test('the build stamps the version into the file name and the bundle', () => {
  const build = readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /home-budget-\$\{version\}/, 'the file name carries the version');
  assert.match(build, /Home Budget \$\{version\}/, 'the bundle banner carries the version');
  assert.match(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), /application-version/);
});

test('the published addresses are well formed and point at the same project', () => {
  for (const url of [REPO_URL, SITE_URL]) {
    assert.doesNotThrow(() => new URL(url), `${url} is not a URL`);
    assert.ok(url.startsWith('https://'), `${url} is not https`);
  }
  assert.ok(SITE_URL.endsWith('/'), 'the site address ends with a slash, so links resolve against it');
  assert.ok(!REPO_URL.endsWith('/'), 'the repository address has no trailing slash');
  const project = REPO_URL.split('/').pop();
  assert.ok(SITE_URL.includes(project), `${SITE_URL} and ${REPO_URL} name different projects`);
});
