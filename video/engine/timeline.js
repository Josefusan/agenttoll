/*
 * AgentToll scene engine (video/engine/timeline.js).
 *
 * Contract: a scene is a 1920x1080 HTML page that loads engine.css + this file, builds its
 * components once, and exposes window.seek(t) -> Promise (frame fully painted) and window.DURATION.
 * Every visual is a pure function of t: no CSS animations or transitions, no wall-clock state,
 * no unseeded randomness. Same t -> same pixels.
 *
 * Minimal scene:
 *   const S = AT.scene({ duration: 8 });           // mesh bg, grain, chrome, progress bar
 *   AT.Headline({ lines: ['Agents read.', { text: 'Founders pay.', grad: true }], at: 0.4, x: 128, y: 200 });
 *   AT.Caption({ cues: [{ at: 1, end: 4, text: 'Same URL. People: free. Agents: $0.002.' }] });
 *
 * Components register with the scene created last (AT.scene). Each returns an object with
 * .el (root element) and update(t). Coordinates are stage pixels (1920x1080), relative to `parent`
 * (default S.world, which the Camera zooms; S.overlay never zooms).
 *
 * Preview in a desktop browser: open scene.html?play (real-time loop, preview only) or ?t=3.2.
 * GIF cut: render with ?flat (render.mjs --flat): grain off and the mesh frozen.
 */
