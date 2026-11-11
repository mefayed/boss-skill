#!/bin/sh
# Builds the `directory` branch: main minus what the Anthropic plugin directory
# refuses from non-Verified organizations (hooks of every type, scripts, and any
# file that is not Markdown, text, JSON, YAML or a raster image). The directory
# tracks that branch; GitHub installs keep using main, hook included.
# Run on a clean main, then push the directory branch.
set -e
cd "$(dirname "$0")/.."
if [ "$(git branch --show-current)" != main ] || [ -n "$(git status --porcelain)" ]; then
  echo "run on a clean main"; exit 1
fi
v=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' .claude-plugin/plugin.json)
src=$(git rev-parse --short HEAD)
git checkout -q directory 2>/dev/null || git checkout -q -b directory
git rm -r -q --ignore-unmatch . >/dev/null
git checkout main -- .
git rm -r -q --ignore-unmatch hooks bench tests scripts .github 'assets/*.svg'
bad=$(git ls-files | while read -r f; do
  case "$f" in
    (LICENSE|*.md|*.txt|*.json|*.yaml|*.yml|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico) ;;
    (*) echo "$f"; continue ;;
  esac
  if [ "$(head -c 2 "$f")" = '#!' ]; then echo "$f"; fi
done)
if [ -n "$bad" ]; then
  echo "not allowed in the directory build:"; echo "$bad"
  git reset -q --hard; git checkout -q main; exit 1
fi
git diff --cached --quiet || git commit -q -m "directory build of $v ($src)"
git checkout -q main
echo "directory branch is at $(git rev-parse --short directory), built from $v ($src)"
