// Single-origin reverse proxy for the shareable demo tunnel.
//
// Serves the whole app on ONE port so a single tunnel can expose it:
//   /auth,/health,/campaigns,/tasks,/me -> backend  (http://127.0.0.1:3000)
//   everything else                     -> prototype static (http://127.0.0.1:8000)
//
// Because the page and the API share one origin through the tunnel, there is no
// CORS and no mixed-content to worry about. Dependency-free (node:http only).
//
// Env overrides: PROXY_PORT (8080), BACKEND_PORT (3000), STATIC_PORT (8000).
import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT || 8080);
const BACKEND = { host: '127.0.0.1', port: Number(process.env.BACKEND_PORT || 3000) };
const STATIC = { host: '127.0.0.1', port: Number(process.env.STATIC_PORT || 8000) };
const API_PREFIXES = ['/auth', '/health', '/campaigns', '/tasks', '/me'];

const isApi = (url) =>
  API_PREFIXES.some(
    (p) => url === p || url.startsWith(p + '/') || url.startsWith(p + '?'),
  );

const server = http.createServer((req, res) => {
  const target = isApi(req.url) ? BACKEND : STATIC;
  const proxyReq = http.request(
    {
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${target.host}:${target.port}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(
      `demo-proxy: upstream ${target.host}:${target.port} unreachable — ${err.message}\n` +
        `Is the ${target.port === BACKEND.port ? 'backend (npm run start:dev)' : 'prototype (npm run web:preview)'} running?`,
    );
  });
  req.pipe(proxyReq);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `demo-proxy on http://0.0.0.0:${PORT}  (/auth,/health -> :${BACKEND.port}, else -> :${STATIC.port})`,
  );
});
