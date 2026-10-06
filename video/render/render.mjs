#!/usr/bin/env node
// Deterministic frame renderer for AgentToll scenes.
//
//   node video/render/render.mjs --scene video/scenes/_engine-test.html --fps 30 --out ~/agenttoll/scratch/frames/test
//   node video/render/render.mjs --scene ... --fps 60 --out DIR --jobs 3          # 3 shard processes
//   node video/render/render.mjs --scene ... --fps 60 --out DIR --shard 2/3       # one shard by hand
//   node video/render/render.mjs --scene ... --out DIR --times 0.5,3.217 --format png   # stills only
//
// Options: --from s --to s (default 0..DURATION), --scale 1 (device scale; 0.5 = 960x540 preview),
//          --format jpeg|png (default jpeg), --quality 95, --root DIR (server root, default: repo root),
//          --port 3510 (shard k listens on port+k-1; falls back to an ephemeral port if busy),
//          --flat (adds ?flat: no grain, frozen mesh; use for the GIF cut),
//          --query 'a=1&b' (extra URL params, e.g. noprogress or cut=pitch),
//          --cues FILE (write the scene's sound cues as JSON and exit; see audio.mjs).
// Frames are named f_000000.<ext> by global index round(t*fps), so shards share one directory.
// Prints one JSON summary line on stdout ({"frames":N,"seconds":S,"fps":F,...}).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PW = process.env.AT_PLAYWRIGHT || '/home/joseph/pw-capture/node_modules/playwright';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function parse(argv) {
  const a = { fps: 30, format: 'jpeg', quality: 95, scale: 1, port: 3510, root: REPO };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2), v = argv[i + 1];
    if (['help', 'flat'].includes(key)) { a[key] = true; continue; }
    a[key] = v; i++;
  }
  for (const k of ['fps', 'quality', 'scale', 'port', 'from', 'to', 'jobs']) if (a[k] != null) a[k] = Number(a[k]);
  return a;
}
const args = parse(process.argv.slice(2));
const expand = p => p && p.replace(/^~(?=$|\/)/, os.homedir());
if (args.help || !args.scene || (!args.out && !args.cues)) {
  console.error('usage: render.mjs --scene <file|url> --out <dir> [--fps 30|60] [--from s --to s] [--scale 1] [--format jpeg|png] [--quality 95] [--shard k/n | --jobs n] [--times a,b,c]');
  process.exit(2);
}
if (args.out) args.out = path.resolve(expand(args.out));
args.root = path.resolve(expand(args.root));
if (args.out) fs.mkdirSync(args.out, { recursive: true });

