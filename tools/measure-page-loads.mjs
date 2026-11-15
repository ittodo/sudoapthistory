#!/usr/bin/env node
// Measure representative page loads on the production site (read-only).
// Drives a locally installed Chrome or Edge over the Chrome DevTools Protocol.
// No npm dependency: Node's built-in fetch and WebSocket are used.
//
// Usage: node tools/measure-page-loads.mjs [--base URL] [--only a,b] [--json FILE]
//        [--gap-ms N] [--idle-ms N] [--timeout-ms N] [--chrome PATH] [--headed]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const BLOCKED_URLS = ['*/api/analytics/*', '*google-analytics.com*', '*googletagmanager.com*',
  '*doubleclick.net*', '*googlesyndication.com*', '*adservice.google.*'];
const DEFAULTS = { base: 'https://nodostream.com', gapMs: 3000, idleMs: 2500, timeoutMs: 60000 };

// Each scenario opens one screen. `ready` is a page expression that becomes true
// when the first data is visible. `action` (optional) runs after the page is idle;
// only the requests after the action are counted for that scenario.
// On desktop, /apartment/ redirects to the home page and opens the detail in an iframe.
// The detail is ready when the complex name and the first panel are shown.
const APARTMENT_DOC = `(document.querySelector('iframe[src*="/apartment/"]')?.contentDocument || document)`;
const APARTMENT_READY = `(d => !d.getElementById('apartment-content')?.hidden && !!d.getElementById('apartment-name')?.textContent.trim())(${APARTMENT_DOC})`;

export const SCENARIOS = [
  {
    id: 'map-first',
    title: '지도 첫 화면',
    url: '/map/',
    ready: `!!document.querySelector('.leaflet-marker-icon, .leaflet-interactive, .map-label, .cluster')`,
  },
  {
    id: 'map-move',
    title: '지역 이동(강남→해운대)',
    url: '/map/#lat=37.4979&lng=127.0276&z=17',
    action: `location.hash='lat=35.1631&lng=129.1636&z=17'`,
    ready: `!!document.querySelector('.leaflet-marker-icon, .leaflet-interactive, .map-label, .cluster')`,
  },
  {
    id: 'apartment-detail',
    title: '단지 상세(개요)',
    url: '/apartment/?id=pub_c80832be42a10589affe8e8d&area=85',
    ready: APARTMENT_READY,
  },
  {
    id: 'apartment-rent',
    title: '전월세 상세',
    url: '/apartment/?id=pub_c80832be42a10589affe8e8d&area=85&tab=rent',
    ready: `${APARTMENT_READY} && /\\d{4}[.-]\\d{1,2}/.test(${APARTMENT_DOC}.getElementById('apartment-panel')?.innerText || '')`,
  },
  {
    id: 'officetel-contracts',
    title: '오피스텔 계약(전월세, 강남구)',
    url: '/trades/contracts.html?property=officetel&category=all-rent&lawd=11680',
    ready: `!!document.querySelector('table tbody tr')`,
  },
  {
    id: 'officetel-sale',
    title: '오피스텔 계약(매매, 강남구)',
    url: '/trades/contracts.html?property=officetel&category=sale&lawd=11680',
    ready: `!!document.querySelector('table tbody tr')`,
  },
  {
    id: 'apartment-contracts',
    title: '아파트 계약(전월세, 강남구)',
    url: '/trades/contracts.html?property=apartment&category=all-rent&lawd=11680',
    ready: `!!document.querySelector('table tbody tr')`,
  },
  {
    id: 'rowhouse-contracts',
    title: '연립 계약(전월세, 강남구)',
    url: '/trades/contracts.html?property=rowhouse&category=all-rent&lawd=11680',
    ready: `!!document.querySelector('table tbody tr')`,
  },
  {
    id: 'stock-detail',
    title: '종목 상세(005930)',
    url: '/div/stocks/detail.html?code=005930',
    ready: `!!document.querySelector('table tbody tr, canvas')`,
  },
  {
    id: 'dividend-list',
    title: '배당 목록',
    url: '/div/',
    ready: `document.getElementById('loading')?.style.display === 'none' && !!document.getElementById('calGrid')?.children.length`,
  },
];

