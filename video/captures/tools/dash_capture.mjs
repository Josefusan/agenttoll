// Real dashboard captures with Playwright against the running film stack (dashboard :3502,
// gateway :8502). Screenshots are 1920x1080 @2x PNG; every state also writes the DOM bounding
// boxes of the key elements so the camera can zoom on exact pixels.
//   node video/captures/tools/dash_capture.mjs shot <state> [--hover-badge]
//   node video/captures/tools/dash_capture.mjs mobile <state>
//   node video/captures/tools/dash_capture.mjs origin
//   node video/captures/tools/dash_capture.mjs record <seconds> <bin-dir>
// Playwright comes from /home/joseph/pw-capture (PW_HOME to override).
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(join(process.env.PW_HOME ?? "/home/joseph/pw-capture", "node_modules", "x.js"));
const { chromium } = require("playwright");
const run = promisify(execFile);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = join(REPO, "video/captures");
const DASH = "http://127.0.0.1:3502/";
const GW = "http://127.0.0.1:8502";
const HOME = process.env.HOME;
const SCRATCH = join(HOME, "agenttoll-scratch");
// A regular desktop Chrome UA: what a person's browser sends. Headless Chromium's default UA
// says "HeadlessChrome", which is not what a human visitor looks like.
const HUMAN_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const now = () => new Date().toISOString();

async function browser() {
  return chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text"] });
}

async function waitReady(page) {
  await page.waitForSelector("text=/No agent payments yet|Revenue from agents/", { timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500); // let row-enter / num-flash animations finish
}

async function box(loc) {
  if ((await loc.count()) === 0) return null;
  const el = loc.first();
  const b = await el.boundingBox();
  if (!b) return null;
  const info = await el.evaluate((n) => ({ text: (n.innerText || "").trim().replace(/\s+\n/g, "\n").slice(0, 400), title: n.getAttribute("title") }));
  const r = (v) => Math.round(v * 10) / 10;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height), text: info.text, ...(info.title ? { title: info.title } : {}) };
}

async function elements(page) {
  const section = (h) => page.locator("section.card").filter({ has: page.locator("h2", { hasText: new RegExp(`^${h}$`) }) });
  const kpi = (l) => page.locator("div.card").filter({ has: page.locator(".label", { hasText: new RegExp(`^${l}$`) }) });
  const live = section("Live settlements");
  const firstRow = live.locator("li").first();
  const out = {
    header: await box(page.locator("main > header")),
    live_indicator: await box(page.locator("main > header > :last-child")),
    empty_state: await box(page.locator("div.card").filter({ has: page.locator(".label", { hasText: "No agent payments yet" }) })),
    kpi_revenue: await box(kpi("Revenue from agents")),
    kpi_revenue_value: await box(kpi("Revenue from agents").locator(".num")),
    kpi_revenue_simulated_caveat: await box(kpi("Revenue from agents").locator("p.text-warn")),
    kpi_paid_requests: await box(kpi("Paid requests")),
    kpi_unique_agents: await box(kpi("Unique agents")),
    kpi_unbilled: await box(kpi("Unbilled agent requests")),
    chart_card: await box(section("Revenue over time")),
    chart_svg: await box(section("Revenue over time").locator("svg.recharts-surface")),
    network_split: await box(section("By network")),
    by_route: await box(section("By route")),
    by_agent: await box(section("By agent")),
    live_feed_card: await box(live),
    live_feed_simulated_count_badge: await box(live.locator('span[title^="Rows in this list"]')),
    live_feed_first_row: await box(firstRow),
    live_feed_first_row_amount: await box(firstRow.locator("span.num")),
    live_feed_first_row_simulated_badge: await box(firstRow.locator('span[title^="Paid through the local simulated"]')),
    live_feed_rows: await live.locator("li").count(),
    unbilled_panel: await box(section("Agent traffic you are not billing yet")),
    cash_out: await box(section("Cash out")),
    cash_out_spendable: await box(section("Cash out").locator(".num")),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

async function stats() {
  const r = await fetch(DASH + "api/stats"); // the dashboard's own proxy: no token here
  return r.json();
}

async function shot(state, { hoverBadge = false } = {}) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(DASH);
  await waitReady(page);
  const dir = join(OUT, "dashboard");
  mkdirSync(dir, { recursive: true });
  const base = `dashboard-${state}`;
  await page.screenshot({ path: join(dir, `${base}.png`) });
  await page.screenshot({ path: join(dir, `${base}-full.png`), fullPage: true });
  const els = await elements(page);
  const meta = {
    state,
    captured_utc: now(),
    url: DASH,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    coords: "CSS px from the top-left of the page at scroll 0; multiply by 2 for PNG pixels",
    page_height: await page.evaluate(() => document.documentElement.scrollHeight),
    screenshot: `dashboard/${base}.png`,
    fullpage_screenshot: `dashboard/${base}-full.png`,
    stats_totals: (await stats()).totals,
    elements: els,
  };
  if (hoverBadge && els.live_feed_first_row_simulated_badge) {
    const badge = live(page);
    await badge.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await badge.hover();
    await page.waitForTimeout(1200);
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: join(dir, `${base}-hover-simulated-badge.png`) });
    meta.hover = {
      screenshot: `dashboard/${base}-hover-simulated-badge.png`,
      scrollY,
      badge_title: await badge.getAttribute("title"),
      badge_box_viewport: await badge.boundingBox(),
      note: "The badge's tooltip is a native title attribute. Headless Chromium does not paint native tooltips, so the PNG shows the hovered badge without the tooltip; badge_title is the exact tooltip text from the DOM.",
    };
  }
  writeFileSync(join(dir, `${base}.boxes.json`), JSON.stringify(meta, null, 2) + "\n");
  await b.close();
  console.log(`${base}: ${Object.keys(els).length} elements, page height ${meta.page_height}`);
}

