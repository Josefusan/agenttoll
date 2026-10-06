#!/usr/bin/env node
// Music bed + UI sound design for an AgentToll film, synthesized from the scene's own cue list.
//
//   node video/render/render.mjs --scene video/scenes/hero/index.html --cues /tmp/hero.cues.json
//   node video/render/audio.mjs --cues /tmp/hero.cues.json --out ~/agenttoll/scratch/film-out/hero.wav [--seed 7]
//
// Everything is generated here from oscillators and seeded noise: no samples, no third-party
// audio, so the track is ours to release (CC0, see video/assets/audio/LICENSE.md).
// Deterministic: same cues + seed -> same samples. Output: 48 kHz stereo 24-bit WAV, peak-limited;
// loudness is set afterwards by video/render/mux.sh (ffmpeg loudnorm, two-pass).
//
// Cue kinds (from AT.sfx): thud riser lift coin deny click key tick whoosh pop.
// AT.duck(t0, t1, db) lowers the bed under dense passages; AT.swell(t0, t1) lifts it into the close.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, k, i, arr) => (k.startsWith('--') ? [...a, [k.slice(2), arr[i + 1]]] : a), []));
const expand = p => p && p.replace(/^~(?=$|\/)/, os.homedir());
if (!args.cues || !args.out) { console.error('usage: audio.mjs --cues cues.json --out out.wav [--seed 7] [--bpm 100]'); process.exit(2); }
const cues = JSON.parse(fs.readFileSync(expand(args.cues), 'utf8'));
const SR = 48000, DUR = cues.duration, N = Math.ceil((DUR + 0.05) * SR);
const BPM = Number(args.bpm || 100), BEAT = 60 / BPM, BAR = 4 * BEAT;
let seed = Number(args.seed || 7) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const db = d => Math.pow(10, d / 20);

// buses: music (dry), music send, sfx (dry), sfx send -> reverb; all stereo
const bus = () => [new Float32Array(N), new Float32Array(N)];
const music = bus(), musicSend = bus(), fx = bus(), fxSend = bus();
function add(b, i, l, r) { if (i >= 0 && i < N) { b[0][i] += l; b[1][i] += r; } }
const panLR = p => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

/* ------------------------------------------------------------------ music bed
   100 BPM, Am9 - Fmaj7#11 - Cmaj7 - G6, two bars each. Layers enter with the film: a sub drone
   under the cold open, the pad after the logo lands, pulse (kick, hats, plucked arpeggio) once
   the story starts. */
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 67, 71] },   // Am9
  { root: 41, pad: [57, 60, 64, 65, 71] },   // Fmaj7#11 (A C E F B over F)
  { root: 48, pad: [55, 59, 60, 64, 67] },   // Cmaj7
  { root: 43, pad: [55, 59, 62, 64, 67] },   // G6
];
const CHORD_LEN = 2 * BAR;
const sfxT = k => (cues.sfx.find(c => c.kind === k) || {}).t;
const tLift = sfxT('lift') ?? 2;            // pad enters with the logo
const tPulse = Math.min(DUR, Math.max(tLift + 2.5, 5));   // groove after the open
const tEnd = DUR;

// gain automation: ducks, swell, fade in/out
function bedGain(t) {
  let g = 1;
  for (const d of cues.duck || []) { const a = clamp((t - d.t0) / 0.6, 0, 1) * (1 - clamp((t - d.t1) / 0.6, 0, 1)); g *= Math.pow(db(d.db), a); }
  for (const s of cues.swell || []) { const a = clamp((t - s.t0) / 1.2, 0, 1); g *= Math.pow(db(4), a); }
  g *= clamp(t / 0.25, 0, 1) * clamp((tEnd - t) / 1.6, 0, 1);
  return g;
}

// PolyBLEP saw
function blep(t, dt) { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
// state-variable lowpass per voice
class SVF { constructor() { this.l = 0; this.b = 0; } lp(x, fc, q = 0.7) { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR); this.l += f * this.b; const h = x - this.l - q * this.b; this.b += f * h; return this.l; } }