function parseArgs(argv) {
  const opts = { ...DEFAULTS, only: null, json: null, chrome: process.env.CHROME_PATH || null, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--base') opts.base = next().replace(/\/$/, '');
    else if (a === '--only') opts.only = new Set(next().split(','));
    else if (a === '--json') opts.json = next();
    else if (a === '--gap-ms') opts.gapMs = Number(next());
    else if (a === '--idle-ms') opts.idleMs = Number(next());
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next());
    else if (a === '--chrome') opts.chrome = next();
    else if (a === '--headed') opts.headed = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function findChrome(explicit) {
  const candidates = [explicit,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Chrome/Edge not found. Set CHROME_PATH or pass --chrome.');
  return found;
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Set();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(h) { this.handlers.add(h); return () => this.handlers.delete(h); }
  close() { this.ws.close(); }
}

async function launchChrome(path, headed) {
  const profile = mkdtempSync(join(tmpdir(), 'measure-pages-'));
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--window-size=1440,900', 'about:blank'];
  if (!headed) args.unshift('--headless=new');
  const proc = spawn(path, args, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('Chrome did not open a DevTools port');
  const [port, wsPath] = readFileSync(portFile, 'utf8').split('\n');
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath.trim()}`);
  const stop = async () => {
    try { await cdp.send('Browser.close'); } catch { /* already closed */ }
    cdp.close();
    await new Promise(r => { if (proc.exitCode !== null) r(); else { proc.once('exit', r); setTimeout(r, 5000); } });
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold files briefly */ }
  };
  return { cdp, stop };
}

function classify(url, type) {
  const path = new URL(url).pathname;
  if (path.startsWith('/data/') || path.startsWith('/api/')) return 'data';
  if (type === 'Script' || type === 'Stylesheet' || /\.(m?js|css)$/.test(path)) return 'code';
  return 'other';
}

// Records network traffic of a page and of the workers it starts.
class Recorder {
  constructor(cdp, origin) {
    this.cdp = cdp; this.origin = origin; this.sessions = new Set(); this.reset();
    cdp.on(msg => this.handle(msg));
  }
  reset() { this.requests = new Map(); this.blockedWrites = []; this.t0 = performance.now(); this.lastActivity = this.t0; }
  key(msg) { return `${msg.sessionId}:${msg.params.requestId}`; }
  // An EventSource stream stays open, and a request of a removed iframe may never
  // report its end. Neither may block the idle check, so ignore requests older than 15 s.
  inflight() {
    const age = performance.now() - this.t0 - 15000; let n = 0;
    for (const r of this.requests.values()) if (!r.done && r.type !== 'EventSource' && r.start > age) n++;
    return n;
  }
  async attach(sessionId) {
    this.sessions.add(sessionId);
    await this.cdp.send('Network.enable', {}, sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
    // Keep the run read-only: block analytics and every API call that is not GET/HEAD
    // (page views, apartment view events and other writes).
    await this.cdp.send('Network.setBlockedURLs', { urls: BLOCKED_URLS }, sessionId);
    await this.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] }, sessionId).catch(() => {});
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  }
  async handle(msg) {
    const { method, params } = msg;
    if (method === 'Target.attachedToTarget') {
      const sid = params.sessionId;
      try { if (['worker', 'shared_worker', 'service_worker'].includes(params.targetInfo.type)) await this.attach(sid); }
      catch { /* worker ended */ }
      try { await this.cdp.send('Runtime.runIfWaitingForDebugger', {}, sid); } catch { /* ignore */ }
      return;
    }
    if (!this.sessions.has(msg.sessionId)) return;
    if (method === 'Fetch.requestPaused') {
      const read = ['GET', 'HEAD', 'OPTIONS'].includes(params.request.method);
      if (!read) this.blockedWrites.push(`${params.request.method} ${params.request.url}`);
      await this.cdp.send(read ? 'Fetch.continueRequest' : 'Fetch.failRequest',
        read ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }, msg.sessionId).catch(() => {});
      return;
    }
    const now = performance.now();
    if (method === 'Network.requestWillBeSent') {
      const u = params.request.url;
      if (!/^https?:/.test(u)) return;
      const k = this.key(msg);
      const prev = this.requests.get(k);
      // A redirect reuses the request id: count the hop as its own request.
      if (prev && params.redirectResponse) { prev.done = true; prev.status = params.redirectResponse.status; this.requests.set(`${k}#${now}`, prev); }
      this.requests.set(k, { url: u, type: params.type, start: now - this.t0, done: false, bytes: 0, status: 0, cache: null });
      this.lastActivity = now;
    } else if (method === 'Network.responseReceived') {
      const r = this.requests.get(this.key(msg)); if (!r) return;
      r.status = params.response.status; r.type = params.type || r.type;
      r.cache = params.response.fromDiskCache ? 'disk' : params.response.fromServiceWorker ? 'sw'
        : params.response.fromPrefetchCache ? 'prefetch' : (params.response.status === 304 ? 'revalidated' : null);
      this.lastActivity = now;
    } else if (method === 'Network.requestServedFromCache') {
      // A memory-cache hit may not send loadingFinished.
      const r = this.requests.get(this.key(msg)); if (r) { r.cache = 'memory'; r.done = true; r.end ??= now - this.t0; }
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      const r = this.requests.get(this.key(msg)); if (!r) return;
      r.done = true; r.end = now - this.t0; r.bytes = params.encodedDataLength || 0;
      if (params.blockedReason || params.errorText === 'net::ERR_BLOCKED_BY_CLIENT') r.blocked = true;
      if (method === 'Network.loadingFailed') r.failed = params.errorText;
      this.lastActivity = now;
    }
  }
  summary() {
    const list = [...this.requests.values()];
    const out = { requests: list.length, network: 0, cached: 0, bytes: { data: 0, code: 0, other: 0, total: 0 },
      dataFiles: [], failed: [] };
    for (const r of list) {
      const cls = classify(r.url, r.type);
      if (r.cache) out.cached++; else out.network++;
      out.bytes[cls] += r.bytes; out.bytes.total += r.bytes;
      if (r.blocked) { out.requests--; if (r.cache) out.cached--; else out.network--; continue; }
      if (r.failed && r.failed !== 'net::ERR_ABORTED') out.failed.push(`${r.url} ${r.failed}`);
      if (cls === 'data') {
        if (r.status >= 200 && r.status < 400 && r.end != null)
          out.firstDataMs = Math.min(out.firstDataMs ?? Infinity, Math.round(r.end));
        const u = new URL(r.url);
        out.dataFiles.push({ path: u.origin === this.origin ? u.pathname + u.search : r.url, bytes: r.bytes,
          status: r.status, cache: r.cache, startMs: Math.round(r.start) });
      }
    }
    out.dataFiles.sort((a, b) => a.startMs - b.startMs);
    out.blockedWrites = [...new Set(this.blockedWrites.map(w => w.replace(/\?.*/, '')))];
    out.pending = list.filter(r => !r.done && r.type !== 'EventSource').map(r => `${r.type} ${r.url}`);
    return out;
  }
}

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) return undefined;
  return res.result.value;
}

