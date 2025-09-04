#!/usr/bin/env bash
set -euo pipefail
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Init git & add remote first: git init && git remote add origin <repo-url>"
  exit 1
fi
npm run deploy
echo "✅ Deployed to GitHub Pages (branch: gh-pages). Enable Pages in repo settings → 'gh-pages' branch."