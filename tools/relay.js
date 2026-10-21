// Заменитель сервера из Android-приложения — для проверки сетевой игры на компьютере.
// Раздаёт игру на :8080 и пересылает сообщения WebSocket на :8081 по тому же протоколу,
// что и приложение (android/app/src/main/java/.../Relay.kt).
// Запуск: npm i ws && node tools/relay.js   → хост: http://localhost:8080/?host=<ваш IP>
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = Number(process.env.HTTP_PORT || 8080), WS_PORT = Number(process.env.WS_PORT || 8081);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('нет файла'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
}).listen(HTTP_PORT);

const wss = new WebSocketServer({ port: WS_PORT });
let host = null, next = 1;
const players = new Map();      // id → сокет

wss.on('connection', (ws, req) => {
  if ((req.url || '').includes('role=host')) {
    if (host) host.close();
    host = ws;
    for (const id of players.keys()) ws.send(JSON.stringify({ t: 'open', id }));
    for (const p of players.values()) p.send('{"t":"rehello"}');
    ws.on('message', data => {
      let env; try { env = JSON.parse(String(data)); } catch (e) { return; }
      const targets = env.to === 'all' ? [...players.keys()] : (env.to || []);
      for (const id of targets) { const p = players.get(id); if (p && p.readyState === 1) p.send(env.m); }
    });
    ws.on('close', () => { if (host === ws) host = null; });
    return;
  }
  const id = next++;
  players.set(id, ws);
  if (host) host.send(JSON.stringify({ t: 'open', id }));
  ws.on('message', data => { if (host) host.send(JSON.stringify({ t: 'from', id, m: String(data) })); });
  ws.on('close', () => { players.delete(id); if (host) host.send(JSON.stringify({ t: 'close', id })); });
});
console.log(`Баай: игра на :${HTTP_PORT}, сообщения на :${WS_PORT}`);