{
  // pad: per chord, each note = 3 detuned saws -> lowpass, slow envelope, chords crossfade
  const nChords = Math.ceil(DUR / CHORD_LEN) + 1;
  for (let c = 0; c < nChords; c++) {
    const ch = CHORDS[c % CHORDS.length], t0 = c * CHORD_LEN, t1 = t0 + CHORD_LEN;
    const s0 = Math.max(0, Math.floor((t0 - 0.2) * SR)), s1 = Math.min(N, Math.floor((t1 + 2.2) * SR));
    ch.pad.forEach((m, vi) => {
      const f = mtof(m), det = [-0.07, 0, 0.065].map(c => f * Math.pow(2, c / 12));
      const ph = det.map(() => rnd()), filt = [new SVF(), new SVF()], pan = (vi / (ch.pad.length - 1)) * 1.2 - 0.6, [pl, pr] = panLR(pan);
      for (let i = s0; i < s1; i++) {
        const t = i / SR;
        if (t < tLift - 0.1) continue;
        const env = clamp((t - t0 + 0.2) / 1.4, 0, 1) * clamp((t1 + 1.8 - t) / 2.0, 0, 1) * clamp((t - tLift + 0.1) / 0.6, 0, 1);
        if (env <= 0) continue;
        let x = 0;
        for (let k = 0; k < 3; k++) { const dt = det[k] / SR; ph[k] += dt; if (ph[k] >= 1) ph[k] -= 1; x += (2 * ph[k] - 1) - blep(ph[k], dt); }
        const fc = 700 + 520 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 9.6 + vi)) + 900 * clamp((t - (cues.swell?.[0]?.t0 ?? 1e9)) / 2, 0, 1);
        const y = filt[0].lp(filt[1].lp(x / 3, fc), fc) * env * 0.085;
        const g = bedGain(t);
        add(music, i, y * pl * g, y * pr * g);
        add(musicSend, i, y * pl * g * 0.6, y * pr * g * 0.6);
      }
    });
  }
}
{
  // sub: sine on the chord root, from frame one (a low drone under the cold open), sidechained to the kick
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, c = Math.floor(t / CHORD_LEN) % CHORDS.length, f = mtof(CHORDS[c].root - 12);
    ph += f / SR; if (ph >= 1) ph -= 1;
    const beatPos = (t - tPulse) / BEAT;
    const sc = t >= tPulse ? 1 - 0.55 * Math.exp(-((beatPos - Math.floor(beatPos)) * BEAT) / 0.09) : 1;
    const env = (t < tLift ? 0.5 : 1) * sc;
    const y = Math.sin(2 * Math.PI * ph) * 0.06 * env * bedGain(t);
    add(music, i, y, y);
  }
}
function kick(t, g) {
  const s0 = Math.floor(t * SR); let ph = 0;
  for (let i = 0; i < 0.5 * SR; i++) {
    const tt = i / SR, f = 48 + 110 * Math.exp(-tt / 0.03);
    ph += f / SR;
    const y = Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.17) * g;
    add(music, s0 + i, y, y);
  }
}
function hat(t, g, pan) {
  const s0 = Math.floor(t * SR), [pl, pr] = panLR(pan); let lp = 0;
  for (let i = 0; i < 0.05 * SR; i++) { const n = rnd() * 2 - 1; const h = n - lp; lp += 0.6 * (n - lp); const y = h * Math.exp(-i / SR / 0.012) * g; add(music, s0 + i, y * pl, y * pr); }
}
function pluck(t, m, g, pan) {
  const s0 = Math.floor(t * SR), f = mtof(m), [pl, pr] = panLR(pan);
  for (let i = 0; i < 0.9 * SR; i++) {
    const tt = i / SR, ph = 2 * Math.PI * f * tt;
    const y = (Math.sin(ph) + 0.28 * Math.sin(2 * ph) + 0.1 * Math.sin(3 * ph)) * Math.exp(-tt / 0.22) * Math.min(1, tt / 0.004) * g;
    add(music, s0 + i, y * pl, y * pr); add(musicSend, s0 + i, y * pl * 0.9, y * pr * 0.9);
  }
}
{
  // pulse: kick on 1 and 3, soft offbeat hats, an 8th-note arpeggio over the chord tones
  const order = [0, 2, 4, 1, 3, 2, 4, 1];
  for (let b = 0; ; b++) {
    const t = tPulse + b * BEAT; if (t > tEnd - 1.2) break;
    const g = bedGain(t);
    const swellOn = (cues.swell || []).some(s => t >= s.t0);
    if (b % 2 === 0) kick(t, 0.3 * g);
    hat(t + BEAT / 2, 0.035 * g, (b % 2 ? 0.3 : -0.3));
    const ch = CHORDS[Math.floor(t / CHORD_LEN) % CHORDS.length];
    for (let k = 0; k < 2; k++) {
      const n = ch.pad[order[(2 * b + k) % order.length] % ch.pad.length] + 12;
      pluck(t + k * BEAT / 2, n, (swellOn ? 0.05 : 0.038) * g * (k ? 0.75 : 1), ((2 * b + k) % 4) / 2 - 0.75);
    }
  }
}

