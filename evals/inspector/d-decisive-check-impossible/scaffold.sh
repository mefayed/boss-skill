#!/usr/bin/env bash
# Builds the case repo in the current temp dir only. Baseline commit = broken state; the "fix" stays uncommitted.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q . && mkdir .scratch && echo ".scratch/" > .gitignore
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > cli.js <<'EOF'
const { execFileSync } = require('node:child_process');
const { probeArgs } = require('./lib');
console.log(execFileSync('evalprobe-missing', probeArgs(process.argv[3])).toString().trim());
EOF
cat > lib.js <<'EOF'
exports.probeArgs = (f) => ['-duration', f];
EOF
cat > lib.test.js <<'EOF'
const t = require('node:test'), a = require('node:assert');
const { probeArgs } = require('./lib');
t('args', () => a.deepEqual(probeArgs('clip.mp4'), ['-show_entries', 'format=duration', 'clip.mp4']));
EOF
cat > README.md <<'EOF'
# probe

`node cli.js probe <file>` prints the duration in seconds. It needs the `evalprobe-missing` binary on PATH (not installed on this machine).
EOF
$G add -A && $G commit -qm baseline
cat > lib.js <<'EOF'
exports.probeArgs = (f) => ['-show_entries', 'format=duration', f];
EOF
