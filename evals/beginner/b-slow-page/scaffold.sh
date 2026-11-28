#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > list.js <<'JS'
// The list page: every product once, newest first.
const products = Array.from({ length: 120000 }, (_, i) => ({ id: i % 60000, name: "item " + (i % 60000) }));
function page() {
  const out = [];
  for (const p of products) if (!out.some(o => o.id === p.id)) out.push(p);
  return out.reverse();
}
if (require.main === module) console.log(page().length + ' products');
module.exports = { page };
JS
cat > list.test.js <<'JS'
const t = require('node:test'), a = require('node:assert');
t('page lists each product once', () => a.equal(require('./list').page().length, 60000));
JS
$G add -A && $G commit -qm baseline
