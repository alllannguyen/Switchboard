const http = require('http');

const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || '1';
const MESSAGE = process.env.APP_MESSAGE || 'Hello from Switchboard';
const COLOR = process.env.APP_COLOR || '#2563eb';
const BROKEN = process.env.BROKEN === 'true';

const page = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo App v${VERSION}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font-family: system-ui, sans-serif; background: ${COLOR}; color: #fff; }
    main { text-align: center; }
    h1 { font-size: 6rem; margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>v${VERSION}</h1>
    <p>${MESSAGE}</p>
  </main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const status = BROKEN ? 500 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: BROKEN ? 'unhealthy' : 'ok', version: VERSION }));
    return;
  }
  if (BROKEN) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
});

server.listen(PORT, () => console.log(`demo-app v${VERSION} listening on ${PORT}`));