/* ------------------------------------------------------------------ sound effects */
function noiseBand(s0, len, fA, fB, env, g, pan, send = 0.4, q = 1.2) {
  const [pl, pr] = panLR(pan); const f1 = new SVF();
  for (let i = 0; i < len; i++) {
    const u = i / len, fc = fA * Math.pow(fB / fA, u), n = rnd() * 2 - 1;
    // band-pass: lowpass minus a lower lowpass
    f1.lp(n, fc, 1 / q);
    const y = f1.b * env(u) * g;
    add(fx, s0 + i, y * pl, y * pr); add(fxSend, s0 + i, y * pl * send, y * pr * send);
  }
}
function tone(s0, len, fn, g, pan, send = 0.3) {
  const [pl, pr] = panLR(pan);
  for (let i = 0; i < len; i++) { const y = fn(i / SR) * g; add(fx, s0 + i, y * pl, y * pr); add(fxSend, s0 + i, y * pl * send, y * pr * send); }
}
const SFX = {
  thud(s0, g, pan) {   // the 402 lands: sub drop + body + transient
    let ph = 0;
    tone(s0, 1.4 * SR, tt => { const f = 36 + 90 * Math.exp(-tt / 0.06); ph += f / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.45) * 0.9; }, g, pan, 0.15);
    noiseBand(s0, 0.25 * SR, 900, 180, u => Math.exp(-u * 6), 0.9 * g, pan, 0.5, 0.8);
    noiseBand(s0, 0.012 * SR, 5000, 3000, u => 1 - u, 0.5 * g, pan, 0.1);
    tone(s0, 1.6 * SR, tt => (Math.sin(2 * Math.PI * 110 * tt) + 0.5 * Math.sin(2 * Math.PI * 164.8 * tt)) * Math.exp(-tt / 0.6) * Math.min(1, tt / 0.01) * 0.22, g, pan, 0.8);
  },
  riser(s0, g, pan) { noiseBand(s0 - Math.floor(0.0 * SR), 0.82 * SR, 300, 5200, u => u * u * (1 - Math.max(0, (u - 0.94) / 0.06)), 0.55 * g, pan, 0.7, 2); },
  lift(s0, g, pan) {   // the logo: a bright open chord + sub swell
    [69, 76, 81, 83, 88].forEach((m, k) => tone(s0 + k * 0.012 * SR, 2.6 * SR, tt => Math.sin(2 * Math.PI * mtof(m) * tt) * Math.exp(-tt / 0.9) * Math.min(1, tt / 0.006) * (k ? 0.12 : 0.16), g, (k - 2) * 0.2, 0.9));
    tone(s0, 1.2 * SR, tt => Math.sin(2 * Math.PI * 55 * tt) * Math.exp(-tt / 0.5) * 0.5, g, 0, 0.1);
  },
  coin(s0, g, pan) {   // gold money moment: two bell notes
    [[88, 0], [93, 0.075]].forEach(([m, d]) => {
      const f = mtof(m);
      tone(s0 + Math.floor(d * SR), 1.2 * SR, tt => (Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt / 0.32) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * tt) * Math.exp(-tt / 0.12) + 0.12 * Math.sin(2 * Math.PI * f * 5.4 * tt) * Math.exp(-tt / 0.05)) * Math.min(1, tt / 0.002) * 0.3, g, pan, 0.6);
    });
  },
  deny(s0, g, pan) {   // muted two-step down: refused
    [[220, 0], [174.6, 0.13]].forEach(([f, d]) => {
      const lp = new SVF();
      tone(s0 + Math.floor(d * SR), 0.2 * SR, tt => { const sq = Math.sign(Math.sin(2 * Math.PI * f * tt)) * 0.6 + Math.sin(2 * Math.PI * f * tt) * 0.4; return lp.lp(sq, 900) * Math.min(1, tt / 0.004) * Math.exp(-tt / 0.09) * 0.42; }, g, pan, 0.25);
    });
  },
  click(s0, g, pan) {
    noiseBand(s0, 0.006 * SR, 4200, 2600, u => 1 - u, 0.35 * g, pan, 0.05, 1.5);
    tone(s0, 0.03 * SR, tt => Math.sin(2 * Math.PI * 1700 * tt) * Math.exp(-tt / 0.006) * 0.12, g, pan, 0.05);
  },
  key(s0, g, pan) {
    const f = 2400 + 1600 * rnd();
    noiseBand(s0, 0.004 * SR, f, f * 0.7, u => 1 - u, 0.09 * g, pan + (rnd() - 0.5) * 0.3, 0.03, 1.4);
  },
  tick(s0, g, pan) { tone(s0, 0.08 * SR, tt => Math.sin(2 * Math.PI * 2093 * tt) * Math.exp(-tt / 0.018) * 0.16, g, pan, 0.3); },
  pop(s0, g, pan) { let ph = 0; tone(s0, 0.09 * SR, tt => { ph += (700 + 900 * Math.min(1, tt / 0.05)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-tt / 0.03) * 0.2; }, g, pan, 0.3); },
  whoosh(s0, g, pan) { noiseBand(s0 - Math.floor(0.12 * SR), 0.62 * SR, 2600, 380, u => Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 2, 0.32 * g, pan, 0.6, 1.6); },
};
for (const c of cues.sfx) {
  const fn = SFX[c.kind]; if (!fn) { console.error('unknown sfx kind ' + c.kind); continue; }
  fn(Math.floor(c.t * SR), c.gain == null ? 1 : c.gain, c.pan || 0);
}

