#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > store.js <<'JS'
// Notes kept in notes.json.
const fs = require('node:fs');
const FILE = __dirname + '/notes.json';
const all = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
function add(text) {
  const notes = all();
  notes.push({ id: notes.length + 1, text, at: new Date().toISOString() });
  fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));
  return notes[notes.length - 1];
}
module.exports = { all, add };
JS
cat > server.js <<'JS'
const http = require('node:http');
const store = require('./store');
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/notes') { res.end(JSON.stringify(store.all())); return; }
  if (req.method === 'POST' && req.url === '/notes') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => { res.statusCode = 201; res.end(JSON.stringify(store.add(JSON.parse(body || '{}').text ?? ''))); });
    return;
  }
  res.statusCode = 404; res.end('not found');
});
if (require.main === module) server.listen(3000);
module.exports = server;
JS
cat > notes.json <<'JS'
[
  { "id": 1, "text": "buy milk, eggs and bread", "at": "2026-11-01T09:00:00.000Z" },
  { "id": 2, "text": "call mom about \"the trip\"", "at": "2026-11-02T18:30:00.000Z" },
  { "id": 3, "text": "", "at": "2026-11-03T07:15:00.000Z" }
]
JS
cat > package.json <<'JS'
{ "name": "notes", "version": "1.0.0", "scripts": { "start": "node server.js", "test": "node --test" } }
JS
$G add -A && $G commit -qm baseline