function live(page) {
  return page
    .locator("section.card")
    .filter({ has: page.locator("h2", { hasText: /^Live settlements$/ }) })
    .locator("li")
    .first()
    .locator('span[title^="Paid through the local simulated"]');
}

async function mobile(state) {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(DASH);
  await waitReady(page);
  const dir = join(OUT, "dashboard");
  const base = `dashboard-${state}-mobile-390`;
  await page.screenshot({ path: join(dir, `${base}.png`) });
  await page.screenshot({ path: join(dir, `${base}-full.png`), fullPage: true });
  const meta = {
    state: `${state} (mobile)`,
    captured_utc: now(),
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    coords: "CSS px at scroll 0; multiply by 3 for PNG pixels",
    page_height: await page.evaluate(() => document.documentElement.scrollHeight),
    elements: await elements(page),
  };
  writeFileSync(join(dir, `${base}.boxes.json`), JSON.stringify(meta, null, 2) + "\n");
  await b.close();
  console.log(`${base}: done`);
}

async function origin() {
  // Dark mode, as a person with a dark OS theme sees it: the demo origin's pages declare
  // color-scheme: dark, and forced dark gives Chrome's built-in JSON viewer a dark page too.
  const b = await chromium.launch({ args: ["--font-render-hinting=none", "--disable-lcd-text", "--enable-features=WebContentsForceDark"] });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, userAgent: HUMAN_UA, locale: "en-US", colorScheme: "dark" });
  const page = await ctx.newPage();
  const dir = join(OUT, "origin");
  mkdirSync(dir, { recursive: true });
  const log = [];
  for (const [name, path] of [["home", "/"], ["api-quote", "/api/quote"], ["blog-hello", "/blog/hello"]]) {
    const res = await page.goto(GW + path);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(dir, `origin-${name}.png`) });
    const headers = await res.allHeaders();
    log.push({
      name,
      url: GW + path,
      status: res.status(),
      response_headers: headers,
      screenshot: `origin/origin-${name}.png`,
      title: await page.title(),
      text: (await page.evaluate(() => document.body.innerText)).slice(0, 2000),
    });
    console.log(`origin ${path}: ${res.status()}`);
  }
  writeFileSync(join(dir, "origin.json"), JSON.stringify({ captured_utc: now(), user_agent: HUMAN_UA, viewport: "1920x1080 @2x", pages: log }, null, 2) + "\n");
  await b.close();
}

