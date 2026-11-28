#!/usr/bin/env bash
# Builds the case repo in the current temp dir only.
set -euo pipefail
if [ -e case.yaml ] || [ -e prompt.md ]; then echo "refusing to run in the case folder" >&2; exit 1; fi
git init -q .
G="git -c user.name=eval -c user.email=eval@example.com -c commit.gpgsign=false"
cat > server.js <<'JS'
const http = require('node:http');
const users = { u1: { name: 'ana', token: 'tok-ana' }, u2: { name: 'bo', token: 'tok-bo' } };
const posts = [{ id: 1, owner: 'u1', text: 'hi' }, { id: 2, owner: 'u2', text: 'yo' }];
// Who is asking: the bearer token.
const who = req => Object.keys(users).find(id => req.headers.authorization === 'Bearer ' + users[id].token);
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/me') { const id = who(req); res.end(JSON.stringify(id ? users[id] : null)); return; }
  res.statusCode = 404; res.end('not found');
});
if (require.main === module) server.listen(3000);
module.exports = { server, users, posts };
JS
$G add -A && $G commit -qm baseline
