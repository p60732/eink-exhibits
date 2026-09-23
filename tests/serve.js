// 本機測試伺服器:靜態檔 + /api 轉給模擬 GAS。node tests/serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv } = require('./fake-gas');
const port = +process.argv[2] || 8787, root = path.join(__dirname, '..');
const G = makeEnv(); G.ctx.Memory.setup();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url === '/api' && req.method === 'POST') {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(G.ctx.doPost({ postData: { contents: b } }).t);
    }); return;
  }
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(f);
  if (f.endsWith('connect.js')) body = body.toString().replace('__GAS_URL__', `http://localhost:${port}/api`);
  res.writeHead(200, { 'Content-Type': (types[path.extname(f)] || 'text/plain') + ';charset=utf-8' }); res.end(body);
}).listen(port, () => console.log('http://localhost:' + port));