(function () {
  'use strict';
  const W = 1920, H = 1080;

  /* ---------- math ---------- */
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const progress = (t, t0, t1) => (t1 <= t0 ? (t >= t0 ? 1 : 0) : clamp((t - t0) / (t1 - t0)));
  const ease = {
    linear: u => u,
    easeInQuad: u => u * u,
    easeOutQuad: u => 1 - (1 - u) * (1 - u),
    easeInOutQuad: u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
    easeInCubic: u => u * u * u,
    easeOutCubic: u => 1 - Math.pow(1 - u, 3),
    easeInOutCubic: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    easeOutQuart: u => 1 - Math.pow(1 - u, 4),
    easeInOutQuart: u => (u < 0.5 ? 8 * u * u * u * u : 1 - Math.pow(-2 * u + 2, 4) / 2),
    easeOutQuint: u => 1 - Math.pow(1 - u, 5),
    easeOutExpo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
    easeInOutExpo: u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2),
    easeInOutSine: u => -(Math.cos(Math.PI * u) - 1) / 2,
    easeOutBack: (u, s = 1.70158) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
    smoothstep: u => u * u * (3 - 2 * u),
  };

  /* Closed-form damped spring from 0 to 1, released at dt = 0 (seconds), zero initial velocity. */
  function spring(dt, stiffness = 170, damping = 26, mass = 1) {
    if (dt <= 0) return 0;
    const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + (z * w0 / wd) * Math.sin(wd * dt));
    }
    if (z === 1) return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
    const s = Math.sqrt(z * z - 1), r1 = -w0 * (z - s), r2 = -w0 * (z + s);
    return 1 - (r2 * Math.exp(r1 * dt) - r1 * Math.exp(r2 * dt)) / (r2 - r1);
  }

  function mix(a, b, u) {
    if (typeof a === 'number') return lerp(a, b, u);
    if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], u));
    if (a && typeof a === 'object') { const o = {}; for (const k in a) o[k] = mix(a[k], b[k], u); return o; }
    return u < 1 ? a : b;
  }
  /* tween(t, t0, t1, from, to, ease) -> value (numbers, arrays or objects of numbers). */
  const tween = (t, t0, t1, from, to, e = ease.easeInOutCubic) => mix(from, to, e(progress(t, t0, t1)));
  /* track([[t, value, ease?], ...]) -> f(t). ease applies to the segment arriving at that key. */
  function track(keys) {
    const k = keys.slice().sort((a, b) => a[0] - b[0]);
    return t => {
      if (t <= k[0][0]) return k[0][1];
      for (let i = 1; i < k.length; i++) {
        if (t < k[i][0]) { const [ta, va] = k[i - 1], [tb, vb, e = ease.easeInOutCubic] = k[i]; return mix(va, vb, e((t - ta) / (tb - ta))); }
      }
      return k[k.length - 1][1];
    };
  }
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pendingImages = [];
  /* img(src, cls?, parent?) -> <img>; the scene waits for it to decode before the first frame. */
  function img(src, cls, parent) {
    const i = el('img', cls, parent); i.decoding = 'sync'; i.src = src;
    pendingImages.push(i.decode().catch(() => { throw new Error('image failed: ' + src); }));
    return i;
  }
  function place(e, o) {
    if (o.x != null) e.style.left = o.x + 'px';
    if (o.y != null) e.style.top = o.y + 'px';
    if (o.right != null) e.style.right = o.right + 'px';
    if (o.bottom != null) e.style.bottom = o.bottom + 'px';
    if (o.w != null) e.style.width = o.w + 'px';
    if (o.h != null) e.style.height = o.h + 'px';
  }
  /* style(el, {o, x, y, s, sx, sy, r, blur}) writes opacity/transform/filter in one go. */
  function style(e, p) {
    const o = p.o == null ? 1 : p.o;
    e.style.opacity = o <= 0.001 ? '0' : o >= 0.999 ? '1' : o.toFixed(4);
    e.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    const tr = [];
    if (p.x || p.y) tr.push(`translate(${(p.x || 0).toFixed(2)}px,${(p.y || 0).toFixed(2)}px)`);
    if (p.s != null && p.s !== 1) tr.push(`scale(${p.s.toFixed(4)})`);
    if (p.sx != null || p.sy != null) tr.push(`scale(${(p.sx == null ? 1 : p.sx).toFixed(4)},${(p.sy == null ? 1 : p.sy).toFixed(4)})`);
    if (p.r) tr.push(`rotate(${p.r.toFixed(3)}deg)`);
    e.style.transform = tr.length ? tr.join(' ') : 'none';
    e.style.filter = p.blur > 0.05 ? `blur(${p.blur.toFixed(2)}px)` : 'none';
  }
  /*
   * show(el, t, {at, dur=0.7, out, outDur=0.45, y=24, x=0, blur=8, scale=1, ease=easeOutExpo, outY=-12})
   * Generic enter/exit: rises from y with blur, settles; exits upward. Returns visibility 0..1.
   */
  function show(e, t, o) {
    const at = o.at == null ? 0 : o.at, dur = o.dur == null ? 0.7 : o.dur;
    const pin = progress(t, at, at + dur), eo = (o.ease || ease.easeOutExpo)(pin);
    const op = ease.easeOutCubic(progress(t, at, at + dur * 0.6));
    let pout = 0;
    if (o.out != null) pout = ease.easeInCubic(progress(t, o.out, o.out + (o.outDur == null ? 0.45 : o.outDur)));
    const y = (o.y == null ? 24 : o.y) * (1 - eo) + (o.outY == null ? -12 : o.outY) * pout;
    const x = (o.x || 0) * (1 - eo);
    const s0 = o.scale == null ? 1 : o.scale;
    const blur = (o.blur == null ? 8 : o.blur) * ((1 - eo) + pout);
    const vis = op * (1 - pout);
    style(e, { o: vis, x, y, s: lerp(s0, 1, eo) * (1 - 0.02 * pout), blur });
    return vis;
  }

  /* ---------- scene ---------- */
  let current = null;
  function scene(opts = {}) {
    const o = Object.assign({ duration: 8, background: true, grain: true, chrome: true, progress: true, vignette: true, seed: 7 }, opts);
    // flat mode (?flat or {flat:true}) is for the GIF cut: no grain, frozen mesh, so unchanged
    // background pixels stay identical between frames and the palette/diff encoder can skip them.
    o.flat = o.flat || new URLSearchParams(location.search).has('flat');
    if (o.flat) o.grain = false;
    let stage = document.getElementById('stage');
    if (!stage) { stage = el('div', null, document.body); stage.id = 'stage'; }
    const bg = el('div', 'at-bg', stage);
    const world = el('div', 'at-world', stage);
    const vignette = o.vignette ? el('div', 'at-vignette', stage) : null;
    const overlay = el('div', 'at-overlay', stage);
    const S = { duration: o.duration, stage, bg, world, overlay, vignette, comps: [], fns: [], viewScale: 1, opts: o };
    S.add = c => { S.comps.push(c); return c; };
    S.every = fn => { S.fns.push(fn); return fn; };
    /* rect(target, relativeTo=world) -> [x, y, w, h] at rest layout (call from a layout() hook). */
    S.rect = (target, rel = world) => {
      const e = typeof target === 'string' ? document.querySelector(target) : target;
      if (!e) throw new Error('rect: no element ' + target);
      const r = e.getBoundingClientRect(), b = rel.getBoundingClientRect(), k = S.viewScale;
      return [(r.left - b.left) / k, (r.top - b.top) / k, r.width / k, r.height / k];
    };
    current = S;
    window.DURATION = o.duration;
    if (o.background) MeshBackground({ parent: bg, seed: o.seed, freeze: o.flat ? 0 : null });
    if (o.chrome) Chrome(o.chrome === true ? {} : o.chrome);
    if (o.progress) Progress(o.progress === true ? {} : o.progress);
    if (o.grain) Grain(o.grain === true ? {} : o.grain);

    const fontsReady = (async () => {
      await Promise.all([
        document.fonts.load('800 80px "Inter"'), document.fonts.load('400 20px "Inter"'),
        document.fonts.load('400 20px "JetBrains Mono"'), document.fonts.load('700 20px "JetBrains Mono"'),
      ]);
      await document.fonts.ready;
    })();
    let ready = null;
    const getReady = () => (ready = ready || (async () => {
      await fontsReady;
      await Promise.all(pendingImages);
      for (const c of S.comps) if (c.layout) c.layout(S);
    })());
    const raf = () => new Promise(r => requestAnimationFrame(() => r()));
    S.frame = t => {
      t = clamp(t, 0, S.duration);
      S.t = t;
      for (const c of S.comps) c.update(t, S);
      for (const fn of S.fns) fn(t, S);
    };
    window.seek = async t => {
      await getReady();
      S.frame(t);
      await Promise.all(pendingImages);
      await document.fonts.ready;
      await raf(); await raf();   // paint barrier only; no state reads from rAF
      return t;
    };
    window.__AT = S;

    // Preview conveniences (never used by the renderer).
    const q = new URLSearchParams(location.search);
    const fit = () => {
      if (q.has('play') || q.has('t') || q.has('fit')) {
        document.body.classList.add('at-preview');
        S.viewScale = Math.min(innerWidth / W, innerHeight / H);
        stage.style.transform = `scale(${S.viewScale})`;
      }
    };
    fit();
    window.addEventListener('load', async () => {
      if (q.has('t')) await window.seek(parseFloat(q.get('t')) || 0);
      if (q.has('play')) {
        await getReady();
        const t0 = performance.now();
        const loop = () => { S.frame(((performance.now() - t0) / 1000) % S.duration); requestAnimationFrame(loop); };
        loop();
      }
    });
    return S;
  }
  const reg = c => { if (!current) throw new Error('AT.scene() must be called first'); return current.add(c); };

  /* ---------- background, grain, chrome, progress ---------- */
  /* MeshBackground({parent, seed, intensity=1, freeze:null|t}): brand radial base + 4 slow drifting colour fields. */
  function MeshBackground(o = {}) {
    const S = current, e = el('div', 'at-abs', o.parent || S.bg); place(e, { x: 0, y: 0, w: W, h: H });
    const R = rng(o.seed || 7), k = o.intensity == null ? 1 : o.intensity;
    const blobs = [
      { c: '109,40,217', a: 0.46, rx: 980, ry: 760, cx: 0.26, cy: 0.78 },
      { c: '59,130,246', a: 0.20, rx: 860, ry: 640, cx: 0.80, cy: 0.24 },
      { c: '45,212,191', a: 0.10, rx: 760, ry: 560, cx: 0.70, cy: 0.92 },
      { c: '139,92,246', a: 0.20, rx: 700, ry: 520, cx: 0.10, cy: 0.12 },
    ].map(b => Object.assign(b, { ax: 0.06 + 0.06 * R(), ay: 0.05 + 0.05 * R(), fx: 0.022 + 0.02 * R(), fy: 0.018 + 0.02 * R(), px: R() * 6.283, py: R() * 6.283 }));
    const c = {
      el: e,
      update(t) {
        if (o.freeze != null) t = o.freeze;
        const g = blobs.map(b => {
          const x = (b.cx + b.ax * Math.sin(6.2832 * b.fx * t + b.px)) * W, y = (b.cy + b.ay * Math.cos(6.2832 * b.fy * t + b.py)) * H;
          return `radial-gradient(${b.rx}px ${b.ry}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, rgba(${b.c},${(b.a * k).toFixed(3)}) 0%, rgba(${b.c},0) 70%)`;
        });
        g.push('radial-gradient(1500px 1000px at 50% 28%, #1B1640 0%, #0E0C24 58%, #07060F 100%)');
        e.style.background = g.join(',');
      },
    };
    return reg(c);
  }
  /* Grain({opacity=0.045, seed, size=384, animate=false}): static seeded noise tile (dithers gradients). */
  function Grain(o = {}) {
    const S = current, e = el('div', 'at-grain', S.stage);
    const n = o.size || 384, cv = document.createElement('canvas'); cv.width = cv.height = n;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(n, n), R = rng(o.seed || 1337);
    for (let i = 0; i < n * n; i++) { const v = (R() * 255) | 0; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    e.style.backgroundImage = `url(${cv.toDataURL('image/png')})`;
    e.style.opacity = String(o.opacity == null ? 0.045 : o.opacity);
    const c = { el: e, update(t) { if (o.animate) { const f = Math.floor(t * 24), r = rng(f * 7919 + 13); e.style.backgroundPosition = `${(r() * n) | 0}px ${(r() * n) | 0}px`; } } };
    return reg(c);
  }
  /* Chrome({left='AGENTTOLL / DEMO', right='github.com/Josefusan/agenttoll', at=0.1}) top corners. */
  function Chrome(o = {}) {
    const S = current;
    const left = o.left || 'AGENTTOLL / DEMO';
    const [a, b] = left.split(' / ');
    const l = el('div', 'at-chrome l', S.overlay, `<span class="dot"></span><b>${esc(a)}</b>${b ? `<span class="sep">/</span>${esc(b)}` : ''}`);
    const r = el('div', 'at-chrome r', S.overlay, esc(o.right || 'github.com/Josefusan/agenttoll'));
    const at = o.at == null ? 0.1 : o.at;
    // Chrome steps aside while the Camera is zoomed past 1.08x, so it never sits on top of zoomed UI.
    return reg({
      el: l,
      update(t, S) {
        const z = S.camera ? S.camera.state(t).s : 1, k = 1 - ease.easeInOutCubic(clamp((z - 1.02) / 0.3));
        for (const [e, d] of [[l, 0], [r, 0.08]]) { const v = show(e, t, { at: at + d, dur: 0.9, y: -8, blur: 0, out: o.out }) * k; e.style.opacity = v.toFixed(3); e.style.visibility = v > 0.001 ? 'visible' : 'hidden'; }
      },
    });
  }
  /* Progress({ticks:[s,...], from=0, to=DURATION}) thin gradient bar along the bottom edge. */
  function Progress(o = {}) {
    const S = current, e = el('div', 'at-progress', S.overlay), f = el('div', 'fill', e);
    for (const tk of o.ticks || []) { const k = el('div', 'tick', e); k.style.left = ((tk / S.duration) * W).toFixed(1) + 'px'; }
    return reg({ el: e, update(t) { const a = o.from || 0, b = o.to == null ? S.duration : o.to; f.style.transform = `scaleX(${progress(t, a, b).toFixed(5)})`; } });
  }

  /* ---------- typography ---------- */
  /* SectionLabel({num:'01', text:'THE PROBLEM', at, out, x=128, y=128, parent}) -> "01 — THE PROBLEM". */
  function SectionLabel(o) {
    const S = current, e = el('div', 'at-section', o.parent || S.world); place(e, { x: o.x == null ? 128 : o.x, y: o.y == null ? 128 : o.y });
    const num = el('span', 'num', e, esc(o.num)), rule = el('span', 'rule', e);
    const chars = [...o.text].map(ch => el('span', 'ch', e, esc(ch)));
    const at = o.at || 0;
    return reg({
      el: e,
      update(t) {
        const pout = o.out == null ? 0 : ease.easeInCubic(progress(t, o.out, o.out + 0.4));
        show(num, t, { at, dur: 0.6, y: 10, blur: 4 });
        const pr = ease.easeOutExpo(progress(t, at + 0.12, at + 0.82));
        style(rule, { o: pr > 0 ? 1 : 0, sx: pr });
        chars.forEach((c, i) => show(c, t, { at: at + 0.3 + i * 0.022, dur: 0.5, y: 10, blur: 3 }));
        e.style.opacity = String(1 - pout); e.style.transform = `translateY(${(-10 * pout).toFixed(2)}px)`;
      },
    });
  }
  /*
   * Headline({lines:['Agents read.', {text:'Founders pay.', grad:true}], at, out, x, y, size=96,
   *           stagger=0.06, lineGap=0.12, weight=800, align='left', parent})
   * Words rise out of a baseline mask with a short blur; gradient lines keep one continuous
   * gradient across words. {muted:true} renders a line in the muted grey.
   */
  function Headline(o) {
    const S = current, e = el('div', 'at-head', o.parent || S.world);
    place(e, { x: o.x == null ? 128 : o.x, y: o.y == null ? 200 : o.y });
    e.style.fontSize = (o.size || 96) + 'px';
    if (o.weight) e.style.fontWeight = o.weight;
    if (o.align) e.style.textAlign = o.align;
    const words = [], lines = [];
    o.lines.forEach((ln, li) => {
      const L = typeof ln === 'string' ? { text: ln } : ln;
      const le = el('div', 'line' + (L.grad ? ' grad' : '') + (L.muted ? ' muted' : ''), e);
      if (o.align === 'center') le.style.margin = '0 auto';
      const ws = L.text.split(' ');
      ws.forEach((w, wi) => {
        const wm = el('span', 'wm', le), wi_ = el('span', 'wi', wm, esc(w));
        words.push({ wm, wi: wi_, li, idx: words.length });
        if (wi < ws.length - 1) le.appendChild(document.createTextNode(' '));
      });
      lines.push({ le, L });
    });
    const at = o.at || 0, st = o.stagger == null ? 0.06 : o.stagger, lg = o.lineGap == null ? 0.12 : o.lineGap;
    return reg({
      el: e,
      layout() {
        for (const { le, L } of lines) if (L.grad) {
          const lw = le.getBoundingClientRect().width / S.viewScale, lx = le.getBoundingClientRect().left;
          for (const wd of words) if (wd.wi.parentNode.parentNode === le) {
            const ox = (wd.wi.getBoundingClientRect().left - lx) / S.viewScale;
            wd.wi.style.backgroundSize = `${lw.toFixed(1)}px 100%`;
            wd.wi.style.backgroundPosition = `${(-ox).toFixed(1)}px 0`;
          }
        }
      },
      update(t) {
        for (const w of words) {
          const t0 = at + w.idx * st + w.li * lg;
          const p = ease.easeOutExpo(progress(t, t0, t0 + 0.95));
          const op = ease.easeOutCubic(progress(t, t0, t0 + 0.45));
          let pout = 0;
          if (o.out != null) pout = ease.easeInCubic(progress(t, o.out + w.idx * 0.025, o.out + w.idx * 0.025 + 0.45));
          style(w.wi, { o: op * (1 - pout), y: (1 - p) * 1.05 * (o.size || 96) - pout * 0.6 * (o.size || 96), blur: (1 - p) * 10 + pout * 6 });
        }
      },
    });
  }
  /* Text({html, at, out, x, y, w, cls='at-sub', parent, y0=18}) a paragraph with the generic reveal. */
  function Text(o) {
    const S = current, e = el('div', o.cls || 'at-sub', o.parent || S.world, o.html); place(e, o);
    return reg({ el: e, update(t) { show(e, t, { at: o.at || 0, out: o.out, y: o.y0 == null ? 18 : o.y0, blur: 6 }); } });
  }

  /* ---------- terminal ---------- */
  /*
   * Terminal({x, y, w, h, title, at, out, fontSize=21, lineHeight=1.6, prompt='$', wrap=false, seed, parent,
   *           lines:[ {cmd:'curl ...', at, cps=34 | dur}, {out:'text' | [[text, color], ...], at, color},
   *                   {out:['l1','l2'], at, step=0.035}, {blank:true, at}, {prompt:true, at} ]})
   * Commands type per character with seeded human jitter; outputs appear whole. Colors:
   * green yellow red blue magenta cyan dim white bold. Body auto-scrolls (eased) to keep the newest line.
   * Text is literal (no markup), so real transcript output is safe to paste in.
   */
  function Terminal(o) {
    const S = current, e = el('div', 'at-panel at-term', o.parent || S.world); place(e, o);
    const bar = el('div', 'at-bar', e, '<div class="at-lights"><i></i><i></i><i></i></div>');
    el('div', 'title', bar, esc(o.title || 'zsh'));
    const body = el('div', 'body', e), sc = el('div', 'scroll', body);
    body.style.setProperty('--fs', (o.fontSize || 21) + 'px'); body.style.setProperty('--lh', String(o.lineHeight || 1.6));
    const R = rng(o.seed || hash(JSON.stringify(o.lines).slice(0, 200)));
    const prompt = o.prompt == null ? '$' : o.prompt;
    const L = [];
    for (const spec of o.lines) {
      if (spec.out && Array.isArray(spec.out) && spec.out.length && (typeof spec.out[0] === 'string' || Array.isArray(spec.out[0]) && Array.isArray(spec.out[0][0]))) {
        spec.out.forEach((ln, i) => L.push({ kind: 'out', segs: segs(ln, spec.color), at: spec.at + i * (spec.step == null ? 0.035 : spec.step) }));
      } else if (spec.out != null) L.push({ kind: 'out', segs: segs(spec.out, spec.color), at: spec.at });
      else if (spec.blank) L.push({ kind: 'out', segs: [], at: spec.at });
      else if (spec.cmd != null || spec.prompt) {
        const text = spec.cmd || '', cps = spec.cps || 34;
        const times = []; let acc = 0;
        for (let i = 0; i < text.length; i++) {
          times.push(acc);
          let d = (1 / cps) * (0.55 + 0.9 * R());
          if (text[i] === ' ') d *= 1.5;
          if ('/-|."'.includes(text[i])) d *= 1.25;
          acc += d;
        }
        if (spec.dur) { const k = spec.dur / Math.max(acc, 1e-6); for (let i = 0; i < times.length; i++) times[i] *= k; acc = spec.dur; }
        L.push({ kind: 'cmd', text, at: spec.at, times: times.map(x => x + spec.at), end: spec.at + acc, cls: spec.color });
      }
    }
    function segs(v, color) { return typeof v === 'string' ? [[v, color]] : v; }
    L.sort((a, b) => a.at - b.at);
    for (const ln of L) {
      ln.el = el('div', 'ln' + (o.wrap ? ' wrap' : ''), sc);
      if (ln.kind === 'out') ln.el.innerHTML = ln.segs.map(([s, c]) => c ? `<span class="${c.split(' ').map(x => 'c-' + x).join(' ')}">${esc(s)}</span>` : esc(s)).join('');
    }
    let tops = [], bodyH = 0;
    return reg({
      el: e,
      layout() {
        // measure every line at full content so wrapped lines scroll correctly
        for (const ln of L) if (ln.kind === 'cmd') ln.el.innerHTML = `<span class="pr">${esc(prompt)} </span>${esc(ln.text)}`;
        const st = getComputedStyle(body);
        bodyH = body.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
        const b0 = sc.getBoundingClientRect().top;
        tops = L.map(ln => { const r = ln.el.getBoundingClientRect(); return [(r.top - b0) / S.viewScale, (r.bottom - b0) / S.viewScale]; });
      },
      update(t) {
        show(e, t, { at: o.at || 0, out: o.out, y: 32, blur: 10, scale: 0.985, dur: 0.8 });
        let last = -1, caretLine = -1, typing = false, lastActivity = 0;
        L.forEach((ln, i) => {
          const vis = t >= ln.at;
          ln.el.style.visibility = vis ? 'visible' : 'hidden';
          if (!vis) return;
          last = i; lastActivity = ln.kind === 'cmd' ? Math.min(t, ln.end) : ln.at;
          if (ln.kind === 'cmd') {
            let n = 0; while (n < ln.times.length && ln.times[n] <= t) n++;
            ln.n = n; typing = n < ln.text.length; caretLine = i;
          } else caretLine = -1;
        });
        L.forEach((ln, i) => {
          if (ln.kind !== 'cmd' || t < ln.at) return;
          const caretOn = i === caretLine && (typing || ((t - lastActivity) % 1.06) < 0.58);
          ln.el.innerHTML = `<span class="pr">${esc(prompt)} </span>${ln.cls ? `<span class="c-${ln.cls}">` : ''}${esc(ln.text.slice(0, ln.n))}${ln.cls ? '</span>' : ''}` +
            (caretOn ? '<span class="caret"></span>' : '');
        });
        // eased auto-scroll: target keeps the newest visible line inside the body
        let y = 0;
        if (last >= 0 && bodyH) {
          const target = i => Math.max(0, tops[i][1] - bodyH);
          const prev = last > 0 ? target(last - 1) : 0;
          y = lerp(prev, target(last), ease.easeOutCubic(progress(t, L[last].at, L[last].at + 0.22)));
        }
        sc.style.transform = y ? `translateY(${(-y).toFixed(2)}px)` : 'none';
      },
    });
  }
  /* typed(text, t, t0, cps=34, seed) -> visible prefix; standalone typewriter for any element. */
  function typed(text, t, t0, cps = 34, seed = 1) {
    const R = rng(seed); let acc = t0, n = 0;
    for (let i = 0; i < text.length; i++) { if (acc > t) break; n = i + 1; acc += (1 / cps) * (0.55 + 0.9 * R()); }
    return t < t0 ? '' : text.slice(0, n);
  }

  /* ---------- browser ---------- */
  const ICON = {
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
    fwd: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3 5 5-5 5"/></svg>',
    reload: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3"/></svg>',
    lock: '<svg class="lock" viewBox="0 0 12 12" fill="currentColor"><path d="M3 5V3.8a3 3 0 0 1 6 0V5h.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5zm1.2 0h3.6V3.8a1.8 1.8 0 0 0-3.6 0z"/></svg>',
    info: '<svg class="lock" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="6" cy="6" r="4.8"/><path d="M6 5.4v3M6 3.6v.1"/></svg>',
  };
  /*
   * Browser({x, y, w, h, url, tabs:['AgentToll'], img:src | content:Element|html, at, out,
   *          typeUrl:{at, cps}, scroll:f(t)->px | [[t, px, ease], ...], secure=false, parent})
   * macOS browser window. The page (image or live HTML) sits in .view; scroll moves it vertically.
   */
  function Browser(o) {
    const S = current, e = el('div', 'at-panel at-browser', o.parent || S.world); place(e, o);
    const tabs = el('div', 'tabs', e, '<div class="at-lights"><i></i><i></i><i></i></div>');
    (o.tabs || ['AgentToll']).forEach((tt, i) => el('div', 'tab' + (i === 0 ? ' on' : ''), tabs, (i === 0 ? '<span class="fav"></span>' : '') + esc(tt)));
    const tool = el('div', 'tool', e, `<div class="nav">${ICON.back}${ICON.fwd}${ICON.reload}</div>`);
    const url = el('div', 'url', tool), urlTxt = el('span', null, null);
    url.innerHTML = o.secure ? ICON.lock : ICON.info; url.appendChild(urlTxt);
    const view = el('div', 'view', e), content = el('div', 'content', view);
    if (o.img) img(o.img, null, content);
    else if (o.content instanceof Element) content.appendChild(o.content);
    else if (o.content) content.innerHTML = o.content;
    const sc = typeof o.scroll === 'function' ? o.scroll : Array.isArray(o.scroll) ? track(o.scroll) : () => 0;
    const fmtUrl = u => { const m = u.match(/^(\w+:\/\/)?([^/]+)(.*)$/); return m ? `<span class="host">${esc((m[1] || '') + m[2])}</span>${esc(m[3])}` : esc(u); };
    return reg({
      el: e, view, content,
      update(t) {
        show(e, t, { at: o.at || 0, out: o.out, y: 32, blur: 10, scale: 0.985, dur: 0.8 });
        const u = o.typeUrl ? typed(o.url || '', t, o.typeUrl.at, o.typeUrl.cps || 40, 3) : (o.url || '');
        urlTxt.innerHTML = fmtUrl(u);
        const y = sc(t);
        content.style.transform = y ? `translateY(${(-y).toFixed(2)}px)` : 'none';
      },
    });
  }

  /* ---------- cursor ---------- */
  const ARROW = '<svg width="32" height="32" viewBox="0 0 32 32"><path d="M6.2 3.6v21.3l5.1-4.9 3.4 7.8 3.6-1.5-3.3-7.7h7.1z" fill="#0B0A1A" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  /*
   * Cursor({path:[{t, x, y} | {t, at:'#sel', ax=0.5, ay=0.5, dx, dy}, click:true|secs, move:secs, arc], at, out,
   *         size=1.35, overshoot=1, parent})
   * The hotspot reaches each waypoint at its t. Moves follow a curved cubic bezier (arc = bow as a
   * fraction of distance, alternating side), eased in-out with a slight overshoot that settles.
   * click:true clicks 0.08 s after arrival: press scale + ripple. Selectors resolve in layout().
   */
  function Cursor(o) {
    const S = current, parent = o.parent || S.world;
    const e = el('div', 'at-cursor', parent, ARROW);
    const size = o.size || 1.35, ov = o.overshoot == null ? 1 : o.overshoot;
    const pts = o.path.map(p => Object.assign({}, p));
    const clicks = [];
    const ripples = [];
    function bez(p0, p1, p2, p3, u) { const v = 1 - u; return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3; }
    function resolve() {
      pts.forEach(p => {
        if (p.at) { const r = S.rect(p.at, parent); p.x = r[0] + r[2] * (p.ax == null ? 0.5 : p.ax) + (p.dx || 0); p.y = r[1] + r[3] * (p.ay == null ? 0.5 : p.ay) + (p.dy || 0); }
      });
      clicks.length = 0;
      pts.forEach(p => { if (p.click) clicks.push({ t: p.t + (p.click === true ? 0.08 : p.click), x: p.x, y: p.y }); });
      while (ripples.length < clicks.length) ripples.push(el('div', 'at-ripple', parent));
    }
    function pos(t) {
      if (t <= pts[0].t) return [pts[0].x, pts[0].y];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (t > b.t) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
        const mv = Math.min(b.move || clamp(0.42 + dist / 2600, 0.42, 1.1), b.t - a.t);
        const t0 = b.t - mv;
        if (t <= t0 || dist < 0.5) return [a.x, a.y];
        const p = (t - t0) / mv;
        const u = ease.easeInOutCubic(p) + 0.06 * ov * Math.sin(Math.PI * p) * p * p * p;
        const side = (b.arc != null ? Math.sign(b.arc) || 1 : (i % 2 ? 1 : -1)), bow = Math.abs(b.arc != null ? b.arc : 0.16) * dist * side;
        const nx = -dy / (dist || 1), ny = dx / (dist || 1);
        const c1x = a.x + dx * 0.28 + nx * bow, c1y = a.y + dy * 0.28 + ny * bow;
        const c2x = a.x + dx * 0.78 + nx * bow * 0.55, c2y = a.y + dy * 0.78 + ny * bow * 0.55;
        return [bez(a.x, c1x, c2x, b.x, u), bez(a.y, c1y, c2y, b.y, u)];
      }
      const z = pts[pts.length - 1]; return [z.x, z.y];
    }
    return reg({
      el: e,
      layout: resolve,
      update(t) {
        if (!clicks.length && pts.some(p => p.click)) resolve();
        const [x, y] = pos(t);
        let press = 0;
        for (const c of clicks) {
          if (t >= c.t - 0.06 && t < c.t) press = Math.max(press, ease.easeOutQuad(progress(t, c.t - 0.06, c.t)));
          else if (t >= c.t && t < c.t + 0.18) press = Math.max(press, 1 - ease.easeOutCubic(progress(t, c.t, c.t + 0.18)));
        }
        const vin = o.at == null ? 1 : ease.easeOutCubic(progress(t, o.at, o.at + 0.3));
        const vout = o.out == null ? 1 : 1 - ease.easeInCubic(progress(t, o.out, o.out + 0.3));
        const s = size * (1 - 0.14 * press);
        e.style.opacity = String((vin * vout).toFixed(3));
        e.style.visibility = vin * vout > 0.001 ? 'visible' : 'hidden';
        e.style.transform = `translate(${(x - 6.2).toFixed(2)}px,${(y - 3.6).toFixed(2)}px) scale(${s.toFixed(4)})`;
        clicks.forEach((c, i) => {
          const r = ripples[i], p = progress(t, c.t, c.t + 0.6);
          if (t < c.t || p >= 1) { r.style.visibility = 'hidden'; return; }
          const rad = lerp(6, 38, ease.easeOutCubic(p));
          r.style.visibility = 'visible';
          r.style.width = r.style.height = (rad * 2).toFixed(2) + 'px';
          r.style.transform = `translate(${(c.x - rad).toFixed(2)}px,${(c.y - rad).toFixed(2)}px)`;
          r.style.opacity = ((1 - ease.easeOutQuad(p)) * 0.9).toFixed(3);
        });
      },
    });
  }

  /* ---------- camera ---------- */
  /*
   * Camera({keys:[{t, to:'full' | [x,y,w,h] | '#sel', dur=0.8, ease=easeInOutCubic, pad=48}], target=S.world,
   *         motionBlur=0.6, clamp=true})
   * Screen Studio style zoom/pan. Scale interpolates in log space, the focus point linearly, so a
   * zoom reads as one smooth push. clamp keeps the world filling the frame. Velocity drives a
   * sub-pixel blur (<= 1.2 px) during fast moves only.
   */
  function Camera(o) {
    const S = current, target = o.target || S.world;
    const keys = o.keys.map(k => Object.assign({ dur: 0.8, pad: 48 }, k)).sort((a, b) => a.t - b.t);
    const full = { s: 1, cx: W / 2, cy: H / 2 };
    function stateFor(k) {
      if (k.to === 'full' || k.to == null) return full;
      const r = typeof k.to === 'string' ? S.rect(k.to, target) : k.to;
      const s = k.scale || Math.min(W / (r[2] + 2 * k.pad), H / (r[3] + 2 * k.pad));
      return { s: Math.max(1, s), cx: r[0] + r[2] / 2, cy: r[1] + r[3] / 2 };
    }
    let states = null;
    function at(t) {
      let cur = full;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (t < k.t) break;
        const p = (k.ease || ease.easeInOutCubic)(progress(t, k.t, k.t + k.dur));
        const nx = states[i];
        cur = { s: Math.exp(lerp(Math.log(cur.s), Math.log(nx.s), p)), cx: lerp(cur.cx, nx.cx, p), cy: lerp(cur.cy, nx.cy, p) };
      }
      return cur;
    }
    function xf(st) {
      let tx = W / 2 - st.s * st.cx, ty = H / 2 - st.s * st.cy;
      if (o.clamp !== false) { tx = clamp(tx, W - st.s * W, 0); ty = clamp(ty, H - st.s * H, 0); }
      return { tx, ty, s: st.s };
    }
    const cam = {
      el: target,
      layout() { states = keys.map(stateFor); },
      state: t => { if (!states) states = keys.map(stateFor); return xf(at(t)); },
      update(t) {
        if (!states) states = keys.map(stateFor);
        const a = xf(at(t)), b = xf(at(Math.max(0, t - 1 / 60)));
        target.style.transform = (a.s === 1 && !a.tx && !a.ty) ? 'none' : `translate(${a.tx.toFixed(2)}px,${a.ty.toFixed(2)}px) scale(${a.s.toFixed(5)})`;
        const v = Math.hypot(a.tx - b.tx, a.ty - b.ty) + Math.abs(Math.log(a.s / b.s)) * 900;
        const mb = (o.motionBlur == null ? 0.6 : o.motionBlur) * clamp((v - 4) / 30, 0, 2);
        target.style.filter = mb > 0.08 ? `blur(${mb.toFixed(2)}px)` : 'none';
      },
    };
    if (target === S.world) S.camera = cam;
    return reg(cam);
  }

  /* ---------- caption ---------- */
  /*
   * Caption({cues:[{at, end, text, hl:['word',...], gold:['$0.002']}], bottom=72, size=34, wordStep, parent=S.overlay})
   * Loom-style caption pill. The pill sizes to the full cue, words fade up one by one.
   */
  function Caption(o) {
    const S = current, parent = o.parent || S.overlay;
    const cues = o.cues.map(c => {
      const e = el('div', 'at-caption', parent);
      if (o.size) e.style.fontSize = o.size + 'px';
      if (o.bottom != null) e.style.bottom = o.bottom + 'px';
      const words = c.text.split(' ').map((w, i, a) => {
        const cls = (c.gold || []).includes(w) ? 'w gold' : (c.hl || []).includes(w) ? 'w hl' : 'w';
        return el('span', cls, e, esc(w + (i < a.length - 1 ? ' ' : '')));
      });
      const step = o.wordStep || Math.min(0.085, (0.4 * (c.end - c.at)) / words.length);
      return { c, e, words, step };
    });
    return reg({
      el: parent,
      update(t) {
        for (const q of cues) {
          const pin = ease.easeOutExpo(progress(t, q.c.at - 0.08, q.c.at + 0.4));
          const pout = ease.easeInCubic(progress(t, q.c.end, q.c.end + 0.3));
          const vis = ease.easeOutCubic(progress(t, q.c.at - 0.08, q.c.at + 0.2)) * (1 - pout);
          q.e.style.opacity = vis.toFixed(3); q.e.style.visibility = vis > 0.001 ? 'visible' : 'hidden';
          q.e.style.transform = `translateX(-50%) translateY(${((1 - pin) * 14 + pout * 6).toFixed(2)}px) scale(${(0.97 + 0.03 * pin).toFixed(4)})`;
          q.words.forEach((w, i) => {
            const t0 = q.c.at + i * q.step;
            const p = ease.easeOutCubic(progress(t, t0, t0 + 0.22));
            w.style.opacity = (0.0 + p).toFixed(3);
            w.style.transform = p < 1 ? `translateY(${((1 - p) * 8).toFixed(2)}px)` : 'none';
            w.style.filter = p < 1 ? `blur(${((1 - p) * 3).toFixed(2)}px)` : 'none';
          });
        }
      },
    });
  }

  /* ---------- badge ---------- */
  const COIN = '<svg class="ico" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#0B0A1A" opacity="0.9"/><circle cx="9" cy="9" r="5.6" fill="none" stroke="#FBBF24" stroke-width="1.4"/><path d="M9 5.6v6.8" stroke="#FBBF24" stroke-width="1.4" stroke-linecap="round"/></svg>';
  /*
   * Badge({text='SIMULATED · no funds moved', at, out, x, y, right, bottom, parent=S.overlay, size})
   * Gold pill. Enters on an underdamped spring (about 12% overshoot), then one shine sweep.
   * The part before " · " is set in tracked caps weight; the rest reads as a note.
   */
  function Badge(o = {}) {
    const S = current, parent = o.parent || S.overlay;
    const text = o.text || 'SIMULATED · no funds moved';
    const [k, ...rest] = text.split(' · ');
    const e = el('div', 'at-badge', parent, `${COIN}<span class="k">${esc(k)}</span>${rest.length ? `<span class="s">· ${esc(rest.join(' · '))}</span>` : ''}`);
    const sh = el('div', 'shine', e);
    place(e, o);
    if (o.size) e.style.fontSize = o.size + 'px';
    e.style.transformOrigin = o.right != null ? '100% 50%' : '0 50%';
    const at = o.at || 0;
    return reg({
      el: e,
      update(t) {
        const sp = spring(t - at, 320, 19);
        const op = ease.easeOutCubic(progress(t, at, at + 0.18));
        const pout = o.out == null ? 0 : ease.easeInCubic(progress(t, o.out, o.out + 0.35));
        style(e, { o: op * (1 - pout), s: lerp(0.62, 1, sp) * (1 - 0.1 * pout), y: (1 - Math.min(sp, 1)) * 6 });
        const ps = progress(t, at + 0.35, at + 1.15);
        sh.style.visibility = ps > 0 && ps < 1 ? 'visible' : 'hidden';
        sh.style.transform = `translateX(${lerp(-90, e.offsetWidth + 20, ease.easeInOutCubic(ps)).toFixed(1)}px) skewX(-18deg)`;
      },
    });
  }

  /* ---------- ticker ---------- */
  /*
   * Ticker({to, from=0, at, dur=1.4, decimals=0, prefix, suffix, format(v), label, x, y, card=true, size, parent})
   * Number counts up with easeOutExpo in tabular figures, then a small spring pop on landing.
   * card:false returns a bare inline number (.at-num) you can style yourself.
   */
  function Ticker(o) {
    const S = current, parent = o.parent || S.world;
    const card = o.card !== false;
    const e = el('div', card ? 'at-stat' : 'at-abs at-num', parent); place(e, o);
    const num = card ? el('div', 'num', e) : e;
    if (o.size) num.style.fontSize = o.size + 'px';
    if (card && o.label) el('div', 'lab', e, esc(o.label));
    const fmt = o.format || (v => (o.prefix || '') + v.toFixed(o.decimals || 0) + (o.suffix || ''));
    const at = o.at || 0, dur = o.dur || 1.4, from = o.from || 0;
    return reg({
      el: e,
      update(t) {
        show(e, t, { at: at - 0.25, out: o.out, y: 20, blur: 6, dur: 0.7 });
        const p = ease.easeOutExpo(progress(t, at, at + dur));
        const v = from + (o.to - from) * p;
        num.textContent = fmt(p >= 1 ? o.to : (o.decimals ? v : Math.floor(v)));
        const pop = t > at + dur * 0.62 ? spring(t - at - dur * 0.62, 400, 16) : 0;
        num.style.transform = `scale(${(1 + 0.05 * Math.sin(Math.PI * clamp(pop, 0, 1)) * (pop < 1 ? 1 : 0)).toFixed(4)})`;
        num.style.transformOrigin = '0 70%';
      },
    });
  }

  /* ---------- diagram ---------- */
  /*
   * Diagram({x, y, w, h, parent,
   *   nodes:[{id, x, y (centre), w=280, h=112, tag, title, sub, at, out, active:[[t0,t1],...]}],
   *   edges:[{id, from, to, at, dur=0.6, lane=0, fromSide, toSide, color}],
   *   packets:[{edge, at, dur=0.9, label, color='#2DD4BF', reverse=false, chipSide=-1}]})
   * Edges draw in along their length; packets glide along an edge with a comet tail and a label chip;
   * the receiving node pulses when a packet lands; active ranges light the gradient ring.
   */
  function Diagram(o) {
    const S = current, root = el('div', 'at-diagram', o.parent || S.world); place(root, o);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'edges');
    svg.setAttribute('width', o.w); svg.setAttribute('height', o.h); root.appendChild(svg);
    const sv = (tag, attrs, parent = svg) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
    const defs = sv('defs', {});
    const lg = sv('linearGradient', { id: 'atg', x1: 0, y1: 0, x2: 1, y2: 0, gradientUnits: 'objectBoundingBox' }, defs);
    sv('stop', { offset: 0, 'stop-color': '#8B5CF6' }, lg); sv('stop', { offset: 0.5, 'stop-color': '#3B82F6' }, lg); sv('stop', { offset: 1, 'stop-color': '#2DD4BF' }, lg);
    const N = {};
    for (const n of o.nodes) {
      const w = n.w || 280, h = n.h || 112;
      const e = el('div', 'at-node', root); place(e, { x: n.x - w / 2, y: n.y - h / 2, w, h });
      const glow = el('div', 'glow', e), ring = el('div', 'ring', e);
      if (n.tag) el('div', 'tag', e, esc(n.tag));
      el('div', 'nt', e, esc(n.title));
      if (n.sub) el('div', 'ns', e, esc(n.sub));
      N[n.id] = Object.assign({}, n, { w, h, e, glow, ring });
    }
    function anchor(n, side, lane) {
      const p = { l: [n.x - n.w / 2, n.y], r: [n.x + n.w / 2, n.y], t: [n.x, n.y - n.h / 2], b: [n.x, n.y + n.h / 2] }[side];
      return side === 'l' || side === 'r' ? [p[0], p[1] + lane] : [p[0] + lane, p[1]];
    }
    const dirs = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
    const E = {};
    for (const ed of o.edges) {
      const a = N[ed.from], b = N[ed.to], dx = b.x - a.x, dy = b.y - a.y;
      const horiz = Math.abs(dx) >= Math.abs(dy);
      const fs = ed.fromSide || (horiz ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't'));
      const ts = ed.toSide || (horiz ? (dx > 0 ? 'l' : 'r') : (dy > 0 ? 't' : 'b'));
      const lane = ed.lane || 0;
      const p0 = anchor(a, fs, lane), p3 = anchor(b, ts, lane);
      const k = Math.max(40, 0.45 * Math.hypot(p3[0] - p0[0], p3[1] - p0[1]));
      const c1 = [p0[0] + dirs[fs][0] * k, p0[1] + dirs[fs][1] * k], c2 = [p3[0] + dirs[ts][0] * k, p3[1] + dirs[ts][1] * k];
      const d = `M${p0[0]},${p0[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p3[0]},${p3[1]}`;
      const base = sv('path', { d, fill: 'none', stroke: 'rgba(255,255,255,0.16)', 'stroke-width': 2, 'stroke-linecap': 'round' });
      const hot = sv('path', { d, fill: 'none', stroke: ed.color || '#2DD4BF', 'stroke-width': 2.5, 'stroke-linecap': 'round', opacity: 0 });
      const dots = [sv('circle', { cx: p0[0], cy: p0[1], r: 4, fill: 'rgba(255,255,255,0.35)' }), sv('circle', { cx: p3[0], cy: p3[1], r: 4, fill: 'rgba(255,255,255,0.35)' })];
      const len = base.getTotalLength();
      base.setAttribute('stroke-dasharray', `${len} ${len}`);
      E[ed.id] = Object.assign({}, ed, { base, hot, dots, len, to: ed.to, from: ed.from, vertical: !horiz });
    }
    const P = (o.packets || []).map(pk => {
      const g = sv('g', {});
      const tail = [0.10, 0.06, 0.03].map((dl, i) => sv('circle', { r: 6 - i * 1.5, fill: pk.color || '#2DD4BF', opacity: 0.35 - i * 0.09 }, g));
      const halo = sv('circle', { r: 16, fill: pk.color || '#2DD4BF', opacity: 0.18 }, g);
      const core = sv('circle', { r: 6.5, fill: '#FFFFFF' }, g);
      const ring = sv('circle', { r: 6.5, fill: 'none', stroke: pk.color || '#2DD4BF', 'stroke-width': 2.5 }, g);
      const chip = pk.label ? el('div', 'at-chip', root, `<span>${esc(pk.label)}</span>`) : null;
      if (chip) chip.style.color = pk.color || '#2DD4BF';
      return Object.assign({ dur: 0.9 }, pk, { g, tail, halo, core, ring, chip });
    });
    function pointAt(edge, u, rev) { const L = edge.len * clamp(rev ? 1 - u : u, 0, 1); return edge.base.getPointAtLength(L); }
    return reg({
      el: root,
      update(t) {
        for (const id in N) {
          const n = N[id];
          show(n.e, t, { at: n.at || 0, out: n.out, y: 18, blur: 8, scale: 0.96, dur: 0.75 });
          let act = 0;
          for (const [a, b] of n.active || []) act = Math.max(act, ease.easeOutCubic(progress(t, a, a + 0.3)) * (1 - ease.easeInCubic(progress(t, b, b + 0.3))));
          let pulse = 0;
          for (const pk of P) { const e2 = E[pk.edge]; const dst = pk.reverse ? e2.from : e2.to; if (dst === id) { const ta = pk.at + pk.dur; if (t >= ta) pulse = Math.max(pulse, 1 - ease.easeOutCubic(progress(t, ta, ta + 0.7))); } }
          n.ring.style.opacity = Math.max(act, pulse * 0.9).toFixed(3);
          n.glow.style.opacity = Math.max(act * 0.6, pulse).toFixed(3);
        }
        for (const id in E) {
          const ed = E[id];
          const p = ease.easeInOutCubic(progress(t, ed.at || 0, (ed.at || 0) + (ed.dur || 0.6)));
          ed.base.setAttribute('stroke-dashoffset', (ed.len * (1 - p)).toFixed(2));
          ed.base.style.visibility = p > 0 ? 'visible' : 'hidden';
          ed.dots[0].setAttribute('opacity', p > 0 ? 1 : 0); ed.dots[1].setAttribute('opacity', p >= 1 ? 1 : 0);
          let hot = 0;
          for (const pk of P) if (pk.edge === id) hot = Math.max(hot, ease.easeOutCubic(progress(t, pk.at - 0.1, pk.at + 0.15)) * (1 - ease.easeInCubic(progress(t, pk.at + pk.dur, pk.at + pk.dur + 0.5))));
          ed.hot.setAttribute('opacity', (hot * 0.85).toFixed(3));
        }
        for (const pk of P) {
          const ed = E[pk.edge], raw = progress(t, pk.at, pk.at + pk.dur);
          const live = t >= pk.at && t <= pk.at + pk.dur + 0.25;
          pk.g.style.visibility = live ? 'visible' : 'hidden';
          if (pk.chip) pk.chip.style.visibility = live ? 'visible' : 'hidden';
          if (!live) continue;
          const u = (pk.ease || ease.easeInOutCubic)(raw);
          const fade = ease.easeOutCubic(progress(t, pk.at, pk.at + 0.12)) * (1 - ease.easeInCubic(progress(t, pk.at + pk.dur, pk.at + pk.dur + 0.25)));
          const pt = pointAt(ed, u, pk.reverse);
          pk.g.setAttribute('opacity', fade.toFixed(3));
          [pk.core, pk.ring, pk.halo].forEach(c => { c.setAttribute('cx', pt.x.toFixed(2)); c.setAttribute('cy', pt.y.toFixed(2)); });
          pk.tail.forEach((c, i) => { const q = pointAt(ed, (pk.ease || ease.easeInOutCubic)(progress(t - 0.035 * (i + 1), pk.at, pk.at + pk.dur)), pk.reverse); c.setAttribute('cx', q.x.toFixed(2)); c.setAttribute('cy', q.y.toFixed(2)); });
          if (pk.chip) {
            // chips sit beside vertical edges and above/below horizontal ones; they clear the nodes
            // by fading in after 12% of the trip and out before 88%.
            const side = pk.chipSide || -1, vert = ed.vertical;
            const cw = pk.chip.offsetWidth, ch = pk.chip.offsetHeight;
            const cx = vert ? (side < 0 ? pt.x + 24 : pt.x - 24 - cw) : pt.x - cw / 2;
            const cy = vert ? pt.y - ch / 2 : (side < 0 ? pt.y - 22 - ch : pt.y + 22);
            const cf = ease.easeOutCubic(progress(raw, 0.06, 0.18)) * (1 - ease.easeInCubic(progress(raw, 0.8, 0.94)));
            pk.chip.style.opacity = cf.toFixed(3);
            pk.chip.style.transform = `translate(${cx.toFixed(2)}px,${(cy + (1 - cf) * 6).toFixed(2)}px)`;
          }
        }
      },
    });
  }

  window.AT = Object.assign({
    W, H, clamp, lerp, progress, ease, spring, tween, track, mix, rng, hash, el, esc, img, place, style, show, typed,
    scene, MeshBackground, Grain, Chrome, Progress, SectionLabel, Headline, Text, Terminal, Browser, Cursor, Camera,
    Caption, Badge, Ticker, Diagram,
    get current() { return current; },
  }, ease);
})();
