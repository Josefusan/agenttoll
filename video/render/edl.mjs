#!/usr/bin/env node
// Assemble a cut from segments of rendered scenes (the 2:30 pitch cut), picture and sound cues.
//
//   node video/render/edl.mjs --edl video/scenes/pitch/EDL.json --frames ~/agenttoll-scratch/frames/pitch \
//        --out ~/agenttoll-scratch/film-out/agenttoll-pitch.mp4 [--jobs 3] [--cues-only]
//
// For each segment it renders [from, to) of its scene with render.mjs (the segment's query, e.g.
// noprogress&cut=pitch), links the frames into one sequence, encodes it with encode.sh, and writes
// <out>.cues.json: every segment's sound cues shifted onto the cut's timeline (audio.mjs input).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const a = {}; process.argv.slice(2).forEach((k, i, arr) => { if (k.startsWith('--')) a[k.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const expand = p => p && path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
const edl = JSON.parse(fs.readFileSync(expand(a.edl), 'utf8'));
const fps = edl.fps || 60, jobs = a.jobs || 3, work = expand(a.frames), out = expand(a.out);
fs.mkdirSync(work, { recursive: true });
const node = process.execPath;
let offset = 0;
const cut = { duration: 0, sfx: [], duck: [], swell: [], segments: [] };
const seq = path.join(work, 'seq');
if (!a['cues-only']) { fs.rmSync(seq, { recursive: true, force: true }); fs.mkdirSync(seq); }
let n = 0;
edl.segments.forEach((s, k) => {
  const scene = path.join(REPO, s.scene), len = +(s.to - s.from).toFixed(4);
  const cf = path.join(work, `seg${k}.cues.json`);
  execFileSync(node, [path.join(HERE, 'render.mjs'), '--scene', scene, '--cues', cf, ...(s.query ? ['--query', s.query] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const inSeg = t => t >= s.from && t < s.to;
  for (const x of c.sfx) if (inSeg(x.t)) cut.sfx.push(Object.assign({}, x, { t: +(x.t - s.from + offset).toFixed(4) }));
  for (const key of ['duck', 'swell']) for (const x of c[key] || []) {
    const t0 = Math.max(x.t0, s.from), t1 = Math.min(x.t1, s.to);
    if (t1 > t0) cut[key].push(Object.assign({}, x, { t0: +(t0 - s.from + offset).toFixed(4), t1: +(t1 - s.from + offset).toFixed(4) }));
  }
  cut.segments.push({ scene: s.scene, query: s.query || '', from: s.from, to: s.to, at: +offset.toFixed(4) });
  if (!a['cues-only']) {
    const dir = path.join(work, `seg${k}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const r = execFileSync(node, [path.join(HERE, 'render.mjs'), '--scene', scene, '--fps', String(fps), '--from', String(s.from), '--to', String(s.to), '--out', dir, '--jobs', String(jobs), ...(s.query ? ['--query', s.query] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    process.stderr.write(`segment ${k}: ${r.toString().trim().split('\n').pop()}\n`);
    for (const f of fs.readdirSync(dir).filter(f => /^f_\d{6}\.jpg$/.test(f)).sort()) {
      fs.renameSync(path.join(dir, f), path.join(seq, `f_${String(n++).padStart(6, '0')}.jpg`));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  offset += len;
});
cut.duration = +offset.toFixed(4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out.replace(/\.mp4$/, '') + '.cues.json', JSON.stringify(cut, null, 1) + '\n');
console.error(`cut: ${cut.duration} s, ${cut.sfx.length} sfx cues, ${n} frames`);
if (!a['cues-only']) execFileSync('bash', [path.join(HERE, 'encode.sh'), '--frames', seq, '--fps', String(fps), '--out', out, '--clean'], { stdio: 'inherit' });
