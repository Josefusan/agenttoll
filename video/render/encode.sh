#!/usr/bin/env bash
# Frames -> MP4 master (+ optional GIF cut, contact sheet, stills).
#
#   video/render/encode.sh --frames ~/agenttoll-scratch/frames/test --fps 30 --out ~/agenttoll-scratch/film-out/test.mp4 \
#       [--gif ~/agenttoll-scratch/film-out/test.gif --gif-from 0 --gif-to 20 --gif-fps 15 --gif-width 960 --gif-max-mb 10] \
#       [--sheet ~/vps-audit/film-shots/test] [--every 2] [--clean]
#   video/render/encode.sh --in existing.mp4 --gif out.gif [...]      # GIF/sheet from an MP4, no re-encode
#
# MP4: libx264 -crf 16 -preset slow -pix_fmt yuv420p -movflags +faststart, 1920x1080, closed GOP.
# GIF: palettegen stats_mode=diff + paletteuse dither=sierra2_4a; exits 3 when larger than --gif-max-mb.
#      Render the GIF source with render.mjs --flat. If still too big: --gif-dither bayer:bayer_scale=5
#      --gif-colors 128 (engine test: 8.4 MB -> 5.0 MB for 8 s), or lower --gif-fps / --gif-width.
# --sheet runs sheet.sh on the MP4. --clean deletes the frames directory after a successful encode.
set -euo pipefail
FRAMES= IN= FPS=30 OUT= GIF= GIF_FROM=0 GIF_TO= GIF_FPS=15 GIF_W=960 GIF_MAX=10 GIF_DITHER=sierra2_4a GIF_COLORS=256 SHEET= EVERY=2 CLEAN=0 CRF=16 PRESET=slow
while [ $# -gt 0 ]; do
  case "$1" in
    --frames) FRAMES=$2; shift 2;; --in) IN=$2; shift 2;; --fps) FPS=$2; shift 2;; --out) OUT=$2; shift 2;;
    --gif) GIF=$2; shift 2;; --gif-from) GIF_FROM=$2; shift 2;; --gif-to) GIF_TO=$2; shift 2;;
    --gif-fps) GIF_FPS=$2; shift 2;; --gif-dither) GIF_DITHER=$2; shift 2;; --gif-colors) GIF_COLORS=$2; shift 2;; --gif-width) GIF_W=$2; shift 2;; --gif-max-mb) GIF_MAX=$2; shift 2;;
    --sheet) SHEET=$2; shift 2;; --every) EVERY=$2; shift 2;; --clean) CLEAN=1; shift;;
    --crf) CRF=$2; shift 2;; --preset) PRESET=$2; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
HERE=$(cd "$(dirname "$0")" && pwd)
if [ -n "$IN" ]; then
  OUT=$IN
else
[ -n "$FRAMES" ] && [ -n "$OUT" ] || { echo "usage: encode.sh --frames DIR --fps N --out FILE.mp4 [...] | --in FILE.mp4 --gif FILE.gif" >&2; exit 2; }
first=$(ls "$FRAMES" | grep -E '^f_[0-9]{6}\.(png|jpg)$' | sort | head -1)
[ -n "$first" ] || { echo "no frames in $FRAMES" >&2; exit 1; }
ext=${first##*.}; start=$((10#${first:2:6}))
n=$(ls "$FRAMES" | grep -cE "^f_[0-9]{6}\.$ext$")
last=$(ls "$FRAMES" | grep -E "^f_[0-9]{6}\.$ext$" | sort | tail -1); lastn=$((10#${last:2:6}))
[ $((lastn - start + 1)) -eq "$n" ] || { echo "frame gap: $n files but range $start..$lastn" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
echo "encode: $n frames ($ext) from $start at ${FPS} fps -> $OUT"
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -start_number "$start" -i "$FRAMES/f_%06d.$ext" \
  -vf "scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p \
  -x264-params "keyint=$((FPS*2)):min-keyint=$FPS:open-gop=0" -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart "$OUT"
echo "mp4: $(du -h "$OUT" | cut -f1)  $(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 "$OUT")"

fi
if [ -n "$GIF" ]; then
  pal=$(mktemp --suffix=.png)
  range=(-ss "$GIF_FROM"); [ -n "$GIF_TO" ] && range+=(-to "$GIF_TO")
  ffmpeg -hide_banner -loglevel error -y "${range[@]}" -i "$OUT" -vf "fps=$GIF_FPS,scale=$GIF_W:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=$GIF_COLORS" "$pal"
  ffmpeg -hide_banner -loglevel error -y "${range[@]}" -i "$OUT" -i "$pal" \
    -lavfi "fps=$GIF_FPS,scale=$GIF_W:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=$GIF_DITHER:diff_mode=rectangle" "$GIF"
  rm -f "$pal"
  bytes=$(stat -c %s "$GIF"); mb=$(awk "BEGIN{printf \"%.2f\", $bytes/1048576}")
  echo "gif: $GIF ${mb} MB (limit ${GIF_MAX} MB)"
  awk "BEGIN{exit !($bytes > $GIF_MAX*1048576)}" && { echo "GIF OVER LIMIT" >&2; exit 3; }
fi
[ -n "$SHEET" ] && EVERY=$EVERY "$HERE/sheet.sh" "$OUT" "$SHEET"
if [ "$CLEAN" = 1 ]; then rm -rf "$FRAMES"; echo "deleted frames $FRAMES"; fi
df -h / | tail -1 | awk '{print "disk: " $5 " used"}'
