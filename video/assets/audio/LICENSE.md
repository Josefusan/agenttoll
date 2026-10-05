# Film audio licence

The music bed and every sound effect in the AgentToll films are synthesized by
`video/render/audio.mjs` from oscillators and seeded noise, at render time, from the cue list each
scene declares (`AT.sfx`, `AT.duck`, `AT.swell`). No samples, loops, presets or third-party
recordings are used, so there is nothing to attribute.

The generated audio is dedicated to the public domain under CC0 1.0
(https://creativecommons.org/publicdomain/zero/1.0/). The generator code is under the repo's MIT
licence.

Rebuild a track: `node video/render/render.mjs --scene <scene> --cues cues.json`, then
`node video/render/audio.mjs --cues cues.json --out bed.wav`, then
`bash video/render/mux.sh --video picture.mp4 --audio bed.wav --out film.mp4`.
