#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > cli.js <<'JS'
const fs = require('node:fs');
const args = process.argv.slice(2);
const at = args.indexOf('--out');
const text = args.filter((_, i) => i !== at && i !== at + 1).join(' ').toUpperCase();
if (at >= 0) fs.writeFileSync(args[at + 1], text + '\n'); else console.log(text);
JS
cat > README.md <<'JS'
# shout
Prints your words in capitals.

    node cli.js hello world
    node cli.js hello world --out result.txt

`--out <file>` writes the result to a file instead of printing it.
JS
$G add -A && $G commit -qm baseline