// Wait for the ready expression and then for network idle.
async function waitForLoad(cdp, sessionId, rec, ready, opts) {
  let readyMs = null;
  const deadline = rec.t0 + opts.timeoutMs;
  while (performance.now() < deadline) {
    if (readyMs === null && ready && await evaluate(cdp, sessionId, `(()=>{try{return ${ready}}catch{return false}})()`).catch(() => false))
      readyMs = Math.round(performance.now() - rec.t0);
    const idleFor = performance.now() - rec.lastActivity;
    if ((readyMs !== null || !ready) && rec.inflight() === 0 && idleFor >= opts.idleMs) break;
    await sleep(100);
  }
  return { readyMs, timedOut: performance.now() >= deadline };
}

async function runVisit(cdp, sessionId, rec, scenario, opts) {
  const url = opts.base + scenario.url;
  await cdp.send('Page.navigate', { url: 'about:blank' }, sessionId);
  await sleep(200);
  if (scenario.action) {
    // Open the start screen without counting it, then measure only the action.
    rec.reset();
    await cdp.send('Page.navigate', { url }, sessionId);
    await waitForLoad(cdp, sessionId, rec, scenario.ready, opts);
    rec.reset();
    await evaluate(cdp, sessionId, scenario.action);
  } else {
    rec.reset();
    await cdp.send('Page.navigate', { url }, sessionId);
  }
  // After an action the old markers are still on screen; use the first data response instead.
  const ready = scenario.action ? null : scenario.ready;
  const { readyMs, timedOut } = await waitForLoad(cdp, sessionId, rec, ready, opts);
  const summary = rec.summary();
  const finalUrl = await evaluate(cdp, sessionId, 'location.href');
  return { finalUrl, readyMs: ready ? readyMs : summary.firstDataMs, readyBy: ready ? 'dom' : 'first-data-response', timedOut, ...summary };
}

