#!/bin/bash
set -euo pipefail

VERSION="${1:-}"
NOTES="${2:-}"

if [ -z "$VERSION" ]; then
  echo '用法: npm run release -- 5.2.1 "本次更新说明"'
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo '工作区有未提交改动，请先提交后再发布。'
  exit 1
fi

npm version "$VERSION" --no-git-tag-version
npm run build
git add package.json package-lock.json
git commit -m "chore: release v$VERSION"
git push origin main

if [ -n "$NOTES" ]; then
  gh release create "v$VERSION" --target main --title "BongMaster v$VERSION" --notes "$NOTES" \
    dist-electron/*.dmg dist-electron/*-mac.zip dist-electron/*.blockmap
else
  gh release create "v$VERSION" --target main --title "BongMaster v$VERSION" --generate-notes \
    dist-electron/*.dmg dist-electron/*-mac.zip dist-electron/*.blockmap
fi
