#!/usr/bin/env bash
# Submit-day live-URL refresher.
#
#   bash scripts/refresh-live-urls.sh            # --check (default)
#   bash scripts/refresh-live-urls.sh --check
#   bash scripts/refresh-live-urls.sh --apply    # rewrite stale URLs in tracked files, print diff, no commit
#
# --check reads the gateway and dashboard URLs from ~/Hackathons/AgentToll-LIVE.txt, finds every
# concrete *.trycloudflare.com URL in tracked files, curls each one (expect 200) and reports any
# that differ from LIVE.txt or are dead. Exit 0 when everything matches and answers 200, 1 otherwise.
# --apply rewrites the stale URLs in place (role inferred from the surrounding text) and prints the
# diff. It does not commit.
set -u

LIVE_FILE="${AGENTTOLL_LIVE_FILE:-$HOME/Hackathons/AgentToll-LIVE.txt}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

MODE="${1:---check}"
case "$MODE" in
  --check|--apply) ;;
  *) echo "usage: bash scripts/refresh-live-urls.sh [--check|--apply]" >&2; exit 2 ;;
esac

URL_RE='https://[a-zA-Z0-9.-]+\.trycloudflare\.com'

if [ ! -f "$LIVE_FILE" ]; then
  echo "FAIL: no LIVE file at $LIVE_FILE" >&2
  exit 2
fi
gw_new="$(grep -iE '^[[:space:]]*Gateway' "$LIVE_FILE" | grep -oE "$URL_RE" | head -1)"
dash_new="$(grep -iE '^[[:space:]]*Dashboard' "$LIVE_FILE" | grep -oE "$URL_RE" | head -1)"
if [ -z "$gw_new" ] || [ -z "$dash_new" ]; then
  echo "FAIL: could not read gateway/dashboard URLs from $LIVE_FILE" >&2
  exit 2
fi

echo "LIVE.txt gateway:   $gw_new"
echo "LIVE.txt dashboard: $dash_new"
echo

# Role of a URL occurrence from the text before it on its line: nearest 'dashboard' vs 'gateway'/'GW='.
role_for() {
  local file="$1" line="$2" url="$3" text prefix low ld lg
  text="$(sed -n "${line}p" "$file")"
  prefix="${text%%"$url"*}"
  low="$(printf '%s' "$prefix" | tr 'A-Z' 'a-z')"
  ld="$(printf '%s' "$low" | grep -bo 'dashboard' | tail -1 | cut -d: -f1)"
  lg="$(printf '%s' "$low" | grep -boE 'gateway|gw=' | tail -1 | cut -d: -f1)"
  if [ -n "$ld" ] && { [ -z "$lg" ] || [ "$ld" -gt "$lg" ]; }; then
    echo dashboard
  else
    echo gateway
  fi
}

mapfile -t occ < <(git grep -n -o -E "$URL_RE" -- . || true)
if [ "${#occ[@]}" -eq 0 ]; then
  echo "no tracked *.trycloudflare.com URLs found"
fi

rc=0
for entry in "${occ[@]}"; do
  file="${entry%%:*}"
  rest="${entry#*:}"
  line="${rest%%:*}"
  url="${rest#*:}"
  role="$(role_for "$file" "$line" "$url")"
  if [ "$role" = dashboard ]; then want="$dash_new"; else want="$gw_new"; fi

  if [ "$role" = dashboard ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)"
  else
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -A 'Mozilla/5.0 Chrome/141' "$url/api/quote" || true)"
  fi
  [ -n "$code" ] || code="000"

  if [ "$url" != "$want" ]; then
    echo "STALE $file:$line $role $url (want $want)"
    rc=1
  elif [ "$code" != "200" ]; then
    echo "DEAD  $file:$line $role $url (HTTP $code)"
    rc=1
  else
    echo "OK    $file:$line $role $url (HTTP $code)"
  fi
done

if [ "$MODE" = "--check" ]; then
  echo
  if [ "$rc" -eq 0 ]; then echo "ALL URLS MATCH LIVE.txt AND ANSWER 200"; else echo "MISMATCH OR DEAD URL"; fi
  exit "$rc"
fi

# --apply: rewrite every stale occurrence to the LIVE.txt URL for its role.
changed=0
for entry in "${occ[@]}"; do
  file="${entry%%:*}"
  rest="${entry#*:}"
  line="${rest%%:*}"
  url="${rest#*:}"
  role="$(role_for "$file" "$line" "$url")"
  if [ "$role" = dashboard ]; then want="$dash_new"; else want="$gw_new"; fi
  [ "$url" = "$want" ] && continue
  python3 - "$file" "$url" "$want" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); old, new = sys.argv[2], sys.argv[3]
t = p.read_text()
n = t.replace(old, new)
if n != t:
    p.write_text(n)
PY
  echo "rewrote $file: $url -> $want"
  changed=1
done

echo
if [ "$changed" -eq 0 ]; then
  echo "no stale URLs; nothing to change (diff should be empty)"
else
  echo "diff:"
  git --no-pager diff --no-color
fi
echo "note: not committed"
