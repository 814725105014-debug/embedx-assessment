/**
 * Preview Static HTTP Server for EMBEDX Quiz Portal
 * Mirrors Firebase Hosting (`public/`, `cleanUrls: true`) and binds to 0.0.0.0
 * so the Arena Live Preview works seamlessly in any browser/mobile viewport.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/') {
      pathname = '/index.html';
    } else if (pathname !== '/' && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Prevent directory traversal
    const safeRelPath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    let filePath = path.join(PUBLIC_DIR, safeRelPath);

    // Support Firebase Hosting `cleanUrls: true` (e.g., /admin -> /admin.html, /verify -> /verify.html)
    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
      const htmlCandidate = `${filePath}.html`;
      if (fs.existsSync(htmlCandidate)) {
        filePath = htmlCandidate;
      }
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>404</title><body style="font-family:sans-serif;background:#070c18;color:#fff;padding:32px;"><h2>404 — Page Not Found</h2><p><a href="/" style="color:#38bdf8;">Return to Quiz Portal</a></p></body>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`EMBEDX Quiz Portal live at http://${HOST}:${PORT}`);
});
