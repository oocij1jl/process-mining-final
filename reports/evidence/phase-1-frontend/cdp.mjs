// Minimal Chrome DevTools Protocol driver for local UI smoke checks (no dependencies).
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(outDir, port = 9333) {
  mkdirSync(outDir, { recursive: true });
  // Fresh, throwaway profile per run (outside the repository) so localStorage never leaks between runs.
  rmSync(join(outDir, 'profile'), { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(outDir, 'profile')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1500,1000', 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
      logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Page.javascriptDialogOpening') { logs.push(`dialog: ${msg.params.message}`); send('Page.handleJavaScriptDialog', { accept: true }); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Deterministic viewer timezone (date filters and expected values assume KST unless PP_TZ is set).
  await send('Emulation.setTimezoneOverride', { timezoneId: process.env.PP_TZ ?? 'Asia/Seoul' });

  const api = {
    logs,
    send,
    /** Drags with the left mouse button from (x1,y1) to (x2,y2) in viewport coordinates. */
    async drag(x1, y1, x2, y2, steps = 8) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1 });
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(400);
    },
    async go(url) { await send('Page.navigate', { url }); await sleep(1200); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(name, full = false) {
      let clip;
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        const h = await api.eval(`Math.max(...[...document.querySelectorAll('main')].map(e=>e.scrollHeight), document.body.scrollHeight)`);
        clip = { x: 0, y: 0, width: 1500, height: Math.min(h + 60, 4000), scale: 1 };
        await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: clip.height, deviceScaleFactor: 1, mobile: false });
        await sleep(400);
      }
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      if (full) await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
      const file = join(outDir, `${name}.png`); writeFileSync(file, Buffer.from(r.data, 'base64')); return file;
    },
    /** Clicks the first visible button/link/label whose text matches exactly (or includes, if partial). */
    async click(text, { partial = false, selector = 'button, a, label, [role=tab]' } = {}) {
      const ok = await api.eval(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.offsetParent !== null || e.getClientRects().length);
        const t = ${JSON.stringify(text)};
        const el = els.find(e => ${partial} ? e.textContent.trim().includes(t) : e.textContent.trim() === t);
        if (!el) return false; el.click(); return true; })()`);
      if (!ok) throw new Error(`click: no element with text "${text}"`);
      await sleep(500);
    },
    /** Sets a React-controlled input/select found by CSS selector (index n). */
    async set(selector, value, n = 0) {
      const ok = await api.eval(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${n}]; if (!el) return false;
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        return true; })()`);
      if (!ok) throw new Error(`set: no element ${selector}[${n}]`);
      await sleep(400);
    },
    text: () => api.eval('document.querySelector("main").innerText'),
    async close() { try { await send('Browser.close'); } catch {} proc.kill(); },
  };
  return api;
}
