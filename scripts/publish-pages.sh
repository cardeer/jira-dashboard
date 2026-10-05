#!/usr/bin/env bash
# Rebuilds the static frontend and replaces the `gh-pages` branch with it.
# Builds in a throwaway worktree, so your working directory is never touched.
# Usage: scripts/publish-pages.sh [--push]
set -euo pipefail
cd "$(dirname "$0")/.."

src=$(git rev-parse --short HEAD)
wt=$(mktemp -d)
trap 'git worktree remove --force "$wt" 2>/dev/null || true' EXIT

VITE_STATIC=1 npm run build

git worktree add -q --detach "$wt"
(
  cd "$wt"
  git checkout -q --orphan gh-pages-tmp
  git rm -rfq .
  cp -R "$OLDPWD"/dist/. .
  touch .nojekyll
  git add -A
  git commit -qm "Static build of $src"
  git branch -M gh-pages
)
echo "gh-pages updated from $src"
if [ "${1:-}" = "--push" ]; then git push -f origin gh-pages; fi
