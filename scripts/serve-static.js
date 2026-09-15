'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);

  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (statError, stats) => {
    const target = !statError && stats.isDirectory() ? path.join(file, 'index.html') : file;
    fs.readFile(target, (readError, body) => {
      if (readError) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      });
      response.end(body);
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Declarafy test server: http://127.0.0.1:${port}`);
});
