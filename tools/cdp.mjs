/**
 * A very small Chrome DevTools Protocol client over Node's built-in WebSocket:
 * enough to start headless Chromium, run expressions in a page and take
 * screenshots. Shared by the browser and the site checks.
 */

import { spawn } from 'node:child_process';

export const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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
  const port = 9333 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files', `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/hb-chrome-${port}`, ...extraArguments, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

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
    throw new Error('Chromium did not start');
  }
  const cdp = await Cdp.connect(wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, null);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, null);
  cdp.sessionId = sessionId;
  return { cdp, chrome };
}
