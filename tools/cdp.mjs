/**
 * A very small Chrome DevTools Protocol client over Node's built-in WebSocket:
 * enough to start headless Chromium, run expressions in a page and take
 * screenshots. Shared by the browser and the site checks.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Finds a Chrome or Chromium to drive. The checks run on a developer machine, in
 * this project's CI and in a container, so nothing may be hard coded: CHROME_PATH
 * wins, then the usual command names, then a browser Playwright has downloaded.
 */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const candidates = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Playwright keeps its browsers in a versioned folder, so the version is globbed.
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    join(process.env.HOME || '', '.cache', 'ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).filter((item) => item.startsWith('chromium')).sort().reverse()) {
      for (const relative of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const candidate = join(root, name, relative);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export const CHROME = findChrome();

export function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export class Cdp {
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

/** Flags that keep a browser predictable on a CI runner and in a container. */
const FLAGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--hide-scrollbars',
  // CI containers often have a tiny /dev/shm, which crashes the renderer.
  '--disable-dev-shm-usage', '--disable-extensions',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-sync', '--disable-component-update', '--metrics-recording-only',
  '--allow-file-access-from-files',
];

/** Starts a browser once and waits for the DevTools port to answer. */
async function startBrowser(headlessFlag, extraArguments, waitMs) {
  const port = 9333 + Math.floor(Math.random() * 300);
  const args = [headlessFlag, ...FLAGS, `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/hb-chrome-${port}`, ...extraArguments, 'about:blank'];
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // The browser's own output is the only thing that explains a browser which
  // starts and then gives up, so it is kept and shown when the wait runs out.
  let output = '';
  const collect = (chunk) => {
    output = (output + chunk).slice(-4000);
  };
  chrome.stdout.on('data', collect);
  chrome.stderr.on('data', collect);
  // Without this a failed spawn throws an unhandled 'error' event and kills the
  // run with a stack trace instead of a sentence saying what went wrong.
  let failure = null;
  chrome.on('error', (error) => { failure = error.message; });
  chrome.on('exit', (code, signal) => {
    if (code !== 0 && failure === null) failure = `it exited with ${signal || `code ${code}`}`;
  });

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(200);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const { webSocketDebuggerUrl } = await response.json();
      if (webSocketDebuggerUrl) return { chrome, wsUrl: webSocketDebuggerUrl };
    } catch {
      // not up yet
    }
  }
  chrome.kill('SIGKILL');
  return { chrome: null, wsUrl: null, failure, output: output.trim(), args };
}

/**
 * Starts a headless browser and attaches to a fresh tab.
 *
 * The headless flag is tried in both spellings: `--headless=new` is what recent
 * Chrome wants, `--headless` what older builds understand, and a runner may have
 * either. When neither answers, the error carries the browser's own output -
 * without it, "did not answer on the DevTools port" says nothing about why.
 */
export async function launchChromium(extraArguments = []) {
  if (!CHROME) {
    throw new Error('No Chrome or Chromium found. Install one, or point CHROME_PATH at it.');
  }
  const waitMs = Number(process.env.CHROME_TIMEOUT_MS || 30000);
  const attempts = [];
  for (const headlessFlag of ['--headless=new', '--headless']) {
    const result = await startBrowser(headlessFlag, extraArguments, waitMs / 2);
    if (result.wsUrl) {
      const cdp = await Cdp.connect(result.wsUrl);
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
      cdp.sessionId = sessionId;
      return { cdp, chrome: result.chrome };
    }
    attempts.push({ headlessFlag, ...result });
  }

  const detail = attempts.map(({ headlessFlag, failure, output }) => {
    const lines = [`  with ${headlessFlag}: ${failure || 'no answer on the DevTools port'}`];
    if (output) lines.push(...output.split('\n').slice(-12).map((line) => `    ${line}`));
    return lines.join('\n');
  }).join('\n');
  throw new Error(`${CHROME} would not start.\n${detail}\n`
    + '  Set CHROME_PATH to another browser, or CHROME_TIMEOUT_MS higher if it is only slow.');
}