async function measureScenario(cdp, scenario, opts) {
  const origin = new URL(opts.base).origin;
  // A new browser context has an empty HTTP cache, Cache Storage and localStorage.
  const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const rec = new Recorder(cdp, origin);
  try {
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await rec.attach(sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    const cold = await runVisit(cdp, sessionId, rec, scenario, opts);
    await sleep(opts.gapMs);
    const warm = await runVisit(cdp, sessionId, rec, scenario, opts);
    return { id: scenario.id, title: scenario.title, url: scenario.url, cold, warm };
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

const kb = n => (n / 1024).toFixed(1);

function printTable(results) {
  const rows = [['화면', '방문', '요청(네트워크)', '데이터 KB', 'JS·CSS KB', '기타 KB', '합계 KB', '첫 데이터 ms', '데이터 파일']];
  for (const r of results) for (const v of ['cold', 'warm']) {
    const m = r[v];
    rows.push([r.id, v === 'cold' ? '첫 방문' : '재방문', `${m.requests}(${m.network})`, kb(m.bytes.data), kb(m.bytes.code),
      kb(m.bytes.other), kb(m.bytes.total), m.readyMs ?? '-', String(m.dataFiles.length)]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scenarios = SCENARIOS.filter(s => !opts.only || opts.only.has(s.id));
  const { cdp, stop } = await launchChrome(findChrome(opts.chrome), opts.headed);
  const results = [];
  try {
    for (const s of scenarios) {
      process.stderr.write(`measuring ${s.id} ...\n`);
      results.push(await measureScenario(cdp, s, opts));
      await sleep(opts.gapMs);
    }
  } finally { await stop(); }
  printTable(results);
  for (const r of results) {
    for (const f of [...r.cold.failed, ...r.warm.failed]) console.log(`failed ${r.id}: ${f}`);
    for (const v of ['cold', 'warm']) if (r[v].timedOut) console.log(`timeout ${r.id} ${v}: pending ${r[v].pending.join(', ') || '-'}`);
    const writes = [...new Set([...r.cold.blockedWrites, ...r.warm.blockedWrites])];
    if (writes.length) console.log(`blocked writes ${r.id}: ${writes.join(', ')}`);
  }
  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify({ base: opts.base, measuredAt: new Date().toISOString(), results }, null, 2));
    console.log(`wrote ${opts.json}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => { console.error(e); process.exitCode = 1; });
