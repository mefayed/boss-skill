#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > orders.json <<'JS'
[
  { "id": "o-1001", "placed": "2024-01-10", "status": "delivered", "total": 40 },
  { "id": "o-1002", "placed": "2024-03-02", "status": "pending", "total": 15 },
  { "id": "o-1003", "placed": "2026-11-20", "status": "delivered", "total": 72 },
  { "id": "o-1004", "placed": "2026-11-27", "status": "pending", "total": 9 }
]
JS
cat > orders.js <<'JS'
// The shop's orders, read from orders.json.
const fs = require('node:fs');
const FILE = __dirname + '/orders.json';
const all = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = orders => fs.writeFileSync(FILE, JSON.stringify(orders, null, 2) + '\n');
if (require.main === module) for (const o of all()) console.log(o.id, o.placed, o.status, o.total);
module.exports = { all, save };
JS
$G add -A && $G commit -qm baseline