// --jobs n: fan out n shard processes of this script and aggregate.
if (args.jobs && args.jobs > 1 && !args.shard) {
  const t0 = Date.now();
  const kids = [];
  for (let k = 1; k <= args.jobs; k++) {
    const pass = process.argv.slice(2).filter((x, i, arr) => x !== '--jobs' && arr[i - 1] !== '--jobs');
    kids.push(new Promise((res, rej) => {
      const p = spawn(process.execPath, [fileURLToPath(import.meta.url), ...pass, '--shard', `${k}/${args.jobs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = ''; p.stdout.on('data', d => (out += d));
      p.on('exit', code => (code === 0 ? res(JSON.parse(out.trim().split('\n').pop())) : rej(new Error(`shard ${k} exited ${code}`))));
    }));
  }
  const rs = await Promise.all(kids);
  const frames = rs.reduce((s, r) => s + r.frames, 0), secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ frames, seconds: +secs.toFixed(2), fps: +(frames / secs).toFixed(2), jobs: args.jobs, shards: rs, out: args.out }));
  process.exit(0);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.mp4': 'video/mp4' };
function serve(root, port) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.resolve(root, '.' + u);
    if (!f.startsWith(root + path.sep) && f !== root) { res.writeHead(403).end(); return; }
    if (/(^|\/)\.env|\.key$|admin-token|keypair|\.demo\//i.test(f)) { res.writeHead(403).end(); return; }   // never serve secrets
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }).end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    srv.once('error', e => (e.code === 'EADDRINUSE' && port !== 0 ? resolve(serve(root, 0)) : reject(e)));
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

let shardK = 1, shardN = 1;
if (args.shard) [shardK, shardN] = String(args.shard).split('/').map(Number);

let url, srv = null;
if (/^(https?|file):/.test(args.scene)) url = args.scene;
else {
  const f = path.resolve(expand(args.scene));
  if (!f.startsWith(args.root)) throw new Error(`scene ${f} is outside --root ${args.root}`);
  srv = await serve(args.root, args.port + shardK - 1);
  url = `http://127.0.0.1:${srv.address().port}/${path.relative(args.root, f).split(path.sep).join('/')}`;
}

if (args.flat) url += (url.includes('?') ? '&' : '?') + 'flat';
if (args.query) url += (url.includes('?') ? '&' : '?') + args.query;
const { chromium } = require(PW);
const browser = await chromium.launch({
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars',
    '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: args.scale, reducedMotion: 'no-preference' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', r => errors.push('request failed: ' + r.url()));
page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.seek === 'function' && typeof window.DURATION === 'number', null, { timeout: 90000 });
const DURATION = await page.evaluate(() => window.DURATION);
await page.evaluate(() => window.seek(0));
if (errors.length) { console.error('page errors:\n  ' + errors.join('\n  ')); await browser.close(); srv && srv.close(); process.exit(1); }
if (args.cues) {
  // --cues FILE: dump the scene's sound cues (window.AT_CUES) for video/render/audio.mjs, no frames.
  const cues = await page.evaluate(() => JSON.parse(JSON.stringify(window.AT_CUES || { sfx: [], duck: [], swell: [] })));
  cues.duration = DURATION; cues.scene = url;
  fs.writeFileSync(path.resolve(expand(args.cues)), JSON.stringify(cues, null, 1) + '\n');
  console.log(JSON.stringify({ cues: path.resolve(expand(args.cues)), sfx: cues.sfx.length, duration: DURATION }));
  await browser.close(); srv && srv.close(); process.exit(0);
}
const cdp = await ctx.newCDPSession(page);
const ext = args.format === 'png' ? 'png' : 'jpg';

async function shot(t) {
  await page.evaluate(tt => window.seek(tt), t);
  const r = await cdp.send('Page.captureScreenshot', args.format === 'png'
    ? { format: 'png', optimizeForSpeed: true }
    : { format: 'jpeg', quality: args.quality, optimizeForSpeed: true });
  return Buffer.from(r.data, 'base64');
}

const t0 = Date.now();
let count = 0;
const writes = [];
if (args.times) {
  for (const s of String(args.times).split(',').map(Number)) {
    const buf = await shot(s);
    const f = path.join(args.out, `still_${s.toFixed(3)}.${ext}`);
    writes.push(fs.promises.writeFile(f, buf)); count++;
  }
} else {
  const fps = args.fps, from = args.from || 0, to = args.to == null ? DURATION : Math.min(args.to, DURATION);
  const i0 = Math.round(from * fps), total = Math.round((to - from) * fps);
  const a = i0 + Math.floor((total * (shardK - 1)) / shardN), b = i0 + Math.floor((total * shardK) / shardN);
  for (let i = a; i < b; i++) {
    const buf = await shot(i / fps);
    writes.push(fs.promises.writeFile(path.join(args.out, `f_${String(i).padStart(6, '0')}.${ext}`), buf));
    if (writes.length > 16) await writes.shift();
    count++;
    if (count % 60 === 0) process.stderr.write(`[shard ${shardK}/${shardN}] ${count}/${b - a} frames\n`);
  }
}
await Promise.all(writes);
const secs = (Date.now() - t0) / 1000;
await browser.close();
srv && srv.close();
if (errors.length) { console.error('page errors during render:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log(JSON.stringify({ frames: count, seconds: +secs.toFixed(2), fps: +(count / secs).toFixed(2), shard: `${shardK}/${shardN}`, duration: DURATION, out: args.out }));
