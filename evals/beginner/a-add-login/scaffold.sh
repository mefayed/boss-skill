#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > server.js <<'JS'
const http = require('node:http');
const notes = ['buy milk', 'call mom'];
const server = http.createServer((req, res) => {
  if (req.url === '/notes') { res.end(JSON.stringify(notes)); return; }
  res.statusCode = 404; res.end('not found');
});
if (require.main === module) server.listen(3000);
module.exports = server;
JS
cat > package.json <<'JS'
{ "name": "notes", "version": "1.0.0", "scripts": { "start": "node server.js", "test": "node --test" } }
JS
$G add -A && $G commit -qm baseline
