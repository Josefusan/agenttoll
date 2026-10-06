#!/usr/bin/env bash
# Put the sound on a picture master: music bed + UI sound (audio.mjs), optional voiceover.
#
#   video/render/mux.sh --video film.mp4 --audio bed.wav --out film-av.mp4 [--vo voice.wav] [--lufs -16]
#
# The bed is loudness-normalised with ffmpeg loudnorm in two passes (integrated -16 LUFS,
# true peak -1.5 dBTP by default). With --vo, the bed is ducked under the voice by a sidechain
# compressor (about -24 LUFS under speech) and the voice is normalised to the target instead.
# Video is stream-copied; audio is AAC-LC 192 kb/s 48 kHz; -shortest trims to the picture.
set -euo pipefail
VIDEO= AUDIO= VO= OUT= LUFS=-16 TP=-1.5
while [ $# -gt 0 ]; do
  case "$1" in
    --video) VIDEO=$2; shift 2;; --audio) AUDIO=$2; shift 2;; --vo) VO=$2; shift 2;; --out) OUT=$2; shift 2;;
    --lufs) LUFS=$2; shift 2;; --tp) TP=$2; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$VIDEO" ] && [ -n "$AUDIO" ] && [ -n "$OUT" ] || { echo "usage: mux.sh --video V.mp4 --audio A.wav --out O.mp4 [--vo VO.wav]" >&2; exit 2; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
if [ -n "$VO" ]; then
  ffmpeg -hide_banner -loglevel error -y -i "$AUDIO" -i "$VO" -filter_complex \
    "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vo][sc];[0:a][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=350[bed];[bed][vo]amix=inputs=2:normalize=0:weights=0.7 1[m]" \
    -map "[m]" -c:a pcm_s24le "$tmp/mix.wav"
  SRC="$tmp/mix.wav"
else
  SRC="$AUDIO"
fi
stats=$(ffmpeg -hide_banner -nostats -i "$SRC" -af "loudnorm=I=$LUFS:TP=$TP:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -hide_banner -loglevel error -y -i "$VIDEO" -i "$SRC" \
  -af "loudnorm=I=$LUFS:TP=$TP:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT"
echo "muxed: $OUT  $(du -h "$OUT" | cut -f1)"
ffprobe -v error -show_entries stream=codec_type,codec_name,sample_rate,channels,bit_rate -of compact=p=0 "$OUT"
ffmpeg -hide_banner -nostats -i "$OUT" -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" | tr -s ' ' | sed 's/^/  /'
