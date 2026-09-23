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

/** Starts headless Chromium and attaches to a fresh tab. */
export async function launchChromium(extraArguments = []) {
  if (!CHROME) {
    throw new Error('No Chrome or Chromium found. Install one, or point CHROME_PATH at it.');
  }
  const port = 9333 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    // CI containers often have a tiny /dev/shm, which crashes the renderer.
    '--disable-dev-shm-usage', '--disable-extensions',
    '--allow-file-access-from-files', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/hb-chrome-${port}`, ...extraArguments, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  // Without this a failed spawn throws an unhandled 'error' event and kills the run
  // with a stack trace instead of a sentence saying which browser was missing.
  let spawnError = null;
  chrome.on('error', (error) => { spawnError = error; });

  let wsUrl = null;
  for (let attempt = 0; attempt < 50 && !wsUrl; attempt += 1) {
    await sleep(200);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
  }
  if (!wsUrl) {
    chrome.kill();
    throw new Error(spawnError
      ? `Could not start ${CHROME}: ${spawnError.message}`
      : `${CHROME} did not answer on the DevTools port`);
  }
  const cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  cdp.sessionId = sessionId;
  return { cdp, chrome };
}
