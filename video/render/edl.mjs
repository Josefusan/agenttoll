#!/usr/bin/env node
// Assemble a cut from segments of rendered scenes (the pitch cut), picture and sound cues.
//
//   node video/render/edl.mjs --edl video/scenes/pitch/EDL.json --frames ~/agenttoll-scratch/frames/pitch \
//        --out ~/agenttoll-scratch/film-out/agenttoll-pitch.mp4 [--jobs 3] [--cues-only] [--fps 10] [--scale 0.5]
//
// For each segment it renders [from, to) of its scene with render.mjs (the segment's query, e.g.
// noprogress&cut=pitch), links the frames into one sequence, encodes it with encode.sh, and writes
// <out>.cues.json: every segment's sound cues shifted onto the cut's timeline (audio.mjs input).
//
// Joins: with "xfade": d (seconds, EDL-wide or per segment), the last d s of the previous segment
// and the first d s of this one are blended with a smoothstep blur dissolve (ffmpeg gblur + blend), so a join
// is never a hard cut and never an empty frame. The cut gets d s shorter per join, and a soft
// whoosh is cued on each join. --fps/--scale override the EDL for low-cost previews.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..');
const a = {}; process.argv.slice(2).forEach((k, i, arr) => { if (k.startsWith('--')) a[k.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const expand = p => p && path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
const edl = JSON.parse(fs.readFileSync(expand(a.edl), 'utf8'));
const fps = +(a.fps || edl.fps || 60), jobs = a.jobs || 3, work = expand(a.frames), out = expand(a.out);
fs.mkdirSync(work, { recursive: true });
const node = process.execPath;
let offset = 0;
const cut = { duration: 0, sfx: [], duck: [], swell: [], segments: [] };
const seq = path.join(work, 'seq');
if (!a['cues-only']) { fs.rmSync(seq, { recursive: true, force: true }); fs.mkdirSync(seq); }
const XBLUR = +(a.xblur || edl.xblur || 12) * (+(a.scale) || 1);   // gblur sigma at the middle of a join, in output px
const XTOP = Math.round(64 * (+(a.scale) || 1));   // the brand bar (same in every segment) stays sharp through a join
const fname = i => `f_${String(i).padStart(6, '0')}.jpg`;
let n = 0;
edl.segments.forEach((s, k) => {
  const scene = path.join(REPO, s.scene), len = +(s.to - s.from).toFixed(4);
  const xd = k === 0 ? 0 : +(s.xfade != null ? s.xfade : edl.xfade || 0);
  const nx = Math.round(xd * fps);
  if (k > 0 && xd > 0) offset -= nx / fps;
  const cf = path.join(work, `seg${k}.cues.json`);
  execFileSync(node, [path.join(HERE, 'render.mjs'), '--scene', scene, '--cues', cf, ...(s.query ? ['--query', s.query] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  const c = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const inSeg = t => t >= s.from && t < s.to;
  for (const x of c.sfx) if (inSeg(x.t)) cut.sfx.push(Object.assign({}, x, { t: +(x.t - s.from + offset).toFixed(4) }));
  for (const key of ['duck', 'swell']) for (const x of c[key] || []) {
    const t0 = Math.max(x.t0, s.from), t1 = Math.min(x.t1, s.to);
    if (t1 > t0) cut[key].push(Object.assign({}, x, { t0: +(t0 - s.from + offset).toFixed(4), t1: +(t1 - s.from + offset).toFixed(4) }));
  }
  if (nx > 0) cut.sfx.push({ t: +(offset + nx / fps / 2 - 0.15).toFixed(4), kind: 'whoosh', gain: 0.4, pan: 0 });
  cut.segments.push({ scene: s.scene, query: s.query || '', from: s.from, to: s.to, at: +offset.toFixed(4), xfade: nx / fps });
  if (!a['cues-only']) {
    const dir = path.join(work, `seg${k}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const r = execFileSync(node, [path.join(HERE, 'render.mjs'), '--scene', scene, '--fps', String(fps), '--from', String(s.from), '--to', String(s.to), '--out', dir, '--jobs', String(jobs),
      ...(a.scale ? ['--scale', String(a.scale)] : []), ...(s.query ? ['--query', s.query] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
    process.stderr.write(`segment ${k}: ${r.toString().trim().split('\n').pop()}\n`);
    const files = fs.readdirSync(dir).filter(f => /^f_\d{6}\.jpg$/.test(f)).sort();
    let skip = 0;
    if (nx > 0 && n >= nx && files.length >= nx) {
      // blend this segment's first nx frames over the sequence's last nx frames, in place
      const tmp = path.join(work, 'xf'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
      const listA = path.join(tmp, 'a.txt'), listB = path.join(tmp, 'b.txt');
      fs.writeFileSync(listA, Array.from({ length: nx }, (_, i) => `file '${path.join(seq, fname(n - nx + i))}'\nduration ${1 / fps}\n`).join(''));
      fs.writeFileSync(listB, files.slice(0, nx).map(f => `file '${path.join(dir, f)}'\nduration ${1 / fps}\n`).join(''));
      const u = `((N+0.5)/${nx})`, sm = `(${u}*${u}*(3-2*${u}))`;
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listA, '-f', 'concat', '-safe', '0', '-i', listB,
        // blur dissolve, the same grammar as the scenes' own shot changes: the outgoing frame blurs
        // out over the first half, the incoming one sharpens over the second, under a smoothstep mix
        '-filter_complex', `[0:v]format=yuv444p,split[a0][a1];[a1]gblur=sigma=${XBLUR}[ab];[a0][ab]blend=all_expr='if(lt(Y,${XTOP}),A,A+(B-A)*clip(2*${u},0,1))'[a];` +
          `[1:v]format=yuv444p,split[b0][b1];[b1]gblur=sigma=${XBLUR}[bb];[bb][b0]blend=all_expr='if(lt(Y,${XTOP}),B,A+(B-A)*clip(2*${u}-1,0,1))'[b];` +
          `[a][b]blend=all_expr='A+(B-A)*${sm}',format=yuvj420p`,
        '-frames:v', String(nx), '-fps_mode', 'passthrough', '-q:v', '2', path.join(tmp, 'x_%06d.jpg')], { stdio: 'inherit' });
      for (let i = 0; i < nx; i++) fs.renameSync(path.join(tmp, `x_${String(i + 1).padStart(6, '0')}.jpg`), path.join(seq, fname(n - nx + i)));
      fs.rmSync(tmp, { recursive: true, force: true });
      skip = nx;
    }
    for (const f of files.slice(skip)) fs.renameSync(path.join(dir, f), path.join(seq, fname(n++)));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  offset += len;
});
cut.duration = +offset.toFixed(4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out.replace(/\.mp4$/, '') + '.cues.json', JSON.stringify(cut, null, 1) + '\n');
console.error(`cut: ${cut.duration} s, ${cut.sfx.length} sfx cues, ${n} frames`);
if (!a['cues-only']) execFileSync('bash', [path.join(HERE, 'encode.sh'), '--frames', seq, '--fps', String(fps), '--out', out, '--clean'], { stdio: 'inherit' });