async function record(seconds, binDir) {
  const outDir = join(SCRATCH, "film-out", "captures");
  const framesDir = join(SCRATCH, "frames", "dash-live");
  mkdirSync(outDir, { recursive: true });
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const b = await browser();
  const ctx = await b.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(DASH);
  await waitReady(page);

  // CDP screencast in parallel: lossless-ish JPEG frames with real timestamps, for a sharper MP4.
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const n = String(frames.length).padStart(5, "0");
    const file = join(framesDir, `f${n}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, ts: f.metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const screencastStartWall = Date.now();

  const fired = [];
  const env = { ...process.env, BUYER_SOLANA_KEYPAIR: ".demo/buyer.json" };
  const targets = ["/api/quote", "/api/quote", "/blog/x402-explained", "/api/quote", "/blog/agents-pay"];
  const n = Math.floor(seconds / 2);
  await page.waitForTimeout(2000);
  const base = Date.now();
  for (let i = 0; i < n; i++) {
    const slot = base + i * 2000 - Date.now();
    if (slot > 0) await page.waitForTimeout(slot);
    const path = targets[i % targets.length];
    const startMs = Date.now() - t0;
    let out = "", code = 0;
    try {
      const r = await run(join(binDir, "agenttoll-buyer"), [GW + path], { cwd: REPO, env });
      out = r.stdout;
    } catch (e) {
      code = e.code ?? 1;
      out = (e.stdout ?? "") + (e.stderr ?? "");
    }
    fired.push({ i, path, video_ms: startMs, done_ms: Date.now() - t0, exit: code, stdout: out });
  }
  await page.waitForTimeout(3000);
  await cdp.send("Page.stopScreencast");
  const video = page.video();
  await ctx.close();
  await b.close();
  const raw = await video.path();
  const webm = join(outDir, "dashboard-live-recordvideo.webm");
  await run("mv", [raw, webm]);

  // Screencast frames -> constant 30 fps MP4 using each frame's real display duration.
  let concat = "";
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 1 / 30;
    concat += `file '${frames[i].file}'\nduration ${dur.toFixed(4)}\n`;
  }
  if (frames.length) concat += `file '${frames[frames.length - 1].file}'\n`;
  writeFileSync(join(framesDir, "concat.txt"), concat);
  const mp4 = join(outDir, "dashboard-live-screencast.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(framesDir, "concat.txt"),
    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "14", "-preset", "slow", mp4]);
  const meta = {
    captured_utc: now(),
    recordvideo_webm: webm,
    recordvideo_bytes: statSync(webm).size,
    screencast_mp4: mp4,
    screencast_bytes: statSync(mp4).size,
    screencast_frames: frames.length,
    screencast_started_video_ms: screencastStartWall - t0,
    note: "video_ms is milliseconds since page.goto in the recordVideo webm (the webm starts at context creation, a few hundred ms earlier). The screencast MP4 starts at screencast_started_video_ms. Every payment is SIMULATED (local mock facilitator).",
    payments: fired,
  };
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(join(OUT, "dashboard"), { recursive: true });
  writeFileSync(join(OUT, "dashboard", "dashboard-live-recording.json"), JSON.stringify(meta, null, 2).split(HOME).join("~") + "\n");
  console.log(`recorded ${fired.length} payments, ${frames.length} screencast frames -> ${webm}, ${mp4}`);
}

const [cmd, a, c] = process.argv.slice(2);
if (cmd === "shot") await shot(a, { hoverBadge: process.argv.includes("--hover-badge") });
else if (cmd === "mobile") await mobile(a);
else if (cmd === "origin") await origin();
else if (cmd === "record") await record(Number(a), c);
else {
  console.error("usage: shot <state> [--hover-badge] | mobile <state> | origin | record <seconds> <bin-dir>");
  process.exit(2);
}
