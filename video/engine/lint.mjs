#!/usr/bin/env node
// Scene lint: runs AT.lint() headless and fails on the rules review round 2 kept catching.
//
//   node video/engine/lint.mjs --scene video/scenes/hero/index.html [--fps 10] [--query cut=pitch] [--from s --to s]
//
// Checks (see AT.lint in timeline.js): frame 0 is a composed thumbnail, no empty-background frames,
// every camera key fits the safe area, the top-band badge never sits on readable undimmed content
// or a stat, section labels never touch the brand bar. Prints JSON, exits 1 when anything fails.
// No frames are written; a 90 s film lints in well under a minute.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PW = process.env.AT_PLAYWRIGHT || '/home/joseph/pw-capture/node_modules/playwright';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const a = { fps: 10, port: 3519 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1]; i++; }
if (!a.scene) { console.error('usage: lint.mjs --scene <file> [--fps 10] [--query q] [--from s --to s]'); process.exit(2); }
const f = path.resolve(a.scene.replace(/^~(?=$|\/)/, os.homedir()));
if (!f.startsWith(REPO + path.sep)) throw new Error('scene must be inside ' + REPO);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain' };
const srv = http.createServer((req, res) => {
  const p = path.resolve(REPO, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(REPO + path.sep) || /(^|\/)\.env|\.key$|admin-token|keypair|\.demo\//i.test(p)) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, buf) => (err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }).end(buf)));
});
await new Promise((ok, no) => { srv.once('error', e => (e.code === 'EADDRINUSE' ? srv.listen(0, '127.0.0.1', ok) : no(e))); srv.listen(+a.port, '127.0.0.1', ok); });
let url = `http://127.0.0.1:${srv.address().port}/${path.relative(REPO, f).split(path.sep).join('/')}`;
if (a.query) url += '?' + a.query;

const { chromium } = require(PW);
const browser = await chromium.launch({ args: ['--disable-gpu', '--hide-scrollbars'] });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => typeof window.seek === 'function', null, { timeout: 60000 });
await page.evaluate(() => window.seek(0.0001));   // layout + fonts; t=0 itself is judged by lint (seek(0) would throw first)
const o = { fps: +a.fps };
if (a.from != null) o.from = +a.from;
if (a.to != null) o.to = +a.to;
const r = await page.evaluate(opts => window.AT.lint(opts), o);
await browser.close(); srv.close();
if (errors.length) { r.ok = false; r.pageErrors = errors; }
console.log(JSON.stringify(r, null, 1));
process.exit(r.ok ? 0 : 1);
