#!/usr/bin/env bash
# Builds the case repo in the current temp dir only. Baseline commit = broken state; the "fix" stays uncommitted.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q . && mkdir .scratch && echo ".scratch/" > .gitignore
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > cli.js <<'EOF'
const { slug } = require('./lib');
console.log(slug(process.argv[3]));
EOF
cat > lib.js <<'EOF'
exports.slug = (s) => s.toLowerCase();
EOF
cat > lib.test.js <<'EOF'
const t = require('node:test'), a = require('node:assert');
const { slug } = require('./lib');
t('slug', () => a.equal(slug('Hello World'), 'hello-world'));
EOF
$G add -A && $G commit -qm baseline
cat > lib.js <<'EOF'
exports.slug = (s) => s.toLowerCase().replace(' ', '-');
EOF
