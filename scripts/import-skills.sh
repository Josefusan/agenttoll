#!/usr/bin/env bash
# Link AgentToll project skills into .claude/skills and pull external skill packs.
# External packs are gitignored (.claude/skills/) because some are private or third-party.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.claude/skills"
CACHE="${AGENTTOLL_SKILL_CACHE:-$HOME/.cache/agenttoll-skills}"
mkdir -p "$DEST" "$CACHE"

echo "==> Project skills"
for d in "$ROOT"/skills/*/; do
  n="$(basename "$d")"
  ln -sfn "$d" "$DEST/$n"
  echo "   linked $n"
done

clone_or_pull () { # url dir
  if [ -d "$2/.git" ]; then git -C "$2" pull --ff-only -q || true
  else git clone --depth 1 -q "$1" "$2" || { echo "   ! could not clone $1 (auth?)"; return 1; }
  fi
}

copy_skill () { # src_dir name
  if [ -f "$1/SKILL.md" ]; then rm -rf "$DEST/$2"; cp -R "$1" "$DEST/$2"; echo "   imported $2"
  else echo "   ! missing $1"; fi
}

echo "==> Skillbox (public)"
if clone_or_pull https://github.com/Josefusan/skillbox.git "$CACHE/skillbox"; then
  SB="$CACHE/skillbox/skills"
  copy_skill "$SB/external/typesafe-ai" typesafe-ai
  for s in hormozi-pitch offer-stack-builder founder-content-engine; do
    copy_skill "$SB/external/john-peslar/$s" "$s"
  done
fi

echo "==> Distribution playbook (private: needs gh auth login)"
DP_URL="https://github.com/Josefusan/distribution-playbook.git"
command -v gh >/dev/null && gh auth status >/dev/null 2>&1 && DP_URL="https://x-access-token:$(gh auth token)@github.com/Josefusan/distribution-playbook.git"
if clone_or_pull "$DP_URL" "$CACHE/distribution-playbook"; then
  EP="$CACHE/distribution-playbook/skills/eptwts/skills"
  for s in distribution-first-strategy platform-growth-playbooks brand-voice-and-authentic-ai-writing coding-agents-and-knowledge-systems context-engineering-profiles; do
    copy_skill "$EP/$s" "$s"
  done
  copy_skill "$CACHE/distribution-playbook/skills/taste-over-slop" taste-over-slop
fi

echo "==> Done. Skills in $DEST:"
ls -1 "$DEST"
