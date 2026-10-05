/*
 * AgentToll full product demo (Loom-style walkthrough, about 2:47 at 1920x1080).
 * Every terminal string is read at build time from a committed capture (video/captures/,
 * docs/assets/, evals/), never retyped. Captions and act starts come from captions.json.
 * Film annotations (rings, callouts, the flow strip, the caps card) are drawn on top and never
 * change a captured pixel. All payments shown are SIMULATED; the gold badge is on screen for
 * every act that shows a payment (04 to 07).
 */
(function () {
  'use strict';
  const { el, esc, show, progress, track, ease: E } = AT;

  /* ---------- data: committed captures only ---------- */
  function load(p) { const x = new XMLHttpRequest(); x.open('GET', p, false); x.send(); if (x.status !== 200) throw new Error('load ' + p + ': ' + x.status); return x.responseText; }
  const J = p => JSON.parse(load(p));
  const CAP = '../../captures/', ROOT = '../../../';
  const cap = id => J(CAP + 'terminal/' + id + '.json');
  const lines = s => s.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
  const must = (arr, pred, what) => { const i = arr.findIndex(pred); if (i < 0) throw new Error('capture changed, missing: ' + what); return i; };
  const pick = (arr, pred, what) => arr[must(arr, pred, what)];
  const compact = s => JSON.stringify(JSON.parse(s));

  const C = J('captions.json');
  const A = {}; C.acts.forEach(a => (A[a.id] = a.start));
  const END = C.duration;

  const S = AT.scene({ duration: END, progress: { ticks: C.acts.slice(1).map(a => a.start) }, seed: 11 });
  const W = S.world;

  /* ---------- small components ---------- */
  const sections = [];
  function Section(num, text, at, out) { const c = AT.SectionLabel({ num, text, at, out, x: 64, y: 98 }); sections.push(c.el); return c; }
  // Provenance lines live in the fixed overlay (never zoomed), one shared line bottom-left.
  function Note(html, x, y, at, out) { return AT.Source({ html, at, out }); }
  function Ring(r, at, out, cls = '') {
    const e = el('div', 'ring ' + cls, W); AT.place(e, { x: r[0], y: r[1], w: r[2], h: r[3] });
    return S.add({ el: e, update(t) { show(e, t, { at, out, dur: 0.5, y: 0, blur: 0, scale: 1.08, ease: E.easeOutBack }); } });
  }
  function Callout(html, x, y, at, out, cls = '') {
    const e = el('div', 'callout ' + cls, W, html); AT.place(e, { x, y });
    return S.add({ el: e, update(t) { show(e, t, { at, out, dur: 0.5, y: 10, blur: 4 }); } });
  }
  const urlFmt = u => { const m = u.match(/^([^/]+)(.*)$/); return m ? `<span class="host">${esc(m[1])}</span>${esc(m[2])}` : esc(u); };

  /*
   * PageBrowser: a browser window whose page is a stack of real screenshots (and optionally the
   * real screencast video), cross-faded by t. Page pixels are CSS px * s, shifted left by cropX
   * (the dashboard's empty side margins), so the content column fills the window.
   */
  function Icon(x, y, size, at, out) {
    const e = el('div', 'at-abs', W); AT.place(e, { x, y, w: size, h: size });
    const i = AT.img(ROOT + 'brand/icon.svg', null, e); i.style.width = size + 'px'; i.style.height = size + 'px'; i.style.display = 'block';
    e.style.filter = 'drop-shadow(0 18px 40px rgba(109,40,217,0.45))';
    return S.add({ el: e, update(t) { const sp = AT.spring(t - at, 260, 20); const v = show(i, t, { at, out, dur: 0.6, y: 0, blur: 6 }); void v; i.style.transform = `scale(${(0.7 + 0.3 * Math.min(sp, 1.2)).toFixed(4)}) translateY(${((1 - Math.min(sp, 1)) * 16).toFixed(2)}px)`; } });
  }
  const videos = [];
  function PageBrowser(o) {
    const s = o.s, cropX = o.cropX || 0;
    const stack = el('div', 'pstack', null); stack.style.width = o.w + 'px'; stack.style.height = Math.ceil(o.pageH * s) + 'px';
    const items = o.pages.map(p => {
      let m;
      if (p.video) {
        m = el('video', null, stack); m.muted = true; m.playsInline = true; m.preload = 'auto';
        const v = { el: m, t0: p.t0, dur: p.dur, fps: p.fps || 30 };
        v.ready = fetch(p.video).then(r => { if (!r.ok) throw new Error('video ' + p.video); return r.arrayBuffer(); })
          .then(b => new Promise((res, rej) => { m.addEventListener('loadeddata', res, { once: true }); m.addEventListener('error', () => rej(new Error('video decode ' + p.video)), { once: true }); m.src = URL.createObjectURL(new Blob([b], { type: 'video/webm' })); }));
        videos.push(v);
        m.style.width = (p.cssW * s) + 'px'; m.style.left = '0px';
      } else {
        m = AT.img(p.src, null, stack);
        m.style.width = ((p.cssW || 1920) * s) + 'px'; m.style.left = (-(p.cropX == null ? cropX : p.cropX) * s) + 'px';
      }
      return { p, m };
    });
    const bar = el('div', 'pload', stack);
    const b = AT.Browser({ x: o.x, y: o.y, w: o.w, h: o.h, url: '', tabs: o.tabs, content: stack, at: o.at, out: o.out,
      scroll: t => (o.scroll ? o.scroll(t) : 0) * s });
    const urlSpan = b.el.querySelector('.url > span');
    const tabEl = b.el.querySelector('.tab.on');
    let tabText = tabEl.lastChild;
    if (!tabText || tabText.nodeType !== 3) tabText = tabEl.appendChild(document.createTextNode(''));
    const urls = (o.urls || []).slice().sort((a, c) => a.at - c.at);
    S.every(t => {
      // address bar: last entry whose time has come; typed entries type from empty
      let u = '', tab = o.tabs ? o.tabs[0] : '';
      for (const e of urls) if (t >= e.at) { u = e.type ? AT.typed(e.text, t, e.at, e.cps || 34, 5) : e.text; if (e.tab != null) tab = e.tab; }
      urlSpan.innerHTML = urlFmt(u);
      if (tabText.nodeValue !== tab) tabText.nodeValue = tab;
      let loading = 0;
      items.forEach(({ p, m }) => {
        const v = E.easeOutCubic(progress(t, p.at, p.at + (p.fade == null ? 0.3 : p.fade))) * (p.out == null ? 1 : 1 - progress(t, p.out, p.out + 0.25));
        m.style.opacity = v.toFixed(3); m.style.visibility = v > 0.001 ? 'visible' : 'hidden';
        if (p.load) { const lp = progress(t, p.at - 0.45, p.at); if (lp > 0 && lp < 1) loading = lp; else if (t >= p.at && t < p.at + 0.25) loading = -progress(t, p.at, p.at + 0.25); }
      });
      if (loading > 0) { bar.style.visibility = 'visible'; bar.style.opacity = '1'; bar.style.transform = `scaleX(${E.easeOutCubic(loading).toFixed(3)})`; }
      else if (loading < 0) { bar.style.visibility = 'visible'; bar.style.opacity = (1 + loading).toFixed(3); bar.style.transform = 'scaleX(1)'; }
      else bar.style.visibility = 'hidden';
    });
    const viewTop = o.y + 92;
    return {
      b, s,
      // world rect of a CSS-px box on the page at a given CSS scroll
      rect: (bx, sc = 0, pad = 0) => [o.x + (bx[0] - cropX) * s - pad, viewTop + (bx[1] - sc) * s - pad, bx[2] * s + 2 * pad, bx[3] * s + 2 * pad],
      pt: (cx, cy, sc = 0) => [o.x + (cx - cropX) * s, viewTop + (cy - sc) * s],
    };
  }

  /* YAML file viewer with line numbers and highlight bands. */
  function yamlHTML(line, price) {
    if (/^\s*#/.test(line)) return `<span class="y-com">${esc(line)}</span>`;
    let body = line, com = '';
    const ci = line.search(/\s+#\s/);
    if (ci > 0) { body = line.slice(0, ci); com = line.slice(ci); }
    const m = body.match(/^(\s*)(- )?([A-Za-z_][\w]*)(:)(.*)$/);
    let h = esc(body);
    if (m) {
      const v = m[5];
      h = esc(m[1]) + (m[2] ? '<span class="y-dash">- </span>' : '') + `<span class="y-key">${esc(m[3])}</span>:` +
        (v.trim() ? (/^\s*"/.test(v) ? `<span class="${price ? 'y-price' : 'y-str'}">${esc(v)}</span>` : `<span class="y-val">${esc(v)}</span>`) : '');
    }
    return h + (com ? `<span class="y-com">${esc(com)}</span>` : '');
  }
  function CodePanel(o) {
    const e = el('div', 'at-panel code', W); AT.place(e, o);
    const bar = el('div', 'at-bar', e, '<div class="at-lights"><i></i><i></i><i></i></div>');
    el('div', 'title', bar, esc(o.title));
    const body = el('div', 'body', e), sc = el('div', 'scroll', body);
    sc.style.setProperty('--fs', o.fs + 'px'); sc.style.setProperty('--lh', String(o.lh));
    const LH = o.fs * o.lh, PAD = 18;
    const bands = (o.bands || []).map(b => { const d = el('div', 'band' + (b.gold ? ' gold' : ''), sc); d.style.top = (PAD + b.from * LH) + 'px'; d.style.height = ((b.to - b.from + 1) * LH) + 'px'; d.style.transformOrigin = '0 50%'; return { b, d }; });
    o.lines.forEach((ln, i) => { const r = el('div', 'ln', sc); el('span', 'no', r, String(i + 1)); el('span', 'tx', r, yamlHTML(ln, (o.price || []).includes(i))); });
    const scr = o.scroll ? track(o.scroll) : () => 0;
    return S.add({
      el: e, LH,
      lineY: (i, t) => o.y + 44 + PAD + i * LH - scr(t),
      update(t) {
        show(e, t, { at: o.at, out: o.out, y: 32, blur: 10, scale: 0.985, dur: 0.8 });
        sc.style.transform = `translateY(${(-scr(t)).toFixed(2)}px)`;
        bands.forEach(({ b, d }) => {
          const v = E.easeOutCubic(progress(t, b.at, b.at + 0.35)) * (1 - E.easeInCubic(progress(t, b.out, b.out + 0.35)));
          d.style.opacity = v.toFixed(3); d.style.visibility = v > 0.001 ? 'visible' : 'hidden'; d.style.transform = `scaleX(${(0.97 + 0.03 * v).toFixed(4)})`;
        });
      },
    });
  }
  /* x402 steps the buyer CLI walks through (README "How it works"). */
  function Flow(o) {
    const e = el('div', 'flow', W); AT.place(e, { x: 0, y: o.y, w: 1920 }); e.style.justifyContent = 'center';
    const steps = [], wires = [];
    o.steps.forEach((s, i) => {
      if (i) { const w = el('div', 'wire', e); wires.push(el('i', null, w)); }
      const st = el('div', 'st' + (s.gold ? ' gold' : ''), e, `<span class="n">${i + 1}</span>${esc(s.text)}`);
      steps.push({ st, s });
    });
    const capEl = o.caption ? el('div', 'flow-cap', W, esc(o.caption)) : null;
    if (capEl) AT.place(capEl, { x: o.capX || 64, y: o.y - 26 });
    return S.add({
      el: e,
      update(t) {
        show(e, t, { at: o.at, out: o.out, y: 14, blur: 6 });
        if (capEl) show(capEl, t, { at: o.at + 0.1, out: o.out, y: 8, blur: 4 });
        steps.forEach(({ st, s }) => st.classList.toggle('on', t >= s.on));
        wires.forEach((w, i) => { const a = steps[i].s.on, b = steps[i + 1].s.on; w.style.transform = `scaleX(${E.easeInOutCubic(progress(t, a, b)).toFixed(3)})`; });
      },
    });
  }
  function Info(o) {
    const e = el('div', 'info', W, `<div class="tag">${esc(o.tag)}</div><div class="hd">${esc(o.title)}</div><ul>${o.items.map(i => `<li class="${i.warn ? 'warn' : ''}">${i.html}</li>`).join('')}</ul>`);
    AT.place(e, o);
    return S.add({ el: e, update(t) { show(e, t, { at: o.at, out: o.out, y: 24, blur: 8, dur: 0.8 }); } });
  }

  const camKeys = [];
  const cam = (t, to, o = {}) => camKeys.push(Object.assign({ t, to }, o));

  /* ================================================================ A0 COLD OPEN (6 s)
     The hook first: the same URL, a person's browser gets the JSON free, Claude-User gets 402. */
  {
    const a = A.a0, out = A.a1 - 0.25;
    const og = J(CAP + 'origin/origin.json');
    const api = pick(og.pages, p => p.name === 'api-quote', 'origin api');
    const r402 = cap('claude-user-402');
    const R = lines(r402.stdout);
    const who = (html, x, y, at) => { const e = el('div', 'who', W, html); AT.place(e, { x, y }); S.add({ el: e, update(t) { show(e, t, { at, out, y: 10, blur: 4 }); } }); };
    const pill = (html, cls, x, y, at) => {
      const e = el('div', 'pill ' + cls, W, '<i></i>' + html); AT.place(e, { x, y });
      S.add({ el: e, update(t) { const sp = AT.spring(t - at, 320, 18); AT.style(e, { o: E.easeOutCubic(progress(t, at, at + 0.15)) * (1 - E.easeInCubic(progress(t, out, out + 0.4))), s: AT.lerp(0.6, 1, sp), blur: 10 * E.easeInCubic(progress(t, out, out + 0.4)) }); } });
    };
    who('<b>PERSON</b> · Chrome', 64, 132, a + 0.15);
    who('<b>AGENT</b> · Claude-User', 976, 132, a + 0.3);
    const pb = PageBrowser({
      x: 64, y: 170, w: 880, h: 560, s: 1.35, cropX: -16, pageH: 1080, at: a + 0.05, out,
      tabs: [api.url.replace(/^https?:\/\//, '')], urls: [{ at: 0, text: api.url.replace(/^https?:\/\//, '') }],
      pages: [{ src: CAP + 'origin/origin-api-quote.png', at: a + 0.35, fade: 0.3 }],
      scroll: () => 22,   // the top 22 CSS px are Chrome's "Pretty-print" bar
    });
    pb.b.view.style.background = '#121212';
    pill(`${api.status} OK`, 'ok', 772, 122, a + 0.75);
    const hdrs = R.slice(0, R.indexOf(''));
    const keepH = hdrs.filter(l => /^HTTP\/|^content-type|^payment-required|^x-agenttoll-verdict/.test(l));
    const t0 = AT.Terminal({
      x: 976, y: 170, w: 880, h: 560, title: 'zsh · an agent asks', at: a + 0.2, out, fontSize: 21, wrap: true,
      lines: [
        { cmd: r402.command, at: a + 0.75, dur: 1.0 },
        { out: keepH.map(l => /^HTTP\//.test(l) ? [[l, 'yellow bold']] : /^payment-required/.test(l) ? [[l, 'clip dim']] : /^x-agenttoll/.test(l) ? [[l.replace(/ .*/, ' '), 'dim'], [l.replace(/^[^ ]+ /, ''), 'cyan bold']] : [[l, 'dim']]), at: a + 1.95, step: 0.06 },
        { prompt: true, at: a + 2.3 },
      ],
    });
    pill('402 Payment Required', 'pay', 1546, 122, a + 2.0);
    AT.sfx(a + 0.75, 'pop', { gain: 0.6, pan: -0.4 });
    AT.sfx(a + 1.95, 'thud', { gain: 0.9, pan: 0.3 });
    cam(a + 2.35, () => t0.rect(/^HTTP\/1\.1 402|x-agenttoll-verdict/, a + 2.6, 14), { scale: 1.8, dur: 0.6 });
    cam(a + 4.6, 'full', { dur: 0.55 });
    Note(`screenshot · <b>video/captures/origin/origin-api-quote.png</b> · stdout · <b>video/captures/terminal/claude-user-402.json</b> (4 of its header lines)`, 0, 0, a + 0.4, out);
  }

  /* ================================================================ A1 TITLE */
  {
    const a = A.a1, out = A.a2 - 0.2;
    Icon(160, 112, 104, a + 0.15, out);
    AT.Headline({ lines: ['AgentToll', { text: 'full product demo', grad: true }], at: a + 0.25, out: out - 0.05, x: 156, y: 236, size: 132 });
    AT.Badge({ at: a + 0.9, out, x: 160, y: 566, parent: W, size: 22 });
    AT.Text({ html: 'Payments are <span class="gold">SIMULATED</span> on Solana devnet: a local test facilitator, no funds moved.<br>Terminal output, screens and the Claude transcript are captured from real runs.', at: a + 1.1, out, x: 160, y: 648, w: 1500 });
    AT.sfx(a + 0.15, 'lift', { gain: 0.7 });
  }

  /* ================================================================ A2 CONFIG + STACK (10 s) */
  {
    const a = A.a2, out = A.a3 - 0.2, codeOut = a + 7.75;
    Section('01', 'ONE CONFIG FILE', a + 0.1, codeOut);
    const cfg = cap('demo-config');
    const L = lines(cfg.stdout);
    const at = (re, what) => must(L, l => re.test(l), what);
    const iNet = at(/^networks:/, 'networks'), iPay = at(/pay_to:/, 'pay_to'), iFac = at(/facilitator:/, 'facilitator');
    const iRoutes = at(/^routes:/, 'routes'), iQuote = at(/price_usd: "0.002"/, 'price 0.002'), iFree = at(/price_usd: "0"$/, 'free price');
    const iMcp = at(/^mcp:/, 'mcp'), iSd = at(/search_docs:/, 'search_docs'), iGr = at(/generate_report:/, 'generate_report');
    const code = CodePanel({
      x: 64, y: 140, w: 1000, h: 780, fs: 17, lh: 1.5, title: 'demo/agenttoll.demo.yaml', at: a + 0.15, out: codeOut, lines: L,
      price: [iQuote, iFree, iSd, iGr, at(/price_usd: "0.001"/, 'price 0.001'), L.findIndex((l, i) => i > at(/blog/, 'blog') && /price_usd/.test(l))],
      scroll: [[a + 2.85, 0], [a + 3.4, 210, E.easeInOutCubic]],
      bands: [
        { from: iNet, to: iFac, at: a + 0.6, out: a + 2.9 },
        { from: iPay, to: iPay, at: a + 0.9, out: a + 2.9, gold: true },
        { from: iRoutes, to: iFree, at: a + 3.2, out: a + 5.3 },
        { from: iQuote, to: iQuote, at: a + 3.5, out: a + 5.3, gold: true },
        { from: iMcp, to: iGr, at: a + 5.4, out: a + 7.5 },
        { from: iSd, to: iGr, at: a + 5.6, out: a + 7.5, gold: true },
      ],
    });
    Note(`file · <b>demo/agenttoll.demo.yaml</b> (as captured in video/captures/terminal/demo-config.json)`, 0, 0, a + 0.4, codeOut);
    const ly = (i, t) => code.lineY(i, t);
    const LH = code.LH;
    cam(a + 0.5, [64, ly(iNet, a + 0.6) - 6, 900, (iFac - iNet + 1) * LH + 12], { scale: 1.85, dur: 0.6 });
    cam(a + 3.0, [64, ly(iRoutes, a + 4) - 6, 900, (iFree - iRoutes + 1) * LH + 12], { scale: 1.8, dur: 0.6 });
    cam(a + 5.35, [64, ly(iMcp, a + 6) - 6, 900, (iGr - iMcp + 1) * LH + 12], { scale: 1.85, dur: 0.6 });
    cam(a + 7.05, 'full', { dur: 0.55 });

    // 2 s insert: one command starts origin, gateway and the SIMULATED facilitator
    const st = cap('stack-only');
    const SL = lines(stripAnsi(st.stdout));
    const runIdx = must(SL, l => /Stack is running/.test(l), 'stack banner');
    AT.Terminal({
      x: 210, y: 170, w: 1500, h: 700, title: 'zsh · repo root', at: a + 7.75, out, wrap: true, fontSize: 21, keys: false,
      lines: [
        { cmd: st.command, at: a + 8.0, dur: 0.5 },
        { out: [[SL[0], 'dim']], at: a + 8.6 },
        { blank: true, at: a + 8.62 },
        { out: [[SL[runIdx], 'cyan bold']], at: a + 8.75 },
        { out: SL.slice(runIdx + 1).map(l => [[l, /SIMULATED/.test(l) ? 'white' : null]]), at: a + 8.85, step: 0.04 },
      ],
    });
    Note('stdout · <b>video/captures/terminal/stack-only.json</b>', 0, 0, a + 7.9, out);

    AT.Cursor({
      at: a + 0.3, out: codeOut - 0.1,
      path: [
        { t: a + 0.3, x: 1500, y: 960 },
        { t: a + 1.1, x: 470, y: ly(iPay, a + 1) + LH * 0.55 },
        { t: a + 3.7, x: 420, y: ly(iQuote, a + 4) + LH * 0.55, arc: -0.12 },
        { t: a + 5.9, x: 470, y: ly(iSd, a + 6) + LH * 0.55 },
      ],
    });
  }

  /* ================================================================ A3 HUMANS vs AGENTS */
  {
    const a = A.a3, out = A.a4 - 0.2;
    Section('02', 'SAME URL, TWO ANSWERS', a + 0.1, out);
    const og = J(CAP + 'origin/origin.json');
    const home = pick(og.pages, p => p.name === 'home', 'origin home'), api = pick(og.pages, p => p.name === 'api-quote', 'origin api');
    const hostPath = u => u.replace(/^https?:\/\//, '');
    const pb3 = PageBrowser({
      x: 64, y: 140, w: 880, h: 780, s: 1, cropX: 0, pageH: 1080, at: a + 0.2, out,
      tabs: ['New Tab'],
      urls: [
        { at: a + 0.95, text: hostPath(home.url), type: true, cps: 30 },
        { at: a + 1.9, text: hostPath(home.url), tab: home.title },
        { at: a + 4.75, text: hostPath(api.url), type: true, cps: 32 },
        { at: a + 5.85, text: hostPath(api.url), tab: hostPath(api.url) },
      ],
      pages: [
        { src: CAP + 'origin/origin-home.png', at: a + 1.95, load: true, out: a + 5.6 },
        { src: CAP + 'origin/origin-api-quote.png', at: a + 5.9, load: true },
      ],
    });
    Note(`screenshots · <b>video/captures/origin/</b> · HTTP ${home.status} and ${api.status} through the gateway`, 64, 932, a + 1.2, out);
    AT.dim(pb3.b.el, [[a + 7.8, out + 1]]);
    cam(a + 1.7, [64, 140, 760, 300], { scale: 2.0, dur: 0.9 });
    cam(a + 4.6, [64, 140, 900, 260], { scale: 2.0, dur: 0.7 });
    cam(a + 7.6, 'full', { dur: 0.8 });

    const r402 = cap('claude-user-402');
    const hdr = l => {
      if (/^HTTP\//.test(l)) return [[l, 'yellow bold']];
      const m = l.match(/^([\w-]+): (.*)$/);
      if (m) return [[m[1] + ': ', 'dim'], [m[2], m[1] === 'x-agenttoll-verdict' ? 'cyan bold' : m[1] === 'payment-required' ? 'dim' : null]];
      return [[l, null]];
    };
    const R = lines(r402.stdout);
    const blankAt = R.indexOf('');
    const dec = cap('payment-required-decoded');
    const D = lines(dec.stdout);
    const t1 = a + 8.6, t2 = a + 12.1;
    AT.Terminal({
      x: 976, y: 140, w: 880, h: 780, title: 'zsh · an agent asks', at: a + 7.7, out, wrap: true, fontSize: 18,
      lines: [
        { cmd: r402.command, at: t1, dur: 1.25 },
        { out: R.slice(0, blankAt).map(hdr), at: t1 + 1.45, step: 0.05 },
        { blank: true, at: t1 + 1.8 },
        { out: R.slice(blankAt + 1).map(l => [[l, 'dim']]), at: t1 + 1.85 },
        { cmd: dec.command, at: t2, dur: 1.5 },
        { out: D.map(l => /"amount"|"network"|"payTo"/.test(l) ? [[l, 'white bold']] : [[l, null]]), at: t2 + 1.7, step: 0.03 },
        { prompt: true, at: t2 + 2.5 },
      ],
    });
    Note('stdout · <b>video/captures/terminal/claude-user-402.json</b>, <b>payment-required-decoded.json</b>', 976, 932, t1, out);
    cam(t1 + 1.6, [976, 150, 880, 330], { scale: 1.75, dur: 0.9 });
    cam(t2 - 0.2, 'full', { dur: 0.7 });
    cam(t2 + 2.2, [976, 520, 880, 380], { scale: 1.6, dur: 0.9 });
    cam(A.a4 - 1.0, 'full', { dur: 0.6 });
    Callout('2000 atomic = <b>$0.002</b>', 1392, 618, t2 + 2.6, out - 0.2, 'gold sm');

    AT.Cursor({
      at: a + 0.4, out: out - 0.1,
      path: [
        { t: a + 0.4, x: 640, y: 700 },
        { t: a + 0.9, x: 330, y: 208, click: true },
        { t: a + 3.6, x: 360, y: 330 },
        { t: a + 4.65, x: 420, y: 208, click: true },
        { t: a + 7.0, x: 520, y: 330 },
        { t: a + 8.5, x: 1400, y: 560, click: true },
      ],
    });
  }

  /* ================================================================ A4 PRICE LIST */
  {
    const a = A.a4, out = A.a5 - 0.2;
    Section('03', 'A PRICE LIST FOR AGENTS', a + 0.1, out);
    const wk = cap('well-known');
    const K = lines(wk.stdout);
    AT.Terminal({
      x: 310, y: 140, w: 1300, h: 780, title: 'zsh · discovery', at: a + 0.15, out, fontSize: 17,
      lines: [
        { cmd: wk.command, at: a + 0.75, dur: 1.2 },
        { out: K.map(l => /priceUsd|"0\.0|"match"/.test(l) ? [[l, /priceUsd|"0\.0/.test(l) ? 'gold' : 'white']] : [[l, null]]), at: a + 2.2, step: 0.028 },
        { prompt: true, at: a + 3.7 },
      ],
    });
    Note('stdout · <b>video/captures/terminal/well-known.json</b>', 310, 932, a + 0.8, out);
    cam(a + 3.9, [310, 470, 1300, 440], { scale: 1.4, dur: 1.0 });
    cam(A.a5 - 1.0, 'full', { dur: 0.6 });
  }

  /* ================================================================ A5 BUYER CLI PAYS */
  const DASH = CAP + 'dashboard/';
  const B03 = J(DASH + 'dashboard-03-one-payment.boxes.json').elements;
  {
    const a = A.a5, out = A.a6 - 0.2;
    Section('04', 'AN AGENT PAYS: THE BUYER CLI', a + 0.1, out);
    const pay = cap('buyer-pay-1');
    const P = lines(pay.stdout);
    const tPay = a + 4.0;
    Flow({
      y: 150, at: a + 0.3, out, caption: null,
      steps: [
        { text: 'GET /api/quote', on: a + 2.3 },
        { text: '402 + PAYMENT-REQUIRED', on: a + 2.75 },
        { text: 'sign a USDC transfer', on: a + 3.15 },
        { text: 'retry + PAYMENT-SIGNATURE', on: a + 3.55 },
        { text: '200 + PAYMENT-RESPONSE', on: tPay, gold: true },
      ],
    });
    const col = l => /^status:/.test(l) ? [[l, 'green bold']] : /^paid:/.test(l) ? [[l, 'green']] : /^tx:/.test(l) ? [['tx:     ', null], [l.replace(/^tx:\s+/, ''), 'gold bold']] : /^note:/.test(l) ? [[l, 'yellow']] : [[l, null]];
    const t5 = AT.Terminal({
      x: 64, y: 232, w: 880, h: 688, title: 'zsh · buyer', at: a + 0.2, out, wrap: true, fontSize: 17,
      lines: [
        { cmd: pay.command, at: a + 0.7, dur: 1.5 },
        { out: [[lines(pay.stderr)[0], 'dim']], at: a + 2.35 },
        { out: P.map(col), at: tPay, step: 0.07 },
        { prompt: true, at: tPay + 0.5 },
      ],
    });
    Note('stdout + stderr · <b>video/captures/terminal/buyer-pay-1.json</b> · paid/tx are decoded from PAYMENT-RESPONSE', 64, 932, a + 0.8, out);
    const dash = PageBrowser({
      x: 976, y: 232, w: 880, h: 688, s: 880 / 1248, cropX: 336, pageH: 1080, at: a + 0.35, out,
      tabs: ['AgentToll · Revenue'], urls: [{ at: 0, text: '127.0.0.1:3502' }],
      pages: [
        { src: DASH + 'dashboard-02-unbilled-no-payments.png', at: a + 0.0, fade: 0.01 },
        { src: DASH + 'dashboard-03-one-payment.png', at: tPay + 0.55, fade: 0.28 },
      ],
    });
    Note('screenshots · <b>video/captures/dashboard/</b> states 02 then 03', 976, 932, a + 0.9, out);
    AT.dim(dash.b.el, [[a + 0.5, tPay + 0.3]], { o: 0.35, blur: 4 });
    AT.dim(t5.el, [[tPay + 0.7, a + 12.7]], { o: 0.35, blur: 4 });
    AT.sfx(tPay, 'tick', { gain: 0.6 });
    AT.sfx(tPay + 0.6, 'coin', { gain: 1 });
    const row = dash.rect([B03.live_feed_first_row.x, B03.live_feed_first_row.y, B03.live_feed_first_row.width, B03.live_feed_first_row.height], 0, 4);
    const kpi = dash.rect([B03.kpi_revenue.x, B03.kpi_revenue.y, B03.kpi_revenue.width, B03.kpi_revenue.height], 0, 4);
    const badge = B03.live_feed_first_row_simulated_badge;
    const bpt = dash.pt(badge.x + badge.width / 2, badge.y + badge.height / 2);
    Ring(row, tPay + 0.9, a + 12.6);
    cam(tPay + 1.0, row, { scale: 2.1, dur: 0.9 });
    Ring(kpi, a + 8.9, a + 12.6, 'gold');
    cam(a + 8.7, kpi, { scale: 2.3, dur: 0.9 });
    // the same id on both sides: terminal tx line and the dashboard row's SIMU…121d
    const txId = pick(P, l => /^tx:/.test(l), 'tx line').replace(/^tx:\s+/, '');
    const short = 'SIMU…' + txId.slice(-4);
    const rowText = B03.live_feed_first_row.text;
    if (!rowText.includes(short)) throw new Error('dashboard row does not show ' + short);
    cam(a + 12.8, 'full', { dur: 0.9 });
    Ring([78, 484, 540, 30], a + 13.2, out - 0.1, 'gold');
    const idPt = dash.pt(1066, 801);
    Ring([idPt[0] - 5, idPt[1] - 5, 60, 24], a + 13.5, out - 0.1, 'gold');
    Callout(`same payment: …${esc(txId.slice(-4))}`, idPt[0] - 250, idPt[1] - 58, a + 13.7, out - 0.1, 'gold');
    AT.Cursor({
      at: a + 0.3, out: out - 0.1,
      path: [
        { t: a + 0.3, x: 760, y: 980 },
        { t: a + 0.65, x: 600, y: 600, click: true },
        { t: a + 5.6, x: 700, y: 640 },
        { t: a + 6.6, x: bpt[0], y: bpt[1] + 4 },
        { t: a + 9.0, x: kpi[0] + kpi[2] * 0.6, y: kpi[1] + kpi[3] * 0.62 },
        { t: a + 13.4, x: 1640, y: 760 },
      ],
    });
  }

  /* ================================================================ A6 CLAUDE PAYS */
  {
    const a = A.a6, out = A.a7 - 0.2;
    Section('05', 'CLAUDE PAYS, WITHIN CAPS', a + 0.1, out);
    const X = J(CAP + 'claude-pays/excerpts.json');
    const r1 = X.runs[0], r2 = X.runs[1];
    const ev = (r, kind, n = 0, tool) => r.events.filter(e => e.kind === kind && (!tool || e.tool === tool))[n];
    const jl = s => lines(s).map(l => l.trim());
    const call = (e) => [['⏺ ', 'magenta'], [e.tool, 'magenta bold'], [' ' + compact(e.json_text), 'dim']];
    const res = (ls, color) => ls.map(l => [['  ⎿ ', 'dim'], [l, color || null]]);
    const keys = (txt, ks, after) => { let L = jl(txt); if (after) L = L.slice(must(L, l => l.startsWith(after), after)); return ks.map(k => pick(L, l => l.startsWith(`"${k}"`), k)); };
    const q1 = ev(r1, 'tool_result', 0), s1 = ev(r1, 'tool_result', 1), p1 = ev(r1, 'tool_result', 2);
    const say1 = ev(r1, 'claude_text', 0).markdown, fin1 = ev(r1, 'claude_text', 1).markdown.split('\n')[0];
    const err2 = ev(r2, 'tool_error', 0), s2 = ev(r2, 'tool_result', 0);
    const say2 = ev(r2, 'claude_text', 0).markdown, fin2md = ev(r2, 'claude_text', 1).markdown;
    const i0 = fin2md.indexOf('Your 10-cent'), i1 = fin2md.indexOf('workaround.', i0) + 'workaround.'.length;
    if (i0 < 0 || i1 < i0) throw new Error('Run 2 answer changed');
    const fin2 = fin2md.slice(i0, i1);
    const session = 'Session: ' + X.session.replace(/`/g, '');
    const T = {
      p1: a + 0.6, c1: a + 3.0, r1: a + 3.5, say1: a + 4.3, c2: a + 5.0, rc2: a + 5.5, fin1: a + 6.6,
      p2: a + 8.3, c3: a + 10.7, err: a + 12.9, say2: a + 13.9, c4: a + 15.0, rc4: a + 15.4, fin2: a + 16.4,
    };
    const t6 = AT.Terminal({
      x: 64, y: 140, w: 1150, h: 780, title: 'claude -p --model sonnet · MCP: agenttoll-pay', at: a + 0.15, out, wrap: true, fontSize: 19, prompt: '>',
      lines: [
        { out: [['Run 1 · ', 'dim bold'], [session, 'dim']], at: a + 0.35 },
        { cmd: r1.prompt, at: T.p1, dur: 2.1, color: 'white' },
        { out: call(ev(r1, 'tool_call', 0)), at: T.c1 },
        { out: call(ev(r1, 'tool_call', 1)), at: T.c1 + 0.2 },
        { out: res(keys(q1.json_text, ['usd', 'network_name', 'payable'])), at: T.r1, step: 0.07 },
        { out: [[say1, 'white']], at: T.say1 },
        { out: call(ev(r1, 'tool_call', 2)), at: T.c2 },
        { out: res(keys(p1.json_text, ['usd', 'tx', 'status', 'simulated'], '"receipt"'), 'gold'), at: T.rc2, step: 0.07 },
        { out: [[fin1, 'white']], at: T.fin1 },
        { blank: true, at: a + 8.05 },
        { out: [['Run 2', 'dim bold']], at: a + 8.1 },
        { cmd: r2.prompt, at: T.p2, dur: 2.0, color: 'white' },
        { out: call(ev(r2, 'tool_call', 0)), at: T.c3 },
        { out: res(jl(err2.json_text).filter(l => /^"(error|message)"/.test(l)), 'red'), at: T.err, step: 0.1 },
        { out: [[say2, 'white']], at: T.say2 },
        { out: call(ev(r2, 'tool_call', 1)), at: T.c4 },
        { out: res(keys(s2.json_text, ['spent_usd', 'remaining_usd'])), at: T.rc4, step: 0.07 },
        { out: [[fin2, 'white']], at: T.fin2 },
      ],
    });
    Note('verbatim excerpts · <b>docs/assets/claude-pays-transcript.md</b> (real claude -p run, 2026-10-04, gateway :28402)', 64, 932, a + 0.6, out);

    // caps card, values from the two spend_status results Claude saw
    const cs = JSON.parse(s1.json_text), cs2 = JSON.parse(s2.json_text);
    const card = el('div', 'capcard', W); AT.place(card, { x: 1246, y: 140, w: 610 });
    card.innerHTML = `<div class="hd">pay-mcp caps</div><div class="sub">spend_status values from the transcript · card drawn for the film</div>` +
      `<div class="row" data-k="call"><span class="k">per call</span><span class="v">$${cs.caps.per_call_usd}</span><i class="hot"></i></div>` +
      `<div class="row"><span class="k">per day</span><span class="v">$${cs.caps.per_day_usd}</span></div>` +
      `<div class="row"><span class="k">spent today</span><span class="v gold" data-v="spent"></span></div>` +
      `<div class="row"><span class="k">remaining</span><span class="v" data-v="rem"></span></div>` +
      `<div class="stamp"></div>`;
    const hot = card.querySelector('.hot'), stamp = card.querySelector('.stamp'), spent = card.querySelector('[data-v=spent]'), rem = card.querySelector('[data-v=rem]');
    const errMsg = JSON.parse(err2.json_text).message;
    const reason = errMsg.slice(errMsg.indexOf('quote $'));
    stamp.textContent = 'refused:per_call · ' + reason;
    S.add({
      el: card,
      update(t) {
        show(card, t, { at: a + 0.7, out, y: 24, blur: 8 });
        const paid = t >= T.rc2 + 0.2;
        spent.textContent = '$' + (paid ? cs2.today.spent_usd : cs.today.spent_usd);
        rem.textContent = '$' + (paid ? cs2.today.remaining_usd : cs.today.remaining_usd);
        const h = E.easeOutCubic(progress(t, T.err, T.err + 0.3));
        hot.style.opacity = h.toFixed(3);
        show(stamp, t, { at: T.err + 0.15, y: 10, blur: 4, dur: 0.5 });
      },
    });

    // the same refusal, live on the film stack (pay-mcp driven by a script, not by Claude)
    const sess = cap('pay-mcp-session');
    const ref = pick(sess.calls, c => c.tool === 'call_paid_tool' && c.arguments.tool === 'generate_report', 'live refusal');
    if (ref.result_json.message !== errMsg) throw new Error('film-stack refusal differs from the transcript');
    const tl = a + 19.8;
    AT.Terminal({
      x: 1246, y: 690, w: 610, h: 230, title: 'film stack · pay-mcp over stdio (scripted)', at: tl, out, wrap: true, fontSize: 15,
      lines: [
        { out: [['→ ', 'magenta'], [ref.tool, 'magenta bold'], [' ' + JSON.stringify(ref.arguments), 'dim']], at: tl + 0.5 },
        { out: res(lines(ref.result_text).map(l => l.trim()).filter(l => /^"(error|message)"/.test(l)), 'red'), at: tl + 1.1, step: 0.1 },
      ],
    });
    Note('<b>video/captures/terminal/pay-mcp-session.json</b> · 22:19 UTC', 1246, 932, tl + 0.4, out);
    AT.dim(card, [[a + 1.0, T.rc2 - 0.1], [T.say2 + 0.4, T.err + 2.3]], { o: 0.4, blur: 3 });
    AT.dim(t6.el, [[T.err + 2.5, T.fin2 - 0.2], [tl + 0.2, out + 1]], { o: 0.35, blur: 4 });
    AT.sfx(T.rc2, 'coin', { gain: 0.8 });
    AT.sfx(T.err, 'deny', { gain: 1 });
    AT.sfx(tl + 1.1, 'deny', { gain: 0.6 });
    cam(T.err - 0.3, [64, 470, 1150, 450], { scale: 1.55, dur: 0.9 });
    cam(T.err + 2.6, [1246, 140, 610, 460], { scale: 1.75, dur: 0.9 });
    cam(T.fin2 + 0.2, 'full', { dur: 0.8 });
    cam(tl + 1.0, [1246, 680, 610, 250], { scale: 1.9, dur: 0.9 });
    cam(A.a7 - 1.0, 'full', { dur: 0.6 });
  }

  /* ================================================================ A7 MCP */
  {
    const a = A.a7, out = A.a8 - 0.2;
    Section('06', 'MCP SERVERS SELL PER TOOL', a + 0.1, out);
    const tl = cap('mcp-tools-list');
    const TL = lines(tl.stdout);
    const iGr = must(TL, l => /Generate a market report/.test(l), 'generate_report desc');
    const iFree = must(TL, l => /A free tool/.test(l), 'free desc');
    const descCol = l => /"description"/.test(l) ? [[l, /Paid tool/.test(l) ? 'gold' : 'white']] : /"name"/.test(l) ? [[l, 'cyan']] : [[l, null]];
    const t7 = AT.Terminal({
      x: 64, y: 140, w: 880, h: 780, title: 'zsh · MCP discovery', at: a + 0.15, out, wrap: true, fontSize: 17,
      lines: [
        { cmd: tl.command, at: a + 0.6, dur: 1.3 },
        { out: TL.slice(0, iGr - 1).map(descCol), at: a + 2.1, step: 0.02 },
        { out: TL.slice(iGr - 1, iFree - 1).map(descCol), at: a + 3.3, step: 0.02 },
        { out: TL.slice(iFree - 1).map(descCol), at: a + 4.1, step: 0.02 },
      ],
    });
    Note('stdout · <b>video/captures/terminal/mcp-tools-list.json</b>', 64, 932, a + 0.6, out);
    cam(a + 2.2, [64, 300, 880, 360], { scale: 1.75, dur: 0.9 });
    cam(a + 4.5, 'full', { dur: 0.7 });

    const ch = cap('mcp-search-docs-challenge');
    const CH = lines(ch.stdout);
    const chCol = l => /"isError": true/.test(l) ? [[l, 'yellow bold']] : /"amount"/.test(l) ? [[l, 'gold bold']] : [[l, /"text"/.test(l) ? 'dim' : null]];
    AT.Terminal({
      x: 976, y: 140, w: 880, h: 780, title: 'zsh · tools/call without payment', at: a + 4.3, out, wrap: true, fontSize: 17,
      lines: [
        { cmd: ch.command, at: a + 4.9, dur: 1.3 },
        { out: CH.map(chCol), at: a + 6.4, step: 0.016 },
      ],
    });
    Note('stdout · <b>video/captures/terminal/mcp-search-docs-challenge.json</b>', 976, 932, a + 4.9, out);
    AT.dim(t7.el, [[a + 4.5, out + 1]]);
    AT.sfx(a + 10.5, 'coin', { gain: 0.8 });
    cam(a + 7.2, [976, 300, 880, 260], { scale: 1.85, dur: 0.9 });
    cam(a + 9.4, 'full', { dur: 0.7 });

    // the paid call's row on the dashboard (state 04 crop)
    const scrim = el('div', 'scrim', W);
    S.add({ el: scrim, update(t) { const v = E.easeOutCubic(progress(t, a + 9.5, a + 10.0)) * (1 - progress(t, out, out + 0.4)); scrim.style.opacity = v.toFixed(3); scrim.style.visibility = v > 0.001 ? 'visible' : 'hidden'; } });
    const k = 1.15, cropH = 330;
    const shot = el('div', 'shot', W); AT.place(shot, { x: (1920 - 853.5 * k) / 2, y: 330, w: 853.5 * k, h: cropH * k });
    const im = AT.img(DASH + 'panel-04-buyer-and-pay-mcp-live-feed-card.png', null, shot); im.style.width = (853.5 * k) + 'px';
    S.add({ el: shot, update(t) { show(shot, t, { at: a + 9.7, out, y: 30, blur: 8, scale: 0.97, dur: 0.8 }); } });
    Ring([(1920 - 853.5 * k) / 2 + 12, 330 + 150 * k, 853.5 * k - 24, 50 * k], a + 10.5, out - 0.1);
    Note('crop · <b>video/captures/dashboard/panel-04-buyer-and-pay-mcp-live-feed-card.png</b> (row paid by pay-mcp, scripted)', (1920 - 853.5 * k) / 2, 330 + cropH * k + 16, a + 10.0, out);
  }

  /* ================================================================ A8 DASHBOARD */
  {
    const a = A.a8, out = A.a9 - 0.2;
    Section('07', "THE FOUNDER'S DASHBOARD", a + 0.1, out - 0.1);
    // (a) the real screencast: 15 scripted buyer payments, rows land as they arrive
    const rec = J(DASH + 'dashboard-live-recording.json');
    const V0 = 0.6, VDUR = 10.0, vt0 = a + 0.3, recOut = a + 10.6;
    const filmT = ms => vt0 + (ms / 1000 - rec.screencast_started_video_ms / 1000 - V0);
    const s = 0.6;
    PageBrowser({
      x: 64, y: 140, w: 1248 * s, h: 92 + 1080 * s, s, cropX: 0, pageH: 1080, at: a + 0.1, out: recOut,
      tabs: ['AgentToll · Revenue'], urls: [{ at: 0, text: '127.0.0.1:3502' }],
      pages: [{ video: 'media/dashboard-live-0.6-10.6s.webm', cssW: 1248, at: a, fade: 0.01, t0: vt0, dur: VDUR }],
    });
    Note('screencast · <b>dashboard-live-screencast.mp4</b> 0.6–10.6 s, real time', 64, 900, a + 0.4, recOut);
    const pl = [];
    rec.payments.forEach(p => {
      const tc = filmT(p.video_ms), td = filmT(p.done_ms);
      if (tc > recOut - 0.3) return;
      pl.push({ cmd: 'BUYER_SOLANA_KEYPAIR=.demo/buyer.json agenttoll-buyer http://127.0.0.1:8502' + p.path, at: tc, dur: 0.12 });
      if (td < recOut - 0.3) pl.push({ out: lines(p.stdout).map(l => /^status:/.test(l) ? [[l, 'green']] : /^tx:/.test(l) ? [[l, 'gold']] : /^note:/.test(l) ? [[l, 'yellow']] : [[l, 'dim']]), at: td, step: 0.03 });
    });
    AT.Terminal({ x: 845, y: 140, w: 1011, h: 92 + 1080 * s, title: 'buyer CLI · 15 payments, one every 2 s (scripted)', at: a + 0.2, out: recOut, wrap: true, fontSize: 14, lines: pl });
    Note('stdout · <b>dashboard-live-recording.json</b> (same clock as the screencast)', 845, 900, a + 0.5, recOut);
    cam(a + 5.4, [64, 140 + 92 + 700 * s, 1248 * s, 380 * s], { scale: 2.0, dur: 1.0 });
    cam(a + 10.0, 'full', { dur: 0.7 });

    // (b) the tour, on the final state (19 payments)
    const B = J(DASH + 'dashboard-05-many-payments.boxes.json').elements;
    const bx = n => [B[n].x, B[n].y, B[n].width, B[n].height];
    const sB = 1600 / 1248, tour = a + 10.7, tourOut = a + 33.7;
    const SC = [[tour, 0], [a + 15.0, 0], [a + 15.8, 230], [a + 18.8, 230], [a + 19.6, 785], [a + 26.4, 785], [a + 27.2, 1160]];
    const scr = track(SC);
    const big = PageBrowser({
      x: 160, y: 140, w: 1600, h: 780, s: sB, cropX: 336, pageH: 1729, at: tour, out: tourOut,
      tabs: ['AgentToll · Revenue'], urls: [{ at: 0, text: '127.0.0.1:3502' }],
      pages: [{ src: DASH + 'dashboard-05-many-payments-full.png', at: tour, fade: 0.01 }],
      scroll: scr,
    });
    Note('full-page screenshot · <b>video/captures/dashboard/dashboard-05-many-payments-full.png</b> (19 payments, all simulated)', 160, 932, tour + 0.5, tourOut);
    const R = (n, sc, pad = 6) => big.rect(bx(n), sc, pad);
    cam(a + 11.3, R('kpi_revenue', 0), { scale: 2.3, dur: 0.9 });
    Ring(R('kpi_revenue_simulated_caveat', 0, 5), a + 12.2, a + 14.9, 'gold');
    cam(a + 14.9, 'full', { dur: 0.6 });
    cam(a + 15.9, R('network_split', 230), { scale: 1.75, dur: 0.9 });
    cam(a + 18.8, 'full', { dur: 0.6 });
    const feedHead = [B.live_feed_card.x, B.live_feed_card.y, B.live_feed_card.width, 150];
    cam(a + 19.7, big.rect(feedHead, 785, 8), { scale: 1.9, dur: 0.9 });
    Ring(R('live_feed_simulated_count_badge', 785, 6), a + 20.3, a + 22.6, 'gold');
    cam(a + 22.8, [...R('unbilled_panel', 785, 8).slice(0, 2), R('unbilled_panel', 785, 8)[2], 920 - R('unbilled_panel', 785, 8)[1]], { scale: 1.5, dur: 0.9 });
    cam(a + 26.3, 'full', { dur: 0.6 });
    cam(a + 27.3, R('cash_out', 1160, 8), { scale: 1.85, dur: 0.9 });
    Ring(R('cash_out_spendable', 1160, 6), a + 28.0, a + 33.4, 'gold');
    cam(a + 32.75, 'full', { dur: 0.6 });
    const P = (n, sc, fx = 0.5, fy = 0.5) => { const r = R(n, sc, 0); return { x: r[0] + r[2] * fx, y: r[1] + r[3] * fy }; };
    AT.Cursor({
      at: tour + 0.2, out: tourOut - 0.1,
      path: [
        Object.assign({ t: tour + 0.2 }, { x: 980, y: 760 }),
        Object.assign({ t: a + 12.3 }, P('kpi_revenue_simulated_caveat', 0, 0.85, 0.7)),
        Object.assign({ t: a + 16.6 }, P('network_split', 230, 0.5, 0.2)),
        Object.assign({ t: a + 20.4 }, P('live_feed_simulated_count_badge', 785, 0.5, 0.6)),
        Object.assign({ t: a + 23.6 }, P('unbilled_panel', 785, 0.6, 0.3)),
        Object.assign({ t: a + 28.4 }, P('cash_out_spendable', 1160, 0.4, 0.6)),
      ],
    });

    // (c) mobile
    const M = J(DASH + 'dashboard-05-many-payments-mobile-390.boxes.json');
    const pw = 404, ph = 840, sm = (pw - 28) / 390, mAt = a + 33.6;
    const phone = el('div', 'phone', W); AT.place(phone, { x: 960 - pw / 2 + 180, y: 120, w: pw, h: ph });
    const scrEl = el('div', 'scr', phone); el('div', 'notch', phone);
    const mimg = AT.img(DASH + 'dashboard-05-many-payments-mobile-390-full.png', null, scrEl); mimg.style.width = (390 * sm) + 'px';
    const mscr = track([[mAt + 0.9, 0], [a + 36.6, 1560, E.easeInOutCubic]]);
    S.add({ el: phone, update(t) { show(phone, t, { at: mAt, out, y: 60, blur: 10, scale: 0.94, dur: 0.9 }); mimg.style.transform = `translateY(${(-mscr(t) * sm).toFixed(2)}px)`; } });
    AT.Text({ html: `MOBILE · ${M.viewport.width} PX VIEWPORT`, x: 300, y: 420, at: mAt + 0.3, out, cls: 'mob-label' });
    AT.Text({ html: 'Same data,<br>same <span class="gold">Simulated</span> labels.', x: 300, y: 456, at: mAt + 0.45, out, cls: 'at-sub', w: 560 });
    Note('<b>video/captures/dashboard/</b><br><b>dashboard-05-many-payments-mobile-390-full.png</b>', 300, 570, mAt + 0.6, out);
  }

  /* ================================================================ A9 EDGE */
  {
    const a = A.a9, out = A.a10 - 0.2;
    Section('08', 'SAME RULES AT THE EDGE', a + 0.1, out);
    const raw = load(ROOT + 'evals/judge/results/test-output/worker-parity.txt');
    const WL = lines(stripAnsi(raw));
    const head = WL[0].match(/^\$ (.*?)\s+\(cwd (.*?)\)/);
    if (!head) throw new Error('worker-parity header changed');
    const keep = WL.filter(l => /^\s*RUN\s|✓|Test Files|^\s+Tests\s|Start at|Duration/.test(l)).map(l => l.replace(/\/home\/joseph/g, '$HOME'));
    const runL = keep.findIndex(l => /RUN/.test(l));
    AT.Terminal({
      x: 64, y: 180, w: 1100, h: 470, title: head[2], at: a + 0.15, out, fontSize: 17, wrap: true,
      lines: [
        { cmd: head[1], at: a + 0.7, dur: 0.9 },
        { out: [[keep[runL], 'dim']], at: a + 1.9 },
        { blank: true, at: a + 2.0 },
        { out: keep.filter((l, i) => i !== runL).map(l => /✓/.test(l) || /Tests\s+21 passed|Test Files\s+1 passed/.test(l) ? [[l, /Tests\s+21/.test(l) ? 'green bold' : 'green']] : [[l, 'dim']]), at: a + 2.5, step: 0.14 },
      ],
    });
    Note('summary lines · <b>evals/judge/results/test-output/worker-parity.txt</b> (gateway log lines omitted)', 64, 664, a + 0.8, out);
    Info({
      x: 1196, y: 180, w: 660, h: 470, at: a + 0.5, out, tag: 'CLOUDFLARE WORKER EDITION', title: 'One core, two runtimes',
      items: [
        { html: '<code>agenttoll-core</code> compiled to WebAssembly; only the IO shell is TypeScript' },
        { html: 'Byte-identical <code>PAYMENT-REQUIRED</code> challenges, asserted against the Rust gateway' },
        { html: 'D1 ledger instead of SQLite' },
        { html: 'Not deployed: no Cloudflare account yet', warn: true },
      ],
    });
    Note('from <b>workers/agenttoll-edge/README.md</b>', 1196, 664, a + 0.9, out);
    cam(a + 3.6, [64, 300, 1100, 300], { scale: 1.6, dur: 0.9 });
    cam(A.a10 - 1.0, 'full', { dur: 0.6 });
  }

  /* ================================================================ A10 PROOF, HANDSHAKES, CLOSE */
  {
    const a = A.a10;
    const pOut = a + 5.1;
    Section('09', 'PROOF', a + 0.1, pOut);
    const readme = load(ROOT + 'README.md');
    const latest = load(ROOT + 'evals/results/latest.md');
    const num = (re, src, what) => { const m = src.match(re); if (!m) throw new Error('number missing: ' + what); return +m[1]; };
    const evals = num(/(\d+)\/\1 passed/, latest, 'evals');
    const rust = num(/\| Rust gateway[^|]*\| (\d+) \|/, readme, 'rust'), pm = num(/\| pay-mcp \| (\d+) \|/, readme, 'pay-mcp');
    const wk = num(/\| Worker edition[^|]*\| (\d+) \|/, readme, 'worker'), par = num(/\((\d+) are parity tests/, readme, 'parity');
    const cards = [
      { to: evals, suffix: '/' + evals, label: 'black-box evals pass' },
      { to: rust, label: 'Rust tests' },
      { to: pm, label: 'pay-mcp tests' },
      { to: wk, label: `Worker tests · ${par} parity` },
    ];
    AT.Headline({ lines: [{ text: 'The repo grades itself.', grad: true }], at: a + 0.2, out: pOut - 0.1, x: 112, y: 262, size: 76 });
    cards.forEach((c, i) => AT.Ticker(Object.assign({ x: 112 + i * 432, y: 426, w: 400, size: 76, at: a + 0.5 + i * 0.18, dur: 1.3, out: pOut }, c)));
    AT.Text({ html: 'Rerun the black-box evals yourself: <code style="font-family:var(--mono);color:var(--text)">python3 evals/run.py --build</code>', x: 112, y: 622, w: 1600, at: a + 1.4, out: pOut });
    Note('<b>evals/results/latest.md</b> (run 2026-10-04, simulated payments) · <b>README.md</b> test table · <b>evals/judge/results/test-output/</b>', 112, 686, a + 1.0, pOut);

    // real facilitator handshakes (rejected as expected: unfunded wallets)
    const hs = load(ROOT + 'docs/assets/real-facilitator-handshake.md');
    const HL = lines(hs);
    const line = (pre, what) => pick(HL, l => l.startsWith(pre), what);
    const h0 = a + 5.3, hOut = a + 15.7;
    Section('10', 'WIRED TO REAL FACILITATORS', h0, hOut);
    const errCol = l => { const m = l.match(/^(.*"error":")([^"]+)(".*)$/); return m ? [[m[1], null], [m[2], 'red bold'], [m[3], null]] : [[l, null]]; };
    const hand = (x, title, cmdPre, buyer, body, conn, t0) => AT.Terminal({
      x, y: 150, w: 880, h: 420, title, at: t0, out: hOut, wrap: true, fontSize: 18,
      lines: [
        { cmd: line(cmdPre, title + ' cmd').replace(/\s*\\$/, ''), at: t0 + 0.4, dur: 0.7 },
        { out: [[line(buyer, title + ' buyer'), 'dim']], at: t0 + 1.25 },
        { out: [[line('status: 402', title + ' status'), 'yellow bold']], at: t0 + 1.35 },
        { out: [errCol(line(body, title + ' body'))], at: t0 + 1.45 },
        { out: [[line('Error: request failed', title + ' error'), 'red']], at: t0 + 1.55 },
        { blank: true, at: t0 + 1.6 },
        { out: [['gateway log: ', 'dim'], [line(conn, title + ' conn'), 'cyan']], at: t0 + 1.7 },
      ],
    });
    const hS = hand(64, 'PayAI facilitator · Solana devnet', 'BUYER_SOLANA_KEYPAIR=~/agenttoll-scratch/throwaway-buyer.json', 'buyer E1vu', 'body:   {"x402Version":2,"error":"invalid_exact_svm', 'DEBUG reqwest::connect: starting new connection \'Some("facilitator.payai.network")', h0);
    const hB = hand(976, 'x402.org facilitator · Base Sepolia', 'BUYER_EVM_PRIVATE_KEY=$(cat', 'buyer 0x6CAdd', 'body:   {"x402Version":2,"error":"invalid_exact_evm', 'DEBUG reqwest::connect: starting new connection \'Some("x402.org")', h0 + 0.25);
    Note('verbatim lines · <b>docs/assets/real-facilitator-handshake.md</b> · unfunded throwaway wallets, no transaction exists', 64, 484, h0 + 0.6, hOut);
    // the outbound connection to the real facilitator, in teal, on each panel
    for (const h of [hS, hB]) {
      let hl = null;
      S.every(t => {
        if (!hl) { const ln = [...h.el.querySelectorAll('.ln')].find(l => l.textContent.includes('starting new connection')); if (ln) { ln.style.position = 'relative'; hl = el('div', 'lnhl teal', ln); } }
        if (hl) hl.style.opacity = E.easeOutCubic(progress(t, h0 + 2.2, h0 + 2.5)).toFixed(3);
      });
    }
    Callout('Expected: unfunded throwaway wallet → the real facilitator rejects it.', 64, 586, h0 + 2.4, hOut);
    Callout('Expected: unfunded throwaway wallet → the real facilitator rejects it.', 976, 586, h0 + 5.1, hOut);
    cam(h0 + 2.0, [64, 150, 880, 480], { scale: 1.9, dur: 0.6 });
    cam(h0 + 4.75, [976, 150, 880, 480], { scale: 1.9, dur: 0.6 });
    cam(h0 + 7.35, 'full', { dur: 0.55 });
    AT.sfx(h0 + 1.75, 'deny', { gain: 0.5, pan: -0.4 });
    AT.sfx(h0 + 2.0, 'deny', { gain: 0.5, pan: 0.4 });
    AT.Text({ html: 'Both real facilitators were reached and rejected the unfunded wallets, as expected.<br><span style="color:var(--text)">A funded wallet is the only missing piece.</span>', x: 64, y: 680, w: 1700, at: h0 + 7.9, out: hOut });

    // close
    const c0 = a + 15.95;
    AT.sfx(c0, 'lift', { gain: 0.7 });
    AT.swell(c0 - 0.2, END, -1);
    Icon(160, 150, 104, c0 - 0.1);
    AT.Headline({ lines: ['Agents already use your product.', { text: 'Now you can bill them.', grad: true }], at: c0, x: 156, y: 300, size: 100 });
    AT.Text({ html: '<b>github.com/Josefusan/agenttoll</b>  ·  MIT  ·  Colosseum Crypto World\'s Fair', x: 160, y: 560, at: c0 + 0.9, cls: 'closeline' });
    AT.Text({ html: 'Devnet and testnet only. Every payment in this demo was simulated.', x: 160, y: 612, at: c0 + 1.2, cls: 'closeline' });
    AT.Text({ html: 'Run it: <b>KEEP=1 bash scripts/demo-local.sh</b>', x: 160, y: 664, at: c0 + 1.5, cls: 'closeline' });
  }

  /* SIMULATED badge: on screen through every act that shows a payment (04 to 07). */
  const BADGE = AT.Badge({ at: A.a5 + 0.25, out: A.a9 + 0.25, right: 64, y: 92 });   // leaves only after the phone (last payment frame) has faded out
  S.requireBadge(BADGE, [[A.a5 + 0.5, A.a9 - 0.1]]);
  // music sits lower under the dense acts; act changes get a soft whoosh
  AT.duck(A.a5, A.a9, -4);
  C.acts.slice(1).forEach(x => AT.sfx(x.start - 0.15, 'whoosh', { gain: 0.45 }));

  AT.Camera({ keys: camKeys, motionBlur: 0.6 });
  const cues = C.cues.map(c => Object.assign({}, c, { at: A[c.act] + c.at, end: A[c.act] + c.end }));
  for (let i = 0; i + 1 < cues.length; i++) if (cues[i + 1].at < cues[i].end + 0.42) cues[i].end = cues[i + 1].at - 0.42;   // never two pills at once
  AT.Caption({ cues, size: 30, bottom: 40 });

  /* video frames: seek the screencast before every frame is painted (deterministic: same t, same frame) */
  const baseSeek = window.seek;
  const vReady = Promise.all(videos.map(v => v.ready));
  window.seek = async t => {
    await vReady;
    for (const v of videos) {
      const vt = Math.min(Math.max(t - v.t0, 0), v.dur - 1 / v.fps) + 0.5 / v.fps;
      const target = Math.floor(vt * v.fps) / v.fps + 0.5 / v.fps;
      if (Math.abs(v.el.currentTime - target) > 1e-4) {
        await new Promise(res => { v.el.addEventListener('seeked', res, { once: true }); v.el.currentTime = target; });
      }
    }
    return baseSeek(t);
  };
})();