/* ------------------------------------------------------------------ reverb (Freeverb) on the sends */
function freeverb(inL, inR, room = 0.82, damp = 0.35, wet = 1) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(n => Math.round(n * SR / 44100));
  const aps = [556, 441, 341, 225].map(n => Math.round(n * SR / 44100));
  const out = [new Float32Array(N), new Float32Array(N)];
  [inL, inR].forEach((inp, ch) => {
    const spread = ch ? Math.round(23 * SR / 44100) : 0;
    const cb = combs.map(n => ({ buf: new Float32Array(n + spread), i: 0, f: 0 }));
    const ab = aps.map(n => ({ buf: new Float32Array(n + spread), i: 0 }));
    const o = out[ch];
    for (let i = 0; i < N; i++) {
      const x = inp[i] * 0.015; let y = 0;
      for (const c of cb) { const v = c.buf[c.i]; c.f = v * (1 - damp) + c.f * damp; c.buf[c.i] = x + c.f * room; if (++c.i >= c.buf.length) c.i = 0; y += v; }
      for (const a of ab) { const v = a.buf[a.i]; const z = -y + v; a.buf[a.i] = y + v * 0.5; if (++a.i >= a.buf.length) a.i = 0; y = z; }
      o[i] = y * wet;
    }
  });
  return out;
}
const rvM = freeverb(musicSend[0], musicSend[1], 0.86, 0.4, 3.2);
const rvF = freeverb(fxSend[0], fxSend[1], 0.8, 0.3, 3.0);

/* ------------------------------------------------------------------ mix, soft limit, write */
const L = new Float32Array(N), R = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = music[0][i] + rvM[0][i] + fx[0][i] * 1.0 + rvF[0][i];
  R[i] = music[1][i] + rvM[1][i] + fx[1][i] * 1.0 + rvF[1][i];
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const pre = 0.9 / Math.max(peak, 1e-6);
const sat = x => Math.tanh(x * 1.1) / Math.tanh(1.1);
const buf = Buffer.alloc(44 + N * 2 * 3);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 6, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34); buf.write('data', 36); buf.writeUInt32LE(N * 6, 40);
for (let i = 0, o = 44; i < N; i++) {
  for (const v of [L[i], R[i]]) { const s = Math.round(clamp(sat(v * pre) * 0.97, -1, 1) * 8388607); buf.writeIntLE(s, o, 3); o += 3; }
}
const out = path.resolve(expand(args.out));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(JSON.stringify({ out, seconds: +(N / SR).toFixed(2), sfx: cues.sfx.length, duck: (cues.duck || []).length, swell: (cues.swell || []).length }));
