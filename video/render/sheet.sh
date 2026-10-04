#!/usr/bin/env bash
# Contact sheets + full-res stills for vision review.
#
#   video/render/sheet.sh ~/agenttoll-scratch/film-out/test.mp4 [~/vps-audit/film-shots/test]
#   EVERY=0.5 COLS=4 ROWS=3 TILE=480 STILLS="1.2 3.217 6" video/render/sheet.sh in.mp4 outdir
#
# Writes outdir/sheet-NN.png (COLSxROWS tiles of TILE px, one frame every EVERY s, each stamped
# with its time) and outdir/still-<t>.png (full 1920x1080 at every STILL_EVERY s, or at STILLS).
set -euo pipefail
IN=${1:?usage: sheet.sh <mp4> [outdir]}
NAME=$(basename "${IN%.*}")
OUT=${2:-$HOME/vps-audit/film-shots/$NAME}
ROWS_FIXED=${ROWS:+1}   # an explicit ROWS is kept as given
EVERY=${EVERY:-2} COLS=${COLS:-4} ROWS=${ROWS:-3} TILE=${TILE:-480} STILL_EVERY=${STILL_EVERY:-4}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
mkdir -p "$OUT"
rm -f "$OUT"/sheet-*.png "$OUT"/still-*.png
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
# short clips: shrink ROWS so one sheet holds every tile without empty rows
n=$(awk -v d="$dur" -v e="$EVERY" 'BEGIN{print int((d-0.0001)/e)+1}')
if [ "$n" -le $((COLS*6)) ] && [ -z "${ROWS_FIXED:-}" ]; then ROWS=$(( (n + COLS - 1) / COLS )); fi
ffmpeg -hide_banner -loglevel error -y -i "$IN" -vf \
  "fps=1/$EVERY:start_time=0,scale=$TILE:-1:flags=lanczos,drawtext=fontfile=$FONT:text='%{pts\:hms}':x=8:y=h-th-8:fontsize=14:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4,tile=${COLS}x${ROWS}:padding=6:margin=6:color=0x222222" \
  -fps_mode vfr "$OUT/sheet-%02d.png"
if [ -n "${STILLS:-}" ]; then times=$STILLS; else times=$(awk -v d="$dur" -v e="$STILL_EVERY" 'BEGIN{for(t=e/2;t<d;t+=e) printf "%.3f ", t}'); fi
for t in $times; do
  ffmpeg -hide_banner -loglevel error -y -ss "$t" -i "$IN" -frames:v 1 "$OUT/still-$(printf '%06.2f' "$t").png"
done
echo "sheets: $(ls "$OUT"/sheet-*.png | wc -l)  stills: $(ls "$OUT"/still-*.png 2>/dev/null | wc -l)  -> $OUT"
